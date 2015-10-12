/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// The grammar and parsing of markdown _blocks_ (i.e. paragraphs, lists, tables, etc.)
module block

import std/string
import std/regex
import std/dict
import common
import attributes

/* --------------------------------------
 Block elements 
---------------------------------------- */

// A block element
public type block {
  HLine( attrs : attrs = attrsNone)                           
  Blank( text : string )                       // blank line (only used inside lists)
  Line( text : string, loose : bool = False, attrs : attrs = attrsNone )  // a single line of text (only used inside lists)
  Para( text : string, attrs : attrs = attrsNone )
  Code( text : string, language : string = "", attrs : attrs = attrsNone )  
  Quote( content : list<block>, attrs : attrs = attrsNone )
  List( tag : string, content : list<block>, attrs : attrs = attrsNone )
  Item( content : list<block>, attrs : attrs = attrsNone )
  Heading( depth : int, text : string, attrs : attrs = attrsNone )
  Table( header: list<row>, columnAttrs : list<attrs>, cells : list<row>, attrs : attrs = attrsNone )
  DefLink( id : string, link : link )
  DefFootnote( id : string, content : list<block> )
  Empty()
  Div( content : list<block>, attrs : attrs = attrsNone )
  Source( text : string, input : input = Markdown(), parentAttrs : attrs = attrsNone )     // raw content
  Special( name : string, value : string = "", attrs : attrs = attrsNone )  // Special blocks, like [TOC] or [FOOTNOTES]
}

/* --------------------------------------
 Block grammar 
---------------------------------------- */

// regular expression for content inside a start HTML tag
val inlineTags  = [ "a","em","strong","small","s","cite","q","dfn","abbr","data","time","code",
                    "var","samp","kbd","sub","sup","i","b","u","mark","ruby","rt","rp","bdi","bdo",
                    "span","br","wbr","ins","del","img" ]
val atag        = @"(?!(?:" + inlineTags.join("|") + @")\b)\w+(?!:/|@)\b"
val comment     = @"!--[\s\S]*?-->"
public val tagContent  = @"(?:""[^""]*""|'[^']*'|[^'"">])*"
val closedTag   = @"(" + atag + @")[\s\S]+?</\1>"
val soloTag     = @"" + atag + tagContent + ">"
val html        = @"<(?:" + [closedTag,soloTag,comment].join("|") + @") *(?:\n+|\s*$)"

// Attributes: allow escaped newline
val rattrs      = @"\{:?((?:[^\\'""\}\n]|\\[.\n]|'[^']*'|""[^""]*"")*)\}" // allow optional colon for maraku compat
val xattrs      = rattrs + " *"  
val iattrs      = "(?:" + xattrs + ")?"           // inline: headers and fences
val pattrs      = @"(?: {0,3}" + xattrs + ")?"    // after a paragraph
val battrs      = @"(?:\n {0,3}" + xattrs + ")?"  // after a block element
val lattrs      = @"\n {0,3}" + xattrs + @"\s*$"  // after a list (separate for efficiency)

// Various
val xlinkid     = @"((?:[^\[\]\n]|\[[^\]\n]*\])*)"
val hr          = @"(?:[*_\-](?: *[*_\-]){2,}) *" + iattrs + @"(?:\n+|$)"

val bull        = @"(?:[*+\-]|(?:\d+|[#iIaA])[\.\)])"
val bullrest    = @"(?:[*+\-]|(?:\d+|[#a-zA-Z]|" + lroman + "|" + uroman + @")[\.\)])"
val lroman      = @"(?:x?(?:i(?:v|x|i|ii)?|[vx]i{0,3}))"
val uroman      = @"(?:X?(?:I(?:V|X|I|II)?|[VX]I{0,3}))" 

val endlist     = hr + @"|\n(?! )(?!\1" + bull + @" )"
val alist       = @"( *)(" + bull + @") ([\s\S]+?)(?=\n(?:" + endlist + @")|$)\n?"
val endpara     = @" *(?:<" + atag + @"|```|~+|>.|#{1,6} |\[" + xlinkid + @"\]:|" 
                            + hr + @"|.+?\n *(?:===|---)|" + xattrs + "(?:\n|$))"

val notbspecialx= @"(?:[^ \[\*\-_\+\d><#`~\niIaA]|[iIaA](?!\.))" // not special block start sequence
val notbspecial = @"(?:[^ \[\*\-_\+\d><#`~\niIaA]|[iIaA](?!\.))" // not special block start sequence

// deflist
val defitem     = @"(?:(?:\* (.*))|((?:" + notbspecial + @").*))\n\n?" 
val defstart    = @"(?:[:]| {1,2}[~:])"
val defdef      = @"(?:.*(?:\n|$)(?:(?:    .*)?(?:\n|$))*)"
val defdefs     = @"(?:" + defstart + defdef + ")+"
val deflist     = @"^(?:" + defitem + defdefs + ")+" + pattrs 

// Tables
val rxtableHeader = @"((?:(?:\| *|\+)[-=][-=+| ]*\n *)?(?:\| *[^-=~: ].+\n *)*)"
val rxtableSep    = @"((?:\| *|\+)[-=~:](?:[-=~+| :]|" + xattrs + ")*)\n"
val rxtableBody   = @"((?: *(?:\||\+[-=]).*(?:\n|$))+)"

// The main block grammar
val blockGrammar : grammar<block,blockContext> = [
  Rule("lheading",   regex(@"^(?!    )([^ \n].*?)" + iattrs + @"\n *(===+|---+) *(?:\n+|$)"), blockHeadingLine ), 
  Rule("deflist",    regex(deflist), blockDefList ),
  Rule("parax",      regex(@"^(" + notbspecial + @"[^|\n]*?(?:\n|$)(?:(?!" + endpara + @").+(?:\n|$))*)" + pattrs + @"\n*"), blockPara ), 

  Rule("code",       regex(@"^(    (?:.|\n+    )*)\n*"), blockCode ),  
  Rule("html",       regex(@"^ *" + html), blockHtml ),
  Rule("deflink",    regex(@"^ *\[(?!\^)" + xlinkid + @"\]: *<?((?:[^\\\s>]|\\(?:.|\n *))+)>?(?: +[""(]((?:[^\n\\]|\\(?:.|\n *))+)["")])?(?: |\\\n *)*" +iattrs+ @"(\n+|$)"), blockDefLink ),
  Rule("deffootnote",regex(@"^ *\[\^" + xlinkid + @"\]: *(?:\n {4})?(.*(?:\n+ {4}.*)*)(?:\n+|$)"), blockDefFootnote),
  Rule("hline",      regex(@"^ *" + hr), blockHLine ),
    
  Rule("list",       regex(@"^" + alist), blockList ),  // before heading due to #.
  Rule("heading",    regex(@"^ *(#{1,6}) *(.+?) *#* *" + iattrs + @"(?:\n+|$)"), blockHeading ),
  Rule("blockquote", regex(@"^((?: *>.+(?:\n[^{\n]+)*\n*)+)" + battrs + "(?:\n+|$)"), blockQuote ),
  Rule("fenced",     regex(@"^ *(```+) *(?:([^{}\s]+) *)?" + iattrs + @"\n([\s\S]+?)\n *\1 *(?:\n+|$)"), blockFencedCode ),

  Rule("table",      regex(@"^ *" + rxtableHeader + rxtableSep + rxtableBody + pattrs + @"\n*"), blockTable ),
  Rule("nptable",    regex(@"^ *(\S[^|\n]*?\|.*?)\n *([-=~:]+ *\|[-=~| :]*)\n((?:.*\|.*(?:\n|$))*)" + pattrs + @"\n*"), blockNpTable ),

  Rule("divnamed",   regex(@"^ *(~+) *[Bb]egin +([\w\d\-]*) *" + iattrs + @"\n([\s\S]*?)\n *\1 *[Ee]nd +\2 *(?:\n+|$)"), blockDiv ),
  Rule("div",        regex(@"^ *(~+) *([\w\d\-]*) *" + iattrs + @"\n([\s\S]*?)\n *\1 *(?:\n+|$)"), blockDiv ),

  Rule("special",    regex(@"^ *\[ *(TOC|FOOTNOTES|TITLE)(?: *= *([\w-]*))? *\] *\n*"), blockSpecial ), 
  Rule("para",       regex(@"^(.+(?:\n|$)(?:(?!" + endpara + @").+(?:\n|$))*)" + pattrs + @"\n*"), blockPara ), 
  Rule("blank",      regex(@"^\n+"), blockBlank ),
  ruleLine,
]

val ruleLine = Rule("para-line",  regex(@"^.+(\n|$)"), blockLine)
val ruleLineX= Rule("parax-line", regex(@"^" + notbspecial + @".*(\n|$)"), blockLine)

val blockListGrammar = blockGrammar.ruleReplace( True, ruleLineX )
                                   .ruleReplace( True, ruleLine  )

/* --------------------------------------
  The context for blocks 
---------------------------------------- */

// The parse context for block elements.
rectype blockContext {
  // The parse context for block elements. Contains the "parse" function,
  // and the current "grammar". 
  BlockContext( grammar : grammar<block,blockContext>,
                listGrammar : grammar<block,blockContext>,
                citestyle : citestyle,
                metadata : dict<string>,
                bench   : bool,
                pedantic : bool,
                loose   : bool = False,
                lineNo  : int = 0,
                lineMap : lineMap
              )
}



/* --------------------------------------
 Block element functions 
---------------------------------------- */
function blockSpecial( cap : matched, context : blockContext ) : block {  
  function joinnl( lines : list<string> ) : string {
    lines.map(fun(line) { line + "\n" }).join
  }
  function mkblock( name, content : list<string>, lineno = context.lineNo ) : list<string> {
    if (content.isNil) then [] else ["~ Begin " + name + " { line-adjust=0 line=" + lineno.show + " }"] + content + ["~ End " + name]
  }
  function entry(name, className = name) {
    match(context.metadata[name]) {
      Just(value) | value.trim != "" 
        -> mkblock(className, ["&" + name + ";"])
      _ -> []
    }
  }
  function readInt(name,default = 0) {
    match(context.metadata[name]) {
      Just(value) -> value.trim.parseIntDefault(default)
      Nothing     -> default
    }
  }
  function group( xs : list<a>, n : int = 3, acc : list<a> = xs ) : list<list<a>> {
    match(xs) {
      Nil -> Nil
      Cons(_,xx) -> { // just for termination proof
        match( acc ) {
          Nil -> Nil
          _   -> Cons( acc.take(n), group(xx, n, acc.drop(n) ) )
        }
      }
    }
  }
  function author( idx : int ) : list<string> {
    mkblock("Author", 
      [entry("author" + idx.show, "AuthorName"),
       entry("affiliation" + idx.show, "AuthorAddress"),
       entry("address" + idx.show, "AuthorAddress"),
       entry("author-note" + idx.show, "AuthorNote"),
       entry("email" + idx.show, "AuthorEmail")].concat)
  }
  function authorRow( idxs : list<int> ) : list<string> {
    mkblock("AuthorRow", idxs.concat(author))
  }
  if (cap.groups[1].toLower == "title") {
    val authorCount = readInt("author-count")
    val titleBlock = [
        mkblock("TitleHeader", entry("title","Title")  + entry("subtitle","Subtitle") + entry("sub-title","Subtitle") + entry("title-note","TitleNote") ),
        mkblock("Authors", list(1,authorCount).group(readInt("author-columns",3)).concat(authorRow) ),
        entry("title-footer","TitleFooter")
      ].concat.join("\n")
    Div( [], "line-adjust=0".parseAttrs("titleblock",source=titleBlock))
  }
  else {
    Special(cap.groups[1],cap.groups[2])
  }
}

function blockPara( cap : matched, _context ) : block {
  Para(cap.groups[1], cap.groups[5].parseAttrs )
}
  
function blockDefLink( cap : matched, context : blockContext ) :  block {
  val id = cap.groups[1].definitionId
  DefLink(id, newLink(cap.groups[2].joinLines, cap.groups[3].joinLines, cap.groups[4].parseAttrs, id, context.bench ))
}

function blockLine( cap : matched, context : blockContext ) : block {
  Line(cap.matched, context.loose )
}

function blockBlank( cap : matched, _context ) : block {
  Blank(cap.matched)
}

function blockHLine( cap : matched, _context ) : block {
  HLine(cap.groups[1].parseAttrs)
}

function blockHtml( cap : matched, context : blockContext ) :  block  {
  Source(cap.matched,Raw(Just(FmtHtml)),attrsNone)
}

function blockHeading( cap : matched, context : blockContext ) : block  {
  Heading(cap.groups[1].length, cap.groups[2], cap.groups[3].parseAttrs)
}

function blockHeadingLine( cap : matched, context : blockContext ) : block {
  Heading( (if (cap.groups[3].substr(0,1) == "=") then 1 else 2), 
              cap.groups[1], cap.groups[2].parseAttrs )
}

function blockCode( cap : matched, context : blockContext ) : block  {
  val source = cap.groups[1].replaceAll(rxindent4,"")
  Code(source, "", 
          if (!(context.pedantic || context.bench)) then attrsNone.addClass("pre-indented") else attrsNone)
  //if (context.bench)
  // then Code(cap.groups[1].replaceAll(rxindent4,"")) 
  // else Div([], parseAttrs("","pre",cap.groups[1].replaceAll(rxindent4,"")))
}

function blockFencedCode( cap : matched, context : blockContext ) {
  val attrs = cap.groups[3].parseAttrs
  Code(cap.groups[4], cap.groups[2], 
        if (!(context.pedantic || context.bench)) 
          then attrs.addClasses(["pre-fenced","pre-fenced" + cap.groups[1].length.show]) 
          else attrs)
}

function blockQuote( cap : matched, context : blockContext ) : block {
  val text = cap.groups[1].replaceAll(rxquotePrefix,"")
  //mtrace("---")
  val content = parseBlocks(context,text)
  //mtrace("--- end quote")
  Quote(content,cap.groups[2].parseAttrs)
}
val rxquotePrefix = regex(@"^ *> ?",multiline=True)

function blockDiv( cap : matched, context : blockContext ) : block {
  val cname = cap.groups[2].definitionId
  val attrs = cap.groups[3].parseAttrs(cname,source=cap.groups[4])
  Div( [], attrs )
}

function blockDefFootnote( cap : matched, context : blockContext ) :  block {
  val id  = cap.groups[1].definitionId
  val txt = "~ Begin Footnote { id='fn-" + id + "' }\n" +
               cap.groups[2].replaceAll(rxindent4,"") + "\n" +
            "~ End Footnote"
  DefFootnote(id, parseBlocks(context,txt))
}

// --------------------------------
// Definition Lists

function blockDefList( cap : matched, context : blockContext ) : block {
  function parseItem( extraAttrs : string, icap : matched, line : int, icontext : blockContext ) :  list<block> {
    //trace("item:\n" + icap.matched)
    val item = icap.groups[4].replaceAll(rxindent4,"") 
    val attrs = icap.groups[3].parseAttrs("dd",source=item)
    val term  = if (icap.groups[1]=="") then icap.groups[2] else icap.groups[1]
    val dterm = if (term=="") then [] else {
                  val attrsd = parseAttrs(extraAttrs,"dt",source=term)
                  [Div([Line(term)],attrsd)]
                }
    val ddesc = Div(parseBlocks(icontext,item,line), 
                          if (line <= 0) then attrs else attrs.setLineNo(context.lineMap,line))
    [ddesc] + dterm
  }

  blockListX( cap.matched.trim, context, "dl", ".dl", rxDefItem, parseItem )
}
val rxDefItem = regex( @"^(?:" + defitem + @")?" + defstart + "(?:" + iattrs + @")? *(" + defdef + ")" )

// --------------------------------
// Lists

function blockList( cap : matched, context : blockContext ) : block {
  val tag  = if (cap.groups[2].length > 1) then "ol" else "ul"

  function parseItem( extraAttrs : string, icap : matched, line : int, icontext : blockContext ) :  list<block> {
    val item = icap.groups[4].replaceAll(if (icontext.pedantic) 
                                           then rxindent4
                                           else rxindent(icap.groups[1].length) ,"") 
    val attrs = (extraAttrs + " " + icap.groups[3]).parseAttrs("li", item)
    [Item(parseBlocks(icontext,item,line), 
           if (line <= 0) then attrs else attrs.setLineNo(context.lineMap,line))]
  }

  val bull = cap.groups[2].substr(0,1)
  val attrs0  = if (bull=="*")   then ".list-star"
                 elif (bull=="+") then ".list-plus"
                 elif (bull=="-") then ".list-dash"
                 elif (bull=="i") then "list-style-type=lower-roman"
                 elif (bull=="I") then "list-style-type=upper-roman"
                 elif (bull=="a") then "list-style-type=lower-alpha"
                 elif (bull=="A") then "list-style-type=upper-alpha"
                 else ""
  val attrs1 = if (cap.groups[2].endsWith(")")) then attrs0 + " .list-sep-paren"
               elif (cap.groups[2].endsWith(")")) then attrs0 + " .list-sep-dot"
               else attrs0
  blockListX( cap.matched, context, tag, "." + tag + " " + attrs1, rxitem, parseItem )
}
val rxitem      = regex(@"^(( *)(?:" + bullrest + @") +)(?:" + iattrs + @")?(.*(?:\n(?!\2" + bullrest + @" ).*)*\n?)",multiline=True);

function blockListX( text : string, context : blockContext, 
                     tag : string, attrsInit : string, rxParseItem : regex, parseItem : (string,matched,int,blockContext) -> list<block> ) : block
{  
  val loose = text.contains(blankline)
  // we should merge any text blocks into a paragraph for a loose list
  // in sane mode, we only make text blocks paragraphs if they are followed by a blank line
  val icontext = context(grammar = // context.grammar.filter( fun(r) { !(r.name.startsWith("paragraph")) }), 
                         context.listGrammar,
                         loose = loose) // if (context.sane) then False else loose)
  

  val (txt,attrsTxt) = match(text.find(rxlattrs)) {
    Just(acap) -> (text.substr(0,text.length - acap.matched.length), attrsInit + " " + acap.groups[1])
    Nothing    -> (text,attrsInit)
  }
  val attrs0 = attrsTxt.parseAttrs(tag).addClasses( [if (loose) then "loose" else "compact"] )
  val attrs = match (txt.find(rxFirstNum)) {
                Nothing    -> attrs0
                Just(icap) -> {
                  val num = icap.groups[1].parseInt.maybe(1,id)
                  if (num==1) then attrs0
                   else attrs0.addKeyval("start",icap.groups[1])
                }
              } 

  val extraAttrs = attrs.classes.map( fun(cls) { "." + cls + "-li" } ).join(" ")              

  function parseItems( src : string, line : int, acc : list<block> = Nil ) {
    match (src.find(rxParseItem)) {
      Nothing    -> acc.reverse
      Just(icap) -> {
        val newline = if (line <= 0) then line else line + icap.matched.count("\n") 
        parseItems( src.substr1(icap.next), newline, parseItem(extraAttrs,icap,line,icontext) + acc)
      }
    }
  }
  
  // if loose then add a blank at the end of the last item so it has a Blank
  val items = parseItems( txt + (if (loose) then "\n\n" else ""), context.lineNo ) 
  List(tag,items,attrs)
}

val rxlattrs    = regex(lattrs)
val blankline   = regex(@"\n\n(?!\s*$)")
val rxindent4   = regex(@"^    ",multiline=True)
val rxFirstNum  = regex(@"^ *(\d+)\.")

function rxindent(i : int ) : regex { 
  if (i==4) then rxindent4x 
  elif (i==5) then rxindent5x
  elif (i==2) then rxindent2x
  elif (i==3) then rxindent3x
  else regex(@"^ {1," + i.show + "}",multiline=True)
}
val rxindent2x  = regex(@"^  ?",multiline=True)
val rxindent3x  = regex(@"^ {1,3}",multiline=True)
val rxindent4x  = regex(@"^ {1,4}",multiline=True)
val rxindent5x  = regex(@"^ {1,5}",multiline=True)


// --------------------------------
// Tables

function blockNpTable( cap : matched, context ) : block {
  val header = cap.groups[1].npcolumns(context,0)
  val cols   = cap.groups[2].npcolumns(context,1).cells.map(fun(c) { c.text.columnStyle } )
  val cells  = cap.groups[3].rows.mapIndexed( fun(i,row) { npcolumns(row,context,i+2) } )
  Table([header],cols,cells,cap.groups[4].parseAttrs)    
}  

function blockTable( cap : matched, context ) : block {
  val headers = if (cap.groups[1]=="") then [] else cap.groups[1].rows.mapIndexed( fun(i,row) { columns(row,context,i) } )
  val cols    = cap.groups[2].columnStyles
  val ofs     = headers.length + 1;
  val cells   = cap.groups[4].rows.mapIndexed( fun(i,row) { columns(row,context,i+ofs) })
  // create a horizontal line after the headers?
  val txts    = cols.map(source)
  val hline   = if (txts.all(fun(txt){txt==""})) then [] else [Row(txts.map(fun(t){ Cell(t) }))]
  Table(headers,cols,hline+cells,cap.groups[5].parseAttrs)    
}  

function npcolumns( row : string, context : blockContext, ofs : int ) : row {
  ("|" + row + "|").columns(context,ofs) 
}

function rows( body : string ) : list<string> {
  body.trimRight.split("\n").list
}

// Split a row into cells, keeping final separators ("|" or "+") at the end of each cell.
function columns( row : string, context : blockContext, ofs: int ) : row {
  // Note: we allow "+" to separate for dashed lines. So we carefully split on "+" too
  // as long as such "+" is followed by dashes or double-dash.
  val cells = row.findAll(rxCell).list.map( fun(cap) { Cell(cap.groups[1]) })
  val attrs = row.find(rxRowAttr).maybe(attrsNone, fun(cap) { cap.groups[1].parseAttrs("tr")  })
  Row(cells, if(context.lineNo > 0) then attrs.setLineNo(context.lineMap, context.lineNo + ofs) else attrs)
}

val rxCell = regex(@"(?:^ *(?:\||\+(?=[-=])))?((?:[^\\|+]|\\.|\+ *(?![-=]))+(?:[|]+|[+]+(?= *[-=])|$))")
val rxRowAttr = regex(@"[\+\|]" + xattrs + "$")

// split the separator row in cells, and include the separators for determining the column style
function columnStyles( row : string ) : list<attrs> {
  row.findAll(regex(@"[|+][^|+]+(?:[|+] *$)?")).list
    .map(fun(cap) { cap.matched }).map(columnStyle) 
}

function columnStyle( style : string ) : attrs {
  match(style.find(regex(@"^([|+])? *(:)?([ ~=-]*)(?:" + xattrs + ")?([ ~=-]*)(:)? *(?:([|+]) *)?$"))) {
    Nothing    -> attrsNone // should not happen?
    Just(ccap) -> {
      val align = if (ccap.groups.matchedOn(2))
                   then (if (ccap.groups.matchedOn(6)) then " text-align=center" else " text-align=left")
                   else (if (ccap.groups.matchedOn(6)) then " text-align=right" else "")
      val borders = (if (ccap.groups[1]!="+") then "" else " .cell-border-left") +
                    (if (ccap.groups[7]!="+") then "" else " .cell-border-right")
      val c = (ccap.groups[3] + ccap.groups[5]).trim.substr(0,1)
      val content = if (c=="=") then "===" elif (c=="-") then "---" else ""
      (ccap.groups[4] + align + borders).parseAttrs("col",content)
    }
  }
}



/* --------------------------------------
  Parse a text into blocks 
---------------------------------------- */

// Parse text into blocks
public function parseBlocks( src : string, lineNo : int, lineMap : lineMap,
                             citestyle : citestyle = citeAuto, mdata : dict<string>,
                             bench : bool = False,
                             pedantic : bool = False
                             )  : list<block>
{
  val bcontext = BlockContext(blockGrammar,blockListGrammar,citestyle,mdata, bench,pedantic, False, lineNo, lineMap)
  parseBlocks(bcontext,src)
}

// Parse text into blocks
function parseBlocks( context : blockContext, src : string, line : int = 0 ) : list<block>
{
  val bs = if (line > 0) 
            then parseBlocksAccLine( context(lineNo = line), Nil, line, src )  
           elif (context.lineNo > 0)
            then parseBlocksAccLine(context, Nil, context.lineNo, src)
            else parseBlocksAcc( context, Nil, src)
  bs.reverse
}


function parseBlocksAcc( context : blockContext,  acc : list<block>, src : string ) : list<block>
{
  if (src=="") return acc;    
  val (block,next,_) = matchRules(context.grammar,context,src,raw)
  parseBlocksAcc( context, Cons(block,acc), src.substr1(next) )
} 

function parseBlocksAccLine( context : blockContext,  acc : list<block>, line : int, src : string ) : list<block>
{
  if (src=="") return acc;    
  val (block,next,matched) = matchRules(context.grammar,context(lineNo=line),src,raw)
  val line2  = line + matched.count("\n")
  val ofs    = match(matched.find(rxPreWhite)) {
                 Nothing   -> 0
                 Just(cap) -> cap.regex/matched.count("\n")
               }
  val block2 = block.adjustAttrs( fun(attrs:attrs) { 
    attrs.setLineNo(context.lineMap,line+ofs) 
  })
  parseBlocksAccLine( context, Cons(block2,acc), line2, src.substr1(next) )
}

val rxPreWhite = regex(@"^\s+")

function raw( s : string ) : block {
  Line(s)
}

public function setLineNo( attrs: attrs, lineMap: lineMap, lineNo : int ) : attrs {
  val srcline = translateLine(lineMap,lineNo)
  val attrs1 = if (attrs.hasKey("data-line").bool) then attrs else attrs.setLineNo(lineNo,srcline)  
  if (attrs1.hasClass("pre-fenced")) {
    val preline = translateLine(lineMap,lineNo+1)
    attrs1.addKeyval("data-line-code",preline)
  }
  else attrs1
}

function translateLine( lineInfos: lineMap, lineNo : int ) : string {
  match(lineInfos) {
    End -> lineNo.show
    Include(line,start,span,fileName,include,rest) -> {
      if (lineNo < line) 
       then lineNo.show
      elif (lineNo >= line + span)
       then translateLine( rest, lineNo - (span - 1))
       else line.show + ";" + fileName + ":" + translateLine(include,(lineNo - line) + start) 
    }
  }
}

function adjustAttrs( b : block, adjust : (attrs : attrs) -> attrs ) : block 
{
  match(b) {
    HLine( attrs ) -> HLine(adjust(attrs))
    Line( text,loose, attrs) -> Line(text,loose,adjust(attrs))
    Para( text, attrs ) -> Para(text,adjust(attrs))
    Code( text, language, attrs) -> Code( text, language, adjust(attrs))  
    Quote( content, attrs) -> Quote( content, adjust(attrs))
    List( tag, content, attrs) -> List( tag, content, adjust(attrs))
    Item( content, attrs) -> Item( content, adjust(attrs))
    Heading( depth, text, attrs) -> Heading( depth, text, adjust(attrs))
    Table( header, columnAttrs, cells, attrs) -> Table( header, columnAttrs, cells, adjust(attrs))
    Div( content, attrs) -> Div( content, adjust(attrs))
    Source( text, input, attrs) -> Source( text, input, adjust(attrs))  
    //DefLink( id, link) ->
    //DefFootnote( id, content) ->
    //Empty() ->    
    Special( name, value, attrs) ->  Special(name,value, adjust(attrs))// Special blocks, like [TOC] or [FOOTNOTES]
    _ -> b
  }
}
