/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Formatting of TeX elements (i.e. emphasis, links, etc.)
module texFormatter

import std/log
import std/path
import std/dict
import std/string
import std/regex
import common
import entity
import inline
import options
import texParser      // for texAccents et al
import htmlFormatter  // for htmlEscape
import hilite
import attributes
import codeAlign

public function fmtTexEnv(context : inlineContext, env : string, txt : string, attrs : attrs ) : string {
  if (env=="") 
   then texText(txt) 
   else texEnv(env,txt,attrs)
}

public function fmtTexCmd(context : inlineContext, cmd : string, txt : string, attrs : attrs ) : string {
  if (cmd=="") then texText(txt) 
  elif (cmd=="br") then "\\mdBr\n" 
  // elif (cmd=="code") then "\\lstinline|" + txt + "|" 
  else texCmd(cmd,txt,attrs)
}

public function fmtTexLineInfo( context : inlineContext, lineInfo : string ) : string {
  "% data-line={" + lineInfo + "}\n{}"
}

public function fmtTexEscape( context : inlineContext, txt : string, allowEntity : bool ) : string {
  //texText(htmlEscape(txt,allowEntity))
  if (allowEntity)
   then texText(htmlEscape(txt,allowEntity))
   else // we use lstlisting with 'mathescape' and escape just $ and |
        txt.replaceAll(regex(@"\$"),@"$\mbox{\$}$").replaceAll(regex(@"\|"),@"$\mbox{\char124}$")  
}

public function fmtTexFootnote(context : inlineContext, id : string, fn : footnote ) : string {
  "\\mdFootnote[id=back-fn-" + id + ",label={" + fn.footnoteNum + "}]{" + ((fn.footnoteContent)(context)) + "}"
}

public function fmtTexLink( context : inlineContext, isImage : bool, link : link, content : string ) {
  if (isImage) {
    texCmd("img",link.href,link.linkattrs)
  }
  else {
    texCmd("a", texLinkText(if (link.href.startsWith("#")) then link.href.substr(1) else link.href),link.linkattrs) +
      "{" + (if (link.linkattrs.hasClass("tex-tooltip")) then extractText(link.title) else "") + "}" +
      "{" + content + "}"    
  }
}

function extractText( s : string ) : string {
  s.replaceAll(regxTexCmd," ")
}

val regxTexCmd = regex(rxTexCmd)

public function fmtTexCodePlain( context : inlineContext, txt : string ) : string 
{
  txt.htmlEscape(False).texText.preSpace
}

public function fmtTexCodeHilite( context : inlineContext, txt : string, startLine : bool ) : (string) 
{
  unTokenize(txt,startLine)
}

public function fmtTexCodeToken(classes : list<string>, txt : string ) : string
{
  val start = if (classes.any(fun(cname) { cname=="white" })) 
                then "{"  // so preindent can match
                else {
                  val cclasses = classes.map(fun(cname) { 
                                    cname.replaceAll(regex(@"(?:^|[^a-z]+)(?:([a-z])([a-z]*))?",ignoreCase=True),fun(ccap) {
                                      ccap.groups[1].toUpper() + ccap.groups[2]
                                    }).replaceAll(regex(@"[^a-zA-Z]+"),"")
                                  }).filter( fun(cname) { cname != "" && cname != "Token" })
                  @"\mdToken{" + cclasses.join(",") + "}{"
                }
  val end = "}"
  start + txt + end     
}

function unTokenize( txt : string, startLine : bool ) : string {
  var nl := startLine
  txt.replaceAll(rxTagged, fun(cap) {
        if (cap.groups.matchedOn(1)) {
          val res = cap.matched.texText.preSpace(nl)
          nl := False
          res
        }
        elif (cap.matched=="<br>") then {
          nl := True
          "\\prebr{}\n" 
        }
        else cap.matched
      })
      .replaceAll(rxToken, fun(cap) {
        val classes=cap.groups[1].toLower.trim.split(rxSpaces).list
        fmtTexCodeToken( classes, cap.groups[2] )    
      })
} 
val rxToken = regex(@"<span\s+.*?\bclass=['""]?([^""']+)['""]?[^>]*>([\s\S]*?)</span>",ignoreCase=True)
val rxBr = regex(@"\n|<br>")
val rxTagged = regex(@"([^<>]+)|<([^>]*)>")

public function preSpace( txt : string, start : bool = True ) : string {
  txt.replaceAll(rxIndent,fun(cap){ cap.groups[1] + (if (start) then @"\preindent" else @"\prespace") + "{" + cap.groups[2].length.show + "}" })
     .replaceAll(rxSpaces,fun(cap){ @"\prespace{" + cap.matched.length.show + "}"})
     .replaceAll("\n|<br>","\\prebr{}\n")
     .replaceAll("`","{`}")
}
val rxIndent = regex(@"(^|\n)( +)")
val rxSpaces = regex(@" +")

function texLinkText( txt : string ) : string {
  txt.replaceAll("~","\\textasciitilde ").replaceAll("%","\\%").replaceAll("#","\\#")
}

public function texText( txt : string ) : string {
  txt.replaceAll(rxSpecial,texSpecial).replaceAll(rxEntity,texEntity)     
}

val rxEntity  = regex(@"&((?:#[xX]?)?(\w)(\w*));")
val rxSpecial = regex(@"&#?\w+;|[" + specials.map(fst).join + @"\]")
val specials = [
  (@"%", @"\%"),
  (@"~", @"{\textasciitilde}"),
  (@"#", @"\#"),
  (@"&", @"\&"),  // defined by madoko.sty
  (@"$", @"\$"),
  (@"{", @"\{"),
  (@"}", @"\}"),
  (@"_", @"\_"),
  (@"^", @"{\textasciicircum}"),
  (@"|", @"{\textbar}"),
  (@"<", @"{\textless}"),
  (@">", @"{\textgreater}"),
  (@"\",@"{\textbackslash}"),  // must come last, see rxSpecial that appends a "\"
]

val rxNamedEntity = regex(@"&(\w+);")

function escapeEntity( s : string ) : string {
  s.replaceAll(rxNamedEntity,"&amp;$1;")
}

function texSpecial( cap : matched ) : string {
  match(specials.find(fun(kv){ kv.fst == cap.matched })) {
    Nothing  -> cap.matched
    Just(kv) -> kv.snd
  }
}

val accents 
  = texAccents.list.map(fun(te) { (te.snd, te.fst ) }).dict

function texEntity( cap : matched ) {
  match(accents[cap.groups[3]]) {
    Just(cmd) -> @"{\" + cmd + "{" + cap.groups[2] + "}}"
    Nothing   -> entityToTex(cap.groups[1])
  } 
}

function texCmd( cmd : string, body : string, attrs : attrs = attrsNone, pre : string = "md" ) : string {
  val cmdName = if (attrs.texelem != "") then attrs.texelem else (pre + cmd.normalizeCmd.capitalize)
  "\\" + cmdName + attrs.texAttrsX + "{" + body + "}"
}

public function fmtTexCodeTable( context : inlineContext, ct : codeTable, attrs : attrs ) : string {
  val table = if (attrs.hasClass("long")) then "LongTable" else "Table"
  "\\begin{mdCode" + table + "}" + attrs.texAttrsX + "{" + ct.columns.show + "}" + "{" + list(1,ct.columns).map(fun(_) {"l"}).join("") + "}\n" +
    ct.rows.map( fun(row) { row.map(fmtTexCodeCell).join("&") }).join("\\\\\n") +
  "\n\\end{mdCodeTable}\n"
}

function fmtTexCodeCell( ccell : ccell ) : string {
  val align = if (ccell.center) then "c" else "l"
  if (ccell.span <= 1) then ccell.content else "\\multicolumn{" + ccell.span.show + "}{" + align + "}{" + ccell.content + "}"
}

public function fmtTexTable( context : inlineContext, head : list<row>, body : list<row>, colattrs : list<attrs>, attrs : attrs ) : string {
  val pre = "md"
  val rows = head + body
  val td = if (attrs.hasClass("columns")) then "column" else "td"
  val table = if (attrs.hasClass("long")) then "LongTable" else "Table"
  val columns = max(1,rows.map(fun(r:row){ r.cells.length }).maximum)
  val colattrsx = (colattrs + list(colattrs.length,columns).map(fun(i){ attrsNone })).take(columns)
  "\\begin{" + pre + table + "}" + attrs.addClass("block").texAttrsX + 
      "{" + columns.show + "}" + 
      "{" + colattrsx.map(fmtColumn).join + "}\n" +
    head.fmtRows("th",pre) + "\n" +
    body.fmtRows(td,pre) +
    "\\end{" + pre + table + "}\n"
}

type line {
  Single
  Double
  NoLine
}

val fmtRowLineBreak = "\\morecmidrules\n" // \\\\[-\\mdTablelineskip]\n"

function fmtColorArg( clr : string ) : string {
  if (clr.startsWith("#")) 
    then "[HTML]{" + clr.substr(1) + "}"
    else "{" + clr.substr(0,1).toUpper + clr.substr(1).toLower + "}"
}

function fmtColumn( colattr : attrs ) : string {
  "l"
}

function fmtRows( rows : list<row>, td : string, pre : string ) : string {
  var lastIsLine := False
  val xrows = rows.map fun(row) {
    val lineRow = row.cells.map(fun(cell) { 
                    if (cell.cellAttrs.hasClass("cell-line")) then Single
                    elif (cell.cellAttrs.hasClass("cell-double-line")) then Double 
                    else NoLine 
                  } )
    if (!(lineRow.all(isNoLine))) then { 
      val res = (if (lastIsLine) then fmtRowLineBreak else "") + fmtLine(lineRow,row)
      lastIsLine := True
      res
    }
    else {
      val res = (if (lastIsLine) then "\n" else "") + fmtRow(td,row,pre)
      lastIsLine := False
      res
    }
  }
  xrows.join() + (if (lastIsLine) then "\n" else "")
}


function fmtLine( lines : list<line>, row : row ) : string 
{
  function width( cattrs : attrs ) {
    match(cattrs.hasKey("rule-width")) {
      Just(wd) -> "[" + wd.normalizeVal + "]"
      Nothing  -> ""
    }
  }

  val line2 = if (!(lines.any(isDouble))) then "" else {
    fmtRowLineBreak + 
     zipWithIndexed(row.cells,lines,fun(i,cell,line) {
      val attrs = cell.cellAttrs
      if (!(line.isDouble)) then "" 
       else "\\cmidrule" + width(attrs) + "{" + (i+1).show + "-" + (i+ attrs.lookupKey("column-span","1").parseInt.maybe(1,id)).show + "}" 
     }).join            
  }
  
  val line1 = if (!(lines.any(isNoLine)) && line2=="") then "\\midrule" + width(row.rowAttrs) else {
    zipWithIndexed(row.cells,lines,fun(i,cell,line) {
      val attrs = cell.cellAttrs
      if (line.isNoLine) then "" 
       else "\\cmidrule" + width(attrs) + "{" + (i+1).show + "-" + (i+ attrs.lookupKey("column-span","1").parseInt.maybe(1,id)).show + "}" 
     }).join
  }
  
  line1 + line2
}

function fmtRow( td : string, row : row, pre : string ) : string {
  /*
  rcolor = match (row.rowAttrs.hasKey("background-color")) {
             Nothing   -> ""
             Just(clr) -> "\\rowcolor" + fmtColorArg(clr)
           }     
  rcolor + */
  row.cells.map(fun(cell) { fmtCell(td,cell.text.trim,cell.cellAttrs,pre) }).join("&") 
    + "\\\\\n"
} 



function fmtCell( elem : string, body : string, attrs : attrs, pre : string ) : string {
  val colspan = attrs.lookupKey("column-span","1")
  val align   = match(attrs.hasKey("text-align")) {
                  Just(alignment) -> alignment.substr(0,1)
                  Nothing -> if (elem=="th") then "c" else "l" 
                }
  val bcolor  = match (attrs.hasKey("background-color")) {
                  Nothing   -> ""
                  Just(clr) -> "{\\cellcolor" + fmtColorArg(clr) + "}"
                }            
  val fmt     = (if (attrs.hasClass("cell-border-left")) then "|" else "") + align +
                (if (attrs.hasClass("cell-border-right")) then "|" else "")

  val attrsx  = attrs( classes = attrs.classes.filter(fun(c){ c != "cell-border-left" && c != "cell-border-right" && !(c.startsWith("align-"))}),
                       keyvals = attrs.keyvals.filter(fun(kv){ kv.fst != "column-span" && kv.fst != "background-color" }))

  val content = if (elem=="column") 
                 then texEnv(elem,body,attrsx)
                 else texCmd(elem,body,attrsx.addKeyval("display","table-cell")) 
                 
  if (colspan=="1" && fmt=="l") then content 
   else "\\multicolumn{" + colspan + "}{" + fmt + "}{" + bcolor + content + "}"
}




function texAttrsX( attrs : attrs = attrsNone ) : string {
  if (attrs.empty) then "" else {
    val txt = [ if (attrs.classes.isNil) then [] else ["class={" + attrs.classes.map(normalizeId).join(",") + "}"],  // so block goes first
                if (attrs.name=="") then [] else ["id=" + attrs.name],
                if (attrs.label=="") then [] else ["label={" + attrs.label.escapeEntity.texText + "}"],
                if (attrs.elem=="") then [] else ["elem={" + attrs.elem.escapeEntity.texText + "}"],
                attrs.keyvals.filter(nosuppressKey).map(fun(kv) { 
                  val (name0,value) = kv
                  val name = if (name0.startsWith("tex-")) then name0.substr(4) else name0    
                  name.normalizeId + "={" + value.normalizeVal + "}" 
                }),          
              ].concat.join(",") 
    if (txt=="") then "" else "[" + txt + "]"
  }
}


function nosuppressKey( kv : (string,string) ) : bool {
  val key = kv.fst
  (key != "source" && !(key.startsWith("html-") || key.startsWith("css-")))
}

function normalizeVal( v : string ) : string {
  match(v.find(rxPerc)) {
    Just(cap) -> {
      val perc = cap.groups[1].parseInt().maybe(100,id).double / 100.0
      perc.showFixed(2) + "\\linewidth"
    }
    Nothing -> match(v.find(rxPixels)) {
      Just(cap) -> cap.groups[1] + "\\cssPixel"
      Nothing   -> v.escapeEntity.texText.replaceAll(regex("\n"),"\\\\")
    }
  }
}
val rxPerc = regex(@"\s*(\d{1,3})%\s*")
val rxPixels = regex(@"\s*(\d+(?:\.\d+)?)px\s*")

function capitalize( s : string ) : string {
  s.substr(0,1).toUpper + s.substr(1)
}


function texEnv( env : string, body : string, attrs : attrs = attrsNone ) : string {
  texEnvPlain(env,body,attrs)
}

function texEnvPlain( env : string, body : string, attrs : attrs ) : string {
  val envName = (if (attrs.texelem != "") then attrs.texelem else ("md" + env.normalizeCmd.capitalize))
  val envCmd = "\\begin{" + envName + "}" + attrs.texAttrsX + "%\n" +
                body.trimRight + "%\n" +
               "\\end{" + envName + "}%\n"
  match(attrs.hasKey("float")) {
    Nothing   -> envCmd
    Just(flt) -> "\\mdFloatBox{" + flt + "}{" + attrs.lookupKey("lines","") + "}{" + envCmd + "}"
  }               
}

function texClassName( attrs : attrs, def : string ) : (string,attrs) {
  val name = attrs.elementName(def)
  (name.normalizeCmd.capitalize,attrs(classes=attrs.classes.filter(fun(c){ c != name })))    
}

/* --------------------------------------
  Entities 
---------------------------------------- */

function normalizeCmd( cmd : string ) {
  cmd.replaceAll(rxCmdSpecial,"").replaceAll(rxDigits) fun(cap) {
    list(1,cap.matched.parseInt.maybe(0,id)).map(fun(i) { "x" }).join
  }
}
val rxDigits = regex(@"\d+")
val rxCmdSpecial = regex(@"[^a-zA-Z0-9]")


/* --------------------------------------
  Title 
---------------------------------------- */
public function fmtTexTitle(context : inlineContext, titleinfo : titleinfo ) : string {
  [@"\mdTitle{" + context.formatInline(titleinfo.title) + "}",
   if (titleinfo.subtitle=="") then "" else @"\mdSubtitle{" + context.formatInline(titleinfo.subtitle) + "}",
   titleinfo.authors.map(fun(author) {
     @"\mdAuthor{" + context.formatInline(author.name) + "}{" + 
                      context.formatInline(author.address) + "}{" + 
                      context.formatInline(author.email) + "}{" +
                      context.formatInline(author.note) + "}"
   }).join("\n"),
   @"\mdMaketitle{" + context.formatInline(titleinfo.note) + "}",""].join("\n")
}



/* --------------------------------------
  Full header 
---------------------------------------- */
public function fmtTexFull(body : string, options : options, metadata : dict<string> ) : string {
  fmtTexFullX(body,options,metadata,False)
}

public function fmtTexMathFull( requireDvi : bool, body : string, options : options ) : string {
  fmtTexFullX(body,options,dict(), requireDvi )
}

function fmtTexFullX(body : string, options : options, metadata : dict<string>, snippets : bool = False) : string 
{
  function expand(s) { s.expandKeys(metadata) }

  val pkgs = (options.packages.expand + (if (snippets) then "" else options.packagesx.expand)).splitPaths 

  val doc = options.docClass.expand
  
  [fmtOptArg(@"\documentclass", doc, ext = ".cls" ),
   "% generated by Madoko, version " + version,
   "% data-line={1}",
   if (snippets) then @"\newcommand\mathmode{true}" else "",
   pkgs.map(fun(pkg) { 
      match (pkg.find(rxTexFile)) {
        Just -> {
          log("filesRefer", changeExt(pkg,".tex") );
          @"\input{" + pkg + "}"
        }
        Nothing -> fmtOptArg(@"\usepackage",pkg,snippets)
      }
    }).join("\n"),
   options.texHeader.expand,
   if (snippets) then "" else options.texHeaderx.expand,
   @"\begin{document}",
   //(if (options.title=="") then "" else
   //   "\\title{" + texText(options.title.expand) + "}\n"),
   body, 
   @"\end{document}",""
   ].join("\n")
}

val rxTexFile = regex(@"^[^\n\r\[\]]+?\.tex$",ignoreCase=True)

function fmtOptArg( pre:string, pkg : string,  snippets : bool = False, ext : string = ".sty" ) : string 
{
  pre + (match(pkg.find(rxPkgOpt)) {
    Just(cap) -> {
      val pname = cap.groups[2]
      if (pname.extname!="" || pname.dirname!="") {
        log("filesRefer", changeExt(pname,ext) );
      }
      (if (cap.groups[1] != "") then "[" + cap.groups[1] + "]" else "") + 
        "{" + (if (ext==".cls") then pname.noext else pname) + "}"
    }
    Nothing  -> {
      val pname = pkg.trim
      if (pname.extname!="" || pname.dirname!="") {
        log("filesRefer", changeExt(pname,ext) )
      }
      "{" + (if (ext==".cls") then pname.noext else pname) + "}"
    }
  })
} 


val rxPkgOpt = regex(@"^\s*(?:\[(.*?)\]\s*)?([^\*]+)\s*(?:\*\s*)?$")
