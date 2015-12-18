/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Format _block_ elements and and their inline elements.
module formatBlock

import std/string
import std/regex
import std/dict
import std/log
import common
import attributes // mergeDefault
import block
import inline
import formatInline
import htmlFormatter
import texFormatter


public struct formatContext( 
  inlineContext : inlineContext,
  tocBlocks   : dict<list<block>>,
  footnoteBlock : block,
  headingBase: int,
  langPrefix : string,
  pedantic : bool,
  lineMap : lineMap,
  fmt : formatter = FmtHtml
)

public function initialFormatContext( icontext : inlineContext, lineMap: lineMap, 
                                      headingBase : int, pedantic : bool, fmt : formatter ) {
  FormatContext(icontext,dict(),Empty,headingBase,"language-",pedantic, lineMap, fmt)
}

function fmtEnv( context : formatContext, env : string, txt : string, attrs : attrs = attrsNone ) : string {
  match(context.fmt) {
    FmtHtml | context.inlineContext.bench -> tagEnv(env, txt, attrs, context.inlineContext.sanitize) // inline for efficiency
    _ -> context.inlineContext.fmtEnv(env,txt,attrs)
  }
}

function fmtCmd( context : formatContext, cmd : string, txt : string, attrs : attrs = attrsNone ) : string {
  match(context.fmt) {
    FmtHtml | context.inlineContext.bench -> tagEnv(cmd, txt, attrs, context.inlineContext.sanitize) // inline for efficiency
    _ -> (context.inlineContext.xfmtCmd)(context.inlineContext,cmd,txt,attrs)
  }
}

function fmtText( context : formatContext, txt : string ) : string {
  match(context.fmt) {
    FmtHtml -> txt  // inline for efficiency
    _       -> (context.inlineContext.xfmtCmd)(context.inlineContext,"",txt,attrsNone)
  }
}

function fmtTable( context : formatContext, head : list<row>, body : list<row>, colattrs : list<attrs>, attrs : attrs = attrsNone ) : string {
  (context.inlineContext.xfmtTable)(context.inlineContext,head,body,colattrs,attrs)
}

function escapeMath( txt : string, fmt : formatter ) : string {
  match(fmt) {
    FmtHtml -> txt.htmlEscape
    FmtTex  -> txt 
  }
}

/* --------------------------------------
  Process inline text in the blocks 
---------------------------------------- */

// Format blocks into html and parse and format all inline elements 
public function formatBlocks( context : formatContext, blocks : list<block> ) : string
{
  unsafeNoDiv{ formatBlocksX(context,blocks) }
}

public function formatBlocksX( context : formatContext, blocks : list<block> ) : div string
{
  formatBlocksAcc(context,blocks,builder()) 
}

function formatBlocksAcc( context : formatContext, blocks : list<block>, acc : builder<h> ) : <st<h>,div> string
{
  match(blocks) {
    Nil -> acc.build
    Cons(block,rest) -> {
      match(block) {
        // inside lists we do not parse paragraphs, but parse per line
        // (because adjacent nested lists otherwise become part of a paragraph)
        // Here we re-discover paragraphs by treating lines that are ended by
        // a blank line as a paragraph again.
        Line(txt,loose,attrs) -> {
          val (lines,rest2) = rest.span(isLine)
          val content = txt + lines.map(lineText).join
          match(rest2) {
            Cons(Blank(_),rest3) -> {
              formatBlocksAcc(context,rest3,acc.append(formatBlock(context,Para(content,attrs))))
            }
            _ -> {
              // This is to emulate fully pedantic list mode where we always
              // combine text lines as a paragraph in a loose list
              val newblock = if (loose) then Para(content,attrs) else Line(content,loose,attrs)
              formatBlocksAcc(context,rest2,acc.append(formatBlock(context,newblock)))
            }
          }
        }
        // For TeX output, an equation or list environment should be part of a paragraph
        // If a paragraph is followed by a `.para-block` we mark the paragraph as `.para-continue` 
        Para(text,attrs) | !(context.inlineContext.bench) -> {
          match(rest) {
            Cons(Div(_,attrsd),_) | attrsd.hasClass("para-block") -> {
              formatBlocksAcc(context,rest,acc.append(formatBlock(context,Para(text,attrs.addClass("para-continue")))))
            }
            //Cons(List,_) -> {
            //  formatBlocksAcc(context,rest,acc.append(formatBlock(context,Para(text,attrs.addClass("para-continue")))))
            //}
            _ -> {
              formatBlocksAcc(context,rest, acc.append(formatBlock(context,block)))
            } 
          }
        }

        // otherwise just proces the block element.
        _ -> formatBlocksAcc(context,rest, acc.append(formatBlock(context,block)))
      }
    }
  }
}

function lineText( b :  block ) {
  match(b) {
    Line(txt) -> txt
    _         -> ""
  }
}

function getLineInfo( attrs : attrs ) : string {
  match(attrs.hasKey("data-line")) {
    Just(info) -> "%mdk-data-line={" + info + "}\n" 
    Nothing    -> ""    
  }
}

function deriveFirstLineInfo( attrs : attrs ) : attrs {
  match(attrs.hasKey("data-line-first")) {
    Just(info) -> attrsNone.addKeyval("data-line-first",info)
    Nothing -> {
      match(attrs.hasKey("data-line")) {
        Just(info) -> attrsNone.addKeyval("data-line-first",info)
        Nothing -> attrsNone
      }
    }
  }
}

/* --------------------------------------
   Output a single block element 
---------------------------------------- */

public function formatBlock( context : formatContext, block : block ) : div string 
{
  match(block) {
    Para(txt,attrs) -> {
      val content = formatInline(context.inlineContext, txt, attrs)
      if (attrs.notag)
       then context.fmtEnv("div", content, attrs) // content
      elif (content.contains(rxblank)) then "" else 
       context.fmtEnv("p", content, attrs)      
       //"<p>" + formatInline(context.inlineContext,txt) + "</p>"
    }

    Line(txt,_loose,attrs) -> {
      formatInline(context.inlineContext, txt, attrs)
    }

    Blank -> {
      match(context.fmt) {
        FmtTex -> ""
        _      -> "\n"
      }
    }
    
    Code(txt,_,attrs) -> {  
      attrs.logDataLine 
      context.inlineContext.fmtCode( "pre", txt, attrs )
    }

    List(tagname,items,attrs) -> {
      context.fmtEnv(tagname, formatBlocksX(context,items), attrs)
    }
    
    Item(bs,attrs)  -> {
      context.fmtEnv("li",formatBlocksX(context,bs), attrs)    
    }
     
    Heading(d,txt,attrs) -> { 
      context.fmtCmd("h" + (d + context.headingBase -1).show, formatInline(context.inlineContext,txt,attrs), 
                     attrs.addKeyval("data-heading-depth",d.show))
    }

    HLine(attrs) -> {
      match(context.fmt) {
        FmtHtml -> "\n<hr " + attrs.htmlFormat("hr",context.inlineContext.sanitize) + ">\n" 
        _ -> context.fmtCmd("hr", "", attrs)
      }
    }
    
    Source(txt,input,parentAttrs) -> {
      parentAttrs.logDataLine 
      match(input) {
        Pre       -> {
          context.inlineContext.fmtCode("pre",txt,parentAttrs.deriveFirstLineInfo)
        }
        Math      -> {
          //("\\[" + txt.trim.escapeMath(context.fmt) + "\\]")
          // context.logLineInfo(parentAttrs)
          context.inlineContext.fmtMath(True,txt,parentAttrs.deriveMathAttrs,getLineInfo(parentAttrs))
        }
        MathPre   -> {
          // ("\\[" + txt.mathPreBlock.escapeMath(context.fmt) + "\\]")
          // context.logLineInfo(parentAttrs)
          context.inlineContext.fmtMath(True,txt.mathPreBlock,parentAttrs.deriveMathAttrs,getLineInfo(parentAttrs))
        }
        MathDefs  -> {
          //context.logLineInfo(parentAttrs)
          val lineInfo = getLineInfo(parentAttrs)
          val mtxt = txt.escapeMath(context.fmt)
          match(context.fmt) {
            FmtTex  -> lineInfo + mtxt
            FmtHtml -> {
              log("math-pdf","%mdk-begin-mathdefs\n" + lineInfo + txt + "\n")
              if (context.inlineContext.mathStatic) {
                log("math-dvi","%mdk-begin-mathdefs\n" + lineInfo + txt + "\n")
                ""
              }
              else {
                "\\[" + mtxt + "\\]"
              }
            }
          }
        }
        Markdown  -> context.inlineContext.formatInline(txt,parentAttrs)
        Raw(monly)-> {
          if (context.inlineContext.sanitize) then ""
          else match(monly) {
            Nothing -> txt + "\n"
            Just(FmtTex) | context.fmt == FmtTex -> {
              val lineInfo = getLineInfo(parentAttrs)
              "%mdk-begin-texraw\n" + lineInfo + txt + "\n"
            }
            Just(f) | f == context.fmt -> txt + "\n"
            _       -> "\n" 
          }
        }
        // these should not happen by now
        Tex  -> context.inlineContext.fmtEscapePre(txt)
      }      
    }

    Quote(bs,attrs) -> {
      context.fmtEnv("blockquote", formatBlocksX(context,bs), attrs)
    }
    
    Table(header,colstyles0,cells,attrs) -> {
      val colstyles = colstyles0.map( fun(colstyle) { context.inlineContext.defaults.matchRules("tc",colstyle) } )
      val thead = formatRows(header,colstyles,context,attrs,False)
      val tbody = formatRows(cells,colstyles,context,attrs,True)
      context.fmtTable(thead,tbody, colstyles, attrs.addClass("madoko"))  
    }

    Div(Cons(Source(txt,Pre),Nil),attrs) | context.pedantic && attrs.elementName("div") == "pre" -> {
      context.formatBlock(Code(txt,""))
    }    

    Div(content,attrs) | attrs.hasClass("columns") -> {
      val cols = content.map fun(b) {
        match(b) {
          Div(bs,xs) -> {
            if (!(xs.hasClass("column"))) {
              warning( "a 'Columns' block should only contain 'Column' blocks")
            }  
            Cell(context.formatBlocksX(bs), xs)
          }
          _ -> {
            warning( "a 'Columns' block can only contain 'Column' blocks")
            Cell(context.formatBlock(b), attrsNone)
          }
        }
      }
      context.fmtTable(Nil,[Row(cols)],cols.map(fun(c){ c.cellAttrs }),attrs)
    }    
    
    Div(content,attrs) -> {    
      val txt = formatBlocksX(context,content)
      val rnd = attrs.input
      match (attrs.hasKey("bib-id")) {
        Just(bibid) -> {
          log("aux","%mdk bib: " + bibid 
                + (attrs.hasKey("csl-style").maybe("",fun(s) { ", csl-style:" + s }))
                + (attrs.hasKey("bib-style").maybe("",fun(s) { ", bib-style:" + s }))
                + (attrs.hasKey("locale").maybe("",fun(s) { ", locale:" + s })) 
             )
        }
        Nothing     -> ()
      }
      if ((attrs.classes.isNil && attrs.keyvals.isNil && attrs.name=="") || attrs.notag || rnd.isRaw || 
            (context.fmt==FmtTex && rnd.isMathDefs))
        then txt 
        else context.fmtEnv("div",txt,attrs.addInputClass)
    }

    Special(name,value,attrs) -> {
      val linfo = context.inlineContext.fmtLineInfo(attrs.hasKey("data-line").mbstring)
      if (name.toLower=="toc") then {
        val blks = context.tocBlocks[value.toLower].maybe([],id)
        linfo + formatBlocksX(context,blks)
      }
      elif (name.toLower=="footnotes" && context.fmt.isFmtHtml) then linfo + formatBlock(context,context.footnoteBlock)
      else "" // formatBlock(context,Para("[" + name + "]\n"))
    }
    
    DefLink       -> ""
    DefFootnote   -> ""
    Empty         -> ""
  }
}
val rxblank = regex(@"^\s*$")
val rxDashes  = regex(@"^ *(\\/)?---+ *[|+]*$") //regex(@"^( |- |-- )*---+ *[- ]*[|+]*$")
val rxDDashes = regex(@"^ *(\\/)?===+ *[|+]*$")

function deriveMathAttrs( parentAttrs : attrs ) {
  attrsNone.addClasses( parentAttrs.classes.filter(fun(c) { c.startsWith("snippet") || c.startsWith("math") } ) )
           .addKeyvals( parentAttrs.keyvals.filter( fun(kv) {
                          val key = kv.fst
                          key.startsWith("color") || key.startsWith("font-") || key.startsWith("snippet-") || key.startsWith("math-")
                        }))
}

function formatRows( rows : list<row>, 
                      colstyles : list<attrs>, context : formatContext,
                      attrs : attrs, isBody : bool ) : list<row>
{
  if (rows.isNil) then return Nil

  function defaultCellKeyvals( colNum : int, rowstyle : attrs, isLast : bool ) : list<(string,string)> {
    val mod  = if (colNum.even) then "even-" else "odd-"
    val elem = if (isBody) then "td-" else "th-"
    val idx  = colNum.show + "-"
    val prefixes = ["cell-","col-","col-" + mod, "col-" + idx,
                    elem, elem + mod, elem+idx] +
                   (if (isLast) then ["col-last-",elem + "last-"] else [])
    val allkvs  = attrs.keyvals + rowstyle.keyvals
    val kvs = allkvs.filterKeyvals(prefixes)
    kvs
  }

  function formatRow( colNum : int, row : list<cell>, cols : list<attrs>, rowstyle : attrs ) : list<cell> {    
    match(row) {
      Cons(cell,rs) -> {
        match(cols) {
          Cons(colstyle,cs) -> {
            // merge with row style
            val colstyle0 = rowstyle.mergeDefault(colstyle)

            // span multiple columns?
            val (txt1,colspan) = match(cell.text.find(rxbars)) {
              Nothing   -> (cell.text,1)
              Just(cap) -> (cell.text.substr(0,cap.index), cap.matched.length)
            }
            // combine borders in case of a multi-column
            val (colstyle1,cs1) = if (colspan<=1) then (colstyle0,cs) 
                                    else {
                                      val colstylex = colstyle0.addKeyval("column-span",colspan.show)
                                      val colstyley = if (isBody) then colstylex 
                                                       else colstylex.addKeyval("text-align",rowstyle.hasKey("text-align").maybe("center",id))
                                      match(cs.drop(colspan-2)) {
                                       Cons(colstylez,csx) 
                                           -> (colstyley.addClasses(colstylez.classes.filter(noalign))
                                                        .addKeyval("column-span",colspan.show), 
                                               csx )
                                       Nil -> (colstyley.addKeyval("column-span",colspan.show),Nil)
                                      }
                                    }
            // horizontal line?
            val (colstyle2,txt2,elemName) = if (txt1.contains(rxDashes))
                                    then (colstyle1.addClass("cell-line"), "","tl")
                                   elif (txt1.contains(rxDDashes))
                                    then (colstyle1.addClass("cell-double-line"), "","tl")
                                    else (colstyle1,txt1,if (isBody) then "td" else "th")
            
            val isLast = rs.isNil
            val extraClasses = [if (colNum.even) then "col-even" else "col-odd"] +
                                (if (isLast) then ["col-last"] else []) +
                                (if (colNum==1) then ["col-first"] else [])

            val colstyle3 = colstyle2.addClasses(extraClasses)
                                     .addKeyval("data-col",colNum.show)
            val colstyle4 = colstyle3.addKeyvals(defaultCellKeyvals(colNum,rowstyle,isLast))
            val colstyle5 = context.inlineContext.defaults.matchRules(elemName, colstyle4)
            val elem = Cell(context.inlineContext.formatInline(txt2,colstyle5), colstyle5)
            Cons(elem, formatRow( colNum+colspan, rs, cs1, rowstyle))        
          }
          _ -> Nil
        }
      }
      _ -> Nil  
    }
  }
  
  
  function addRowKey( target : string, key : string, test : bool ) : list<(string,string)> {
    if (!test) then [] else {
      match(attrs.hasKey(key)) {
        Nothing -> []
        Just(value) -> [(target,value)]
      }
    }
  }

  function filterKeyvals( keyvals : list<(string,string)>, prefixes : list<string> ) : list<(string,string)> {
    keyvals.filterMap fun(kv) {
      val (key,value) = kv
      match (prefixes.reverse.find(fun(pre) { key.startsWith(pre) })) {
        Just(pre) -> {
          val skey = key.substr(pre.length)
          if (skey.find(rxSubSelect).isJust) then Nothing else Just((skey,value))
        }
        Nothing -> Nothing
      }
    }
  }

  function defaultKeyvals( hasLine :  bool, rowNum : int, isLast : bool ) : list<(string,string)> {
    val mod = if (rowNum.even && rowNum != 0) then "even-" else "odd-"
    val row = if (isBody) then "tbody-tr-" else "thead-tr-"
    val idx = rowNum.show + "-"
    val prefixes = ["tr-","tr-" + mod,"tr-" + idx,
                    row, row + mod, row + idx ] + 
                   (if (isLast) then ["tr-last-",row + "last-"] else [])
    val kvs = attrs.keyvals.filterKeyvals(prefixes)
    if (hasLine)
     then kvs.filter(fun(kv){kv.fst.startsWith("background-color") || kv.fst.startsWith("rule") })
     else kvs
  }

  function containsDashes( row : row ) : bool {
    row.cells.any( fun(cell) { cell.text.contains(rxDashes) || cell.text.contains(rxDDashes) })
  }
         
  var rowNum := 0
  var rowCount := 0
  val firstHasLine = rows.take(1).all(containsDashes)
  val lastHasLine  = rows.reverse.take(1).all(containsDashes)
  val defaults = context.inlineContext.defaults
  rows.map fun(row) {
    rowCount := rowCount+1
    val hasLine = row.containsDashes
    val isLast  = !hasLine && (rowCount == rows.length - (if (lastHasLine) then 1 else 0)) 
    if (!hasLine) then rowNum := rowNum+1  

    val extraClasses = [if (isBody) then "tbody" else "thead",
                        if (rowNum.even) then "tr-even" else "tr-odd"] +
                       (if (isLast) then ["tr-last"] else []) +
                       (if (rowNum==1) then ["tr-first"] else [])
    val rowstyle0 = defaults.matchRules("tr", 
                      row.rowAttrs.addClasses(extraClasses).addKeyval("data-row",rowNum.show))
    val rowstyle = rowstyle0.addKeyvals( 
        addRowKey("rule-width", "rule-top-width", !isBody && rowNum==0 ) +
        addRowKey("rule-width", "rule-mid-width", isBody && rowNum==0 ) +
        addRowKey("rule-width", "rule-bottom-width", isBody && hasLine && rowCount == rows.length ) +
        addRowKey("rule-width", "rule-width", True ) +
        addRowKey("padding-top", "rule-top-sep", !isBody && firstHasLine && rowNum==1 && !hasLine ) +
        addRowKey("padding-top", "rule-mid-sep", isBody && rowNum==1 && !hasLine) +
        addRowKey("padding-bottom", "rule-mid-sep", !isBody && isLast ) +
        addRowKey("padding-bottom", "rule-bottom-sep", isBody && isLast ) 
      )
      .addKeyvals( defaultKeyvals(hasLine,rowNum,isLast) )
    Row(formatRow(1,row.cells,colstyles,rowstyle),rowstyle)
  }
}
val rxbars = regex(@"[|+]+$")
val rxSubSelect = regex(@"^(even|odd|last|\d+)\-")

function noalign( s : string ) : bool = !(s.startsWith("align-"))
