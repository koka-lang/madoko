/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Formatting of TeX elements (i.e. emphasis, links, etc.)
module latexFormatter

import std/log
import std/path
import std/dict
import std/string
import std/regex
import common
import entity
import inline
import options
import texCommon      // for texAccents et al
import htmlFormatter  // for htmlEscape
import hilite
import attributes
import codeAlign

public function fmtLatexEnv(context : inlineContext, env : string, txt : string, attrs : attrs ) : string {
  if (env=="") 
   then texText(txt) 
   else texEnv(env,txt,attrs)
}

public function fmtLatexCmd(context : inlineContext, cmd : string, txt : string, attrs : attrs ) : string {
  if (cmd=="") then texText(txt) 
  elif (cmd=="br") then "\\mdBr\n" 
  // elif (cmd=="code") then "\\lstinline|" + txt + "|" 
  else texCmd(cmd,txt,attrs)
}

public function fmtLatexLineInfo( context : inlineContext, lineInfo : string ) : string {
  "%mdk-data-line={" + lineInfo + "}\n"
  "\\mdkline{" + lineInfo + "}"
}

public function fmtLatexEscape( context : inlineContext, txt : string, allowEntity : bool ) : string {
  //texText(htmlEscape(txt,allowEntity))
  if (allowEntity)
   then texText(htmlEscape(txt,allowEntity))
   else // we use lstlisting with 'mathescape' and escape just $ and |
        txt.replaceAll(regex(@"\$"),@"$\mbox{\$}$").replaceAll(regex(@"\|"),@"$\mbox{\char124}$")  
}

public function fmtLatexFootnote(context : inlineContext, id : string, fn : footnote ) : string {
  "\\mdFootnote[id=back-fn-" + id + ",label={" + fn.footnoteNum + "}]{" + ((fn.footnoteContent)(context)) + "}"
}

public function fmtLatexLink( context : inlineContext, isImage : bool, link : link, content : string ) {
  val attrs = if (link.linkid.bool) then link.linkattrs.addKeyval("data-linkid",link.linkid) else link.linkattrs
  if (isImage) {
    texCmd("img",link.href,attrs)
  }
  else {
    texCmd("a", texLinkText(if (link.href.startsWith("#")) then link.href.substr(1) else link.href),attrs) +
      "{" + (if (link.linkattrs.hasClass("tex-tooltip")) then extractText(link.title) else "") + "}" +
      "{" + content + "}"    
  }
}

function extractText( s : string ) : string {
  s.replaceAll(regxTexCmd," ")
}

val regxTexCmd = regex(rxTexCmd)

public function fmtLatexCodePlain( context : inlineContext, txt : string ) : string 
{
  txt.htmlEscape(False).texText.preSpace
}

public function fmtLatexCodeHilite( context : inlineContext, txt : string, startLine : bool ) : (string) 
{
  unTokenize(txt,startLine)
}

public function fmtLatexCodeToken(classes : list<string>, txt : string ) : string
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
        fmtLatexCodeToken( classes, cap.groups[2] )    
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


public function fmtLatexCodeTable( context : inlineContext, ct : codeTable, attrs : attrs ) : string {
  val table = if (attrs.hasClass("long")) then "LongTable" else "Table"
  "\\begin{mdCode" + table + "}" + attrs.texAttrsX + "{" + ct.columns.show + "}" + "{" + list(1,ct.columns).map(fun(_) {"l"}).join("") + "}\n" +
    ct.rows.map( fun(row) { row.map(fmtLatexCodeCell).join("&") }).join("\\\\\n") +
  "\n\\end{mdCodeTable}\n"
}

function fmtLatexCodeCell( ccell : ccell ) : string {
  val align = if (ccell.center) then "c" else "l"
  if (ccell.span <= 1) then ccell.content else "\\multicolumn{" + ccell.span.show + "}{" + align + "}{" + ccell.content + "}"
}

public function fmtLatexTable( context : inlineContext, head : list<row>, body : list<row>, colattrs : list<attrs>, attrs : attrs ) : string {
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
      Just(wd) -> "[" + wd.cssWidth + "]"
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
                  Just(clr) -> "{\\cellcolor" + cssColorArg(clr) + "}"
                }            
  val fmt     = (if (attrs.hasClass("cell-border-left")) then "|" else "") + align +
                (if (attrs.hasClass("cell-border-right")) then "|" else "")

  val attrsx  = attrs( classes = attrs.classes.filter(fun(c){ c != "cell-border-left" && c != "cell-border-right" && !(c.startsWith("align-"))}),
                       keyvals = attrs.keyvals.filter(fun(kv){ kv.fst != "column-span" && kv.fst != "background-color" }))

  val content = if (elem=="column") 
                 then texEnv(elem,body,attrsx)
                 else texCmd(elem,body,attrsx.addKeyval("display","table-cell")) 
                 
  if (colspan=="1" && fmt=="l" && bcolor=="") then content 
   else "\\multicolumn{" + colspan + "}{" + fmt + "}{" + bcolor + content + "}"
}





function capitalize( s : string ) : string {
  s.substr(0,1).toUpper + s.substr(1)
}

function texAttrsX( attrs : attrs ) : string {
  ""
}

/* --------------------------------------
  Command and env
---------------------------------------- */

function texCmd( cmd : string, body : string, attrs : attrs = attrsNone, pre : string = "md" ) : string {
  // val cmdName = if (attrs.texelem != "") then attrs.texelem else (pre + cmd.normalizeCmd.capitalize)
  // "\\" + cmdName + attrs.texAttrsX + "{" + body + "}"
  attrs.cssAttrs(body,[("display","inline")],cmd)
}


function texEnv( env : string, body : string, attrs : attrs = attrsNone ) : string {
  texEnvPlain(env,body,attrs)
}

function texEnvPlain( env : string, body : string, attrs : attrs ) : string {
  val envName = (if (attrs.texelem != "") then attrs.texelem else ("md" + env.normalizeCmd.capitalize))
  val envCmd = // "\\begin{" + envName + "}" + attrs.texAttrsX + "%mdk\n" +
               attrs.cssAttrs(body,[("display","block")],env) // + "%mdk\n" +
               // "\\end{" + envName + "}%mdk\n"
  match(attrs.hasKey("float")) {
    Nothing   -> envCmd
    Just(flt) -> "\\mdFloatBox{" + flt + "}{" + attrs.lookupKey("lines","") + "}{" + envCmd + "}"
  }               
}

function texClassName( attrs : attrs, def : string ) : (string,attrs) {
  val name = attrs.elementName(def)
  (name.normalizeCmd.capitalize,attrs(classes=attrs.classes.filter(fun(c){ c != name })))    
}

function normalizeCmd( cmd : string ) {
  cmd.replaceAll(rxCmdSpecial,"").replaceAll(rxDigits) fun(cap) {
    list(1,cap.matched.parseInt.maybe(0,id)).map(fun(i) { "x" }).join
  }
}
val rxDigits = regex(@"\d+")
val rxCmdSpecial = regex(@"[^a-zA-Z0-9]")



/* --------------------------------------
  Full header 
---------------------------------------- */
public function fmtLatexFull(body : string, options : options, metadata : dict<string> ) : string {
  fmtLatexFullX(body,options,metadata)
}

public function fmtLatexMathFull( requireDvi : bool, body : string, options : options ) : string {
  fmtLatexFullX(body,options,dict(), if (requireDvi) then "dvi" else "pdf" )
}

function fmtLatexFullX(body : string, options : options, metadata0 : dict<string>, mathmode : string = "") : string 
{
  val metadata = match(metadata0["heading-base"]) {
    Just -> metadata0
    Nothing -> metadata0 + [("heading-base",options.headingBase.show)].dict
  }
  function expand(s) { s.expandKeys(metadata) }
    
  val basicMath = (mathmode == "dvi")
  val pkgs = (options.packages.expand + (if (basicMath) then "" else options.packagesx.expand)).splitPaths 
  val doc0 = if (options.docClass != "") then options.docClass 
             elif (options.headingBase >= 2) then "article" else "book"
  val doc  = doc0.expand
  
  [fmtOptArg(@"\documentclass", doc, ext = ".cls" ),
   "% generated by Madoko, version " + version,
   "%mdk-data-line={1}",
   if (mathmode.isEmpty) then "" else @"\newcommand\mathmode{" + mathmode + "}",
   pkgs.map(fun(pkg) { 
      match (pkg.find(rxTexFile)) {
        Just -> {
          log("files", changeExt(pkg,".tex") );
          @"\input{" + pkg + "}"
        }
        Nothing -> fmtOptArg(@"\usepackage",pkg)
      }
    }).join("\n"),
   options.texHeader.expand,
   if (basicMath) then "" else options.texHeaderx.expand,
   @"\begin{document}",
   //(if (options.title=="") then "" else
   //   "\\title{" + texText(options.title.expand) + "}\n"),
   body, 
   options.texFooter.expand,
   @"\end{document}",""
   ].join("\n")
}

val rxTexFile = regex(@"^[^\n\r\[\]]+?\.tex$",ignoreCase=True)

function fmtOptArg( pre:string, pkg : string,  ext : string = ".sty" ) : string 
{
  pre + (match(pkg.find(rxPkgOpt)) {
    Just(cap) -> {
      val pname = cap.groups[2]
      if (pname.extname!="" || pname.dirname!="") {
        log("files", changeExt(pname,ext) );
      }
      (if (cap.groups[1] != "") then "[" + cap.groups[1] + "]" else "") + 
        "{" + (if (ext==".cls" || ext==".sty") then pname.noext else pname) + "}"
    }
    Nothing  -> {
      val pname = pkg.trim
      if (pname.extname!="" || pname.dirname!="") {
        log("files", changeExt(pname,ext) )
      }
      "{" + (if (ext==".cls" || ext==".sty") then pname.noext else pname) + "}"
    }
  })
} 


val rxPkgOpt = regex(@"^\s*(?:\[(.*?)\]\s*)?([^\*]+)\s*(?:\*\s*)?$")



// -----------------------------------------------------------------------------
//
// -----------------------------------------------------------------------------


function cssAttrs( attrs : attrs = attrsNone, body : string, defaults = [], elem = "" ) : string {
  val kvs = dict(defaults + attrs.keyvals).cssExpandKeys
  body.applyCmd(kvs,"tex-innercmd")
      .applyCmd(kvs,"tex-cmd")
      .applyEnv(kvs,"tex-env",elem)
      .cssOuter(kvs)
      .applyCmd(kvs,"tex-outercmd")
  /*
  if (attrs.empty) then "" else {
    val txt = [ if (attrs.classes.isNil) then [] else ["class={" + attrs.classes.map(normalizeId).join(",") + "}"],  // so block goes first
                if (attrs.name=="") then [] else ["id=" + attrs.name],
                if (attrs.label=="") then [] else ["label={" + attrs.label.escapeEntity.texText + "}"],
                if (attrs.elem=="") then [] else ["elem={" + attrs.elem.escapeEntity.texText + "}"],
                attrs.keyvals.filter(nosuppressKey).map(fun(kv) { 
                  val (name0,value) = kv
                  val name = if (name0.startsWith("tex-")) then name0.substr(4) else name0    
                  showAttr( name, value )
                }),          
              ].concat.join(",") 
    if (txt=="") then "" else "[" + txt + "]"  
  }
  */
}

function applyCmd( body : string, kvs : dict<string>, key : string ) : string {
  match(kvs[key]) {
    Nothing -> body
    Just(cmd) -> 
      (if (cmd.startsWith("+")) then cmd.substr(1) else cmd) + body.braced + "\n"
  }
}

function applyEnv( body : string, kvs : dict<string>, key : string, elem : string) : string {
  match(kvs[key]) {
    Nothing -> {
      if (elem=="p") {
        body + "\n" // body will already end in \n 
      }
      else {
        body
      }
    }
    Just(env) -> {
      val (envName,envArgs) = match(env.find(rxEnv)) {
                               Just(cap) -> (cap.groups[1],cap.groups[2])
                               Nothing   -> (env,"")
                             }
      "%mdk\n\\begin{" + envName + "}" + envArgs + "%mdk\n" + body + "%mdk\n\\end{" + envName + "}%mdk\n"
    }
  }
}
val rxEnv = regex(@"^(\w+)([\s\S]*)$")

function cssOuter( body0 : string, kvs : dict<string> ) : string {
  body0.onKeys(kvs,["padding-left","padding-right"], fun(body) {
         "\n\\begin{mdMarginLR}" + [kvs.find("padding-right"),kvs.find("padding-left")].texArgs +
         "%mdk\n" + body.trim + "\n\\end{mdMarginLR}%mdk\n"
       })
       .onKey(kvs,"padding-bottom", fun(value,body) { body.trimRight + "%mdk\n\\mdMarginBottom" + value.braced + "%mdk\n" } )
       .onKey(kvs,"padding-top", fun(value,body) { "\\mdMarginTop" + value.braced + "%mdk\n" + body.trimLeft } )       
       .onKeys(kvs,["border-style","border-top-style","border-bottom-style","border-left-style","border-right-style","background-color"], 
          fun(body) { body.cssBorder(kvs) } )
       .onKeys(kvs,["margin-left","margin-right"], fun(body) {  // note: width implies margin-right
         "\n\\begin{mdMarginLR}" + kvs.marginLR +
         "%mdk\n" + body.trim + "\n\\end{mdMarginLR}%mdk\n"
       })
       .onKey(kvs,"margin-bottom", fun(value,body) { body.trimRight + "%mdk\n\\mdMarginBottom" + value.braced + "%mdk\n" } )
       .onKey(kvs,"margin-top", fun(value,body) { "\\mdMarginTop" + value.braced + "%mdk\n" + body.trimLeft } )       
}


function marginLR( kvs : dict<string> ) : string {
  val left = kvs.find("margin-left").cssWidth
  val right = kvs.find("margin-right").cssWidth
  val width = kvs.dimBorderBoxWidth
  if (left=="auto") {
    if (right=="auto") {
      val auto = dimAuto(width)
      auto.braced + auto.braced
    }
    else dimAuto(width,right).braced + right.braced
  }
  elif (right=="auto") {
    left.braced + dimAuto(width,left).braced
  }
  else {
    left.braced + right.braced
  }
}

function dimAuto( w : string, other : string = "" ) : string {
  if (w.isEmpty) then "" else "\\dimAuto" + w.braced + other.braced
}

function dimBorderBoxWidth( kvs : dict<string> ) {
  val w = kvs.find("width")
  if (w.isEmpty) return ""
  
  val maxw = kvs.find("max-width")
  val minw = kvs.find("min-width")
  
  val width0 = if (maxw.isEmpty) then w.cssWidth else "\\dimMin" + w.cssWidth.braced + maxw.cssWidth.braced
  val width  = if (minw.isEmpty) then width0 else "\\dimMax" + width0.braced + minw.cssWidth.braced 
  val extra = [kvs.find("border-left-width"),kvs.find("padding-left"),
               kvs.find("border-right-width"),kvs.find("padding-right")
              ].filter(bool).map(cssWidth)
  ([width] + extra).join("+")
}

function cssBorder( body : string, kvs : dict<string> ) : string {
  function hasStyle(side) {
    match(kvs["border-" + side + "-style"]) {
      Just(value) | value != "none" -> [] 
      _ -> [side+"line=false"]
    }
  }
  val hides   = ["top","right","bottom","left"].map(hasStyle) 
  val hideall = (kvs.find("border-width")=="0pt" || hides.all(isCons))

  if (hideall) then {
    "\n\\begin{mdBackgroundColor}" +     
    cssColorArgHtml(kvs.find("background-color","#FFF")) + "%mdk\n" +
    body.trim +
    "\n\\end{mdBackgroundColor}%mdk\n"
  }
  else {
  "\n\\begin{mdBorder}" + 
    cssWidth(kvs.find("border-width","1px")).braced +
    cssColorArgHtml(kvs.find("border-color","#000")) +
    cssColorArgHtml(kvs.find("background-color","#FFF")) +
    hides.concat.join(",").braced + "%mdk\n"
    + body.trim + 
    "\n\\end{mdBorder}%mdk\n"
  }
}


function cssExpandKeys( kvs : dict<string> ) : dict<string> {
  val xs = [
    if (kvs.containsKey("width")) then [("margin-right","auto")] else [], // ensures marginLR
    if (kvs.containsKey("background-color")) then [("border-style","solid"),("border-width","0pt")] else [], // ensures cssborder
    kvs.cssExpandTRBL("margin"),
    kvs.cssExpandTRBL("padding"),
    kvs.cssExpandTRBL("border-style"),
    kvs.cssExpandTRBL("border-width"),
  ].concat
  xs.dict + kvs 
}

function cssExpandTRBL( kvs : dict<string>, key : string  ) : list<(string,string)> {
  val i = key.lastIndexOf('-')
  val (pre,post) = if (i < 0) then (key,"") else (key.substr(0,i),key.substr(i))
  match(kvs[key]) {
    Nothing -> []
    Just(value) -> {
      val vs = value.cssSplitValues
      val ks = ["top","right","bottom","left"].map(fun(side) { pre + "-" + side + post })
      val zs = zip(ks,[vs,vs,vs,vs].concat)
      if (zs.length == 4) then zs else {
        warning("Unable to parse CSS values: " + value)
        []
      }
    }
  }
}

function cssSplitValues( s : string ) : list<string> {
  s.findAll(rxCssTerm).list.map(fun(cap) { cap.matched })
}

val rxEsc   = @"\\(?:[0-9a-fA-F]{1,6}\s*|.)"
val rxCssTerm = regex(@"(?:'(?:[^\n\\']|" + rxEsc + @")*'|""(?:[^\n\\""]|" + rxEsc + @")*""|-?[a-zA-Z_]\w*\([^\)]*\)|(?:[^'""\\\s]|" + rxEsc + ")+)")


function onKey( body : string, kvs : dict<string>, key : string, action ) : string {
  match(kvs[key]) {
    Nothing -> body
    Just(value) -> action(value,body)
  }
}

function onKeys( body : string, kvs : dict<string>, keys : list<string>, action ) : string {
  if (kvs.containsAny(keys)) then action(body) else body
}

function texArgs( xs : list<string> ) = xs.map(braced).join

function braced( s : string ) : string {
  if (s.startsWith("{") && s.endsWith("}")) then s else "{" + s + "}"
}

function containsAny( d : dict<a>, keys : list<string> ) : bool {
  keys.any( fun(key) { d.containsKey(key) })
}

function find( d : dict<string>, key : string, default = "" ) : string {
  d[key].maybe(default,id)
}

function nosuppressKey( kv : (string,string) ) : bool {
  val key = kv.fst
  (key != "source" && !(key.startsWith("html-") || key.startsWith("css-")))
}


function cssColorCmd( v : string ) : string {
  "\\color"
}

function cssColorArg( v : string ) : string {
  val c = v.cssColor
  if (c.startsWith("#")) 
    then "[HTML]{" + c.substr(1) + "}"
  elif (c.startsWith("\\#")) 
    then "[HTML]{" + c.substr(2) + "}"
    else "{" + c.substr(0,1).toUpper + c.substr(1).toLower + "}"
}

function cssColorArgHtml( v : string ) : string {
  val c = v.cssColor
  if (c.startsWith("#")) 
    then c.substr(1).braced + "{}"
  elif (c.startsWith("\\#")) 
    then c.substr(2).braced + "{}"
    else "{}{" + c.substr(0,1).toUpper + c.substr(1).toLower + "}"
}


function cssColor( v : string ) : string {
  match(v.find(rxRgbX)) {
    Just(cap) -> {
      if (cap.groups[4]=="")
       then "\\#" + [1,1,2,2,3,3].map( fun(i) { cap.groups[i] } ).join.toUpper
       else "\\" + v.trim.toUpper
    }
    Nothing -> match(v.find(rxRgb)) {
      Just(cap) -> {
        val rgb = [cap.groups[1],cap.groups[3],cap.groups[4]].map( fun(c) { c.parseIntDefault(0) } )
        val hrgb = if (cap.groups[2]=="%") then rgb.map( fun(p) { (p.double * 2.55).int } ) else rgb
        "\\#" + hrgb.map(fun(c) { c.showHex(2) } ).join
      }
      Nothing   -> match(v.find(rxHsl)) {
        Just(cap) -> {
          val (r,g,b) = hslToRgb( cap.groups[1].parseIntDefault(0), cap.groups[2].parseIntDefault(0), cap.groups[3].parseIntDefault(0) )
          "\\#" + [r,g,b].map( fun(c) { c.showHex(2) } ).join
        }
        Nothing -> cssValue(v)
      }
    }
  }
}

function cssWidth( v : string ) : string {
  match(v.find(rxPerc)) {
    Just(cap) -> {
      val perc = cap.groups[1].parseInt().maybe(100,id).double / 100.0
      perc.showFixed(2) + "\\linewidth"
    }
    Nothing -> match(v.find(rxPixels)) {
      Just(cap) -> cap.groups[1] + "\\px"
      Nothing   -> cssValue(v)
    }
  }
}

function cssValue( v : string ) : string {
  v.escapeEntity.texText.replaceAll(regex("\n"),"\\\\")
}

val rxPerc = regex(@"^\s*(\d{1,3})%\s*$")
val rxPixels = regex(@"^\s*(\d+(?:\.\d+)?)px\s*$")

val rxRgbX = regex(@"^\s*#([a-fA-F0-9])([a-fA-F0-9])([a-fA-F0-9])([a-fA-F0-9]{3})?")
val rxRgb = regex(@"^\s*rgba?\((\d+)(%)?,(\d+)%?,(\d+)%?(?:,\d+%?)?\)\s*$")
val rxHsl = regex(@"^\s*hsla?\((\d+),(\d+)%?,(\d+)%?(?:,\d+%?)?\)\s*$")

function hslToRgb(hi, si, li){
  val h = (hi%360).double / 360.0;
  val s = si.double * 0.01;
  val l = li.double * 0.01;

  if (s==0.0) {
    val x = (l*255.0).int
    return (x,x,x)
  }

  val q = if (l < 0.5) then l * (1.0 + s) else l + (s - (l * s));
  val p = (2.0 * l) - q;
  
  function hue2rgb(t0) {
    val t = if (t0 < 0.0) then t0+1.0 elif (t0 > 1.0) then t0-1.0 else t0;
    val c = if (t < 1.0/6.0) then p + (q - p) * 6.0 * t
            elif (t < 0.5) then q
            elif (t < 2.0/3.0) then p + (q - p) * (2.0/3.0 - t) * 6.0
            else p
    (c * 255.0).int            
  }

  (hue2rgb(h + 1.0/3.0), hue2rgb(h), hue2rgb(h - 1.0/3.0))
}
