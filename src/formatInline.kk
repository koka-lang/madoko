/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// The parsing and formatting of _inline_ elements (i.e. emphasis, links, etc.)
module formatInline

import std/log
import std/dict
import std/string
import std/regex
import std/crypto
import common
import attributes
import inline
import htmlFormatter  // htmlEscape
import texCommon   // rxAuthorYear
import entity
import hilite // inlineMode
import codeAlign

/* --------------------------------------
  Inline grammar 
---------------------------------------- */
alias inlineRule = rule<string,inlineContext>

val normal       = @"(?:[^`*_\\~&<>\^#\$""'\[!\-\. \+@]| (?! \n| *[\[\-\+!@])|-(?![@\-])|\+(?!@)|\.(?!\.\.)|!(?![@\[]))"
val normalbench  = @"(?:[^""'`*_\\~&<>\^#\$\[!]| (?! \n))"

//val attrs    = @"\{:?((?:[^\}\n]|\\\})*)\}"
val attrs      = @"\{:?((?:[^\\'""\}\n]|\\[.\n]|'[^']*'|""[^""]*"")*)\}"  // allow optional colon for maraku compat

val linkhref = @"\s*<?([^\s>)]*)>?(?:\s+['""](.*?)['""])?\s*"
val xlinkid   = @"((?:[^\[\]\n]|\[[^\]\n]*\])*)"
val linktxt  = @"\[(?!\^)((?:\[(?:[^\[\]]|\[[^\]]*\])*\]|\\.|[^\\\]]|\](?=[^\[{]*\]))*)\]"
val linkreg  = linktxt + @"((?:\(" + linkhref + @"\)|\s*\[" + xlinkid + @"\])?(?:" + attrs + @")?)"

public val rxLink = regex(linkreg)

function inlineCoreGrammar( fmt : formatter ) : grammar<string,inlineContext> = [
  Rule("itext",     regex(@"^" + normal + "+"), inlineNormal ),

  Rule("iquotes",   regex(@"^(?:'(?![s\s])((?:[^\\']|\\.|'[a-zA-Z])*)'(?![a-zA-Z])|""((?:[^\\""]|\\.)*)"")"), inlineQuotes ),
  Rule("icode",     regex(@"^(`+)((?:[^`]|(?!\1)`)*)\1(?:" + attrs + ")?"), inlineCode ),
  Rule("ilink",     regex(@"^([\n ]*)" + linkreg), inlineLink ),
  Rule("iemph*",    regex(@"^(\*)((?:[^\\*]|\\.)+)\*"), inlineEmph),  
  
  Rule("iimg",      regex(@"^()!" + linkreg), inlineImg ),
  Rule("ifootnote", regex(@"^\[\^" + xlinkid + @"\]"), inlineFootnote ),
  Rule("iguil",     regex(@"^<<((?:[^\\>]|>(?!>)|\\.)*)>>"), inlineQuotes ),
  Rule("iautolink", regex(@"^<([^/\s>][^\s>]*?(@|:/)[^\s>]+?)>"), inlineAutoLink ),  
  Rule("istrong_",  regex(@"^(__)((?:[^\\]|\\.)+?)__(?!_)"), inlineStrong),
  Rule("istrong*",  regex(@"^(\*\*)((?:[^\\]|\\.)+?)\*\*(?!\*)"), inlineStrong),
  Rule("iemph_",    regex(@"^\b(_)((?:[^\\_]|\\.)+)_\b"), inlineEmph),
  Rule("idel",      regex(@"^~~(?=\S)([\s\S]*?\S)~~"), inlineDel ),
  Rule("isub",      regex(@"^~((?:[^~\\\s]|\\.)+)~"), inlineSub ),
  Rule("isup",      regex(@"^\^((?:[^\^\\\s]|\\.)+)\^"), inlineSup ),
  Rule("itagcode",  regex(@"^(<code\b(?:""[^""]*""|'[^']*'|[^'"">])*?>)([\s\S]*?)(</code>)"), inlineTagCode ),
  Rule("itag",      regex(@"^<(?:!--[\s\S]*?-->|/?\w+\b(?:""[^""]*""|'[^']*'|[^'"">])*?>)"), inlineTag ),
  Rule("ientity",   regex(@"^&(#?[\w\-:]*);"), inlineEntity ),
  //Rule("ilabel",    regex(@"^(#[a-zA-Z][\w\-:]*);?"), inlineLabel ),
  
  Rule("idashes",   regex(@"^--(-)?"), inlineDashes ),
  Rule("ielipsis",  regex(@"^\.\.\."), inlineDots ),
  
  Rule("texinline", regex(@"^\$(?!\$)((?:[^\\\$]|\\[\s\S])+)\$(?:" + attrs + ")?"), inlineMath ),
  Rule("texblock1", regex(@"^\$\$( *\n(?:[^\\\$]|\\[\s\S]|\$[^\$])*)\$\$"), inlineMathBlock ),
  Rule("texblock2", regex(@"^\\\[( *\n(?:[^\\]|\\[^\]])*)\\\]"), inlineMathBlock ),

  Rule("textcite",  regex(@"^([\n ]*)(([\-+!]?)@" + rxCitename + ")"), inlineCite ),
  
  Rule("ibr",       regex(@"^  \n(?!\s*$)"), inlineBreak ),  
  Rule("iescape",   regex(@"^\\([^a-zA-Z0-9])"), inlineEscape ),

  Rule("other",     regex(@"^[\s\S]"), inlineOther ),
]

val benchGrammar 
  = inlineCoreGrammar(FmtHtml).stripFancyRules

function stripFancyRules( g : grammar<string,inlineContext> ) : grammar<string,inlineContext> {
  g.ruleReplace(True, Rule("itext", regex("^" + normalbench + "+"), inlineNormal ))
   .ruleReplace(True, Rule("iquotes", regex(@"^[""']"), inlineQuot ))
   .ruleRemove(True,["idashes","ielipsis","tex","iguil","textcite"])
}

public function inlineGrammar( fmt : formatter, bench : bool = False ) {
  if (bench) then benchGrammar else inlineCoreGrammar(fmt)
  /* for gfm style line breaks */
  /*
  inlineCoreGrammar
   .ruleReplace( breaks, Rule("itext", regex(@"^(?:[^\n" + special + "])+"), inlineNormal ))
   .ruleReplace( breaks, Rule("ibr",   regex(@"^\n(?!\s*$)"), inlineBreak ))
  */
}


/* --------------------------------------
 Inline grammar functions 
---------------------------------------- */

function inlineBreak( cap : matched, context ) {
  match(context.fmt) {
    FmtHtml -> context.fmtText("<br>\n")
    _ -> context.fmtCmd("br","")
  }
}

function inlineEntity( cap : matched, context : inlineContext ) : string {
  val key = cap.groups[1]
  if (key.startsWith("#")) // character code 
   then context.fmtText(cap.matched) 
   else {
    val txt = expandKeyName(key,context.labels,context.metadata)
    if (txt==cap.matched)             // prevent obvious infinite loop
     then context.fmtText(txt)
     else context.formatInline(txt)   // format the expansion
  }
} 

function inlineNormal( cap : matched, context : inlineContext ) : string {
  context.fmtText(cap.matched)
} 

function inlineMath( cap : matched, context : inlineContext ) : string {
  val attrs = cap.groups[2].parseAttrs("math-inline");
  //val attrsd = context.defaults.matchRules("math-inline",attrs)
  //context.fmtMath(False,cap.groups[1],attrsd)
  context.fmtSpan( cap.groups[1], attrs ); // can be taken over by the user
}


function inlineMathBlock( cap : matched, context : inlineContext ) : string {
  val attrsd = context.defaults.matchRules("math-display",attrsNone)
  context.fmtMath(True,cap.groups[1],attrsd)
}

public function fmtMath( context : inlineContext, isDisplay : bool, txt0 : string, attrs : attrs = attrsNone, lineInfo : string = "" ) : string {
  val (kind,left,right,rightx) = 
    if (attrs.hasClass("snippet")) 
     then (if (isDisplay) then "Display" else "Inline","","","")
    elif (isDisplay) 
     then ("Display","\\[" + (if (attrs.name.isEmpty) then "" else "\\label{" + attrs.name + "}"),"\n\\]","%mdk\n")  // add newline because of comments in latex (and we do use trimLines on the content)
     else ("Inline","$","$","")
  val lkind  = kind.toLower
  val class  = "math-" + lkind
  val attrsd = context.applyDefaults("span",attrs.addClass(class))
  val mode   = if (attrsd.hasBoolKey("snippet-needpdf") || attrsd.hasBoolKey("math-needpdf")) then "math-pdf" else "math-dvi" 
  //ptxt = if (attrs.hasClass("mathpre")) then mathPre(txt) else txt
  val txt    = txt0.trimLines
  val texcmd = if (kind=="Inline")
                then context.fmtMathCmd("span", left+lineInfo+txt+right+rightx, attrsd)
                else context.fmtMathEnv("div",  left+lineInfo+txt+right+rightx, attrsd)
  match(context.fmt) {
    FmtTex -> texcmd
    _      -> {
      val mtxt = left + txt.escapeMath(context.fmt) + right
      val mcmd = context.fmtCmd("span",context.fmtText(mtxt),attrsd)
      if (context.mathStatic || mode=="math-pdf") {
        val digest = md5(txt)
        log(mode, @"\begin{md" + kind + "Snippet}[" + digest + "]%mdk\n" + 
                      texcmd + "\\end{md" + kind + "Snippet}%mdk")
        //trace("math: " + digest)
        match(context.mathinfos[digest]) {
          Nothing  -> context.fmtCmd("span",mcmd,attrsNone.addClass("math-rendering").addKeyval("html-title","Rendering math..."))
          Just(mi) -> context.fmtMathImg(mi,txt,mtxt,attrsd)
        }
      }
      else mcmd
    }
  }
} 

public function fmtMathImg( context : inlineContext, mi : mathinfo, txt : string, mtxt : string, attrs : attrs ) {
  val scale = match(attrs.hasKey("math-scale")) {
            Just(value) -> value.parseInt.maybe(100,id).double / 100.0
            Nothing     -> 1.0
          }
  val baseline = match(attrs.hasKey("math-baseline")) {
                   Just(value) -> value.parseInt.maybe(0,id).double
                   Nothing     -> 0.0
                 }
  // Depth and height are in _pt_. Since we assume that the math has been 
  // type set with a 10pt font, we divide by 10 to get the units in _em_. 
  // This has the advantage that it will scale automatically if the user
  // selected a larger display font.
  val fontsize = 10.0
  val valign   = (scale * mi.depth / fontsize) - baseline
  val xattrs = attrs.addKeyvalIfNotExist("vertical-align","-" + valign.showFixed(3) + "em")
                    .addKeyvalIfNotExist("height",(scale * mi.height / fontsize).showFixed(3) + "em")
                    .addClass("math")
                // .addKeyvalIfNotExist("width",mi.width.showFixed(2) + "pt")
                // .addKeyval("data-math", mtxt)
  val src = if (mi.imageData!="") then mi.imageData else mi.imageName
  context.fmtLink(True,Link(src,"",xattrs),mtxt)
}

function escapeMath( txt : string, fmt : formatter ) : string {
  match(fmt) {
    FmtHtml -> txt.htmlEscape
    FmtTex  -> txt 
  }
}


function inlineQuot( cap : matched, context ) : string {
  context.formatInline(if (cap.matched=="\"") then "&quot;" else "&apos;")
}

function inlineStrong( cap : matched, context ) : string {
  val tag = if (context.starBold && cap.matched.startsWith("_")) then "em" else "strong"
  val class = tag + (if (cap.matched.startsWith("*")) then "-star" else "-low") + cap.groups[1].length.show
  val attrs = context.defaults.matchRules( tag, attrsNone.addClass(class) )
  context.fmtCmd(tag, formatInline(context,cap.groups[2]), attrs)
} 

function inlineEmph( cap : matched, context ) : string {  
  val tag = if (context.starBold && cap.matched.startsWith("*")) then "strong" else "em"
  val class = tag + (if (cap.matched.startsWith("*")) then "-star" else "-low") + cap.groups[1].length.show
  val attrs = context.defaults.matchRules( tag, attrsNone.addClass(class) )
  context.fmtCmd(tag, formatInline(context,cap.groups[2]), attrs )  
} 

function inlineSup( cap : matched, context ) : string {
  context.fmtCmd("sup", formatInline(context,cap.groups[1]), context.defaults.matchRules("sup",attrsNone))  
} 

function inlineSub( cap : matched, context ) : string {
  context.fmtCmd("sub", formatInline(context,cap.groups[1]), context.defaults.matchRules("sub",attrsNone))  
} 

function inlineDel( cap : matched, context ) : string {
  context.fmtCmd("del", formatInline(context,cap.groups[1]), context.defaults.matchRules("del",attrsNone))  
} 

function inlineTag( cap : matched, context : inlineContext ) : string {
  inlineTagX(cap.matched,context)
}

function inlineTagX( tag : string, context : inlineContext ) : string {
  if (context.sanitize || !(context.fmt.isFmtHtml)) 
   then "" 
   else tag
}

function inlineTagCode( cap : matched, context : inlineContext ) : string {
  // TODO: we do not process fully inside <code> for now; remove this later
  // when koka documentation generates markdown instead of html.
  val icontext = context.copy(grammar = context.grammar.stripFancyRules)
  inlineTagX(cap.groups[1],context) +
   icontext.formatInline(cap.groups[2]) +
   inlineTagX(cap.groups[3],context)
}

function inlineCode( cap : matched, context ) : string {
  val txt0 = cap.groups[2]
  val txt1 = if (txt0.startsWith(" `")) then txt0.substr(1) else txt0
  val txt  = if (txt0.endsWith("` ")) then txt1.substr(0,txt1.length-1) else txt1
  val attrs = if (cap.groups.matchedOn(3)) 
               then context.formatAttrs(cap.groups[3].parseAttrs) else attrsNone 
  if (context.bench)
   then context.fmtCode( "",txt,attrs)
   else context.fmtSpan( txt,  // can be overridden by the user
          attrs.addClasses(["code","code" + cap.groups[1].length.show])) 
}

public function fmtCode( context : inlineContext, env0 : string, txt : string, attrs0 : attrs = attrsNone ) : string {
  val env = if (env0=="") then "code" else env0
  //trace("code: " + env + ": " + attrs0.show)
  val lang   = attrs0.hasKey("language").maybe("",id)
  val attrs1 = if (lang=="") then attrs0 else attrs0.addClasses(["language-" + lang, "lang-"+lang, lang])
  val attrs  = context.formatDefaults(attrs1,env)
  //trace("code: " + env + ": " + attrs.show)

  val cattrs = match(attrs.hasKey("data-line-first")) {
                 Nothing -> attrsNone
                 Just(v) -> attrsNone.addKeyval("data-line",v)
               }

  val pretty = attrs.hasClass("pretty")               
  val plain0 = (lang=="" || !(context.highlight) || attrs.hasClass("plain") || attrs.hasClass("prettyprint"))
  val plain = if (plain0) then plain0 else {
    if (canHilite(lang)) then False else {
      warning("unknown language: " + lang)
      True
    }
  }

  
  function colorize( code : string, mode : maybe<hilitemode> ) : (string,maybe<hilitemode>) {
    if (plain) 
     then (code, mode)
     else match(code.hilitePartial(lang,mode)) {
            Nothing         -> (code,mode)
            Just((hl,next)) -> (hl,Just(next))
          } 
  }

  function colorToken( classes : list<string>, content : string ) : string {
    if (plain || classes.isNil) then content else {
      val pclasses = if (!pretty) then classes else Cons("ptoken",classes.filter(fun(cname) { cname!="token" } ))
      val tokAttrs = context.formatDefaults( attrsNone(elem="span").addClasses(pclasses) )
      context.fmtCodeToken(pclasses,content,lang,tokAttrs)
    }
  }

  function colorCode( content : string, startline : bool ) : string {
    content.replaceAll("<br>","\n").replaceAll(rxEndSpaces," ").replaceAll( rxTokens, fun(cap) {
      val nl = (pretty && ((cap.index==0 && startline) || (content.substr(cap.index-1,1) == "\n")))
      if (cap.groups[2].bool) {  // token span
        val classes = cap.groups[2].split(" ").list
        colorToken( classes, context.fmtCodePlain( cap.groups[3].htmlUnescape, nl ) )
      }
      elif (cap.groups[4].bool) { // unknown tag
        ""
      }
      else { // literal
        context.fmtCodePlain( cap.matched.htmlUnescape, nl )
      }
    });
  }

  function codeEscape( code : string ) : string {
    context.fmtCodeEscaped(txt,colorize,colorToken,attrs).fst   // possibly tokenize with colors, and process escapes     
  }

  function codeUnescape( ecode : string, col : int ) : string {
    fmtCodeUnescape( ecode, fun(s,startLine) { 
      trace(" format: " + s)
      if (plain) then context.fmtCodePlain(s) else colorCode(s, startLine /* col==0 */)
    })
  }


  val pattrs0 = if (plain) then attrs else attrs.addClasses(["highlighted","colorized"]) // legacy: highlighted 
  val pattrs = context.formatDefaults(pattrs0)
  val content 
    = if (pretty && env != "code" ) then {
        val ct = codeAlign(codeEscape(txt),context.prettyAlign).map( codeUnescape )
        context.fmtCodeTable(ct,cattrs)
      }
      else codeUnescape(codeEscape(txt), 0) // todo: optimize the escape/unescape path?


  if (env=="code") 
   then context.fmtCmd("code", content, pattrs.mergeDefault(cattrs))
   else context.fmtEnv(env, context.fmtCmd( if (context.fmt==FmtTex) then "precode" else "code", content, cattrs), pattrs)
}

val rxEndSpaces = regex(@"  +$",multiline=True)
val rxTokens = regex( @"([^<>]+)|" + rxToken + "|(<([^>]*)>)|(.)", ignoreCase=True)
val rxToken  = @"(?:<span\s+.*?\bclass=['""]?([^""']+)['""]?[^>]*>([\s\S]*?)</span>)"

function htmlUnescape( s : string ) : string {
  s.replaceAll( rxEntity, fun(cap) {
    match(entityToNum(cap.groups[1])) {
      Nothing -> cap.matched;
      Just(i) -> string(1,i.char)
    }
  })
}
val rxEntity = regex( @"&(#[xX]\d+|\w+);" )

function fmtCodeUnescape( txt : string, fmt : (string,bool) -> string ) : string {
  function unspan(caps : list<matched>, i : int ) {
    match(caps) {
      Nil -> txt.substr(i).fmt(i==0)
      Cons(cap,rest) -> {
        trace(" escaped: no format: " + cap.groups[1])
        txt.substr(i,cap.index - i).fmt(i==0) + cap.groups[1] + unspan(rest, cap.next)
      }
    }
  }
  val caps = txt.findAll(rxEscaped).list
  unspan(caps,0)  
}
val rxEscaped = regex(@"<ESCAPED\b[^>]*>([\s\S]*?)</ESCAPED>")

function fmtCodeEscaped( context : inlineContext, txt : string, format : (string,maybe<a>) -> (string,maybe<a>), 
                         formatToken : (list<string>,string) -> string,
                         attrs : attrs = attrsNone, st : maybe<a> = Nothing ) : (string,maybe<a>) {
  if (attrs.hasClass("noescape")) return format(txt,st)

  function codeEscape( src : string, st0 : maybe<_a> ) : (string,maybe<_a>) {
    match( src.find(rxCodeEscaped)) {
      Nothing   -> format(src,st0)
      Just(cap) -> {
        val (fmt1,st1) = format(src.substr(0,cap.index),st0)
        val subcode    = cap.groups[2].replaceAll(regex(@"\\([^\w])"), "$1")
        val width      = if (cap.groups.matchedOn(1)) then cap.groups[1].parseInt.maybe(1,id)  
                         elif (cap.groups.matchedOn(2)) then subcode.length
                         else 1
        val (fmt2,st2) = format(subcode,st1) // for colorization, use the provided substitution
        val classes2   = match(fmt2.find(rxClass)) {
                           Just(ccap) -> (ccap.groups[1] + ccap.groups[2] + ccap.groups[3]).split(" ").list
                           Nothing    -> []
                         }  

        val innerEsc   = context.fmtCmd("span", context.formatInline(cap.groups[3]), 
                           context.formatDefaults(attrsNone.addClass( "code-escaped" )))
        val escaped    = formatToken(classes2,innerEsc)
        trace("inner: " + innerEsc)
        trace("full : " + escaped)
        val fmt3       = "<ESCAPED width=" + width.show + ">" + escaped + "</ESCAPED>"

        val (fmt4,st3) = codeEscape(src.substr1(cap.next),st2)
        (fmt1 + fmt3 + fmt4, st3)
      }
    }
  }

  codeEscape(txt,st)
}
//val rxCodeEscaped = regex(@"\\\((?:(\d+):)?((?:[^\\\r\n]|\\\n|\\[^\)])*)\\\)")
val rxCodeEscaped = regex(@"\\\((?:(\d+):)?(?:((?:[^\\\|]|\\[^\)])*)\|)?((?:[^\\\r\n]|\\\n|\\[^\)])*)\\\)")
val rxClass       = regex(@"^<span\s+class=(?:""([^""]*)""|'([^']*)'|([^\s\&<>]+))\s*>",ignoreCase=True)

function escapeTexPre( txt : string ) : string {
  txt.replaceAll(regex(@"\$"),@"$\text{\tt\textdollar}$")
     .replaceAll(regex(@"\|"),@"$\text{\tt\textbar}$")
}

function inlineDashes( cap : matched, context ) : string {
  context.formatInline(if (cap.groups[1] != "") then "&mdash;" else "&ndash;")
}


function inlineQuotes( cap : matched, context : inlineContext ) : string {
  val quote = cap.matched.substr(0,1)
  if (quote == "'") 
   then context.formatInline("&lsquo;" + cap.groups[1] + "&rsquo;")
  elif (quote=="<")
   then context.formatInline("&laquo;" + cap.groups[1] + "&raquo;")
   else context.formatInline("&ldquo;" + cap.groups[2] + "&rdquo;")
}

function inlineDots( cap : matched, context ) : string {
  context.formatInline("&hellip;")
}

function inlineOther( cap : matched, context ) : string {
  //trace("other: " + cap.matched)
  context.fmtEscape(cap.matched)
}

function inlineEscape( cap : matched, context : inlineContext ) : string {
  val txt = cap.groups[1]
  if (txt==" ") then context.formatInline("&nbsp;")
  elif (txt=="\n") then inlineBreak(cap,context)
  elif (txt=="/") then ""
  elif (context.sanitize) then context.fmtEscape(txt) 
  else context.fmtText(txt)  
}

function inlineAutoLink( cap : matched, context : inlineContext ) : string {
  if (cap.groups[2] == "@") {
    val text = cap.groups[1].replace(regex(@"^mailto:"),"")
    val url  = "mailto:" + text
    context.fmtLink(False,newLink(url,bench=context.bench),context.fmtEscape(text))
  }
  else {
    context.fmtLink(False,newLink(cap.groups[1],bench=context.bench),context.fmtEscape(cap.groups[1]))
  }
}

function inlineLink( cap : matched, context : inlineContext ) : string {
  inlineLinkEx(False,cap,context)
}

function inlineImg( cap : matched, context : inlineContext ) : string {
  inlineLinkEx(True,cap,context)
}

function inlineLinkEx( isImage : bool, cap : matched, context : inlineContext ) : string {
  // cap.groups = 1:optional spaces, 2:txt, 3:everything after it, 
  //               AND 4:href, 5:href-title, OR 6: linkid, AND 7:span attributes
  val attrs  = if (cap.groups.matchedOn(7)) then context.formatAttrs(cap.groups[7].parseAttrs) else attrsNone
  //val attrs   = context.applyDefaults(if (isImage) then "img" else "a", attrs0)
  
  val nbsp = if (cap.groups[1] != "" && cap.groups[1].list.all(fun(c){c==' '})) 
              then context.fmtText("&nbsp;") else cap.groups[1]
  if (cap.groups.matchedOn(4)) {
    // direct url link:  [text](url title){attrs}
    val attrsd = context.defaults.matchRules( if (isImage) then "img" else "a", attrs)
    nbsp + context.fmtLink(isImage, newLink(cap.groups[4],cap.groups[5],attrsd,bench=context.bench), 
                                 context.formatInline(cap.groups[2]))
  }
  elif (context.bench || cap.groups.matchedOn(6)) {
    // [text][ref]{attrs} 
    inlineLinkRef(isImage, cap.groups[1], nbsp, cap.groups[2], cap.groups[3], cap.groups[6], attrs, context )
  }
  else {
    // [text]{attrs}
    inlineLinkNoRef(isImage, cap.groups[1], nbsp, cap.groups[2], cap.groups[3], attrs, context)
  }
}

struct cite( 
  name    : string, 
  pre     : string, 
  post    : string, 
  modifier: string, 
  number  : string,
  year    : string,
  authors : string,
  ordinal : int  
)

function newCite( context : inlineContext, name : string, pre : string, post : string, modifier : string, 
                  citeLabel : string, citeInfo : string ) 
{
  val numlab = match(context.labels[name]) {
                 Nothing   -> "?"
                 Just(lbl) -> lbl.labelText
               }
  val ordinal = match(numlab.find(rxDigits)) {
                  Just(cap) -> cap.matched.parseInt.maybe(0,id)
                  Nothing   -> 0
                }
  //trace("citeLabel: " + name + ": " + citeLabel)
  val (number,authors,year) = 
    match(citeInfo.find(rxAuthorYear)) {
      Nothing   -> if (citeLabel=="") then (numlab,"","") else (citeLabel,"","")
      Just(cap) -> {
        //trace(" matched: " + cap.groups[1] + ", " + cap.groups[2] + ", " + cap.groups[3] ) 
        (numlab, 
          if (modifier=="+" && cap.groups[3]!="") 
            then cap.groups[3] 
            else cap.groups[1], //.replaceAll(rxEtAl,"_et al._"),
          cap.groups[2])
      }
    }     
  
  match (post.find(rxCommaAt)) {
    Nothing -> ()
    Just(cap) -> warning( "citations need to be semi-colon separated: "  + cap.matched )
  }

  Cite( name, pre, post, modifier, number, 
        if (year=="") then number else year, 
        authors, ordinal )
}
val rxCommaAt = regex(@",\s*[+!-]?@([\w-:]+)")
val rxDigits = regex(@"\d+")

function inlineLinkNoRef( isImage:bool, spaces : string, nbsp : string, txt : string, after : string, attrs : attrs, context : inlineContext ) : string 
{
  val citationss 
            = if (context.bench || !(txt.contains("@"))) then Nil  
                else txt.splitExclude(rxCiteSep,rxCiteSepExclude).map(fun(elem) {
                        match (elem.find(rxCitation)) {
                          Nothing -> []
                          Just(cap) -> {
                            log("aux",@"\citation{" + cap.groups[3] + "}")
                            val lab = ("@" + cap.groups[3]).definitionId 
                            match(context.labels[lab]) {
                              Just(lbl) -> {  // | lbl.element == "bibitem" 
                                [context.newCite(lab.substr(1),cap.groups[1],cap.groups[4],cap.groups[2],
                                                  lbl.labelText, lbl.labelInfo)]
                              }
                              Nothing -> {
                                warning( "missing citation: @" + cap.groups[3] )
                                []
                              }
                            }
                          } 
                        }                      
                      })

  //trace("citations: " + citationss.concat.join("-")) 
  if (citationss.isCons && citationss.all(isCons)) {
    // Citations link: set defaults as "citations" block
    val attrsc = attrs.addKeyval("target-element","bibitem")
    val attrsd = context.defaults.matchRules("citations",attrsc)
    nbsp + context.fmtCite(citationss.concat,attrsd)
  } 
  else {
    inlineLinkRef( isImage, spaces, nbsp, txt, after, "", attrs, context )
  }
}
val rxCiteSep         = regex(@"\s*[;]\s*")
val rxCiteSepExclude  = regex(@"[^\\;\s]|\\.")
val rxCitation        = regex(@"^((?:[^\w\\@+!-]|[+!-](?!@)|\\.|\w(?![+!-]?@))*)(?:([+!-]?)@" + rxCitename + @")([\s\S]*)$")
val rxCitename        = @"(\w(?:[\w]|[:\-\.]\w)*)"

function inlineCite( cap : matched, context : inlineContext ) : string {
  log("aux",@"\citation{" + cap.groups[4] + "}")
  match(context.labels[("@" + cap.groups[4]).definitionId]) {
    Just(_) -> context.formatInline(cap.groups[1] + "[" + cap.groups[2] + "]{.textual" + 
                                      (if (cap.groups[3]=="-") then " .free" else "") + "}")  
    Nothing -> {
      if (cap.groups[1] != "") {
        warning( "possibly missing citation: " + cap.groups[2])
      }
      context.fmtText(cap.matched)
    }
  }
}

function inlineLinkRef( isImage : bool, spaces : string, nbsp : string, txt : string, after : string, ref : string, 
                          attrs : attrs, context : inlineContext ) : string 
{    
  val id = if (ref != "") then ref.definitionId else txt.definitionId
  val elemName = if (isImage) then "img" else "a"
  match(context.links[id]) {
    Just(link) -> {
      val attrsd = context.defaults.matchRules(elemName,attrs)
      val xlink = if (attrsd.empty) then link else link( linkattrs = attrsd.mergeDefault(link.linkattrs) )
      nbsp + context.fmtLink(isImage, xlink, context.formatInline(txt))         
    }
    Nothing -> {
      // Link not found! Try if it is a label
      val labelId = if (id.startsWith("#")) then id.substr(1) else ""
      match(context.labels[labelId]) {
        Just(lab) -> {
          // Label reference
          val attrsd = context.defaults.matchRules(elemName,attrs)
          val lattrs = attrsd.addKeyval("target-element",lab.element)
          val llink  = newLink(id,context.formatInline(lab.labelCaption),lattrs,bench=context.bench)
          nbsp + context.fmtLink(isImage,llink,context.formatInline(
                                 if (ref=="") then "&" + labelId + ";" else txt)) 
        }      
        Nothing -> {
          if (ref != "") then {            
            warning( "missing link definition: " + ref)
            spaces + context.formatInline(txt) + "[??]"
          }
          elif (!(attrs.empty)) {
            // Span element
            spaces + context.fmtSpan(txt,attrs)
          }
          else {
            // warn for missing labels or links
            if (txt.contains(rxCanBeRef)) {
              if (txt.startsWith("#")) {
                warning( "reference to missing id: " + txt)
              }
              elif (context.labels[id].isJust) {
                warning( "possibly forgot '#' to reference id: " + txt)
              }
              else {
                warning( "possibly missing link definition or id: " + txt)
              }
            }
            
            // just brackets
            spaces + "[" + formatInline(context,txt) + "]" + formatInline(context,after)
          }
        }
      }
    }
  }
}

val rxCanBeRef = regex(@"^#?[A-Za-z_][\w-]*$")

// get and format default attributes
function formatDefaults( context : inlineContext, attrs : attrs, elemName : string = "" ) : attrs {
  if (!(attrs.defaults)) return attrs

  val sname = if (elemName != "") then elemName
              elif (attrs.elem != "") then attrs.elem
              else match (attrs.classes) {
                Cons(cname,_) -> cname
                _             -> "span"
              } //attrs.elementName("span")
  val attrsx  = context.defaults.matchRules(sname,attrs)
  context.formatAttrs(attrsx)
}

// Format a span element
function fmtSpan( context : inlineContext, txt0 : string, attrs : attrs ) : string {
  val sname   = if (attrs.elem != "") then attrs.elem
                else match (attrs.classes) {
                  Cons(cname,_) -> cname
                  _             -> "span"
                } //attrs.elementName("span")
  val attrsx  = context.defaults.matchRules(sname,attrs)
  val attrsd  = context.formatAttrs(attrsx)            

  val txt = attrsd.transformText(txt0,context.labels,context.metadata)
  match(attrsd.input) {
    Pre      -> context.fmtCode("", txt, attrsd) // todo: use sname as env name?
    Math     -> context.fmtMath(False,txt.mathUnline,attrsd)
    MathPre  -> context.fmtMath(False,txt.mathUnline.mathPre,attrsd)
    Raw(monly) -> {
      if (context.sanitize) then "" 
       else match(monly) {
        Nothing -> context.fmtCmd("span", txt, attrsd )
        Just(f) | f == context.fmt -> context.fmtCmd("span", txt, attrsd )
        _       -> ""
       }
    }
    Markdown | attrsd.notag -> context.formatInline(txt)
    // MathDefs, Tex, Markdown 
    _  -> context.fmtCmd("span", context.formatInline(txt), attrsd )
  }
}

function mathUnline( txt : string ) {
  txt.replaceAll(rxCont,"$1")  // allow line breaks in inline-math
}
val rxCont = regex(@"(\\%)|(?:%.*)?\n[ \t]*")  

// Format a citation link
function fmtCite(context : inlineContext, citations : list<cite>, attrs : attrs ) : string 
{  
  val cs0 = match(attrs.hasKey("cite-style")) {
              Just(cstext) -> parseCiteStyle(cstext)
              Nothing      -> context.citestyle
            }
  val cs1 = match(cs0.mode) {
              Auto -> match(citations) {
                        Cons(cite,_) | cite.authors != "" -> citeNatural
                        _  -> citeNumeric                      
                      }
              _ -> cs0
            }
  val cs = if (attrs.hasClass("free")) then cs1(open="",close="") else cs1 

  val isTextual = (attrs.hasClass("textual") || cs.mode.isTextual)

  function makeParens(text) {
    cs.open + text + cs.close
  }

  function makeLink(cite:cite,text:string) :string {
    "[" + text + "][#" + cite.name + "]{.bibref}"
  }

  // Takes a list of citations that share common authors
  function fmtAuthorYear(cites : list<cite> ) {
    val (modifier,authors,pre,post) = match(cites) {
      Cons(cite,_) -> (cite.modifier,cite.authors,cite.pre,cite.post)
      _ -> ("","?","","")  // should never happen
    }
    val links = cites.map(fun(cite){ makeLink(cite,cite.year) }).join(cs.yysep)
    val plinks= if (isTextual && !(modifier.contains("-"))) then makeParens(links) else links
    val sep   = if (isTextual) then "&nbsp;" else cs.aysep


    if (authors=="") {
      warning( "author-year citation but this bib style does not support this: " + 
              cites.map(fun(cite){ "@" + cite.name }).join(", "))
    }
    val mid  = if (modifier=="!") 
                 then authors
               elif (modifier=="-" || authors=="")
                 then plinks
                 else authors + sep + plinks 
    pre + mid + post
  }

  function fmtNumeric(cite : cite) {
    val mid  = if (cite.modifier=="!") then cite.authors else makeLink(cite,cite.number)      
    cite.pre + mid + cite.post
  }

  function fmtNumericSpan( cite1 : cite, cite2 : cite ) : string {
    val link1 = makeLink(cite1,cite1.number)
    val link2 = makeLink(cite2,cite2.number)
    cite1.pre + link1 + @"\/--\/" + link2 + cite1.post  
  }

  // compress numeric citations
  function takeSeq1(cite:cite, final:cite, cites : list<cite> ) : maybe<cite> {
    match(cites) {
      Cons(citex,citesx) | citex.ordinal == final.ordinal+1
        -> takeSeq1(cite,citex,citesx)
      _ -> if (final.ordinal - cite.ordinal <= 1) then Nothing else Just(final)
    }
  }

  function takeSeq(cite:cite, cites : list<cite> ) : maybe<cite> {
    if (cite.modifier=="!") then return Nothing
    if (cite.ordinal<=0) then return Nothing
    match(cites) {
      Cons(citex,citesx) -> {
        if (citex.ordinal == cite.ordinal+1) 
         then takeSeq1(cite,citex,citesx) 
         else Nothing
      }
      Nil -> Nothing
    }
  }

  function fmtCompressed( cites : list<cite>, done : int = ~1 ) : list<string> 
  {    
    match(cites) {
      Cons(cite,rest0) ->
        if (done >= cite.ordinal) then fmtCompressed(rest0,done) else {
          match(takeSeq(cite,rest0)) {
            Just(final) -> Cons(fmtNumericSpan(cite,final), rest0.fmtCompressed(final.ordinal))    
            Nothing     -> Cons(fmtNumeric(cite), rest0.fmtCompressed())
          }
        }
      Nil -> Nil
    }
  }

  // Group common authors together for author-year citations.
  // We pass an explicit "done" list so Koka can see this is terminating
  function groupAuthors( cites : list<cite>, done : list<string> ) : list<list<cite>> {
    match(cites) {
      Nil -> Nil
      Cons(cite,rest) -> {
        if (done.any( fun(s) { s == cite.modifier + cite.authors })) 
          then groupAuthors(rest,done) 
          else {
            val same = rest.filter( fun(citex) { 
                          (citex.authors == cite.authors) && (citex.modifier == cite.modifier) } )
            if (same.isNil) 
             then Cons([cite], rest.groupAuthors(done))
             else Cons( Cons(cite,same), rest.groupAuthors( Cons(cite.modifier + cite.authors, done)) )
          }
      }
    }
  }

  function fmtAuthorYears( cites : list<cite> ) : list<string> {
    cites.groupAuthors([]).map(fmtAuthorYear)
  }


  function fmtNumerics( cites : list<cite> ) : list<string> {
    // group numeric citations?
    if (cs.compress) then cites.fmtCompressed else cites.map(fmtNumeric)
  }

  function fmtTextualNumerics( cites : list<cite> ) : list<string> {
    cites.map(fun(cite){ fmtAuthorYear([cite(year = cite.number)])} )
  }

  function fmtCitations(cites : list<cite> ) : list<string> {
    function gtCite(cite1,cite2) { cite1.ordinal > cite2.ordinal }
    val scites = if (cs.sort) then cites.isort(gtCite) else cites
    match(cs.mode) {
      Natural -> fmtAuthorYears(scites)
      Textual -> fmtAuthorYears(scites)
      _ | isTextual -> fmtTextualNumerics(scites)
      _ -> fmtNumerics(scites)
    }
  }

  val citeText = citations.fmtCitations.join(cs.citesep + @"\/")  // add \/ or nbsp's are inserted.
  val pciteText = if (isTextual) then citeText else makeParens(citeText) 
  
  val sciteText = match(cs.mode) {
    Super -> @"\/^" + pciteText + @"^\/"
    _     -> pciteText
  }  
  context.fmtCmd("span", context.formatInline(sciteText), attrs.addClass("citations"))
}


val rxEtAl       = regex(@"\bet(?: |&nbsp;|\\ )al.(?!_)") 


// Format attributes
function formatAttrs( context : inlineContext, attrs : attrs ) : attrs {
  attrs( label = context.formatInline(attrs.label) ).expand(context.metadata )
}

// Apply defaults
function applyDefaults( context : inlineContext, sname : string, attrs : attrs ) : attrs {
  context.defaults.matchRules(sname,attrs)
}

function inlineFootnote( cap : matched, context : inlineContext ) : string {
  val id = cap.groups[1].definitionId
  match( context.footnotes[id] ) {
    Just(fn:footnote) -> context.fmtFootnote(id,fn(footnoteNum = context.formatInline(fn.footnoteNum),
                                                   footnoteCaption = context.formatInline(fn.footnoteCaption)))
    Nothing -> {
      warning( "missing footnote definition: " + cap.groups[1])
      context.fmtText("[^" + formatInline(context,cap.groups[1]) + "]") // leave as plain text?
    }
  }
}

function isort( xs : list<a>, gt : (a,a) -> bool ) : list<a> {
  match(xs) {
    Cons(x,xx) -> insert(x,xx.isort(gt),gt)
    Nil -> Nil
  }
}

function insert( x : a, xs : list<a>, gt : (a,a) -> bool ) : list<a> {
  match(xs) {
    Cons(y,yy) -> if (gt(x,y)) then Cons(y,insert(x,yy,gt)) else Cons(x,xs)    
    Nil -> [x]
  }
}