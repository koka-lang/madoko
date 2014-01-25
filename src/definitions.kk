/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Process definitions: links, footnotes, labels, and counters
module definitions

import std/dict
import std/regex
import common
import options
import attributes
import block
import inline     
import formatBlock   // just the formatContext
import texParser

// Parse source into blocks (see "parseBlocks") and 
// process all definitions (see "parseDefinitions").
public function parseBody( fcontext : formatContext,
                           src : string,
                           metadata : metadata, 
                           tocDepth : int,
                           secBase : int,
                           secDepth : int ) :  div (list<block>,formatContext)
{
  parseDefinitions(fcontext, [Div([],"notag".parseAttrs("body",src))], 
                   metadata,tocDepth,secBase,secDepth)
}

// Visits all blocks and returns a dictionary of links, labels, footnotes,
// a footnote block, and a table-of-contents block. 
public function parseDefinitions( 
                     fcontext : formatContext,
                     blocks : list<block>,
                     metadata : metadata, 
                     tocDepth : int = 0,
                     secBase : int = 1,
                     secDepth : int = 6 ) :  div (list<block>,formatContext)
{
  if (fcontext.inlineContext.bench) 
    then parseDefinitionsBench(fcontext,blocks)
    else parseDefinitionsFull(fcontext,blocks,metadata,tocDepth,secBase,secDepth)
}

// Fast version for benchmarking
function parseDefinitionsBench( 
                     fcontext : formatContext,
                     blocks : list<block> ) :  div (list<block>,formatContext)
{
  val links  = mdict()

  blocks.foreach fun(block) {
    match(block) {
      DefLink(id,link) -> {
        links[id] := link          
      }
      _ -> ()
    }
  }

  (blocks, fcontext( fcontext.inlineContext.copy( links=links.freeze ), dict(), Empty)  )
}


// Full version that does attribute processing
function parseDefinitionsFull( 
                     fcontext : formatContext,
                     blocks : list<block>, 
                     mdata : metadata,
                     tocDepth : int = 0,
                     secBase : int,
                     secDepth : int ) :  div (list<block>,formatContext)
{
  val counters = mdict()
  val nested   = mdict()
  val labels   = mdict()
  val links    = mdict()
  val footnotes = mdict()
  var footnoteCount := 0
  var footnoteItems := Nil
  var tocs := mdict()
  var footnotesAtEnd := True
  
  // initialize defaults from metadata
  val mdefaultAttrs = mdict()
  mdata.initializeDefaults(mdefaultAttrs,labels,counters,nested)
  val defaultAttrs = mdefaultAttrs.freeze()

  // process attributes 
  function process( attrs : attrs, previousIsPar : bool, block : block ) : <div,st<_h>> block {
    bname = block.blockName
    
    // merge and set default attributes
    attrsd  = if (!(attrs.defaults)) then attrs
              else {
                attrsy = defaultAttrs.matchRules(bname,attrs)
                if (attrsy.name != "" && attrsy.label=="") then attrsy( label = "@"+bname ) else attrsy
              } 
    //adjust counters
    if (bname!="" && attrs.defaults) counters.adjustCounter(bname,"",nested)

    attrsd.common/counters.foreach fun(cv) {
      val (counter,value) = cv
      counters.adjustCounter(counter,value,nested)
    }

    // expand counters and #keys in label, before, and after
    attrsx = attrsd.expandCounters(counters,fcontext.inlineContext.metadata)

    // set label
    if (attrsx.name != "") then {
      labels["#" + attrsx.name] := Label(bname,attrsx.label)   
      match (attrsx.hasKey("cite-label")) {
        Nothing -> ()
        Just(clabel) -> {
          clabelx = clabel.expandKeys(attrsx.source,attrsx,fcontext.inlineContext.metadata)
          labels["@" + attrsx.name] := Label(bname,clabelx)
        }
      }
    }

    // paragraph indentation
    attrsp = match(block) {
      Para | previousIsPar -> attrsx.addClass("indent")
      _ -> attrsx
    }

    // render
    rblock = block.setAttrs(attrsp,fcontext) 

    // toc
    match (attrsp.hasKey("toc")) {
      Nothing -> ()
      Just(value) -> {
        entry = match(rblock) {
          Heading(d,txt,xs) -> {
            (d,xs.addKeyval("toc-line",txt))  // note: txt is processed already
          }
          _ -> {
            depth = attrsp.lookupKey("toc-depth","1").parseInt.maybe(1,id)
            (depth,attrsp)
          }
        }
        tocs[value.toLower] := Cons(entry, tocs[value.toLower].maybe([],id))
      }
    }

    // return
    rblock
  }

  // process a block
  function parseDefBlock( previousIsPar : bool,  block : block ) : <st<_h>,div> block {
    attrs : attrs = match(block) {
      DefLink(id,link) -> {
        links[id] := link
        attrsNone  
      }
      DefFootnote(id,content) -> {
        footnoteCount := footnoteCount+1
        ncontent = content.mapBlocks(parseDefBlock)
        footnotes[id] := Footnote(footnoteCount.show, fun(ictx){ formatBlocks(fcontext(inlineContext=ictx),ncontent) })
        footnoteItems := Cons(Item(content,Attrs(name="fn-" + id)),footnoteItems)        
        attrsNone
      }
      Para(attrs=xs)  -> xs
      Code(attrs=xs)  -> xs
      Quote(attrs=xs) -> xs
      List(attrs=xs)  -> xs
      Item(attrs=xs)  -> xs
      HLine(attrs=xs) -> xs
      Table(attrs=xs) -> xs
      Div(attrs=xs)   -> xs
      Heading(_,txt,xs) -> xs.generateHeaderId(txt)
      Special(name) -> {
        if (name == "FOOTNOTES") then footnotesAtEnd := False
        attrsNone
      }
      _ -> attrsNone
    }

    attrs.process( previousIsPar, block )
  }
  
  newblocks     = blocks.mapBlocks(parseDefBlock)
  tocBlocks     = //if (tocDepth <= 0) then Empty else createToc(headings.reverse)
                  (tocs.list.map fun(entry) {
                     (entry.fst, createToc(entry.snd.reverse,fcontext.inlineContext.metadata))
                   }).dict
  footnoteBlock = if (isNil(footnoteItems)) then Empty 
                   else Div([HLine(), List("ol", footnoteItems.reverse)],Attrs(classes=["footnotes"]))  
  fblocks       = if (!footnotesAtEnd) then newblocks else (newblocks + [Special("FOOTNOTES")])

  secblocks = newblocks.sections(secInit(secBase=secBase,secMax=secDepth))

  (secblocks,                   
   fcontext( fcontext.inlineContext.copy( links=links.freeze, labels=labels.freeze, 
                                          footnotes=footnotes.freeze, defaults=defaultAttrs ),
              tocBlocks, footnoteBlock )  )
}

struct secinfo(
  level   : int,  // current level; start at 1
  secMax  : int,  // max level for sections 
  secBase : int   // level used is max(base,level) 
)

val secInit = Secinfo(1,6,1)
val secNone = Secinfo(1,0,1)

function mapBlocks( blocks : list<block>, 
                    action : (bool,block) -> <st<h>,div|e> block  ) : <st<h>,div|e> list<block> {
  var previousIsPar := False
  blocks.map fun(block) {
    nblock = action(previousIsPar,block)
  
    match(nblock) {
      Para -> previousIsPar := True
      Div  | nblock.blockName == "figure" -> ()  // leave as is
      DefLink     -> ()
      DefFootnote -> ()
      _    -> previousIsPar := False
    }
    match(nblock) {
      Div(content,xs) -> {
        ncontent = match(content.mapBlocks(action)) {
          Cons(Para(txt,attrs),rest) | xs.tight
            -> Cons(Line(txt,False,attrs),rest)
          other -> other
        }
        Div(ncontent,xs)
      }
      Quote(content,xs)    -> Quote(content.mapBlocks(action),xs)
      List(tag,content,xs) -> List(tag,content.mapBlocks(action),xs)
      Item(content,xs)     -> Item(content.mapBlocks(action),xs)
      _ -> nblock
    }
  }
}

// Sets new attributes for a block, and applies conversion to text
function setAttrs( block : block, xs : attrs, fcontext : formatContext ) : block {
  match(block) {
    HLine(_)            -> HLine(xs)                           
    Para( text )        -> Para(xs.transformText(text,fcontext.inlineContext.metadata),xs)
    Heading(depth,text) -> Heading(depth,xs.transformText(text,fcontext.inlineContext.metadata),xs)
    Div( content  )     -> transformDiv(content, xs, fcontext )
    Quote( content )    -> Quote(content, xs) 
    Code( text, lang)   -> {
      if (lang=="" && !(xs.input.isPre))
        then transformDiv([Source(text)], xs(source=text,elem="pre"), fcontext )
        else Code(xs.transformText(text,fcontext.inlineContext.metadata),lang,xs)  
    }
    _                   -> block
  }
} 

function transformDiv( blocks : list<block>, attrs : attrs, fcontext : formatContext )  : block {
  //if (blocks.isCons) return Div(blocks,attrs) // for example, inserted sections
  citestyle = fcontext.inlineContext.citestyle
  //if (attrs.source=="") then return Div(blocks,attrs) 
  txt = attrs.transformText(attrs.source,fcontext.inlineContext.metadata)
  match(attrs.input) {
    Tex -> {      
      Div(txt.parseTex(citestyle,fcontext.inlineContext.verbose >= 4).parseBlocks(citestyle),attrs)
    }
    Markdown(monly) -> {
      match(monly) {
        Just(mfmt)  | !(mfmt == fcontext.fmt) -> Empty
        _ -> Div(txt.parseBlocks(citestyle),attrs)
      }
    }
    input -> {
      Div([Source(txt,input)],attrs)
    }
  }  
}

// Initialize default attributes and attributes from metadata
function initializeDefaults( metadata : metadata, defaultAttrs : mdict<h,string>, labels : mdict<h,label>, 
                             counters : mdict<h,counter>, nested : mdict<h,list<string>> ) : st<h> () {
  metadata.foreach fun(kv) {
    val (key,value) = kv
    if (key.startsWith("~") || key.startsWith("#") || key.startsWith(".")) then {
      // element attributes
      // name   = key.substr(1)  // no .#~
      attrs  = value.parseAttrs
      dattrs = if (!(attrs.defaults)) then attrs
               else match(defaultAttrs[key]) {
                 Nothing   -> attrs
                 Just(def) -> {
                   //trace("default merge " + name + ": " + attrs.classes.join(",") + "  def: " + def.classes.join(","))  
                   attrs.mergeDefault(def.parseAttrs) 
                 }
               }
      defaultAttrs[key] := dattrs.text
      //trace("default " + name + ": " + dattrs.show)  
      
      // initialize counters: necessary if one for example starts with a subsection 
      // without an initial section.
      dattrs.label.findAll(rxcounter).foreach fun(cap : matched) {
        counters.setCounter(cap.groups[1].definitionId,Counter(),nested)
      }
    }
    else {
      // label key
      labels["#" + key] := Label("metadata",value)
    }
  }
}

//--------------------------------------------------------
// Divide into sections
//--------------------------------------------------------

function sections( blocks : list<block>, secinfo : secinfo ) : div list<block>
{
  if (secinfo.level > secinfo.secMax) return blocks
  match (blocks.findHeading(secinfo)) {
    Nothing -> blocks.sectionMap(secinfo)
    Just((pre,h,post)) -> pre.sectionMap(secinfo) + h.sectionSpan(post,secinfo)
  }
}

function sectionMap( blocks : list<block>, secinfo : secinfo ) : div list<block> 
{
  if (secinfo.level > secinfo.secMax) return blocks
  blocks.map fun(block) {
    match(block) {
      Div(content,attrs) -> {
        Div(content.sections(secinfo),attrs)
      }
      _ -> block
    }
  }
}

function sectionSpan( h : block, blocks : list<block>,  secinfo : secinfo  ) : div list<block>
{
  function createSection(content) 
  {
    lvl = h.headingLevel(secinfo.level)
    nsecinfo = secinfo(level=lvl+1)
    ncontent = content.sections(nsecinfo)
    match(h) {
      Heading(d,txt,attrs) -> {
        secattrs = "html-elem=section .section" + d.show +
                     (if (attrs.name=="") then "" else " id='" + attrs.name + "'")
        hattrs = if (attrs.name=="") then attrs else attrs(name="heading-" + attrs.name)
        [Div(Cons(Heading(d,txt,hattrs),ncontent), secattrs.parseAttrs("section"))]
      }
      _ -> [h].sectionMap(nsecinfo) + ncontent
    }
  }

  match(blocks.findHeading(secinfo)) {
    Nothing -> blocks.createSection()
    Just((pre,hdr,post)) -> pre.createSection() + hdr.sectionSpan(post,secinfo)
  }    
}

function findHeading( blocks : list<block>, secinfo : secinfo ) : maybe<(list<block>,block,list<block>)>
{
  lvl = max(secinfo.level,secinfo.secBase)
  val (pre,post) = blocks.span(fun(b) { 
    d = b.headingLevel(lvl+1, lvl)
    (d > lvl) //  || d < secinfo.secMin
  })  
  match(post) {
    Cons(hdr,rest) -> Just((pre,hdr,rest))
    Nil -> Nothing
  }
}


function headingLevel( block : block, default : int, defaultSection : int = default ) : int {
  match(block) {
    Heading(d)   -> d
    Div(_,attrs) | attrs.hasClass("section") -> {
      match(attrs.hasKey("data-level")) {
        Just(value) -> value.parseInt.maybe(defaultSection,id)
        Nothing     -> defaultSection
      }
    }
    _  -> default
  }
}

//--------------------------------------------------------
// TOC
//--------------------------------------------------------


// Create a table of contents
function createToc( headings : list<(int,attrs)>, metadata : dict<string> ) : div block 
{
  Div( [headings.tocItems(0,metadata).tocList], Attrs(name="toc",classes=["toc"],htmlelem="nav") )
}

function tocList( items : list<block> ) : block {
  if (items.isNil) then Empty else Div(items, Attrs(classes=["tocblock"]))
}

function tocItems( headings : list<(int,attrs)>, outerDepth : int, metadata : dict<string> ) : div list<block> {
  match(headings) {
    Nil -> []
    Cons(hdr,hdrs) -> {
      val (depth,attrs) = hdr
      if (depth > outerDepth+1) then {
        [tocItems(headings,outerDepth+1,metadata).tocList]
      }
      else {
        val (subs,rest) = hdrs.span( fun(h) { h.fst > depth } )
        txt = attrs.lookupKey("toc-line","[??]").expandKeys(attrs.source,attrs,metadata)
        tocline = @"[\/" + txt + "](#" + attrs.name + ")"
        //trace("tocline: " + attrs.source)
        item = Div([Line(tocline)], Attrs(classes=["tocitem"], keyvals=[("toctarget",attrs.name), ("toclevel",depth.show)]))
        subitems = tocItems(subs,depth,metadata).tocList 
        Cons(item,Cons(subitems,tocItems(rest,outerDepth,metadata)))
      }
    }
  }
}

//--------------------------------------------------------
// counters
//--------------------------------------------------------

// expand counters in label
function expandCounters( attrs : attrs, counters : mdict<h,counter>, metadata : dict<string> ) : read<h> attrs {
  val xlab = attrs.label.expandKeys(attrs.source,attrs,metadata).expand(counters)
  if (xlab != attrs.label)
   then attrs(label=xlab)
   else attrs
}

// expand the counters in a string
function expand(lab : string, counters : mdict<h,counter> ) : read<h> string
{
  lab.replaceAll(rxcounter) fun(cap) {
    //trace("expand: " + lab + ": found: " + cap.groups[1] + " = " + counters[cap.groups[1]].string)
    match(counters[cap.groups[1].definitionId]) {
      Just(counter) -> counter.show
      Nothing       -> cap.matched
    }
  }  
}
val rxcounter = regex(@"(?:\\/)?@([\w\-]+)(?:\\/)?")



// adjust a counter
function adjustCounter(counters : mdict<h,counter>,name : string, value : string, nested : mdict<h,list<string>> ) : st<h> () {
  //trace("increment " + counter + " from " + counters[counter].string + " to " + incrementCounter(counters[counter].string,value))
  counters.setCounter( name, increment(counters[name].maybe(Counter(),id), value), nested )
  counters.resetNestedCounters(name,nested)
}

// increment or set a count to a value
function increment(counter :counter, xvalue : string) : counter {
  v = xvalue.toLower
  if (v=="upper-case") then counter(counter.value+1,Uppercase)
  elif (v=="lower-case") then counter(counter.value+1,Lowercase)
  elif (v=="arabic") then counter(counter.value+1,Arabic)
  elif (v=="") then counter(value=counter.value+1)
  else match(xvalue.list) {
    Cons(d,Nil) | d >= 'a' && d <= 'z' -> Counter((d-'a').int+1,Lowercase)
    Cons(d,Nil) | d >= 'A' && d <= 'Z' -> Counter((d-'A').int+1,Uppercase)
    _ -> match(v.parseInt) {
      Just(i) -> counter(value=i)
      Nothing -> {
        warning( "unrecognized counter value: " + xvalue)
        counter
      }
    }
  }
}

// reset lower counters (ie. for h1-h2, reset h1-h2-h3, h1-h2-h3-h4, ...)
function resetNestedCounters(counters : mdict<h,counter>, counter : string, nested : mdict<h,list<string>> ) : st<h> ()
{  
  match(nested[counter]) {
    Nothing -> ()
    Just(cnts) -> {
      cnts.foreach fun(cnt) {
        match(counters[cnt]) {
          Nothing -> ()
          Just(c) -> counters[cnt] := c(value=0)
        }
      }
    }
  }
}
 
function setCounter( counters : mdict<h,counter>, name : string, counter : counter, nested : mdict<h,list<string>> ) : st<h> ()
{   
  if (counters[name].isNothing) {
    nested.initializeCounter( name )
  }
  counters[name] := counter;
}

function initializeCounter( nested : mdict<h,list<string>>, name : string ) : st<h> ()
{
  prefixes = name.split("-").list.init
  prefixes.foreachIndexed fun(i,_) {
    pre = prefixes.take(i+1).join("-")
    nested[pre] := Cons(name, nested[pre].maybe([],id))
    //trace("nested: " + pre + ": " + nested[pre].maybe([],id).join(","))
  }
}



//--------------------------------------------------------
// counter type
//--------------------------------------------------------

// The display format of a counter
type format {
  Arabic
  Uppercase
  Lowercase
  // Roman
}

struct counter( value :int = 0, format :format = Arabic  )

function show( counter : counter ) : string {
  match(counter.format) {
    Uppercase -> counter.value.showLetterBase('A')
    Lowercase -> counter.value.showLetterBase('a')
    _ -> counter.value.show
  }
}

function showLetterBase( value : int, baseChar : char) : string {
  unsafeNoDiv {
    value.showRLetterBase(baseChar).reverse.string
  }
}

function showRLetterBase( value : int, baseChar : char ) : div list<char> {
  if (value <= 0) return []
  next = value/26
  mod  = value%26 - (if (next == 0) then 1 else 0)
  Cons(mod.char + baseChar, next.showRLetterBase(baseChar))
}


//--------------------------------------------------------
// Block names
//--------------------------------------------------------

function blockName(block : block) : string
{
  match(block) {
    Para  -> "p"
    Code  -> "pre"
    Quote -> "blockquote"
    List(tag) -> tag 
    Item  -> "li"
    HLine -> "hr"
    Table -> "table"
    Heading(depth=d) -> "h" + d.show
    Div(attrs=xs) -> xs.elementName("div")
    _     -> ""
  }
}
