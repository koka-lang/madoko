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
import common
import attributes
import inline
import htmlFormatter
import texFormatter
import texParser   // rxAuthorYear
import md5
import entity
import hilite // inlineMode

/* --------------------------------------
  Inline grammar 
---------------------------------------- */
alias inlineRule = rule<string,inlineContext>

val normal       = @"(?:[^`*_\\~&<>\^#\$""'\[!\-\. \+@]| (?! \n| *[\[\-\+!@])|-(?![@\-])|\+(?!@)|\.(?!\.\.)|!(?![@\[]))"
val normalbench  = @"(?:[^""'`*_\\~&<>\^#\$\[!]| (?! \n))"

//val attrs    = @"\{:?((?:[^\}\n]|\\\})*)\}"
val attrs      = @"\{:?((?:[^\\'""\}\n]|\\[.\n]|'[^']*'|""[^""]*"")*)\}"  // allow optional colon for maraku compat

val linkhref = @"\s*<?([^\s>)]*)>?(?:\s+['""](.*?)['""])?\s*"
val linkid   = @"((?:[^\[\]\n]|\[[^\]\n]*\])*)"
val linktxt  = @"\[(?!\^)((?:\[(?:[^\[\]]|\[[^\]]*\])*\]|\\.|[^\\\]]|\](?=[^\[{]*\]))*)\]"
val linkreg  = linktxt + @"((?:\(" + linkhref + @"\)|\s*\[" + linkid + @"\])?(?:" + attrs + @")?)"

function inlineCoreGrammar( fmt : formatter ) : grammar<string,inlineContext> = [
  Rule("itext",     regex(@"^" + normal + "+"), inlineNormal ),

  Rule("iquotes",   regex(@"^(?:'((?:[^\\']|\\.|'[a-zA-Z])*)'(?![a-zA-Z])|""((?:[^\\""]|\\.)*)"")"), inlineQuotes ),
  Rule("icode",     regex(@"^(`+)((?:[^`]|(?!\1)`)*)\1(?:" + attrs + ")?"), inlineCode ),
  Rule("ilink",     regex(@"^([\n ]*)" + linkreg), inlineLink ),
  Rule("iemph*",    regex(@"^\*((?:[^\\*]|\\.)+)\*"), inlineEmph),  
  
  Rule("iimg",      regex(@"^()!" + linkreg), inlineImg ),
  Rule("ifootnote", regex(@"^\[\^" + linkid + @"\]"), inlineFootnote ),
  Rule("iguil",     regex(@"^<<((?:[^\\>]|>(?!>)|\\.)*)>>"), inlineQuotes ),
  Rule("iautolink", regex(@"^<([^/\s>][^\s>]*?(@|:/)[^\s>]+?)>"), inlineAutoLink ),  
  Rule("istrong_",  regex(@"^__((?:[^\\]|\\.)+?)__(?!_)"), inlineStrong),
  Rule("istrong*",  regex(@"^\*\*((?:[^\\]|\\.)+?)\*\*(?!\*)"), inlineStrong),
  Rule("iemph_",    regex(@"^\b_((?:[^\\_]|\\.)+)_\b"), inlineEmph),
  Rule("idel",      regex(@"^~~(?=\S)([\s\S]*?\S)~~"), inlineDel ),
  Rule("isub",      regex(@"^~((?:[^~\\\s]|\\.)+)~"), inlineSub ),
  Rule("isup",      regex(@"^\^((?:[^\^\\\s]|\\.)+)\^"), inlineSup ),
  Rule("itagcode",  regex(@"^(<code\b(?:""[^""]*""|'[^']*'|[^'"">])*?>)([\s\S]*?)(</code>)"), inlineTagCode ),
  Rule("itag",      regex(@"^<(?:!--[\s\S]*?-->|/?\w+\b(?:""[^""]*""|'[^']*'|[^'"">])*?>)"), inlineTag ),
  Rule("ientity",   regex(@"^&(#?[\w\-:]*);"), inlineEntity ),
  //Rule("ilabel",    regex(@"^(#[a-zA-Z][\w\-:]*);?"), inlineLabel ),
  
  Rule("idashes",   regex(@"^--(-)?"), inlineDashes ),
  Rule("ielipsis",  regex(@"^\.\.\."), inlineDots ),
  
  Rule("texinline", regex(@"^\$((?:[^\\\$]|\\.)+)\$(?:" + attrs + ")?"), inlineMath ),
  Rule("texblock1", regex(@"^\$\$( *\n(?:[^\\\$]|\\.|\$[^\$])*)\$\$]"), inlineMathBlock ),
  Rule("texblock2", regex(@"^\\\[( *\n(?:[^\\]|\\[^\]])*)\\\]"), inlineMathBlock ),

  Rule("textcite",  regex(@"^([\n ]*)(([\-+!]?)(@[\w:\-]+))"), inlineCite ),
  
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

function inlineGrammar( fmt : formatter, bench : bool = False ) {
  if (bench) then benchGrammar else inlineCoreGrammar(fmt)
  /* for gfm style line breaks */
  /*
  inlineCoreGrammar
   .ruleReplace( breaks, Rule("itext", regex(@"^(?:[^\n" + special + "])+"), inlineNormal ))
   .ruleReplace( breaks, Rule("ibr",   regex(@"^\n(?!\s*$)"), inlineBreak ))
  */
}


// Create an ":inlineContext"
public function inlineContext( fmt : formatter, 
                               metadata : dict<string>,
                               mathinfos : dict<mathinfo>,
                               citestyle : citestyle = citeAuto,
                               sanitize : bool = False,
                               bench: bool = False,
                               verbose : int = 0,
                               mathStatic : bool = False,
                               highlight : bool = True ) : inlineContext
{
  InlineContext( inlineGrammar(fmt,bench), dict(), dict(), dict(), dict(),
                 metadata, mathinfos, 
                 citestyle, sanitize, bench, verbose, mathStatic, highlight,
                 fmt.pick(fmtHtmlCmd,fmtTexCmd), 
                 fmt.pick(fmtHtmlEscape,fmtTexEscape), 
                 fmt.pick(fmtHtmlLink,fmtTexLink), 
                 fmt.pick(fmtHtmlFootnote,fmtTexFootnote),
                 fmt.pick(fmtHtmlTitle,fmtTexTitle),
                 fmt.pick(fmtHtmlTable,fmtTexTable),
                 fmt.pick(fmtHtmlEnv,fmtTexEnv),
                 fmt.pick(fmtHtmlCodePlain,fmtTexCodePlain),
                 fmt.pick(fmtHtmlCodeHilite,fmtTexCodeHilite),
                 fmt 
               )
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
  key = cap.groups[1]
  if (key.startsWith("#")) // character code 
   then context.fmtText(cap.matched) 
   else {
    txt = expandKeyName(key,context.labels,context.metadata)
    if (txt==cap.matched)             // prevent obvious infinite loop
     then context.fmtText(txt)
     else context.formatInline(txt)   // format the expansion
  }
} 

function inlineNormal( cap : matched, context : inlineContext ) : string {
  context.fmtText(cap.matched)
} 

function inlineMath( cap : matched, context : inlineContext ) : string {
  context.fmtMath(False,cap.groups[1],cap.groups[2].parseAttrs)
}

function inlineMathBlock( cap : matched, context : inlineContext ) : string {
  context.fmtMath(True,cap.groups[1])
}

public function fmtMath( context : inlineContext, isDisplay : bool, txt : string, attrs : attrs = attrsNone ) : string {
  val (kind,left,right) = 
    if (attrs.hasClass("snippet")) 
     then (if (isDisplay) then "Display" else "Inline","","")
    elif (isDisplay) 
     then ("Display","\\[","\\]") 
     else ("Inline","$","$")
  val mode = if (attrs.hasBoolKey("snippet-needpdf") || attrs.hasBoolKey("math-needpdf")) then "math-pdf" else "math-dvi" 
  lkind  = kind.toLower
  class  = "math-" + lkind
  attrsd = context.formatAttrs(context.applyDefaults("div", attrs.addClass(class)))
  //ptxt = if (attrs.hasClass("mathpre")) then mathPre(txt) else txt
  texcmd = if (kind=="Inline")
            then context.fmtTexCmd("span", left+txt+right, attrsd)
            else context.fmtTexEnv("div",  left+txt+right, attrsd)
  match(context.fmt) {
    FmtTex -> texcmd
    _      -> {
      mtxt = left + txt.escapeMath(context.fmt) + right
      mcmd = context.fmtCmd("span",context.fmtText(mtxt),attrsd)
      if (context.mathStatic || mode=="math-pdf") {
        digest = md5(txt)
        log(mode, @"\begin{md" + kind + "Snippet}[" + digest + "]%\n" + 
                      texcmd + "\n\\end{md" + kind + "Snippet}")
        match(context.mathinfos[digest]) {
          Nothing  -> mcmd
          Just(mi) -> context.fmtMathImg(mi,txt,mtxt,attrsd)
        }
      }
      else mcmd
    }
  }
} 

public function fmtMathImg( context : inlineContext, mi : mathinfo, txt : string, mtxt : string, attrs : attrs ) {
  scale = match(attrs.hasKey("math-scale")) {
            Just(value) -> value.parseInt.maybe(100,id).double / 100.0
            Nothing     -> 1.0
          }
  // Depth and height are in _pt_. Since we assume that the math has been 
  // type set with a 10pt font, we divide by 10 to get the units in _em_. 
  // This has the advantage that it will scale automatically if the user
  // selected a larger display font.
  fontsize = 10.0
  xattrs = attrs.addKeyvalIfNotExist("vertical-align","-" + (scale * mi.depth / fontsize).showFixed(3) + "em")
                .addKeyvalIfNotExist("height",(scale * mi.height / fontsize).showFixed(3) + "em")
                .addClass("math")
                // .addKeyvalIfNotExist("width",mi.width.showFixed(2) + "pt")
  src = if (mi.imageData!="") then mi.imageData else mi.imageName
  context.fmtLink(True,Link(src,txt,xattrs),mtxt)
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
  context.fmtCmd("strong", formatInline(context,cap.groups[1]))  
} 

function inlineEmph( cap : matched, context ) : string {
  context.fmtCmd("em", formatInline(context,cap.groups[1]))  
} 

function inlineSup( cap : matched, context ) : string {
  context.fmtCmd("sup", formatInline(context,cap.groups[1]))  
} 

function inlineSub( cap : matched, context ) : string {
  context.fmtCmd("sub", formatInline(context,cap.groups[1]))  
} 

function inlineDel( cap : matched, context ) : string {
  context.fmtCmd("del", formatInline(context,cap.groups[1]))  
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
  icontext = context.copy(grammar = context.grammar.stripFancyRules)
  inlineTagX(cap.groups[1],context) +
   icontext.formatInline(cap.groups[2]) +
   inlineTagX(cap.groups[3],context)
}

function inlineCode( cap : matched, context ) : string {
  txt0 = cap.groups[2]
  txt1 = if (txt0.startsWith(" `")) then txt0.substr(1) else txt0
  txt  = if (txt0.endsWith("` ")) then txt1.substr(0,txt1.length-1) else txt1
  attrs = if (cap.groups.matchedOn(3)) 
           then context.formatAttrs(cap.groups[3].parseAttrs) else attrsNone 
  if (context.bench || cap.groups[1].length > 1)
   then context.fmtCode( "",txt,attrs)
   else context.fmtSpan( txt, attrs.addClass("code") ) // can be overridden by the user
}

public function fmtCode( context : inlineContext, env : string, txt : string, attrs : attrs = attrsNone ) : string {
  lang   = attrs.hasKey("language").maybe("",id)
  lattrs = if (lang=="") then attrsNone else Attrs(classes=["language-" + lang, "lang-"+lang, lang])
  
  val (pattrs,content)
    = if (lang=="" || !(context.highlight) || attrs.hasClass("plain") || attrs.hasClass("prettyprint")) 
       then (attrs, context.fmtCodePlain(txt))
       else (attrs.addClass("hljs"), context.fmtCodeEx(lang,txt,attrs))

  if (env=="" || env=="code") 
   then context.fmtCmd("code", content, pattrs.mergeDefault(lattrs))
   else context.fmtEnv(env, context.fmtCmd("code", content, lattrs), pattrs)
}

function fmtCodeEx( context : inlineContext, lang : string, txt : string, attrs : attrs ) : string 
{
  if (attrs.hasClass("noescape")) return context.fmtCodeHilite(txt,lang).fst

  function hiliteX( src : string, mode : maybe<hilitemode> ) : string {
    match( src.find(rxCodeEscaped)) {
      Nothing   -> context.fmtCodeHilite(src,lang,mode).fst
      Just(cap) -> {
        val (fmt1,mode1) = context.fmtCodeHilite(src.substr(0,cap.index),lang,mode)
        fmt2 = context.fmtCmd("span", context.formatInline(cap.groups[1]), 
                                context.formatDefaults(attrsNone.addClass("code-escaped")))  
        fmt1 + fmt2 + hiliteX(src.substr1(cap.next),mode1)
      }
    }
  }

  hiliteX(txt,Nothing)
}

val rxCodeEscaped = regex(@"\\\(((?:[^\\\r\n]|\\\n|\\[^\)])*)\\\)")

/*
function fmtCode( context : inlineContext, tag : string, txt : string, attrs : attrs = attrsNone) : string {
  match(context.fmt) {
    FmtHtml -> context.fmtCmd(tag, context.fmtEscapePre(txt), attrs)  
    FmtTex  -> if (attrs.hasClass("plain"))
                then context.fmtCmd("verb", context.fmtText(txt), attrs )
                else context.fmtCmd(tag, txt.escapeTexPre, attrs )
  }
}
*/

function escapeTexPre( txt : string ) : string {
  txt.replaceAll(regex(@"\$"),@"$\text{\tt\textdollar}$")
     .replaceAll(regex(@"\|"),@"$\text{\tt\textbar}$")
}

function inlineDashes( cap : matched, context ) : string {
  context.formatInline(if (cap.groups[1] != "") then "&mdash;" else "&ndash;")
}


function inlineQuotes( cap : matched, context : inlineContext ) : string {
  quote = cap.matched.substr(0,1)
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
  txt = cap.groups[1]
  if (txt==" ") then context.formatInline("&nbsp;")
  elif (txt=="\n") then inlineBreak(cap,context)
  elif (txt=="/") then ""
  elif (context.sanitize) then context.fmtEscape(txt) 
  else context.fmtText(txt)  
}

function inlineAutoLink( cap : matched, context : inlineContext ) : string {
  if (cap.groups[2] == "@") {
    text = cap.groups[1].replace(regex(@"^mailto:"),"")
    url  = "mailto:" + text
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
  attrs  = if (cap.groups.matchedOn(7)) then context.formatAttrs(cap.groups[7].parseAttrs) else attrsNone
  
  nbsp = if (cap.groups[1] != "" && cap.groups[1].list.all(fun(c){c==' '})) 
          then context.fmtText("&nbsp;") else cap.groups[1]
  if (cap.groups.matchedOn(4)) {
    // direct url link:  [text](url title){attrs}
    attrsd = context.defaults.matchRules("a",attrs)
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

function newCite( context : inlineContext, name : string, pre : string, post : string, modifier : string, citeLabel : string ) 
{
  numlab = match(context.labels[name]) {
             Nothing   -> "?"
             Just(lbl) -> lbl.labelText
           }
  ordinal = match(numlab.find(rxDigits)) {
              Just(cap) -> cap.matched.parseInt.maybe(0,id)
              Nothing   -> 0
            }
  val (number,authors,year) = 
    match(citeLabel.find(rxAuthorYear)) {
      Nothing   -> if (citeLabel=="") then (numlab,"","") else (citeLabel,"","")
      Just(cap) -> (numlab, 
                    if (modifier=="+" && cap.groups[3]!="") 
                      then cap.groups[3] 
                      else cap.groups[1], //.replaceAll(rxEtAl,"_et al._"),
                    cap.groups[2])
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
  citationss = if (context.bench || !(txt.contains("@"))) then Nil  
                else txt.splitExclude(rxCiteSep,rxCiteSepExclude).map(fun(elem) {
                        match (elem.find(rxCitation)) {
                          Nothing -> []
                          Just(cap) -> {
                            log("aux",@"\citation{" + cap.groups[3] + "}")
                            lab = ("@" + cap.groups[3]).definitionId 
                            match(context.labels[lab]) {
                              Just(lbl) -> {  // | lbl.element == "bibitem" 
                                [context.newCite(lab.substr(1),cap.groups[1],cap.groups[4],cap.groups[2],lbl.labelText)]
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
    attrsc = attrs.addKeyval("target-element","bibitem")
    attrsd = context.defaults.matchRules("citations",attrsc)
    nbsp + context.fmtCite(citationss.concat,attrsd)
  } 
  else {
    inlineLinkRef( isImage, spaces, nbsp, txt, after, "", attrs, context )
  }
}
val rxCiteSep         = regex(@"\s*[;]\s*")
val rxCiteSepExclude  = regex(@"[^\\;\s]|\\.")
val rxCitation        = regex(@"^((?:[^\w\\@+!-]|[+!-](?!@)|\\.|\w(?![+!-]?@))*)(?:([+!-]?)@([\w-:]+))([\s\S]*)$")


function inlineCite( cap : matched, context : inlineContext ) : string {
  match(context.labels[(cap.groups[4]).definitionId]) {
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
  id = if (ref != "") then ref.definitionId else txt.definitionId
  match(context.links[id]) {
    Just(link) -> {
      attrsd = context.defaults.matchRules("a",attrs)
      xlink = if (attrs.empty) then link else link( linkattrs = attrsd.mergeDefault(link.linkattrs) )
      nbsp + context.fmtLink(isImage, xlink, context.formatInline(txt))         
    }
    Nothing -> {
      // Link not found! Try if it is a label
      labelId = if (id.startsWith("#")) then id.substr(1) else ""
      match(context.labels[labelId]) {
        Just(lab) -> {
          // Label reference
          attrsd = context.defaults.matchRules("a",attrs)
          lattrs = attrsd.addKeyval("target-element",lab.element)
          llink  = newLink(id,context.formatInline(lab.labelCaption),lattrs,bench=context.bench)
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
              elif (context.labels[("#"+txt).definitionId].isJust) {
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
function formatDefaults( context : inlineContext, attrs : attrs ) : attrs {
  if (!(attrs.defaults)) return attrs

  sname   = if (attrs.elem != "") then attrs.elem
            else match (attrs.classes) {
              Cons(cname,_) -> cname
              _             -> "span"
            } //attrs.elementName("span")
  attrsx  = context.defaults.matchRules(sname,attrs)
  context.formatAttrs(attrsx)
}

// Format a span element
function fmtSpan( context : inlineContext, txt0 : string, attrs : attrs ) : string {
  sname   = if (attrs.elem != "") then attrs.elem
            else match (attrs.classes) {
              Cons(cname,_) -> cname
              _             -> "span"
            } //attrs.elementName("span")
  attrsx  = context.defaults.matchRules(sname,attrs)
  attrsd  = context.formatAttrs(attrsx)            

  txt = attrsd.transformText(txt0,context.labels,context.metadata)
  match(attrsd.input) {
    Pre      -> context.fmtCode("", txt, attrsd) // todo: use sname as env name?
    Math     -> context.fmtMath(False,txt,attrsd)
    MathPre  -> context.fmtMath(False,txt.mathPre,attrsd)
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

// Format a citation link
function fmtCite(context : inlineContext, citations : list<cite>, attrs : attrs ) : string 
{  
  cs0 = match(attrs.hasKey("cite-style")) {
          Just(cstext) -> parseCiteStyle(cstext)
          Nothing      -> context.citestyle
        }
  cs1 = match(cs0.mode) {
          Auto -> match(citations) {
                    Cons(cite,_) | cite.authors != "" -> citeNatural
                    _  -> citeNumeric                      
                  }
          _ -> cs0
        }
  cs = if (attrs.hasClass("free")) then cs1(open="",close="") else cs1 

  isTextual = (attrs.hasClass("textual") || cs.mode.isTextual)

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
    links = cites.map(fun(cite){ makeLink(cite,cite.year) }).join(cs.yysep)
    plinks= if (isTextual && !(modifier.contains("-"))) then makeParens(links) else links
    sep   = if (isTextual) then "&nbsp;" else cs.aysep


    if (authors=="") {
      warning( "author-year citation but this bib style does not support this: " + 
              cites.map(fun(cite){ "@" + cite.name }).join(", "))
    }
    mid  = if (modifier=="!") 
             then authors
           elif (modifier=="-" || authors=="")
             then plinks
             else authors + sep + plinks 
    pre + mid + post
  }

  function fmtNumeric(cite : cite) {
    mid  = if (cite.modifier=="!") then cite.authors else makeLink(cite,cite.number)      
    cite.pre + mid + cite.post
  }

  function fmtNumericSpan( cite1 : cite, cite2 : cite ) : string {
    link1 = makeLink(cite1,cite1.number)
    link2 = makeLink(cite2,cite2.number)
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

  function fmtCompressed( cites : list<cite>, done : int = -1 ) : list<string> 
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
    scites = if (cs.sort) then cites.isort(gtCite) else cites
    match(cs.mode) {
      Natural -> fmtAuthorYears(scites)
      Textual -> fmtAuthorYears(scites)
      _ | isTextual -> fmtTextualNumerics(scites)
      _ -> fmtNumerics(scites)
    }
  }

  citeText = citations.fmtCitations.join(cs.citesep + @"\/")  // add \/ or nbsp's are inserted.
  pciteText = if (isTextual) then citeText else makeParens(citeText) 
  
  sciteText = match(cs.mode) {
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
  id = cap.groups[1].definitionId
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