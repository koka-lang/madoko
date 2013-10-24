/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Defines the context for _inline_ elements.
module inline

import std/dict
import std/string
import std/regex
import common

public function pick(fmt : formatter, htmlElem, texElem ) {
  match(fmt) {
    FmtHtml -> htmlElem
    FmtTex  -> texElem
  }
}

public alias cells = list<list<(string,attrs)>>

/* --------------------------------------
 The context for inline elements 
---------------------------------------- */
public rectype inlineContext {
  // The parse context for inline elements. 
  // Contains a dictionary of all define "links", and the current "grammar". 
  // If "sanitize" is "True", all (user) html is supressed or escaped.
  InlineContext( grammar    : grammar<string,inlineContext>,
                 links      : dict<link>,
                 labels     : dict<label>,
                 footnotes  : dict<footnote>,
                 defaults   : dict<string>,
                 metadata   : dict<string>,
                 citestyle  : citestyle,
                 xsanitize  : bool,
                 bench      : bool,

                 xfmtCmd : (ctx:inlineContext,cmd:string,body:string,attrs:attrs) -> string,
                 xfmtEscape : (ctx:inlineContext,body:string,allowEntity:bool) -> string,
                 xfmtLink: (ctx:inlineContext,isImage : bool, link : link, content : string ) -> string,
                 xfmtFootnote: (context : inlineContext, id : string, fn : footnote ) -> string,
                 xfmtTitle: (context : inlineContext, titleinfo : titleinfo ) -> string,
                 xfmtTable: (context : inlineContext, head : cells, body : cells, attrs : attrs ) -> string,
                 fmt : formatter
               )                 
}

public struct titleinfo (
  title : string,
  subtitle : string,
  authors : list<(string,string,string)>
)

public rectype footnote {
  Footnote( footnoteNum : string, footnoteContent : (inlineContext) -> string  )
}

public struct label( element : string, labelText : string )


public function fmtCmd( context : inlineContext, cmd : string, txt : string, attrs : attrs = attrsNone ) : string {
  (context.xfmtCmd)(context,cmd,txt,attrs)
}

public function fmtEscapePre( context : inlineContext, txt : string ) : string {
  (context.xfmtEscape)(context,txt,False)
}

public function fmtEscape( context : inlineContext, txt : string ) : string {
  (context.xfmtEscape)(context,txt,True)
}

public function fmtText( context : inlineContext, txt : string ) : string {
  (context.xfmtCmd)(context,"",txt,attrsNone)
}

public function fmtLink( context : inlineContext, isImage : bool, link : link, content : string) : string {
  (context.xfmtLink)(context,isImage,link,content)
}

public function fmtFootnote(context : inlineContext, id : string, fn : footnote ) : string {
  (context.xfmtFootnote)(context,id,fn)
}

// Copy an ":inlineContext"
public function copy( self : inlineContext,
                       grammar : grammar<string,inlineContext> = self.grammar,
                       links : dict<link> = self.links,
                       labels : dict<label> = self.labels, 
                       footnotes : dict<footnote> = self.footnotes,
                       defaults: dict<string> = self.defaults,
                       metadata: dict<string> = self.metadata,
                       citestyle : citestyle = self.citestyle,
                       sanitize : bool = self.sanitize,
                       bench : bool = self.bench,
                       xfmtCmd = self.xfmtCmd,
                       xfmtEscape = self.xfmtEscape,
                       xfmtLink = self.xfmtLink,
                       xfmtFootnote = self.xfmtFootnote,
                       xfmtTitle = self.xfmtTitle,
                       xfmtTable = self.xfmtTable,
                       fmt : formatter = self.fmt  ) : inlineContext
{
  InlineContext( grammar,links,labels,footnotes,defaults,metadata,citestyle,sanitize,bench,
                 xfmtCmd,xfmtEscape,xfmtLink,xfmtFootnote,xfmtTitle,xfmtTable,
                 fmt )
}

public function sanitize( context : inlineContext ) : bool {
  context.xsanitize
}


/* --------------------------------------
  Parse inline text elements 
---------------------------------------- */


// Parse _inline_ markdown elements and return formatted html
public function formatInline( context : inlineContext, txt : string ) : string
{
  formatInlineAcc(context,builder(), txt)
}



function formatInlineAcc( context : inlineContext, acc : builder<h>, txt : string ) : st<h> string
{
  if (txt=="") return acc.string
  val (s,next) = matchRules(context.grammar,context,txt,id)
  formatInlineAcc(context, acc.append(s), txt.substr1(next))  
}



public function mathPre( txt : string ) : string
{
  txt.replaceAll(regex(@"(\\(?:text|math|begin)(?:[a-z][a-z])?{(?:[^\\}]|\\.)*} *|\\[a-zA-Z@]+\b *|\\[^ ] *|\\ )|^( +)|( )|(\n)",multiline=True), fun(cap) {
        if (cap.groups.matchedOn(2)) then cap.matched.list.map(fun(_){@"\:\:"}).join // double space indentation
        elif (cap.groups.matchedOn(3)) then @"\:"
        elif (cap.groups.matchedOn(4)) then "\\\\\n"
        else cap.matched
      })     
     .replaceAll(regex(@"(\\(?:text|math|begin)(?:[a-z][a-z])?{(?:[^\\}]|\\.)*}|\\[a-z@]+\b)|#([a-z][a-z\d]*\b)|([a-z][a-z\d]*\b)|@([a-z][a-z\d]*\b)", ignoreCase=True), fun(cap) {
        val grp = cap.groups.firstMatchedOn
        if (grp==2) then cap.groups[2]
        elif (grp < 2) then cap.matched
        else {
          cmd = if (cap.groups.matchedOn(4)) then "mathkw" else "mathid"
          captxt = cap.groups[grp]
          val (stem,digits) = match(captxt.find(regex(@"^([^\d]*(?:\d+[^\d]+)*)(\d*)$"))) {
                                Just(ccap) -> (ccap.groups[1],ccap.groups[2])
                                Nothing    -> (captxt,"")
                              }
          "\\" + cmd + "{" + stem + "}" + (if (digits=="") then "" else "_{" + digits + "}")
        } 
      })
}

public function mathPreBlock( txt : string) : string
{
  pre = mathPre(txt)
  "\\begin{mdMathprearray}\n" + pre + "\n\\end{mdMathprearray}"     
}
