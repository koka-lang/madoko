/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Formatting of  HTML elements 
module htmlFormatter

import std/dict
import std/string
import std/regex
import common
import inline
import options

public function fmtHtmlEnv(context : inlineContext, env : string, txt : string, attrs : attrs ) : string {
  if (env=="") 
   then txt 
   else tagEnv(env, (if(env.length>2) then "\n" else "") + txt,attrs,context.sanitize)
}


public function fmtHtmlCmd(context : inlineContext, cmd : string, txt : string, attrs : attrs ) : string {
  if (cmd=="") then txt else tag(cmd,txt,attrs.htmlFormat(cmd,context.sanitize))
}


public function fmtHtmlEscape(context : inlineContext, txt : string, allowEntity : bool ) : string {
  htmlEscape(txt,allowEntity)
}

public function fmtHtmlFootnote(context : inlineContext, id : string, fn : footnote ) : string {
  tag("sup", 
    tag("a", fn.footnoteNum, " href=\"#fn-" + escape(id) + "\" class=\"footnote-ref localref\"" ),
          " id=\"fnref-" + escape(id) + "\"" )
}

public function fmtHtmlTable( context : inlineContext, head : cells, body : cells, attrs : attrs  ) : string {
  tag("table", 
    context.fmtRows("thead","th",head) + context.fmtRows("tbody","td",body),
    attrs.addClass("block").htmlFormat("table",context.sanitize))
}

function fmtRows( context : inlineContext, tbody : string, td : string, cells : cells ) : string {
  if (cells.isNil) then return ""
  tagBlock(tbody,
    cells.map( fun(row) {
      tag("tr", row.map(fun(cell) { tag(td,cell.fst,cell.snd.htmlFormat(td,context.sanitize)) }).join)
    }).join())
} 

public function fmtHtmlLink( context : inlineContext, isImage : bool, link : link, content : string) {
  if (isImage) {
    "<img src=\"" + link.href.escape + "\"" +
      (if (link.title != "") then " title=\"" + link.title.escape + "\"" else "") +
      (if (content != "") then " alt=\"" + content.escape + "\"" else "") +
      link.linkattrs.htmlFormat("img",context.sanitize) + ">"
  }
  else {
    "<a href=\"" + link.href.escape + "\"" +
      (if (link.title != "") then " title=\"" + link.title.escape + "\"" else "") +
      link.linkattrs.htmlFormat("a",context.sanitize) + ">" + 
      content + "</a>"
  }
}

/* --------------------------------------
 Format attributes 
---------------------------------------- */

// Format attributes. If none, return the empty string, otherwise start with a space
public function htmlFormat( attrs : attrs, tag : string, sanitize : bool = True ) : string {
  if (attrs.empty || sanitize) then return ""
  (if (attrs.name=="") then "" else " id=\"" + escape(attrs.name) + "\"") +
   (if (attrs.classes.isNil) then "" 
     else " class=\"" + escape(attrs.classes.join(" ")) + "\"") 
     + attrs.formatKeyvals(tag)
   // (" input=" + attrs.input.maybe("?",showInput)) +
   //(attrs.htmlAttributes)
}

function formatKeyvals( attrs : attrs, tag : string ) {
  kvs = attrs.keyvals.map fun(kv) {
    formatKeyval(kv.fst,kv.snd,tag)
  }
  val (hstyles,hattrs) = kvs.partition( fun(kv){ kv.contains(":") } )
  (if (hattrs.isNil) then "" else " " + hattrs.join(" ")) + 
   (if (hstyles.isNil) then "" else " style='" + hstyles.join(";") + "'")
}

function formatKeyval( key : string, value : string, tag : string ) {
  if ((key=="colspan" || key=="column-span") && (tag=="td" || tag=="th")) {
    "colspan=" + value.htmlQuote
  }
  elif (((key=="width") && (tag=="td" || tag=="th")) ||
        (key=="target" && tag=="a") ||
        (key=="start" && tag=="ol"))
  {
    key + "=" + value.htmlQuote
  }
  //elif ((key=="align" || key=="text-align") && (tag=="td" || tag=="th")) {
  //  "align=" + value.htmlQuote
  //}
  elif ((key=="width" || key=="height" || key=="text-align") && (tag=="span")) {
    "display: inline-block; " + key + ":" + cssQuote(value) 
  }
  elif (value=="" || (key=="toc" || key=="toc-line" || key=="toc-depth" || key=="language")) {
    "" // nothing
  }
  else {
    key.escape + ":" + value.cssQuote
  }
}

function htmlQuote(s) {
  "\"" + s.escape + "\""
}

function cssQuote(s) {
  if (s.trim.contains(" ")) then "\"" + s.escape + "\"" else s.escape
}

// private function htmlAttributes( attrs : attrs ) :  string {
//   attrs.keyvals.map(fun(kv) {
//     " " + kv.fst + "=\"" + kv.snd.escape + "\""
//   }).join()
// }

/* --------------------------------------
 Tags 
---------------------------------------- */

// output a html tag with a given body and attributes
public function tag( tagName : string, body : string, attrs : string = "" ) : string 
{
  "<" + tagName + 
   attrs + // (if (attrs.startsWith(" ")) then attrs else (" " + attrs)) +  
   ">" + body + "</" + tagName + ">"
}


// output a html block tag
public function tagEnv( tagName : string, body : string, attrs : attrs = attrsNone, sanitize : bool = True ) : string 
{
  tagBlock( tagName, body, attrs.htmlFormat(tagName,sanitize))
}

// output a html block tag
function tagBlock( tagName : string, body : string, attrs : string = "" ) : string 
{
  "\n<" + tagName + 
   attrs + // (if (attrs.startsWith(" ")) then attrs else (" " + attrs)) +  
   ">" + body + "</" + tagName + ">"
}


/* --------------------------------------
  Title 
---------------------------------------- */
public function fmtHtmlTitle(context : inlineContext, titleinfo : titleinfo ) : string {
  tag("div", 
    [tag("div",context.formatInline(titleinfo.title)," class='title'"),
     if (titleinfo.subtitle=="") then "" else tag("div",context.formatInline(titleinfo.subtitle)," class='subtitle'"),
     tag("table",
      tag("tr", 
       titleinfo.authors.map(fun(aae) {
        tag("td", context.formatInline("[" + aae.fst + "]{.author}<br>[" + aae.snd + "]{.affiliation}<br>[" +
                                              aae.thd + "]{.email}" )
           ," class='authorblock align-center'")
       }).join("\n")))
    ].join("\n"),
    " class='titleblock align-center'")
   
}

/* --------------------------------------
  Full header 
---------------------------------------- */
public function fmtHtmlFull(html : string, options : options) : string {
  "<!DOCTYPE html>\n<html>\n<head>\n" +
   "  <meta http-equiv=\"content-type\" content=\"text/html; charset=UTF-8\" />\n" +
   "  <!-- Generated by Madoko, version " + version + " -->\n" +
   (if (options.title=="") then "" else
      "  <title>" + escape(options.title) + "</title>\n") +
   (if (options.css == "") then "" else {
      links = options.css.splitPaths
      links.map(fun(link) { "  <link rel=\"stylesheet\" type=\"text/css\" href=\"" + escape(link) + "\">\n" }).join 
    }) +
   (if (options.scripts == "") then "" else {
      links = options.scripts.splitPaths
      links.map(fun(link) { "  <script src=\"" + escape(link) + "\"></script>\n" }).join 
    }) +
   (if (options.mathjax=="") then "" else {
      ["  <script type=\"text/x-mathjax-config\">",
       "  MathJax.Hub.Config({",
       "    tex2jax: {inlineMath: [['$','$']]},",
       @"    TeX: { Macros: { mathid: ['\\mathit{#1\\hspace{0.1ex}}',1], mathkw: ['\\mathsf{#1}',1] } }",
       "  });",
       "  MathJax.Hub.Register.StartupHook('TeX AMSmath Ready',function () { ",
       "    MathJax.InputJax.TeX.Definitions.environment['mdMathprearray'] = ['AMSarray',null,null,null,'l','0em','0em'];", 
       "  });", 
       "</script>",
       "<script type=\"text/javascript\"",
       "  src=\"" + (if (options.mathjax=="-")
                      then "https://c328740.ssl.cf1.rackcdn.com/mathjax/latest/MathJax.js?config=TeX-AMS-MML_HTMLorMML"
                      else options.mathjax.escape) + "\">",
       "</script>\n"
      ].join("\n  ")
   }) +
   options.htmlHeader + "\n" + 
   "</head>\n" +
   "<body class=\"madoko\">\n" + 
   html +
   "\n</body>\n</html>\n"
}





/* --------------------------------------
  Escape HTML Elements 
---------------------------------------- */

function escape( s : string ) :  string
{
  s.htmlEscape(allowEntity=True)
}

function escapePre( s : string ) :  string
{
  s.htmlEscape()  
}

public function htmlEscape( s : string, allowEntity : bool = False ) {
  if (s.contains(rxhtml)) 
   then s.replaceAll( if (allowEntity) then rxnoEntityAmp else rxamp,"&amp;")
         .replaceAll(rxlt,"&lt;").replaceAll(rxgt,"&gt;")
         .replaceAll(rxquot,"&quot;").replaceAll(rxapos,"&#39;")
   else s        
}
val rxnoEntityAmp = regex(@"&(?!#?\w+;)")
val rxamp = regex(@"&")
val rxgt  = regex(@">")
val rxlt  = regex(@"<")
val rxquot = regex("\"")
val rxapos = regex("'")
val rxhtml = regex(@"[&<>""']")


function escapeChar( c : string ) : string 
{
  if (c=="&") "&amp;"
  elif (c==">") "&gt;"
  elif (c=="<") "&lt;"
  elif (c=="\"") "&quot;"
  elif (c=="'") "&#39;"
  else c
}
