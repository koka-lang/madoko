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
import common
import block
import inline
import formatInline
import htmlFormatter
import texFormatter

public struct formatContext( 
  inlineContext : inlineContext,
  tocBlocks   : dict<block>,
  footnoteBlock : block,
  titleinfo : titleinfo,
  headingBase: int,
  langPrefix : string,
  pedantic : bool,
  xfmtEnv : (context : inlineContext, env : string, txt : string, attrs : attrs ) -> string,
  fmt : formatter = FmtHtml
)

public function initialFormatContext( icontext : inlineContext, titleinfo : titleinfo, headingBase : int, pedantic : bool, fmt : formatter ) {
  FormatContext(icontext,dict(),Empty,titleinfo,headingBase,"lang-",pedantic,fmt.pick(fmtHtmlEnv,fmtTexEnv), fmt)
}

function fmtEnv( context : formatContext, env : string, txt : string, attrs : attrs = attrsNone ) : string {
  match(context.fmt) {
    FmtHtml -> tagEnv(env, txt, attrs, context.inlineContext.sanitize) // inline for efficiency
    _ -> (context.xfmtEnv)(context.inlineContext,env,txt,attrs)
  }
}

function fmtPre( context : formatContext, txt : string ) : string {
  context.inlineContext.fmtEscapePre(txt)
}

function fmtCode( context : formatContext, lang : string, txt : string, attrs : attrs = attrsNone ) : string {
  langClassName = context.langPrefix + lang
  lattrs = if (lang=="") then attrsNone else Attrs(classes=[langClassName])      
  match(context.fmt) {
    FmtHtml -> context.fmtEnv("pre", context.fmtCmd("code", txt.htmlEscape, lattrs ), attrs)
    _       -> context.fmtEnv("pre", context.fmtPre(txt), 
                                if (lang=="" || attrs.hasKey("language").isJust) 
                                  then attrs else attrs.addKeyval("language",lang))
  }
}

function fmtCmd( context : formatContext, cmd : string, txt : string, attrs : attrs = attrsNone ) : string {
  match(context.fmt) {
    FmtHtml -> tagEnv(cmd, txt, attrs, context.inlineContext.sanitize) // inline for efficiency
    _ -> (context.inlineContext.xfmtCmd)(context.inlineContext,cmd,txt,attrs)
  }
}

function fmtText( context : formatContext, txt : string ) : string {
  match(context.fmt) {
    FmtHtml -> txt  // inline for efficiency
    _       -> (context.inlineContext.xfmtCmd)(context.inlineContext,"",txt,attrsNone)
  }
}

function fmtTitle( context : formatContext ) : string {
  (context.inlineContext.xfmtTitle)(context.inlineContext,context.titleinfo)
}

function fmtTable( context : formatContext, head : cells, body : cells, attrs : attrs = attrsNone ) : string {
  (context.inlineContext.xfmtTable)(context.inlineContext,head,body,attrs)
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
    Nil -> acc.string
    Cons(block,rest) -> {
      match(block) {
        // inside lists we do not parse paragraphs, but parse per line
        // (because adjacent nested lists otherwise become part of a paragraph)
        // Here we re-discover paragraphs by treating lines that are ended by
        // a blank line as a paragraph again.
        Line(txt,loose) -> {
          val (lines,rest2) = rest.span(isLine)
          val content = txt + lines.map(lineText).join
          match(rest2) {
            Cons(Blank(_),rest3) -> {
              formatBlocksAcc(context,rest3,acc.append(formatBlock(context,Para(content))))
            }
            _ -> {
              // This is to emulate fully pedantic list mode where we always
              // combine text lines as a paragraph in a loose list
              newblock = if (loose) then Para(content) else Line(content,loose)
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
            Cons(List,_) -> {
              formatBlocksAcc(context,rest,acc.append(formatBlock(context,Para(text,attrs.addClass("para-continue")))))
            }
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

/* --------------------------------------
   Output a single block element 
---------------------------------------- */

public function formatBlock( context : formatContext, block : block ) : div string 
{
  match(block) {
    Para(txt,attrs) -> {
      content = formatInline(context.inlineContext, txt)
      if (attrs.notag)
       then content
      elif (content.contains(rxblank)) then "" else 
       context.fmtEnv("p", content, attrs)      
       //"<p>" + formatInline(context.inlineContext,txt) + "</p>"
    }

    Line(txt) -> {
      formatInline(context.inlineContext, txt)
    }

    Blank -> {
      match(context.fmt) {
        FmtTex -> ""
        _      -> "\n"
      }
    }
    
    Code(txt,lang,attrs) -> {
      context.fmtCode( lang, txt, attrs)
    }

    List(tagname,items,attrs) -> {
      context.fmtEnv(tagname, formatBlocksX(context,items), attrs)
    }
    
    Item(bs,attrs)  -> {
      context.fmtEnv("li", formatBlocksX(context,bs), attrs)    
    }
    
    Heading(d,txt,attrs) -> { 
      context.fmtCmd("h" + (d + context.headingBase -1).show, formatInline(context.inlineContext,txt), attrs)
    }

    HLine(attrs) -> {
      match(context.fmt) {
        FmtHtml -> "\n<hr " + attrs.htmlFormat("hr",context.inlineContext.sanitize) + ">\n" 
        _ -> context.fmtCmd("hr", "", attrs)
      }
    }
    
    Source(txt,input) -> {
      match(input) {
        Pre       -> context.fmtCode("",txt,attrsNone)
        Math      -> ("\\[" + txt.trim.escapeMath(context.fmt) + "\\]")
        MathPre   -> ("\\[" + txt.mathPreBlock.escapeMath(context.fmt) + "\\]")
        MathDefs  -> {
          mtxt = txt.escapeMath(context.fmt)
          match(context.fmt) {
            FmtTex  -> mtxt
            FmtHtml -> "\\[" + mtxt + "\\]"
          }
        }
        Markdown  -> context.inlineContext.formatInline(txt)
        Raw(monly)-> {
          if (context.inlineContext.sanitize) then ""
          else match(monly) {
            Nothing -> txt
            Just(f) | f == context.fmt -> txt
            _       -> "" 
          }
        }
        // these should not happen by now
        Tex  -> context.fmtPre(txt)
      }      
    }

    Quote(bs,attrs) -> {
      context.fmtEnv("blockquote", formatBlocksX(context,bs), attrs)
    }
    
    Table(header,colstyles,cells,attrs) -> {
      thead = formatRows(header,colstyles,context)
      tbody = formatRows(cells,colstyles,context)
      context.fmtTable(thead,tbody, attrs)  
    }

    Div(Cons(Source(txt,Pre),Nil),attrs) | context.pedantic && attrs.elementName("div") == "pre" -> {
      context.formatBlock(Code(txt,""))
    }    

    Div(content,attrs) | attrs.hasClass("columns") -> {
      cols = content.map fun(b) {
        match(b) {
          Div(bs,xs) -> {
            if (!(xs.hasClass("column"))) {
              trace("warning: a 'Columns' block should only contain 'Column' blocks")
            }  
            (context.formatBlocksX(bs), xs)
          }
          _ -> {
            trace("warning: a 'Columns' block can only contain 'Column' blocks")
            (context.formatBlock(b), attrsNone)
          }
        }
      }
      context.fmtTable(Nil,[cols],attrs)
    }    
    
    Div(content,attrs) -> {    
      txt = formatBlocksX(context,content)
      rnd = attrs.input
      if ((attrs.classes.isNil && attrs.keyvals.isNil && attrs.name=="") || attrs.notag || rnd.isRaw || 
            (context.fmt==FmtTex && rnd.isMathDefs))
        then txt 
        else context.fmtEnv("div",txt,attrs.addInputClass)
    }

    Special(name,value) -> {
      if (name.toLower=="toc") then {
        blk = context.tocBlocks[value.toLower].maybe(Empty,id)
        formatBlock(context,blk)
      }
      elif (name.toLower=="footnotes" && context.fmt.isFmtHtml) then formatBlock(context,context.footnoteBlock)
      elif (name.toLower=="title") then context.fmtTitle()
      else "" // formatBlock(context,Para("[" + name + "]\n"))
    }
    
    DefLink       -> ""
    DefFootnote   -> ""
    Empty         -> ""
  }
}
val rxblank = regex(@"^\s*$")
val rxDashes  = regex(@"^ *---+ *[|+]*$") //regex(@"^( |- |-- )*---+ *[- ]*[|+]*$")
val rxDDashes = regex(@"^ *===+ *[|+]*$")

function formatRows( cells : list<list<string>>, 
                      colstyles : list<attrs>, context : formatContext ) : list<list<(string,attrs)>>
{
  function formatRow( row : list<string>, cols : list<attrs> ) : list<(string,attrs)> {
    match(row) {
      Cons(cell,rs) -> {
        match(cols) {
          Cons(colstyle,cs) -> {
            // span multiple columns?
            val (txt1,colspan) = match(cell.find(rxbars)) {
              Nothing   -> (cell,1)
              Just(cap) -> (cell.substr(0,cap.index), cap.matched.length)
            }
            // combine borders in case of a multi-column
            val (colstyle1,cs1) = if (colspan<=1) then (colstyle,cs) 
                                   else match(cs.drop(colspan-2)) {
                                     Cons(colstylex,csx) 
                                         -> (colstyle.addClasses(colstylex.classes.filter(noalign))
                                                     .addKeyval("column-span",colspan.show), 
                                             csx )
                                     Nil -> (colstyle.addKeyval("column-span",colspan.show),Nil)
                                   }
            // horizontal line?
            val (colstyle2,txt2) = if (txt1.contains(rxDashes))
                                    then (colstyle1.addClass("cell-line"), "")
                                   elif (txt1.contains(rxDDashes))
                                    then (colstyle1.addClass("cell-double-line"), "")
                                    else (colstyle1,txt1) 
                                    
            elem = (context.inlineContext.formatInline(txt2), colstyle2)
            Cons(elem, formatRow(rs,cs1))        
          }
          _ -> Nil
        }
      }
      _ -> Nil  
    }
  }
  
  if (cells.isNil) then return Nil
  cells.map fun(row) {
    formatRow(row,colstyles)
  }
}
val rxbars = regex(@"[|+]+$")

function noalign( s : string ) : bool = !(s.startsWith("align-"))
