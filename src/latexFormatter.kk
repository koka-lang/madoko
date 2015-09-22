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
import attributes
import codeAlign

import texCommon      // for texAccents et al
import cssFormatter

public function fmtLatexEnv(context : inlineContext, env : string, txt : string, attrs : attrs ) : string {
  if (env=="") 
   then texText(txt) 
  elif (env=="ul" || env=="ol")
   then texList(env,txt,attrs)
   else texEnv(env,txt,attrs)
}

public function fmtLatexCmd(context : inlineContext, cmd : string, txt : string, attrs : attrs ) : string {
  if (cmd=="") then texText(txt) 
  elif (cmd=="br") then "\\mdbr\n" 
  // elif (cmd=="code") then "\\lstinline|" + txt + "|" 
  else texCmd(cmd,txt,attrs)
}

public function fmtLatexMathEnv(context : inlineContext, env : string, txt : string, attrs : attrs ) : string {
  attrs.cssAttrs(txt,[("display","inline")],"span")
}

public function fmtLatexMathCmd(context : inlineContext, cmd : string, txt : string, attrs : attrs ) : string {
  attrs.cssAttrs(txt,[("display","inline")],"span")
}

public function fmtLatexLineInfo( context : inlineContext, lineInfo : string ) : string {
  //"%mdk-data-line={" + lineInfo + "}\n"
  "\\mdline{" + lineInfo + "}"
}

public function fmtLatexEscape( context : inlineContext, txt : string, allowEntity : bool ) : string {
  //texText(htmlEscape(txt,allowEntity))
  if (allowEntity)
   then texText(htmlEscape(txt,allowEntity))
   else // we use lstlisting with 'mathescape' and escape just $ and |
        txt.replaceAll(regex(@"\$"),@"$\mbox{\$}$").replaceAll(regex(@"\|"),@"$\mbox{\char124}$")  
}

public function fmtLatexFootnote(context : inlineContext, id : string, fn : footnote ) : string {
  texCmdX( "\\mdfootnote" + fn.footnoteNum.braced, ((fn.footnoteContent)(context)).trimLeft, attrsNone, [("id","back-fn-" + id)])
}

public function fmtLatexLink( context : inlineContext, isImage : bool, link : link, content : string ) {
  val attrs = if (link.linkid.bool) then link.linkattrs.addKeyval("data-linkid",link.linkid) else link.linkattrs
  val url   = texLinkText(if (link.href.startsWith("#")) then link.href.substr(1) else link.href)
  if (isImage) {
    val (attrsx, args) = cssImageArgs(attrs)
    texCmdX( "\\includegraphics[" + args + "]" + url.noext.braced, "" /*content*/, attrsx ) 
  }
  else {
    val title = if (link.linkattrs.hasClass("tex-tooltip")) then "\\mdtooltip" + extractText(link.title).braced else ""
    val cmd   = if (attrs.hasClass("localref")) 
                 then (if (attrs.hasClass("bibref")) 
                        then "\\mdcite" + url.braced
                        else "\\mdref" + url.braced )
                 else "\\href" + url.braced
    texCmdX( cmd, content, attrs, [("tex-outercmd",title)] )
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
                  val cclasses = classes.map( fun(cname) { cname.replaceAll(regex(@"[^a-zA-Z]+"),"") })
                                  .filter( fun(cname) { cname != "" && cname != "token" })
                  @"\mdtoken{" + cclasses.join(",") + "}{"
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
     .replaceAll("`","\\lsquot{}")
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
  (@"~", @"\textasciitilde{}"),
  (@"#", @"\#"),
  (@"&", @"\&"),  // defined by madoko.sty
  (@"$", @"\$"),
  (@"{", @"\{"),
  (@"}", @"\}"),
  (@"_", @"\_"),
  (@"^", @"\textasciicircum{}"),
  (@"|", @"\textbar{}"),
  (@"<", @"\textless{}"),
  (@">", @"\textgreater{}"),
  (@"\",@"\textbackslash{}"),  // must come last, see rxSpecial that appends a "\"
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
  val table = if (attrs.hasClass("long")) then "longtable" else "tabular"
  val content = 
      "\\begin{mdcodetabular}" + ct.columns.show.braced + 
    "\\begin" + table.braced + "{" + list(1,ct.columns).map(fun(_) {"l"}).join("") + "}\n" +
    ct.rows.map( fun(row) { row.map(fmtLatexCodeCell).join("&") }).join("\\\\\n") +
    "\n\\end" + table.braced + "\\end{mdcodetabular}%mdk\n"
  texEnv("",content,attrs.addClass("para-block"))
}

function fmtLatexCodeCell( ccell : ccell ) : string {
  val align = if (ccell.center) then "c" else "l"
  if (ccell.span <= 1) then ccell.content else "\\multicolumn{" + ccell.span.show + "}{" + align + "}{" + ccell.content + "}"
}

public function fmtLatexTable( context : inlineContext, head : list<row>, body : list<row>, colattrs : list<attrs>, attrs : attrs ) : string {
  val rows = head + body
  val td = if (attrs.hasClass("columns")) then "column" else "td"
  val table = if (attrs.hasClass("long")) then "longtable" else "tabular"
  val columns = max(1,rows.map(fun(r:row){ r.cells.length }).maximum)
  val colattrsx = (colattrs + list(colattrs.length,columns).map(fun(i){ attrsNone })).take(columns)
  "\\begin{mdtabular}" + columns.show.braced + 
      "\\begin{" + table + "}" + 
      "{" + colattrsx.map(fmtColumn).join + "}" +
    head.fmtRows("th") + "\n" +
    body.fmtRows(td) +
    "\\end{" + table + "}\\end{mdtabular}\n"
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

function fmtRows( rows : list<row>, td : string ) : string {
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
      val res = (if (lastIsLine) then "\n" else "") + fmtRow(td,row)
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

function fmtRow( td : string, row : row ) : string {
  /*
  rcolor = match (row.rowAttrs.hasKey("background-color")) {
             Nothing   -> ""
             Just(clr) -> "\\rowcolor" + fmtColorArg(clr)
           }     
  rcolor + */
  row.cells.map(fun(cell) { fmtCell(td,cell.text.trim,cell.cellAttrs) }).join("&") 
    + "\\\\\n"
} 



function fmtCell( elem : string, body : string, attrs : attrs ) : string {
  val colspan = attrs.lookupKey("column-span","1")
  val align   = match(attrs.hasKey("text-align")) {
                  Just(alignment) -> alignment.substr(0,1)
                  Nothing -> if (elem=="th") then "c" else "l" 
                }
  val bcolor  = match (attrs.hasKey("background-color")) {
                  Nothing   -> ""
                  Just(clr) -> "{\\cellcolor[HTML]" + cssColorArg(clr) + "}"
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


function texList( tag : string, body : string, attrs : attrs ) : string {
  val args = cssListArgs( attrs )
  val env  = attrs.lookupKey("tex-env","itemize") + args
  attrs.addKeyval("tex-env",env).cssAttrs(body,[("display","block")],"")
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

function texCmdX( cmd : string, body : string, attrs : attrs = attrsNone, extra : list<(string,string)> = []) : string {
  // val cmdName = if (attrs.texelem != "") then attrs.texelem else (pre + cmd.normalizeCmd.capitalize)
  // "\\" + cmdName + attrs.texAttrsX + "{" + body + "}"
  attrs.cssAttrs(body,[("display","inline"),("tex-cmd",cmd)] + extra)
}


function texEnv( env : string, body : string, attrs : attrs = attrsNone ) : string {
  texEnvPlain(env,body,attrs)
}

function texEnvPlain( env : string, body : string, attrs : attrs ) : string {
  //val envName = (if (attrs.texelem != "") then attrs.texelem else ("md" + env.normalizeCmd.capitalize))
  val envCmd = // "\\begin{" + envName + "}" + attrs.texAttrsX + "%mdk\n" +
               attrs.cssAttrs(body,[("display","block")],env) // + "%mdk\n" +
               // "\\end{" + envName + "}%mdk\n"
  match(attrs.hasKey("float")) {
    Nothing   -> envCmd
    Just(flt) -> "\\mdfloatbox{" + flt + "}{" + attrs.lookupKey("lines","") + "}{" + envCmd + "}"
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
  val kvs = dict(defaults + attrs.keyvals).cssExpandKeys()
  val isBlock = kvs.cssIsBlock
  /*
  val kvs = if (isBlock || elem == "span" || elem == "div" ||
                ["tex-cmd","tex-innercmd","tex-cmd","tex-env","tex-outercmd","tex-outerenv"].any(fun(k) { kvs0.containsKey(k) }))
             then kvs0
             else kvs0 + [("tex-cmd","\\md" + elem.normalizeCmd)].dict
  */            
  body.insertCmd(kvs,"tex-cmd-before")
      .appendCmd(kvs,"tex-cmd-after")
      .applyCmd(kvs,"tex-cmd-inner")
      .cssInner(kvs, attrs, isBlock)
      .applyCmd(kvs,"tex-cmd")
      .applyEnv(kvs,"tex-env",attrs)
      .cssBox(kvs,isBlock)
      .cssOuter(kvs, attrs, isBlock)
      .applyCmd(kvs,"tex-cmd-outer")
      .applyEnv(kvs,"tex-env-outer",attrs)
      .applyBlock(isBlock && !attrs.hasClass("para-block"), attrs)
}

function applyBlock( body : string, isBlock : bool, attrs : attrs ) : string {
  val lineinfo = match(attrs.hasKey("data-line")) {
    Just(info) -> "\n%mdk-data-line={" + info + "}" 
    Nothing    -> ""    
  }
  if (isBlock) then lineinfo + "\n" + body.trim + "%mdk\n" else body
}

function applyCmd( body : string, kvs : dict<string>, key : string ) : string {
  match(kvs[key]) {
    Nothing -> body
    Just(cmd) -> 
      if (cmd.startsWith("{")) 
        then cmdconnect(cmd.substr(1), body).braced
        else cmd + body.braced 
  }
}

function insertCmd( body : string, kvs : dict<string>, key : string ) : string {
  match(kvs[key]) {
    Nothing -> body
    Just(cmd) -> {
      val cbody = cmdconnect(if (cmd.startsWith("{")) then cmd.substr(1) else cmd, body) 
      if (cmd.startsWith("{")) then cbody.braced else cbody
    }
  }
}


function appendCmd( body : string, kvs : dict<string>, key : string ) : string {
  match(kvs[key]) {
    Nothing -> body
    Just(cmd) -> {
      body + cmd
    }
  }
}

function applyEnv( body : string, kvs : dict<string>, key : string, attrs : attrs) : string {
  match(kvs[key]) {
    Nothing -> body
    Just(env) -> {
      val post = kvs["tex-env-postfix"].maybe("",id)
      match(env.find(rxEnv)) {
       Just(cap) -> body.blockEnv(cap.groups[1] + post,expandKeys(cap.groups[2],"",attrs,dict(),dict()))
       Nothing   -> body.blockEnv(env + post)
      }
    }
  }
}
val rxEnv = regex(@"^(\w+)([\s\S]*)$")

function blockEnv( body : string, env : string, args : string = "" ) {      
  "\\begin{" + env + "}" + args + "%mdk\n" + body + "%mdk\n\\end{" + env + "}"
}

function trimEnv( body : string, env : string, args : string = "" ) {      
  body.trim.blockEnv(env,args)
}

function braceCmd( body : string, cmd : string ) : string {
  "{" + cmd.cmdconnect(body.unbrace) + "}"  // TODO: unbrace is unsafe here, i.e. {\cmd}gkkgk{\test}
}

function unbrace( s : string ) : string {
  if (s.startsWith("{") && s.endsWith("}")) then s.substr(1,s.length-2) else s
}

function cmdconnect( cmd : string, s : string ) : string {
  if (cmd.isEmpty || s.isEmpty || cmd.endsWith("}")) then cmd + s
  elif (s.contains(rxCmdOk)) then cmd + s 
  elif (s.contains(rxCmdSpace)) then cmd + "{}" + s
  else cmd + " " + s
}
val rxCmdOk = regex(@"^[^a-zA-Z0-9\s]")
val rxCmdSpace = regex(@"^\s")


function trimEnvCmd( body : string, name : string, args : string, isBlock : bool ) {      
  if (isBlock) 
    then body.trimEnv( "mdb" + name, args)
    else "\\md" + name + args + body.braced  
}


function cssInner( body0 : string, kvs : dict<string>, attrs : attrs, isBlock : bool ) : string {
  body0
    .onKey(kvs,"color", fun(value,body) {
      body.braceCmd("\\mdcolor" + value.cssColor.braced)
    })
    .cssFont(kvs)
    .cssText(kvs,attrs,isBlock)
}

function cssOuter( body0 : string, kvs : dict<string>, attrs : attrs, isBlock : bool ) : string {
  val body1 = if (attrs.name.isEmpty) then body0 
               else body0 + "\\label" + attrs.name.braced
  val body2 = body1
  /*.onKey(kvs,"bookmark",fun(value,body) {
    cmdconnect( "\\mdbookmark" + attrs.lookupKey("level","1").braced + 
                    value.texText.braced + attrs.name.braced + "%mdk\n",
                body )
  })*/               
  if (isBlock) {
    body2.onKeys(kvs,["margin-left","margin-right","margin-top","margin-bottom"], fun(b) {  
      b.margins(kvs)
    })
  }
  else {
    body2.cssInlineMargin(kvs,"margin")
  }
}

// -----------------------------------------------------------------------------
// Text
// -----------------------------------------------------------------------------

function cssText( body : string, kvs : dict<string>, attrs :attrs, isBlock : bool ) : string {
  if (isBlock) then {
    body
      .onClasses( attrs, ["para-continue","para-block","noindent"], fun(b) {
        cmdconnect("\\noindent",b)
      })
      .onKey( kvs, "text-indent", fun(value,b) {
        cmdconnect( (if (attrs.hasClass("noindent")) then "" else "\\noindent") + 
                    (if (value==""||value=="0"||value=="0em") then "" else "\\hspace*" + value.cssWidth.braced)
                  , b )
      })
      .onKey( kvs, "line-height", fun(value,b) {
        braceCmd( "\\baselineskip=" + value.cssFontLength + "\\relax", b )
      })
  }
  else body
}

// -----------------------------------------------------------------------------
// Images
// -----------------------------------------------------------------------------

function cssImageArgs( attrs : attrs ) : (attrs,string) {
  val kvs = attrs.keyvals.dict
  val args = "keepaspectratio=true"
    .onKey( kvs, "width", fun(value,b) {
      if (value=="auto") then b else b + ",width=" + cssWidth(value)
    })
    .onKey( kvs, "height", fun(value,b) {
      if (value=="auto") then b else b + ",height=" + cssHeight(value)
    })
    .onKey( kvs, "zoom", fun(value,b) {
      b + ",scale=" + cssValue(value)
    })
    .onKey( kvs, "transform-scale", fun(value,b) {
      b + ",scale=" + cssValue(value)
    })
    .onKey( kvs, "transform-rotate", fun(value,b) {
      b + ",angle=" + cssValue(value)
    })
  val attrsx = attrs.removeKeys(["width","height","zoom","transform-rotate","transform-scale"])
  (attrsx,args)
}

// -----------------------------------------------------------------------------
// Lists
// -----------------------------------------------------------------------------

function cssListArgs( attrs : attrs ) : string {
  val kvs = attrs.keyvals.dict
  val args = 
    (if (attrs.hasClass("compact")) then "noitemsep,topsep=\\mdcompacttopsep" else "")
    .onKey( kvs, "start", fun(value,b) {
      b + ",start=" + cssValue(value)      
    })
    .onKey( kvs, "list-style-type", fun(value0,b) {
      val value = value0.cssValue
      val tag   = if (value=="lower-roman") then "\\roman*"
                  elif (value=="upper-roman") then "\\Roman*"
                  elif (value=="lower-alpha" || value=="lower-latin") then "\\alph*"
                  elif (value=="upper-alpha" || value=="upper-latin") then "\\Alph*"
                  elif (value=="decimal") then "\\arabic*"
                  elif (value=="disc") then "\\textbullet"
                  elif (value=="circle") then "$\\circ$"
                  elif (value=="square") then "$\\blacksquare$"
                  elif (value=="dash") then "{--}"
                  elif (value=="none") then ""
                  else "\\arabic*"                
      val fmt = match(kvs["list-format"]) {
                  Nothing -> if (tag.endsWith("*")) then "#1" + (if (attrs.hasClass("list-sep-paren")) then ")" else ".") else "#1"
                  Just(f) -> f
                }
      val label = fmt.replaceAll("#1",tag)
      b + ",label=" + label
    })
  if (args.isEmpty) then "" else "[" + args + "]"
}

// -----------------------------------------------------------------------------
// Fonts
// -----------------------------------------------------------------------------

function cssFont( body : string, kvs : dict<string> ) : string {
  body
    .onKey( kvs,"font-weight", fun(value,b) { 
      val cmd = if (value=="bold") then "\\bfseries"
                elif (value=="bolder") then "\\bfseries"
                elif (value=="lighter") then "\\mdseries"
                elif (value=="normal") then "\\mdseries"
                else ""
      b.braceCmd(cmd)
    })
    .onKey( kvs,"font-size", fun(value,b) { 
      val cmd = if (value.cssIsLength) then "\\mdfontsize" + value.cssFontLength.braced  
                elif (value=="larger") then "\\mdfontsize{1.2}"
                elif (value=="smaller") then "\\mdfontsize{0.8}"
                elif (value=="xx-small") then "\\tiny"
                elif (value=="x-small") then "\\scriptsize"
                elif (value=="small") then "\\small"
                elif (value=="medium") then "\\normalsize"
                elif (value=="large") then "\\large"
                elif (value=="x-large") then "\\Large"
                elif (value=="xx-large") then "\\LARGE"
                else { warning("illegal font-size value: " + value); "" }
      b.braceCmd(cmd)
    })
    .onKey( kvs,"font-style", fun(value,b) { 
      val cmd = if (value=="italic") then "\\itshape"
                elif (value=="oblique") then "\\slshape"
                elif (value=="normal") then "\\upshape"
                else { warning("illegal font-style value: " + value); "\\upshape" }
      b.braceCmd(cmd)
    })
    .onKey( kvs,"font-variant", fun(value,b) { 
      val cmd = if (value=="small-caps") then "\\scshape"
                elif (value=="all-small-caps") then "\\scshape"
                elif (value=="petite-caps") then "\\scshape"
                elif (value=="all-petite-caps") then "\\scshape"
                elif (value=="normal") then "\\upshape"
                else ""
      b.braceCmd(cmd)
    })
    .onKey( kvs,"font-family", fun(value,b) { 
      val fonts = value.cssSplitValues.reverse
      match(fonts) {
        Nil -> b
        Cons(fam,_) -> {
          val cmd = if (fam=="serif") then "\\rmfamily"
                    elif (fam=="sans-serif") then "\\sffamily"
                    elif (fam=="monospace") then "\\ttfamily"
                    else {
                      if (fam.startsWith("tex-")) 
                        then "\\fontfamily{" + fam.substr(4) + "}\\selectfont"
                        else "\\fontspec{" + fam.unquote + "}"
                    }
          b.braceCmd(cmd)
        }
      }
    })
}

function unquote( s : string ) : string {
  if (s.startsWith("'") && s.endsWith("'")) then s.substr(1,s.length-2)
  elif (s.startsWith("\"") && s.endsWith("\"")) then s.substr(1,s.length-2)
  else s
}


// -----------------------------------------------------------------------------
// Margins
// -----------------------------------------------------------------------------


function cssInlineMargin( body0 : string, kvs : dict<string>, margin : string ) : string {
  val body1 = body0.onKey(kvs,margin + "-left", fun(width,body) { 
                "\\hspace*" + cssWidth(width).braced + body
              })
              .onKey(kvs,margin + "-right", fun(width,body) { 
                body + "\\hspace*" + cssWidth(width).braced
              })
  val body2 = if (kvs.cssIsInlineBlock) {
                body1.onKeys(kvs,[margin + "-top", margin + "-bottom"],fun(body) { 
                        "\\md" + margin + "tb" + 
                          cssHeight(kvs.find(margin + "-top")).braced + 
                          cssHeight(kvs.find(margin + "-bottom")).braced + 
                          body.braced
                })
              }
              else body1
  body2.onKey(kvs, "float", fun(value,body) {
    if (value=="left") then "\\mdfloatleft" + body.braced
    elif (value=="right") then "\\mdfloatright" + body.braced
    elif (value=="center") then "\\mdfloatcenter" + body.braced
    else body
  })              
}

function padding( body : string, kvs : dict<string> ) : string {
  val ptop = kvs.find("padding-top").cssWidth
  val pbottom = kvs.find("padding-bottom").cssWidth
  val pleft = kvs.find("padding-left").cssWidth
  val pright = kvs.find("padding-right").cssWidth
  if (ptop==pbottom && pbottom==pleft && pleft==pright)
   then body.trimEnv("mdbpadding", ptop.braced )
   else body.trimEnv("mdbpaddingx", [ptop,pright,pbottom,pleft].map(braced).join )
}

function margins( body : string, kvs : dict<string> ) : string {
  val mtop = kvs.find("margin-top").cssWidth  // top/bottom in margins are calculated with respect to width!
  val mbottom = kvs.find("margin-bottom").cssWidth
  val (mleft,mright) = kvs.marginLR
  if (mtop==mbottom && mbottom==mleft && mleft==mright)
   then body.trimEnv("mdbmargin", mtop.braced )
  elif (mleft.isEmpty && mright.isEmpty)
   then body.trimEnv("mdbmargintb", [mtop,mbottom].map(braced).join )
   else body.trimEnv("mdbmarginx", [mtop,mright,mbottom,mleft].map(braced).join )
}

function marginLR( kvs : dict<string>, pre = "margin") : (string,string) {
  val width  = if (pre=="margin") then kvs.dimBorderBoxWidth else kvs.find("width","").cssWidth
  val left  = kvs.find(pre + "-left").cssWidth("auto")
  val mright = kvs.find(pre + "-right").cssWidth("auto")
  val right  = if (width.bool && left.isEmpty && mright.isEmpty) then "auto" else mright

  if (left=="auto") {
    if (right=="auto") {
      val auto = dimAuto(width)
      (auto,auto)
    }
    else (dimAuto(width,right),right)
  }
  elif (right=="auto") {
    (left,dimAuto(width,left))
  }
  else {
    (left,right)
  }
}

// -----------------------------------------------------------------------------
// Dimensions
// -----------------------------------------------------------------------------

function dimAuto( w : string, other : string = "" ) : string {
  if (w.isEmpty) then "" else "\\dimauto" + w.braced + other.braced
}

function dimBorderBoxWidth( kvs : dict<string> ) {
  val width = kvs.dimContentWidth
  if (width.isEmpty) return ""

  val extra = [kvs.find("border-left-width"),kvs.find("padding-left"),
               kvs.find("border-right-width"),kvs.find("padding-right")
              ].filter(bool).map( fun(wd) { wd.cssWidth })
  if (extra.isNil) 
   then width
   else "\\dimeval" + ([width] + extra).join("+").braced
}

function dimContentWidth( kvs : dict<string> ) {
  val w = kvs.find("width")
  if (w.isEmpty) return ""
  
  val maxw = kvs.find("max-width")
  val minw = kvs.find("min-width")
  
  val width0 = if (maxw.isEmpty) then w.cssWidth else "\\dimmin" + w.cssWidth.braced + maxw.cssWidth.braced
  val width  = if (minw.isEmpty) then width0 else "\\dimmax" + width0.braced + minw.cssWidth.braced 
  width
}

// -----------------------------------------------------------------------------
// Border-box
// -----------------------------------------------------------------------------

function cssBox( body : string, kvs : dict<string>, isBlock : bool ) : string {
  val breakable = kvs.find("breakable").bool || kvs.find("long").bool
  val fboxkeys  = ["border-top-style","border-bottom-style","border-left-style","border-right-style",
                   "vertical-align", "height-align", "baseline",
                   "background-color","height","width"]                  
  if (breakable || kvs.containsAny(fboxkeys)) {
    // use longfbox
    val attrs = [kvs.cssTRBL("padding","",cssWidthX),
                 kvs.cssTRBL("border","-width",cssWidthX),
                 kvs.cssTRBL("border","-color",cssColor),
                 kvs.cssTRBL("border","-style",cssValue),
                 kvs.cssTRBL("border","-radius",cssWidthX), // TODO: parse double radius
                 kvs.cssVerticalAlign,
                 kvs.cssAttr("height-align",cssValue,["top","middle","bottom"]),
                 kvs.cssAttr("text-align",cssValue,["default","left","center","right","justify"]),
                 kvs.cssAttr("baseline",cssValue,["bottom","middle","top"]),
                 kvs.cssAttr("background-color",cssColor),
                 kvs.cssAttr("background-clip",cssValue,["border-box","padding-box","content-box"]),
                 kvs.cssAttr("height",cssHeightX),
                 kvs.cssAttr("width",cssWidthX),
                 kvs.cssAttr("breakable",cssBool),
                ].concat
    val args = attrs.join(",").braced
    if (isBlock)
     then body.trimEnv("mdblock",args)
     else "\\mdinline" + args + body.braced
  }
  else {
    // use specific environments
    body
      .onKey(kvs,"text-align", fun(value,b) {
        if (!isBlock) then b else {
          blockEnv( b, 
            if (value=="left") then "flushleft"
            elif (value=="right") then "flushright"
            elif (value=="center") then "center"
            else "")
        }
      })
      .onKeys(kvs,["padding-left","padding-right","padding-top","padding-bottom"], fun(b) {  
        if (isBlock) then b.padding(kvs) else b.cssInlineMargin(kvs,"padding")
      })
  }
}

function cssVerticalAlign( kvs : dict<string> ) : list<string> {
 match(kvs["vertical-align"]) {
    Nothing -> []
    Just(value) -> {
      if (value.cssIsLength)
       then ["raise=" + value.cssWidth]
       else ["vertical-align=" + value.cssValue]
    }
  }
}

function cssTRBL( kvs : dict<string>, pre : string, post : string, show : string -> string ) : list<string>
{
  val (top,topv) = kvs.cssAttrX(pre + "-top" + post, show)
  val (right,rightv) = kvs.cssAttrX(pre + "-right" + post, show)
  val (bottom,bottomv) = kvs.cssAttrX(pre + "-bottom" + post, show)
  val (left,leftv) = kvs.cssAttrX(pre + "-left" + post, show)

  if (topv==rightv && rightv==bottomv && bottomv==leftv) 
   then (if (top.isNil) then [] else [pre + post + "=" + topv])
   else [top,right,bottom,left].concat
}

function cssHeightX( value : string ) : string {
  cssHeight(value)
}

function cssWidthX( value : string ) : string {
  cssWidth(value)
}

function cssAttr( kvs : dict<string>, key : string, show : string -> string, allowed : list<string> = [], cssKey : string = key ) : list<string> {
  match(kvs[key]) {
    Nothing -> []
    Just(value) -> {
      if (allowed.isCons && !allowed.any(fun(v) { v==value })) then {
        warning("illegal CSS value: " + key + ":'" + value + "'\n  expecting one of: " + allowed.join(",")) 
        []
      } 
      else {
        [cssKey + "=" + value.show]
      }
    }
  }
}

function cssAttrX( kvs : dict<string>, key : string, show : string -> string ) : (list<string>,string) {
  match(kvs[key]) {
    Nothing -> ([],"")
    Just(value) -> {
      val svalue = value.show
      ([key + "=" + svalue], svalue)
    }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function onKey( body : string, kvs : dict<string>, key : string, action ) : string {
  match(kvs[key]) {
    Nothing -> body
    Just(value) -> if (value.isEmpty) then body else action(value,body)
  }
}


function onClasses( body : string, attrs : attrs, classes : list<string>, action ) : string {
  if (classes.any(fun(c) { attrs.hasClass(c)})) then action(body) else body
}

function onKeys( body : string, kvs : dict<string>, keys : list<string>, action ) : string {
  if (kvs.containsAny(keys)) then action(body) else body
}

function texArgs( xs : list<string> ) = xs.map(braced).join


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

