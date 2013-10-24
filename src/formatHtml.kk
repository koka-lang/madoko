/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Formatting of  HTML elements (i.e. emphasis, links, etc.)
module formatHtml

import std/dict
import std/string
import std/regex
import common
import inline

public function fmtHtmlCmd(context : inlineContext, cmd : string, txt : string, attrs : attrs ) : string {
  if (cmd=="") then txt else tag(cmd,txt,attrs.format(context.sanitize))
}


public function htmlFootnote( cap : matched, context : inlineContext ) : string {
  id = cap.groups[1].definitionId
  match( context.footnotes[id] ) {
    Nothing -> "[^" + formatInline(context,cap.groups[1]) + "]" // leave as plain text
    Just(num) -> 
      tag("sup", tag("a", num, " href=\"#fn-" + escape(id) + "\" class=\"footnote-ref localref\"" ),
            " id=\"fnref-" + escape(id) + "\"" )
  }
}

public function fmtHtmlLink( context : inlineContext, isImage : bool, link : link, content : string) {
  if (isImage) {
    "<img src=\"" + link.href.escape + "\"" +
      (if (link.title != "") then " title=\"" + link.title.escape + "\"" else "") +
      (if (content != "") then " alt=\"" + content.escape + "\"" else "") +
      link.linkattrs.format(context.sanitize) + ">"
  }
  else {
    "<a href=\"" + link.href.escape + "\"" +
      (if (link.title != "") then " title=\"" + link.title.escape + "\"" else "") +
      link.linkattrs.format(context.sanitize) + ">" + 
      content + "</a>"
  }
}

/* --------------------------------------
 Tags 
---------------------------------------- */

// output a block html tag (ends with newline)
public function bbtag( tagName : string, body : string, attrs : string = "" ) : string 
{
  "\n" + tag(tagName,body + "\n",attrs)
}

// output a block html tag 
public function btag( tagName : string, body : string, attrs : string = "" ) : string 
{
  "\n" + tag(tagName,body,attrs)
}

// output a html tag with a given body and attributes
public function tag( tagName : string, body : string, attrs : string = "" ) : string 
{
  "<" + tagName + 
   attrs + // (if (attrs.startsWith(" ")) then attrs else (" " + attrs)) +  
   ">" + body + "</" + tagName + ">"
}

