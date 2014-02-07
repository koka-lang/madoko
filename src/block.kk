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
import common
import attributes
import texParser

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
  Special( name : string, value : string = "" )  // Special blocks, like [TOC] or [FOOTNOTES]
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
val html        = @"<(?:" + [closedTag,soloTag,comment].join("|") + @") *(?:\n{2,}|\s*$)"

// Attributes: allow escaped newline
val rattrs      = @"\{:?((?:[^\\'""\}\n]|\\[.\n]|'[^']*'|""[^""]*"")*)\}" // allow optional colon for maraku compat
val xattrs      = rattrs + " *"  
val iattrs      = "(?:" + xattrs + ")?"           // inline: headers and fences
val pattrs      = @"(?: {0,3}" + xattrs + ")?"    // after a paragraph
val battrs      = @"(?:\n {0,3}" + xattrs + ")?"  // after a block element
val lattrs      = @"\n {0,3}" + xattrs + @"\s*$"  // after a list (separate for efficiency)

// Various
val linkid      = @"((?:[^\[\]\n]|\[[^\]\n]*\])*)"
val hr          = @"(?:[*_\-](?: *[*_\-]){2,}) *" + iattrs + @"(?:\n+|$)"
val bull        = @"(?:[*+\-]|\d+\.)"

val endlist     = hr + @"|\n(?! )(?!\1" + bull + @" )"
val alist       = @"( *)(" + bull + @") [\s\S]+?(?=\n(?:" + endlist + @")|$)\n?"
val endpara     = @" *(?:<" + atag + @"|```|~+|>.|#{1,6} |\[" + linkid + @"\]:|" 
                            + hr + @"|.+?\n *(?:===|---)|" + xattrs + "(?:\n|$))"
val bspecial    = @" \[\*\-_\+\d><#`~\n|"  // Special block start characters 

// Tables
val rxtableHeader = @"((?:(?:\| *|\+)[-=][-=+| ]*\n *)?(?:\| *[^-=~: ].+\n *)*)"
val rxtableSep    = @"((?:\| *|\+)[-=~:](?:[-=~+| :]|" + xattrs + ")*)\n"
val rxtableBody   = @"((?: *(?:\||\+[-=]).*(?:\n|$))+)"

// The main block grammar
val blockGrammar : grammar<block,blockContext> = [
  Rule("lheading",   regex(@"^(?!    )([^ \n].*?)" + iattrs + @"\n *(===+|---+) *(?:\n+|$)"), blockHeadingLine ), 
  Rule("parax",      regex(@"^([^" + bspecial + @"][^|\n]*?(?:\n|$)(?:(?!" + endpara + @").+(?:\n|$))*)" + pattrs + @"\n*"), blockPara ), 

  Rule("code",       regex(@"^(    (?:.|\n+    )*)\n*"), blockCode ),  
  Rule("html",       regex(@"^ *" + html), blockHtml ),
  Rule("deflink",    regex(@"^ *\[(?!\^)" + linkid + @"\]: *<?((?:[^\\\s>]|\\(?:.|\n *))+)>?(?: +[""(]((?:[^\n\\]|\\(?:.|\n *))+)["")])?(?: |\\\n *)*" +iattrs+ @"(\n+|$)"), blockDefLink ),
  Rule("deffootnote",regex(@"^ *\[\^" + linkid + @"\]: *(?:\n {4})?(.*(?:\n+ {4}.*)*)(?:\n+|$)"), blockDefFootnote),
  Rule("hline",      regex(@"^ *" + hr), blockHLine ),
    
  Rule("heading",    regex(@"^ *(#{1,6}) *(.+?) *#* *" + iattrs + @"(?:\n+|$)"), blockHeading ),
  Rule("blockquote", regex(@"^((?: *>.+(?:\n[^{\n]+)*\n*)+)" + battrs + "(?:\n+|$)"), blockQuote ),
  Rule("fenced",     regex(@"^ *(```+) *(?:([^{}\s]+) *)?" + iattrs + @"\n([\s\S]+?)\n *\1 *(?:\n+|$)"), blockFencedCode ),

  Rule("list",       regex(@"^" + alist), blockList ), 
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
val ruleLineX= Rule("parax-line", regex(@"^[^" + bspecial + @"].*(\n|$)"), blockLine)

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
                bench   : bool,
                pedantic : bool,
                loose   : bool = False
              )
}



/* --------------------------------------
 Block element functions 
---------------------------------------- */
function blockSpecial( cap : matched, context : blockContext ) : block {  
  Special(cap.groups[1],cap.groups[2])
}

function blockPara( cap : matched, _context ) : block {
  Para(cap.groups[1], cap.groups[5].parseAttrs )
}
  
function blockDefLink( cap : matched, context : blockContext ) :  block {
  DefLink(cap.groups[1].definitionId, newLink(cap.groups[2].joinLines, cap.groups[3].joinLines, cap.groups[4].parseAttrs, context.bench ))
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

function blockCode( cap : matched, context ) : block  {
  Code(cap.groups[1].replaceAll(rxindent4,""))
  //if (context.bench)
  // then Code(cap.groups[1].replaceAll(rxindent4,"")) 
  // else Div([], parseAttrs("","pre",cap.groups[1].replaceAll(rxindent4,"")))
}

function blockFencedCode( cap : matched, context : blockContext ) {
  attrs = cap.groups[3].parseAttrs
  Code(cap.groups[4], cap.groups[2], 
        if (!(context.pedantic || context.bench)) then attrs.addClass("fenced") else attrs)
}

function blockQuote( cap : matched, context : blockContext ) : block {
  text = cap.groups[1].replaceAll(rxquotePrefix,"")
  //mtrace("---")
  content = parseBlocks(context,text)
  //mtrace("--- end quote")
  Quote(content,cap.groups[2].parseAttrs)
}
val rxquotePrefix = regex(@"^ *> ?",multiline=True)

function blockDiv( cap : matched, context : blockContext ) : block {
  cname = cap.groups[2].definitionId
  attrs = cap.groups[3].parseAttrs(cname,source=cap.groups[4])
  Div( [], attrs )
}

function blockDefFootnote( cap : matched, context : blockContext ) :  block {
  id  = cap.groups[1].definitionId
  txt = cap.groups[2].replaceAll(rxindent4,"") + 
          "\n[&#8617;](#fnref-" + id + "){.footnote-backref}"
  DefFootnote(id, parseBlocks(context,txt))
}

// --------------------------------
// Lists

function blockList( cap : matched, context : blockContext ) : block {
  loose = cap.matched.contains(blankline)
  // we should merge any text blocks into a paragraph for a loose list
  // in sane mode, we only make text blocks paragraphs if they are followed by a blank line
  icontext = context(grammar = // context.grammar.filter( fun(r) { !(r.name.startsWith("paragraph")) }), 
                               context.listGrammar,
                     loose = loose) // if (context.sane) then False else loose)


  function parseItem( icap : matched ) :  block {
    item = icap.groups[4].replaceAll(if (icontext.pedantic) 
                                       then rxindent4
                                       else rxindent(icap.groups[1].length) ,"") 
    attrs = icap.groups[3].parseAttrs
    Item(parseBlocks(icontext,item),attrs)
  }

  function parseItems( src : string, acc : list<block> = Nil ) {
    match (src.find(rxitem)) {
      Nothing    -> acc.reverse
      Just(icap) -> parseItems( src.substr1(icap.next),Cons(parseItem(icap),acc))
    }
  }

  val (txt,attrsTxt) = match(cap.matched.find(rxlattrs)) {
    Just(acap) -> (cap.matched.substr(0,cap.matched.length - acap.matched.length), acap.groups[1])
    Nothing    -> (cap.matched,"")
  }
  attrs0 = attrsTxt.parseAttrs.addClass(if (loose) then "loose" else "compact")
  attrs = match (txt.find(rxFirstNum)) {
            Nothing    -> attrs0
            Just(icap) -> {
              num = icap.groups[1].parseInt.maybe(1,id)
              if (num==1) then attrs0
               else attrs0.addKeyval("start",icap.groups[1])
            }
          } 
  // if loose then add a blank at the end of the last item so it has a Blank
  items = parseItems( txt + (if (loose) then "\n\n" else "")) 
  List(if (cap.groups[2].length > 1) then "ol" else "ul",items,attrs)
}

val rxlattrs    = regex(lattrs)
val blankline   = regex(@"\n\n(?!\s*$)")
val rxitem      = regex(@"^(( *)(?:" + bull + @") +)(?:" + iattrs + @")?(.*(?:\n(?!\2" + bull + @" ).*)*\n?)",multiline=True);
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

function blockNpTable( cap : matched, _context ) : block {
  header = cap.groups[1].npcolumns
  cols   = cap.groups[2].npcolumns.cells.map(fun(c) { c.text.columnStyle } )
  cells  = cap.groups[3].rows.map(npcolumns)
  Table([header],cols,cells,cap.groups[4].parseAttrs)    
}  

function blockTable( cap : matched, _context ) : block {
  headers = if (cap.groups[1]=="") then [] else cap.groups[1].rows.map(columns)
  cols    = cap.groups[2].columnStyles
  cells   = cap.groups[4].rows.map(columns)
  // create a horizontal line after the headers?
  txts    = cols.map(source)
  hline   = if (txts.all(fun(txt){txt==""})) then [] else [Row(txts.map(fun(t){ Cell(t) }))]
  Table(headers,cols,hline+cells,cap.groups[5].parseAttrs)    
}  

function npcolumns( row : string ) : row {
  ("|" + row + "|").columns
}

function rows( body : string ) : list<string> {
  body.trimRight.split("\n").list
}

// Split a row into cells, keeping final separators ("|" or "+") at the end of each cell.
function columns( row : string ) : row {
  // Note: we allow "+" to separate for dashed lines. So we carefully split on "+" too
  // as long as such "+" is followed by dashes or double-dash.
  cells = row.findAll(rxCell).list.map( fun(cap) { Cell(cap.groups[1]) })
  attrs = row.find(rxRowAttr).maybe(attrsNone, fun(cap) { cap.groups[1].parseAttrs("row")  })
  Row(cells,attrs)
}

val rxCell = regex(@"(?:^ *(?:\||\+(?=[-=])))?((?:[^\\|+]|\\.|\+ *(?![-=]))+(?:[|]+|[+]+(?= *[-=])|$))")
val rxRowAttr = regex(@"[\+\|]" + xattrs + "$")

// split the separator row in cells, and include the separators for determining the column style
function columnStyles( row : string ) : list<attrs> {
  row.findAll(regex(@"[|+][^|+]+(?:[|+] *$)?")).list.map(fun(cap) { cap.matched }).map(columnStyle) 
}

function columnStyle( style : string ) : attrs {
  match(style.find(regex(@"^([|+])? *(:)?([ ~=-]*)(?:" + xattrs + ")?([ ~=-]*)(:)? *([|+] *)?$"))) {
    Nothing    -> attrsNone // should not happen?
    Just(ccap) -> {
      align = if (ccap.groups.matchedOn(2))
               then (if (ccap.groups.matchedOn(6)) then " text-align=center" else " text-align=left")
               else (if (ccap.groups.matchedOn(6)) then " text-align=right" else "")
      borders = (if (ccap.groups[1]!="+") then "" else " .cell-border-left") +
                (if (ccap.groups[7]!="+") then "" else " .cell-border-right")
      c = (ccap.groups[3] + ccap.groups[5]).trim.substr(0,1)
      content = if (c=="=") then "===" elif (c=="-") then "---" else ""
      (ccap.groups[4] + align + borders).parseAttrs("",content)
    }
  }
}



/* --------------------------------------
  Parse a text into blocks 
---------------------------------------- */

// Parse text into blocks
public function parseBlocks( src : string,
                             citestyle : citestyle = citeAuto, 
                             bench : bool = False,
                             pedantic : bool = False )  : list<block>
{
  bcontext = BlockContext(blockGrammar,blockListGrammar,citestyle,bench,pedantic, False)
  parseBlocks(bcontext,src)
}

// Parse text into blocks
function parseBlocks( context : blockContext, src : string ) : list<block>
{
  parseBlocksAcc(context, Nil, src).reverse
}

function parseBlocksAcc( context : blockContext,  acc : list<block>, src : string ) : list<block>
{
  if (src=="") return acc;    
  val (block,next) = matchRules(context.grammar,context,src,raw)
  parseBlocksAcc( context, Cons(block,acc), src.substr1(next) )
}

function raw( s : string ) : block {
  Line(s)
}
