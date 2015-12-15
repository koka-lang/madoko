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
import storage        // for xnormalize
import texCommon      // for texAccents et al
import cssFormatter

function warning( msg : string ) {
  common/warning( msg, "texwarning" );
}

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

function normalize( sandbox: bool, path : string ) : string {
  if (sandbox) then xnormalize(path) else path
}

public function fmtLatexLink( context : inlineContext, isImage : bool, link : link, content : string ) {
  val attrs = if (link.linkid.bool) then link.linkattrs.addKeyval("data-linkid",link.linkid) else link.linkattrs
  val url   = texLinkText(if (link.href.startsWith("#")) then link.href.substr(1) else link.href)  
  if (isImage) {
    // expand extensions and set file refers
    val hrefs  = url.expandChoices
    // pick best one for images
    val imgref = pickExtension(latexImageExtensions, hrefs)

    val (attrsx, args) = cssImageArgs(attrs)
    texCmdX( "\\includegraphics[" + args + "]" + normalize(context.sandbox,imgref).noext.braced, "" /*content*/, attrsx ) 
  }
  else {
    val titleCmd = if (link.linkattrs.hasClass("tex-tooltip")) then [("tex-cmd-outer-after","\\mdtooltip" + extractText(link.title).braced)] else []
    val cmd   = if (attrs.hasClass("localref")) 
                 then (if (attrs.hasClass("bibref")) 
                        then "\\mdcite" + url.braced
                        else "\\mdref" + url.braced )
                 else "\\href" + url.braced
    texCmdX( cmd, content, attrs, titleCmd )
  }
}
val latexImageExtensions = [".pdf",".eps",".ps",".png",".jpg",".jpeg"]

function extractText( s : string ) : string {
  s.replaceAll(regxTexCmd," ")
}

val regxTexCmd = regex(rxTexCmd)

public function fmtLatexCodePlain( context : inlineContext, txt : string, startline : bool ) : string 
{
  txt.htmlEscape(False).texText.preSpace(startline)
}

public function fmtLatexCodeToken(context:inlineContext, classes : list<string>, txt : string, lang : string, attrs : attrs ) : string
{
  /*
  if (classes.any(fun(cname) { cname=="white" })) then {
    "{" + txt + "}" // so preindent can match
  }
  else {
  */
    /*
    val cclasses = classes.map( fun(cname) { cname.replaceAll(regex(@"[^a-zA-Z]+"),"") })
                    .filter( fun(cname) { cname != "" && cname != "token" })
    @"\mdtoken{" + cclasses.join(",") + "}{"
    */
    texCmd("span",txt,attrs)
  //}
}

/*
function fmtLatexCodeHilite( context : inlineContext, txt : string, startLine : bool ) : (string) 
{
  unTokenize(txt,startLine)
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
*/

public function preSpace( txt : string, start : bool = True ) : string {
  val txt1 = if (!start) then txt 
              else txt.replaceAll(rxIndent, fun(cap) { 
                     cap.groups[1] + @"\preindent{" + cap.groups[2].length.show + "}" 
                   })
  txt1.replaceAll("\n","\\\\\n").replaceAll(" ","~")
  /*
  txt.replaceAll(rxIndent,fun(cap){ cap.groups[1] + (if (start) then @"\preindent" else @"\prespace") + "{" + cap.groups[2].length.show + "}" })
     .replaceAll(rxSpaces,fun(cap){ @"\prespace{" + cap.matched.length.show + "}"})
     .replaceAll("\n|<br>","\\prebr{}\n")
     .replaceAll("`","\\lsquot{}")
  */
}
val rxIndent = regex(@"(^|\n)( +)")
val rxSpaces = regex(@" +")

function texLinkText( txt : string ) : string {
  //txt.replaceAll("~","\\textasciitilde ").replaceAll("%","\\%").replaceAll("#","\\#")
  txt.replaceAll( regex(@"([%{}&#\\])"), fun(cap) { cap.matched.list.map( fun(c) { @"\%" + c.int.showHex(2) } ).join })
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
  val table = if (attrs.hasBoolKey("breakable") || attrs.hasClass("long") /* legacy */) then "longtable" else "tabular"
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
  val breakable = attrs.hasBoolKey("breakable") || attrs.hasClass("long") /* legacy */
  val table = if (breakable) then "longtable" else "tabular"
  val columns = max(1,rows.map(fun(r:row){ r.cells.length }).maximum)
  val colattrsx = (colattrs + list(colattrs.length,columns).map(fun(i){ attrsNone })).take(columns)
  val colfmts   = colattrsx.map(fun(ca) { fmtColumn(attrs,ca) })
  val defcolwidth  = colattrsx.fmtDefaultColumnWidth
  val tabcolsep    = attrs.lookupKey("tex-tabcolsep","1ex").cssWidth
  val tbody = "\\begin{mdtabular}" + columns.show.braced  + defcolwidth.braced + tabcolsep.braced +
                "%mdk\n\\begin{" + table + "}" + 
                "{" + colfmts.join + "}" +
              head.fmtRows("th",colfmts,defcolwidth) + "\n" +
              body.fmtRows(td,colfmts,defcolwidth) +
              "\\end{" + table + "}\\end{mdtabular}\n"
  attrs.cssAttrs(tbody, if (breakable) then [("display","block")] else [])              
}

type line {
  Single
  Double
  NoLine
}

val fmtRowLineBreak = "\\morecmidrules\n" // \\\\[-\\mdTablelineskip]\n"

function fmtColumn( attrs : attrs, colattr : attrs ) : string {
  match(colattr.hasKey("text-align")) {
    Just(alignment) -> alignment.substr(0,1)
    Nothing -> "l" 
  }
}

function fmtDefaultColumnWidth( colattrs : list<attrs> ) : string {
  val fixed = colattrs.concat( fun(ca) { 
    if(ca.hasKey("width").bool) then {
      val kvs = dict(ca.keyvals).cssExpandKeys
      ["-" + dimBorderBoxWidth(kvs)]
    }
    else []
  })
  val flexible = colattrs.length - fixed.length
  if (flexible == 0) then "0pt"
    else "\\dimeval{(\\linewidth" + fixed.join + ")/" + flexible.show + "}"
}

function fmtRows( rows : list<row>, td : string, colfmts : list<string>, defcolwidth : string ) : string {
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
      val res = (if (lastIsLine) then "\n" else "") + fmtRow(td,row,colfmts,defcolwidth)
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

function fmtRow( td : string, row : row, colfmts : list<string>, defcolwidth : string ) : string {
  /*
  rcolor = match (row.rowAttrs.hasKey("background-color")) {
             Nothing   -> ""
             Just(clr) -> "\\rowcolor" + fmtColorArg(clr)
           }     
  rcolor + */
  zipWith(row.cells,colfmts, fun(cell,colfmt) { fmtCell(td,cell.text.trim,cell.cellAttrs,colfmt,defcolwidth) }).join("&") 
    + "\\\\\n"
} 



function fmtCell( elem : string, body : string, attrs : attrs, colfmt : string, defcolwidth : string ) : string {
  if (elem=="column" || attrs.lookupKey("display","") == "block")
   then fmtCellBlock(elem,body,attrs,colfmt,defcolwidth)
   else fmtCellInline(elem,body,attrs,colfmt)
}

function fmtCellBlock( elem : string, body : string, attrs : attrs, colfmt : string, defcolwidth : string ) : string {
  if (attrs.hasKey("width").bool)
    then texEnv(elem,body,attrs)
    else texEnv(elem,body,attrs.addKeyval("width","available"))
}

function fmtCellInline( elem : string, body : string, attrs : attrs, colfmt : string ) : string {
  val colspan = attrs.lookupKey("column-span","1")
  val align   = match(attrs.hasKey("text-align")) {
                  Just(alignment) -> alignment.substr(0,1)
                  Nothing -> if (elem=="th") then "c" else "l" 
                }
  val bcolor  = match (attrs.hasKey("background-color")) {
                  Nothing   -> ""
                  Just(clr) -> "{\\mdcellcolor" + cssColorArg(clr) + "}"
                }            
  val fmt     = (if (attrs.hasClass("cell-border-left")) then "|" else "") + align +
                (if (attrs.hasClass("cell-border-right")) then "|" else "")

  val attrsx  = attrs( classes = attrs.classes.filter(fun(c){ c != "cell-border-left" && c != "cell-border-right" && !(c.startsWith("align-"))}),
                       keyvals = attrs.keyvals.filter(fun(kv){ kv.fst != "column-span" && kv.fst != "background-color" && kv.fst != "text-align"}))

  val content = if (elem=="column") 
                 then texEnv(elem,body,attrsx)
                 else texCmd(elem,body,attrsx.addKeyval("display","inline")) 
                 
  if (colspan=="1" && fmt==colfmt) then bcolor + content 
   else "\\multicolumn{" + colspan + "}{" + fmt + "}{" + bcolor + content + "}"
}


function texList( tag : string, body : string, attrs : attrs ) : string {
  val args = cssListArgs( attrs )
  val env  = (if (attrs.hasKey("list-style-type").bool) then "enumerate" else attrs.lookupKey("tex-env","enumerate")) + args
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
  envCmd               
  /*
  match(attrs.hasKey("float")) {
    Nothing   -> envCmd
    Just(flt) -> "\\mdfloatbox{" + flt + "}{" + attrs.lookupKey("lines","") + "}{" + envCmd + "}"
  } 
  */              
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

function fmtLatexFullX(body : string, options : options, metadata1 : dict<string>, mathmode : string = "") : string 
{
  val metadata0 = [("heading-base",options.headingBase.show),
                   ("tex-section-num", options.texSectionNum.show.toLower),
                   ("bib-label", "true")].dict
  val metadata = metadata0 + metadata1

  function expand(s) { s.expandKeys(metadata) }
  function norm(p)   { normalize(options.sandbox,p) }
    
  val basicMath = (mathmode == "dvi")
  val pkgs = (options.packages.expand + (if (basicMath) then "" else options.packagesx.expand)).splitPaths 
  val doc0 = if (options.docClass != "") then options.docClass.norm
             elif (options.headingBase >= 2) then "article" else "book"
  val doc  = doc0.expand
  
  [fmtOptArg(@"\documentclass", doc, norm, ext = ".cls" ),
   "% generated by Madoko, version " + options.version,
   "%mdk-data-line={1}",
   if (mathmode.isEmpty) then "" else @"\newcommand\mathmode{" + mathmode + "}",
   pkgs.map(fun(pkg) { 
      match (pkg.find(rxTexFile)) {
        Just -> {
          log("files", changeExt(pkg,".tex") );
          @"\input{" + pkg.norm + "}"
        }
        Nothing -> fmtOptArg(@"\usepackage",pkg,norm)
      }
    }).join("\n"),
   options.texHeader.expand,
   if (basicMath) then "" else options.texHeaderx.expand,
   @"\begin{document}",
   options.texDocHeader.expand,
   if (basicMath) then "" else options.texDocHeaderx.expand,
   body, 
   options.texFooter.expand,
   @"\end{document}",""
   ].join("\n")
}

val rxTexFile = regex(@"^[^\n\r\[\]]+?\.tex$",ignoreCase=True)

function fmtOptArg( pre:string, pkg : string, norm : string -> string,  ext : string = ".sty" ) : string 
{
  pre + (match(pkg.find(rxPkgOpt)) {
    Just(cap) -> {
      val pname = cap.groups[2]
      if (pname.extname!="" || pname.dirname!="") {
        log("files", changeExt(pname,ext) );
      }
      (if (cap.groups[1] != "") then "[" + cap.groups[1] + "]" else "") + 
        "{" + (if (ext==".cls" || ext==".sty") then pname.noext else pname).norm + "}"
    }
    Nothing  -> {
      val pname = pkg.trim
      if (pname.extname!="" || pname.dirname!="") {
        log("files", changeExt(pname,ext) )
      }
      "{" + (if (ext==".cls" || ext==".sty") then pname.noext else pname).norm + "}"
    }
  })
} 


val rxPkgOpt = regex(@"^\s*(?:\[(.*?)\]\s*)?([^\*]+)\s*(?:\*\s*)?$")



// -----------------------------------------------------------------------------
//
// -----------------------------------------------------------------------------


function cssAttrs( attrs0 : attrs = attrsNone, body : string, defaults = [], elem = "" ) : string {
  val attrs = attrs0.adjustFloatAttrs()
  val kvs = dict(defaults + attrs.keyvals).cssExpandKeys()
  val hidden = 
    match(kvs["display"]) {
      Just(disp) -> (disp.cssValue.toLower == "none")
      Nothing    -> False
    }
  if (hidden) return ""

  val isBlock = kvs.cssIsBlock
  /*
  val kvs = if (isBlock || elem == "span" || elem == "div" ||
                ["tex-cmd","tex-innercmd","tex-cmd","tex-env","tex-outercmd","tex-outerenv"].any(fun(k) { kvs0.containsKey(k) }))
             then kvs0
             else kvs0 + [("tex-cmd","\\md" + elem.normalizeCmd)].dict
  */            
  body.insertCmd(kvs,"tex-cmd-inner-before")
      .appendCmd(kvs,"tex-cmd-inner-after")
      .applyCmd(kvs,"tex-cmd-inner")
      .applyEnv(kvs,"tex-env-inner",attrs)
      .cssInner(kvs, attrs, isBlock)
      .insertCmd(kvs,"tex-cmd-before")
      .appendCmd(kvs,"tex-cmd-after")
      .applyCmd(kvs,"tex-cmd")
      .applyEnv(kvs,"tex-env",attrs)
      .cssBox(kvs,isBlock)
      .cssOuter(kvs, attrs, isBlock)
      .applyCmd(kvs,"tex-cmd-outer")
      .applyEnv(kvs,"tex-env-outer",attrs)
      .insertCmd(kvs,"tex-cmd-outer-before")
      .appendCmd(kvs,"tex-cmd-outer-after")
      .applyBlock(isBlock && !attrs.hasClass("para-block") && !attrs.hasClass("para-continued"), attrs)
}

function adjustFloatAttrs( attrs : attrs ) : attrs {
  if (attrs.hasClass("float") || attrs.lookupKey("display","").cssValue == "block") {
    val flt = attrs.lookupKey("tex-float",attrs.lookupKey("float","")).cssValue
    if (flt=="left" || flt=="right" || flt=="inside" || flt=="outside") then {
      match (attrs.hasKey("width")) {
        Just(w) -> attrs.removeKeys(["width","tex-env-outer"]).addKeyval("tex-wrap-width",w).addKeyvalIfNotExist("tex-wrap-placement",flt.substr(0,1))
        Nothing -> attrs
      }
    }
    else attrs
  }
  else attrs
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
    Just(cmd) -> {
      val post = kvs[key + "-postfix"].maybe("",id)      
      if (cmd.startsWith("{")) 
        then cmdconnect(cmd.substr(1) + post, body).braced
        else cmd + post + body.braced 
    }
  }
}

function insertCmd( body : string, kvs : dict<string>, key : string ) : string {
  match(kvs[key]) {
    Nothing -> body
    Just(cmd) -> {
      val cbody = cmdconnect( (if (cmd.startsWith("{")) then cmd.substr(1) else cmd), body) 
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
      val post = kvs[key + "-postfix"].maybe("",id)
      match(env.find(rxEnv)) {
       Just(cap) -> {
        body.blockEnv(cap.groups[1] + post,expandKeys(cap.groups[2],"",attrs,dict(),kvs)) /* pass 'kvs' as metadata since it contains expanded keys */
       }
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
  "{" + cmd.cmdconnect(body.unbrace) + "}"  
}

function unbrace( s : string ) : string {
  if (s.startsWith("{") && s.endsWith("}")) then {
    if (s.indexOf("}") < s.length-1) 
      then s // prevent unbracing: {\cmd}gkkgk{\test} 
      else s.substr(1,s.length-2) 
  }
  elif (s.contains(rxCommentEnd)) then s + "\n"
  else s
}

val rxCommentEnd = regex(@"(?:^|[^\\])%.*$")

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
  val body1 = match(kvs["tex-label-before"]) {
    Just(lab) -> if (lab.isEmpty) then body0 else "\\label" + lab.braced + "%mdk\n" + body0 
    _ -> match(kvs["tex-label"]) {
      Just(lab) -> if (lab.isEmpty) then body0 else body0 + "\\label" + lab.braced + "%mdk\n"
      _ -> if (attrs.name.isEmpty) then body0 else body0 + "\\label" + attrs.name.braced + "%mdk\n"
    }
  }
  val body2 = if (isBlock) then {
      val body1x = body1
        .onKeys(kvs,["margin-left","margin-right","margin-top","margin-bottom"], fun(b) {  
          b.margins(kvs)
        })
      if (!kvs.containsKey("tex-wrap-width")) then body1x else {
        val width = kvs.dimMarginBoxWidth("tex-wrap-width")
        val wrapfig = kvs.find("tex-wrap-env","wrapfigure")
        val wraplines = kvs.find("tex-wrap-lines","")
        val wrapplace = kvs.find("tex-wrap-placement","o")
        val args = (if (wraplines.bool) then "[" + wraplines + "]" else "") + wrapplace.braced + width.braced
        body1x.blockEnv(wrapfig,args)
      }
    }
    else {
      body1.cssInlineMargin(kvs,"margin")
    }
  body2.onKey(kvs, "page-break-before", fun(value,b) {
    cmdconnect(cssPagebreak(value),b)
  })
  .onKey(kvs, "page-break-after", fun(value,b) {
    b + cssPagebreak(value)
  })
}

function cssPagebreak( value : string ) {
  val key = cssValue(value).toLower
  val cmd = match(key.parseInt) {
    Just(penalty) -> "\\penalty" + penalty.show.braced
    Nothing -> {
      if (key=="always") then "\\newpage"
      elif (key=="avoid") then "\\nobreak"
      elif (key=="left" || key=="verso") then "\\cleartoleftpage"
      elif (key=="right" || key=="recto") then "\\cleardoublepage"
      elif (key=="auto") then "\\goodbreak"
      elif (key=="clear") then "\\clearpage"
      else {
        warning("unknown page-break value: " + value.show)
        ""
      }
    }
  }
  if (cmd.isEmpty) then "" else (cmd + "%mdk\n")
}

// -----------------------------------------------------------------------------
// Text
// -----------------------------------------------------------------------------

function cssText( body : string, kvs : dict<string>, attrs :attrs, isBlock : bool ) : string {
  if (isBlock) then {
    body
      .onClasses( attrs, ["para-continued","para-block","noindent"], fun(b) {
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
  val w   = dimContentWidth(kvs)
  val h   = dimContentHeight(kvs)
  val args0 = "keepaspectratio=true" + 
                (if (w.isEmpty) then "" else ",width=" + w) +
                (if (h.isEmpty) then "" else ",height=" + h)
    /*
    .onKey( kvs, "width", fun(value,b) {
      if (value=="auto") then b else b + ",width=" + dimContentWidth(kvs)
    })
    .onKey( kvs, "height", fun(value,b) {
      if (value=="auto") then b else b + ",height=" + cssHeight(value)
    }) */
  val args = args0.onKey( kvs, "zoom", fun(value,b) {
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
                elif (value=="lighter") then "\\lfseries"
                elif (value=="normal") then "\\mdseries"
                else match (value.parseInt) {
                  Just(i) -> if (i < 400) then "\\lfseries"
                             elif (i > 500) then "\\bfseries"
                             else "\\mdseries"
                  Nothing -> ""
                }
      b.braceCmd(cmd)
    })
    .onKey( kvs,"font-size", fun(value,b) { 
      val cmd = if (value=="larger") then "\\mdfontsize{1.2}"
                elif (value=="smaller") then "\\mdfontsize{0.8}"
                elif (value=="xx-small") then "\\tiny"
                elif (value=="x-small") then "\\scriptsize"
                elif (value=="small") then "\\small"
                elif (value=="medium") then "\\normalsize"
                elif (value=="large") then "\\large"
                elif (value=="x-large") then "\\Large"
                elif (value=="xx-large") then "\\LARGE"
                else {
                  "\\mdfontsize" + value.cssFontLength.braced  
                }
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
      val fonts = value.cssSplitList.filter(bool)
      val (tfonts,xfonts) = fonts.filter(fun(f) { !f.startsWith("html-") }).partition( fun(f) { f.startsWith("tex-") })
      val families = (tfonts + xfonts).map( fun(fam) {
          val spec = if (fam=="serif") then "!rmfamily"
                      elif (fam=="sans-serif") then "!sffamily"
                      elif (fam=="monospace") then "!ttfamily"
                      elif (fam=="cursive") then "!cursive"
                      elif (fam=="fantasy") then "!fantasy"
                      else {
                        if (fam.startsWith("tex-family-")) then {
                          match( fam.find( regex(@"^tex-family[-/](?:([A-Z]\w\w?)[-/])?([\w\-]+)(?:/(l|m|b|bx|sb|c))?(?:/(n|it|sl|bf|sc))?(?:[@/](\d+\.\d+))?$"))) {
                            Just(cap) -> 
                              "@" + [cap.groups[1],cap.groups[2],cap.groups[3],cap.groups[4],cap.groups[5]].join("/")
                            Nothing -> 
                              fam.substr(11)
                          }
                        }
                        elif (fam.startsWith("tex-cmd-"))
                          then "!" + fam.substr(8)
                          else (if (fam.startsWith("tex-")) then fam.substr(4) else fam) 
                      }
          if (spec.contains(',')) then spec.braced else spec
        })
      val cmd = match (families) {
        Cons(spec,Nil) | spec.startsWith("!") -> "\\" + spec.substr(1)
        _ -> "\\mdfontfamily" + families.join(",").braced 
      }
      b.braceCmd(cmd)
    })
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

function dimMarginBoxWidth( kvs : dict<string>, widthName = "width"  ) {
  val width = kvs.dimBorderBoxWidth(widthName)
  if (width.isEmpty) return ""

  val extra = [kvs.find("margin-left"),kvs.find("margin-right")
              ].filter(bool).map( fun(wd) { wd.cssWidth })
  if (extra.isNil) 
   then width
   else "\\dimeval" + ([width] + extra).join("+").braced
}

function dimBorderBoxWidth( kvs : dict<string>, widthName = "width"  ) {
  val width = kvs.dimContentWidth(widthName)
  if (width.isEmpty) return ""

  val extra = [kvs.find("border-left-width"),kvs.find("padding-left"),
               kvs.find("border-right-width"),kvs.find("padding-right")
              ].filter(bool).map( fun(wd) { wd.cssWidth })
  if (extra.isNil) 
   then width
   else "\\dimeval" + ([width] + extra).join("+").braced
}

function dimContentWidth( kvs : dict<string>, widthName = "width" ) {
  val w0   = kvs.find(widthName)
  val maxw = kvs.find("max-width")
  val minw = kvs.find("min-width")

  val w = if (!w0.isEmpty) then w0
          elif (!maxw.isEmpty) maxw
          else minw
  if (w.isEmpty) return ""

  val width0 = if (maxw.isEmpty) then w.cssWidth else "\\dimmin" + w.cssWidth.braced + maxw.cssWidth.braced
  val width  = if (minw.isEmpty) then width0 else "\\dimmax" + width0.braced + minw.cssWidth.braced 
  width
}

function dimContentHeight( kvs : dict<string> ) {
  val h0   = kvs.find("height")
  val maxh = kvs.find("max-height")
  val minh = kvs.find("min-height")

  val h = if (!h0.isEmpty) then h0
          elif (!maxh.isEmpty) maxh
          else minh
  if (h.isEmpty) return ""

  val height0 = if (maxh.isEmpty) then h.cssHeight else "\\dimmin" + h.cssHeight.braced + maxh.cssHeight.braced
  val height  = if (minh.isEmpty) then height0 else "\\dimmax" + height0.braced + minh.cssHeight.braced 
  height
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
                 // kvs.cssTRBL("border","-radius",cssWidthX), // TODO: parse double radius
                 kvs.cssRadius("border-radius"),
                 kvs.cssRadius("border-top-left-radius"),
                 kvs.cssRadius("border-top-right-radius"),
                 kvs.cssRadius("border-bottom-left-radius"),
                 kvs.cssRadius("border-bottom-right-radius"),
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
            if (value=="left") then "mdflushleft"
            elif (value=="right") then "mdflushright"
            elif (value=="center") then "mdcenter"
            else "mdjustify")
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

function cssRadius( kvs : dict<string>, key : string ) : list<string> {
  match(kvs[key]) {
    Nothing -> []
    Just(value) -> {
      match(value.cssSplitValues) {
        [v] -> [key + "=" + v.cssWidth]
        [h,v] -> [key + "={" + h.cssWidth + "," + v.cssWidth + "}"]
        _ -> {
          warning("illegal CSS radius: " + key + ":'" + value)
          [] 
        }
      }
    }
  }
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

