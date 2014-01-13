/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Formatting of TeX elements (i.e. emphasis, links, etc.)
module texFormatter

import std/dict
import std/string
import std/regex
import common
import entity
import inline
import options
import texParser      // for texAccents et al
import htmlFormatter  // for htmlEscape

public function fmtTexEnv(context : inlineContext, env : string, txt : string, attrs : attrs ) : string {
  if (env=="") 
   then texText(txt) 
   else texEnv(env,txt,attrs)
}

public function fmtTexCmd(context : inlineContext, cmd : string, txt : string, attrs : attrs ) : string {
  if (cmd=="") then texText(txt) 
  elif (cmd=="br") then "\\mdBr\n" 
  elif (cmd=="code") then "\\lstinline|" + txt + "|" 
  else texCmd(cmd,txt,attrs)
}

public function fmtTexEscape( context : inlineContext, txt : string, allowEntity : bool ) : string {
  //texText(htmlEscape(txt,allowEntity))
  if (allowEntity)
   then texText(htmlEscape(txt,allowEntity))
   else // we use lstlisting with 'mathescape' and escape just $ and |
        txt.replaceAll(regex(@"\$"),@"$\mbox{\$}$").replaceAll(regex(@"\|"),@"$\mbox{\char124}$")  
}

public function fmtTexFootnote(context : inlineContext, id : string, fn : footnote ) : string {
  "\\mdFootnote[id=fnref-" + id + "]{" + ((fn.footnoteContent)(context)) + "}"
}

public function fmtTexLink( context : inlineContext, isImage : bool, link : link, content : string ) {
  if (isImage) {
    texCmd("img",texText(link.href),link.linkattrs)
    // "<img src=\"" + link.href.escape + "\"" +
    //   (if (link.title != "") then " title=\"" + link.title.escape + "\"" else "") +
    //   (if (content != "") then " alt=\"" + content.escape + "\"" else "") +
    //   link.linkattrs.format(context.sanitize) + ">"
  }
  else {
    // link.linkattrs.texAttrs(
    //   (if (link.linkattrs.hasClass("localref"))
    //     then "\\mdLocalA{" + texText(link.href.substr(1)) + "}"
    //     else "\\mdA{" + texText(link.href) + "}") +
    texCmd("a",texText(if (link.href.startsWith("#")) then link.href.substr(1) else link.href),link.linkattrs) +
      "{" + content + "}"
    
  }
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
  (@"&", @"\&"),
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
  "\\" + pre + cmd.normalizeCmd.capitalize + attrs.texAttrsX + "{" + body + "}"
}


public function fmtTexTable( context : inlineContext, head : cells, body : cells, attrs : attrs ) : string {
  pre = "md"
  cells = head + body
  td = if (attrs.hasClass("columns")) then "column" else "td"
  table = if (attrs.hasClass("long")) then "LongTable" else "Table"
  columns = cells.map(length).maximum
  "\\begin{" + pre + table + "}" + attrs.addClass("block").texAttrsX + "{" + columns.show + "}{" + list(1,max(columns,1)).map(fun(i){"l"}).join + "}\n" +
    head.fmtRows("th",pre) + "\n" +
    body.fmtRows(td,pre) +
    "\\end{" + pre + table + "}\n"
}

type line {
  Single
  Double
  NoLine
}

val fmtRowLineBreak = "\\\\[-\\mdTablelineskip]\n"

function fmtRows( cells : cells, td : string, pre : string ) : string {
  var lastIsLine := False
  rows = cells.map fun(row) {
    lineRow = row.map(fun(cell) { 
                if (cell.snd.hasClass("cell-line")) then Single
                elif (cell.snd.hasClass("cell-double-line")) then Double 
                else NoLine 
              } )
    if (!(lineRow.all(isNoLine))) then { 
      res = (if (lastIsLine) then fmtRowLineBreak else "") + fmtLine(lineRow,row)
      lastIsLine := True
      res
    }
    else {
      res = (if (lastIsLine) then "\n" else "") + fmtRow(td,row,pre)
      lastIsLine := False
      res
    }
  }
  rows.join() + (if (lastIsLine) then "\n" else "")
}


function fmtLine( lines : list<line>, row : list<(string,attrs)> ) : string {
  line1 = if (!(lines.any(isNoLine))) then "\\hline" else {
    zipWithIndexed(row,lines,fun(i,cell,line) {
      attrs = cell.snd
      if (line.isNoLine) then "" 
       else "\\cline{" + (i+1).show + "-" + (i+ attrs.lookupKey("column-span","1").parseInt.maybe(1,id)).show + "}" 
     }).join
  }
  line2 = if (!(lines.any(isDouble))) then "" 
          elif (lines.all(isDouble)) then "\\\\ \\hline" else {
    fmtRowLineBreak + 
     zipWithIndexed(row,lines,fun(i,cell,line) {
      attrs = cell.snd
      if (!(line.isDouble)) then "" 
       else "\\cline{" + (i+1).show + "-" + (i+ attrs.lookupKey("column-span","1").parseInt.maybe(1,id)).show + "}" 
     }).join            
  }
  line1 + line2
}

function fmtRow( td : string, row : list<(string,attrs)>, pre : string ) : string {
  row.map(fun(cell) { fmtCell(td,cell.fst,cell.snd,pre) }).join("&") + "\\\\\n" 
} 



function fmtCell( elem : string, body : string, attrs : attrs, pre : string ) : string {
  colspan = attrs.lookupKey("column-span","1")
  align   = if (attrs.hasClass("align-left")) then "l" 
            elif (attrs.hasClass("align-right")) then "r"
            elif (attrs.hasClass("align-center")) then "c"
            else "l" // attrs.lookupKey("align","left").substr(0,1) // l, c, or r
  fmt     = (if (attrs.hasClass("cell-border-left")) then "|" else "") + align +
            (if (attrs.hasClass("cell-border-right")) then "|" else "")
  attrsx  = attrs( classes = attrs.classes.filter(fun(c){ c != "cell-border-left" && c != "cell-border-right" && !(c.startsWith("align-"))}),
                   keyvals = attrs.keyvals.filter(fun(kv){ kv.fst != "column-span" }))                             

  content = if (elem=="column") 
             then texEnv(elem,body,attrsx)
             else texCmd(elem,body,attrsx.addKeyval("display","table-cell")) 
             
  if (colspan=="1" && fmt=="l") then content 
   else "\\multicolumn{" + colspan + "}{" + fmt + "}{" + content + "}"
}




function texAttrsX( attrs : attrs = attrsNone ) : string {
  if (attrs.empty) then "" else {
    txt = [ if (attrs.classes.isNil) then [] else ["class={" + attrs.classes.map(normalizeId).join(",") + "}"],  // so block goes first
            if (attrs.name=="") then [] else ["id=" + attrs.name],
            if (attrs.label=="") then [] else ["label={" + attrs.label.texText + "}"],
            if (attrs.elem=="") then [] else ["elem={" + attrs.elem.texText + "}"],
            attrs.keyvals.filter(nosuppressKey).map(fun(kv) { kv.fst.normalizeId + "={" + kv.snd.normalizeVal + "}" }),
          ].concat.join(",") 
    if (txt=="") then "" else "[" + txt + "]"
  }
}

function nosuppressKey( kv : (string,string) ) : bool {
  key = kv.fst
  (key != "source")
}

function normalizeVal( v : string ) : string {
  match(v.find(rxPerc)) {
    Just(cap) -> "0." + cap.groups[1] + "\\linewidth"
    Nothing -> match(v.find(rxPixels)) {
      Just(cap) -> cap.groups[1] + "\\cssPixel"
      Nothing   -> texText(v).replaceAll(regex("\n"),"\\\\")
    }
  }
}
val rxPerc = regex(@"\s*(\d\d?)%\s*")
val rxPixels = regex(@"\s*(\d+)px\s*")

function capitalize( s : string ) : string {
  s.substr(0,1).toUpper + s.substr(1)
}


function texCmdPlain( cmd : string, body : string, pre : string = "md" ) : string {
  "\\" + pre + cmd.normalizeCmd.capitalize + "{" + body + "}"
}

function texEnv( env : string, body : string, attrs : attrs = attrsNone ) : string {
  if (env=="pre") then {
    // pass right options to lstlisting package
    opts1 = match(attrs.hasKey("language")) {
             Nothing    -> ""
             Just(lang) -> "language={" + lang + "}"
           }
    opts2 = match(attrs.classes.filter(fun(c){ c.startsWith("linenums") }).maybe) {
              Nothing   -> ""
              Just(cls) -> match(cls.find(regex(@"linenums:(\d+)"))) {
                Nothing   -> "numbers=left"
                Just(cap) -> "numbers=left,firstnumber=" + cap.groups[1]
              }
            }
    opts3 = if (attrs.hasClass("showspaces")) then "showspaces,showtabs" else ""  
    opts  = "[" + [opts1,opts2,opts3].join(",") + "]"

    "\\begin{lstlisting}" + opts + "\n" + body + "\n\\end{lstlisting}\n"
  }
  else texEnvPlain(env,body,attrs)
}

function texEnvPlain( env : string, body : string, attrs : attrs ) : string {
  envName = (if (attrs.texelem != "") then attrs.texelem else ("md" + env.normalizeCmd.capitalize))
  "\\begin{" + envName + "}" + attrs.texAttrsX + "%\n" +
    body.trimRight + "%\n" +
    "\\end{" + envName + "}%\n"
}

function texClassName( attrs : attrs, def : string ) : (string,attrs) {
  name = attrs.elementName(def)
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
   titleinfo.authors.map(fun(aae) {
     @"\mdAuthor{" + context.formatInline(aae.fst) + "}{" + 
                      context.formatInline(aae.snd) + "}{" + 
                      context.formatInline(aae.thd) + "}"
   }).join("\n"),
   @"\mdMaketitle",""].join("\n")
}



/* --------------------------------------
  Full header 
---------------------------------------- */
public function fmtTexFull(body : string, options : options) : string {
  pkgs = options.packages.splitPaths
  [@"\documentclass" + fmtOptArg(options.docClass),
   "% generated by Madoko, version " + version,
   pkgs.map(fun(pkg) { 
      match (pkg.find(rxTexFile)) {
        Just -> @"\input{" + pkg + "}"
        Nothing -> @"\usepackage" + fmtOptArg(pkg)
      }
    }).join("\n"),
   options.texHeader + "\n",
   @"\begin{document}",
   (if (options.title=="") then "" else
      "\\title{" + texText(options.title) + "}\n"),
   body, 
   @"\end{document}",""
   ].join("\n")
}

val rxTexFile = regex(@"^[^\n\r\[\]]+?\.tex$",ignoreCase=True)

function fmtOptArg( s : string ) : string {
  match(s.find(rxPkgOpt)) {
    Just(cap) -> "[" + cap.groups[1] + "]{" + cap.groups[2] + "}"
    Nothing   -> "{" + s + "}"
  }
} 

val rxPkgOpt = regex(@"^\[(.*?)\]\s*(.+)$")