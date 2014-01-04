/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// The parsing and formatting of _inline_ elements (i.e. emphasis, links, etc.)
module formatInline

import std/dict
import std/string
import std/regex
import common
import attributes
import inline
import htmlFormatter
import texFormatter

/* --------------------------------------
  Inline grammar 
---------------------------------------- */
alias inlineRule = rule<string,inlineContext>

val normal       = @"(?:[^`*_\\~&<>\^#\$""'\[!\-\. ]| (?! \n| *\[)|-(?!-)|\.(?!\.\.)|!(?!\[))"
val normalbench  = @"(?:[^""'`*_\\~&<>\^#\$\[!]| (?! \n))"

val attrs    = @"\{:?((?:[^\}\n]|\\\})*)\}"
val linkhref = @"\s*<?([^\s>)]*)>?(?:\s+['""](.*?)['""])?\s*"
val linkid   = @"((?:[^\[\]\n]|\[[^\]\n]*\])*)"
val linktxt  = @"\[(?!\^)((?:\[(?:[^\[\]]|\[[^\]]*\])*\]|\\.|[^\\\]]|\](?=[^\[{]*\]))*)\]"
val linkreg  = linktxt + @"((?:\(" + linkhref + @"\)|\s*\[" + linkid + @"\])?(?:" + attrs + @")?)"

function inlineCoreGrammar( fmt : formatter ) : grammar<string,inlineContext> = [
  Rule("itext",     regex(@"^" + normal + "+"), inlineNormal ),

  Rule("iquotes",   regex(@"^(?:'((?:[^\\']|\\.)*)'|""((?:[^\\""]|\\.)*)"")"), inlineQuotes ),
  Rule("icode",     regex(@"^(`+)((?:[^`]|(?!\1)`)*)\1(?:" + attrs + ")?"), inlineCode ),
  Rule("ilink",     regex(@"^( *)" + linkreg), inlineLink ),
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
  Rule("ientity",   regex(@"^&#?\w+;"), inlineNormal ),
  Rule("ilabel",    regex(@"^(#[\w\-:]+);?"), inlineLabel ),
  
  Rule("idashes",   regex(@"^--(-)?"), inlineDashes ),
  Rule("ielipsis",  regex(@"^\.\.\."), inlineDots ),
  
  Rule("texinline", regex(@"^\$((?:[^\\\$]|\\.)+)\$"), inlineMath ),
  Rule("texblock1", regex(@"^\$\$( *\n(?:[^\\\$]|\\.|\$[^\$])*)\$\$]"), inlineMathBlock ),
  Rule("texblock2", regex(@"^\\\[( *\n(?:[^\\]|\\[^\]])*)\\\]"), inlineMathBlock ),
  
  Rule("ibr",       regex(@"^  \n(?!\s*$)"), inlineBreak ),  
  Rule("iescape",   regex(@"^\\([ \n\\`*{}\[\]()#+\-.!_<>~\|/\$'""\?])"), inlineEscape ),

  Rule("other",     regex(@"^[\s\S]"), inlineOther ),
]

val benchGrammar 
  = inlineCoreGrammar(FmtHtml).stripFancyRules

function stripFancyRules( g : grammar<string,inlineContext> ) : grammar<string,inlineContext> {
  g.ruleReplace(True, Rule("itext", regex("^" + normalbench + "+"), inlineNormal ))
   .ruleReplace(True, Rule("iquotes", regex(@"^[""']"), inlineQuot ))
   .ruleRemove(True,["idashes","ielipsis","tex","iguil"])
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
                               citestyle : citestyle = Auto,
                               sanitize : bool = False,
                               bench: bool = False,
                               verbose : int = 0 ) : inlineContext
{
  InlineContext( inlineGrammar(fmt,bench), dict(), dict(), dict(), dict(),
                 metadata, citestyle, sanitize, bench, verbose,
                 fmt.pick(fmtHtmlCmd,fmtTexCmd), 
                 fmt.pick(fmtHtmlEscape,fmtTexEscape), 
                 fmt.pick(fmtHtmlLink,fmtTexLink), 
                 fmt.pick(fmtHtmlFootnote,fmtTexFootnote),
                 fmt.pick(fmtHtmlTitle,fmtTexTitle),
                 fmt.pick(fmtHtmlTable,fmtTexTable),
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

function inlineNormal( cap : matched, context : inlineContext ) : string {
  context.fmtText(cap.matched)
} 

function inlineMath( cap : matched, context : inlineContext ) : string {
  context.fmtMath(cap.groups[1])
}

function inlineMathBlock( cap : matched, context : inlineContext ) : string {
  context.fmtMathBlock(cap.groups[1])
}

function fmtMath( context : inlineContext, txt : string, attrs : attrs = attrsNone ) : string {
  //ptxt = if (attrs.hasClass("mathpre")) then mathPre(txt) else txt
  mtxt = "$" + txt + "$"
  match(context.fmt) {
    FmtTex -> mtxt 
    _      -> context.fmtText(mtxt)
  }
} 

function fmtMathBlock( context : inlineContext, txt : string ) : string {
  mtxt = "\\[" + txt + "\\]"
  match(context.fmt) {
    FmtTex -> mtxt 
    _      -> context.fmtText(mtxt)
  }
} 

function inlineQuot( cap : matched, context ) : string {
  context.fmtText(if (cap.matched=="\"") then "&quot;" else "&#39;")
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
   then context.fmtCode("code",txt,attrs)
   else context.fmtSpan( txt, attrs(classes=["code"] + attrs.classes) ) // can be overridden by the user
}

function fmtCode( context : inlineContext, tag : string, txt : string, attrs : attrs = attrsNone) : string {
  match(context.fmt) {
    FmtHtml -> context.fmtCmd(tag, context.fmtEscapePre(txt), attrs)  
    FmtTex  -> if (attrs.hasClass("plain"))
                then context.fmtCmd("verb", context.fmtText(txt), attrs )
                else context.fmtCmd(tag, txt.escapeTexPre, attrs )
  }
}

function escapeTexPre( txt : string ) : string {
  txt.replaceAll(regex(@"\$"),@"$\text{\tt\textdollar}$")
     .replaceAll(regex(@"\|"),@"$\text{\tt\textbar}$")
}

function inlineDashes( cap : matched, context ) : string {
  context.fmtText(if (cap.groups[1] != "") then "&mdash;" else "&ndash;")
}


function inlineQuotes( cap : matched, context : inlineContext ) : string {
  quote = cap.matched.substr(0,1)
  if (quote == "'") 
   then context.fmtText("&lsquo;") + context.formatInline(cap.groups[1]) + context.fmtText("&rsquo;")
  elif (quote=="<")
   then context.fmtText("&laquo;") + context.formatInline(cap.groups[1]) + context.fmtText("&raquo;")
   else context.fmtText("&ldquo;") + context.formatInline(cap.groups[2]) + context.fmtText("&rdquo;")
}

function inlineDots( cap : matched, context ) : string {
  context.fmtText("&hellip;")
}

function inlineOther( cap : matched, context ) : string {
  //trace("other: " + cap.matched)
  context.fmtEscape(cap.matched)
}

function inlineEscape( cap : matched, context : inlineContext ) : string {
  txt = cap.groups[1]
  if (txt==" ") then context.fmtText("&nbsp;")
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

function inlineLabel( cap : matched, context : inlineContext ) : string {
  key = cap.groups[1].definitionId
  //trace("inlineLabel: " + key )
  match(context.labels[key]) {
    Nothing   -> {
      //trace("warning: missing anchor: " + cap.groups[1])
      context.fmtText(cap.matched)
    }
    Just(lab) -> formatInline(context,lab.labelText)
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
  attrs = if (cap.groups.matchedOn(7)) then context.formatAttrs(cap.groups[7].parseAttrs) else attrsNone
  nbsp = if (cap.groups[1]==" ") then context.fmtText("&nbsp;") else cap.groups[1]
  if (cap.groups.matchedOn(4)) {
    // direct url link:  [text](url title){attrs}
    nbsp + context.fmtLink(isImage, newLink(cap.groups[4],cap.groups[5],attrs,bench=context.bench), 
                               context.formatInline(cap.groups[2]))
  }
  elif (context.bench || cap.groups.matchedOn(6)) {
    // [text][ref]{attrs} 
    inlineLinkRef(isImage, nbsp, cap.groups[2], cap.groups[3], cap.groups[6], attrs, context )
  }
  else {
    // [text]{attrs}
    inlineLinkNoRef(isImage, nbsp, cap.groups[2], cap.groups[3], attrs, context)
  }
}

function inlineLinkNoRef( isImage:bool, nbsp : string, txt : string, after : string, attrs : attrs, context : inlineContext ) : string 
{
  citations = if (context.bench) then Nil  
               else txt.split(rxCommaSep).list.map(fun(elem) {
                      val (l,desc) = match (elem.find(rxCitation)) {
                                        Nothing -> (elem,"")
                                        Just(cap) -> (cap.groups[1],cap.groups[2])
                                     }
                      lab = l.definitionId 
                      match(context.labels[lab]) {
                        Just(lbl) | lbl.element == "bibitem" -> (lab,desc)
                        Nothing | l.startsWith("#") -> {
                          trace("warning: missing anchor or citation: " + l )
                          log("\\citation{" + l.substr(1) + "}")
                          ("","")
                        } 
                        _ -> ("","")
                      }
                    })
  //trace("citations: " + citations.join("-")) 
  if (citations.isCons && citations.all(fun(s){ s.fst != ""})) {
    // Citations link
    citations.foreach fun(cite) { log("\\citation{" + cite.fst.substr(1) + "}") }
    cattrs = attrs.addKeyval("target-element","bibitem")
    nbsp + context.fmtCite(citations,cattrs)
  } 
  else {
    inlineLinkRef( isImage, nbsp, txt, after, "", attrs, context )
  }
}
val rxCommaSep = regex(@"\s*[;,]\s*(?=#)")
val rxCitation = regex(@"^(#[\w-:]+)([\s\S]*)$")

function inlineLinkRef( isImage : bool, nbsp : string, txt : string, after : string, ref : string, 
                          attrs : attrs, context : inlineContext ) : string 
{    
  id = if (ref != "") then ref.definitionId else txt.definitionId
  match(context.links[id]) {
    Just(link) -> {
      xlink = if (attrs.empty) then link else link( linkattrs = attrs.mergeDefault(link.linkattrs) )
      nbsp + context.fmtLink(isImage, xlink, context.formatInline(txt))         
    }
    Nothing -> {
      // Link not found! Try if it is a label
      match(context.labels[id]) {
        Just(lab) -> {
          // Label reference
          lattrs = attrs.addKeyval("target-element",lab.element)
          llink  = newLink(id,"",lattrs,bench=context.bench)
          nbsp + context.fmtLink(isImage,llink,context.formatInline(txt)) 
        }      
        Nothing -> {
          space = if (nbsp=="") then "" else " "
          if (ref != "") then {            
            trace("warning: missing link definition: " + ref)
            space + context.formatInline(txt) + "[??]"
          }
          elif (!(attrs.empty)) {
            // Span element
            space + context.fmtSpan(txt,attrs)
          }
          else {
            // warn if there are no spaces or commas
            if (txt.contains(rxCanBeRef)) {
              trace("warning: possibly missing link definition: " + txt)
            }
            // just brackets
            space + "[" + formatInline(context,txt) + "]" + formatInline(context,after)
          }
        }
      }
    }
  }
}

val rxNotRef = regex(@"[\s,;]")
val rxCanBeRef = regex(@"^[A-Za-z_]\w*$")

// Format a span element
function fmtSpan( context : inlineContext, txt0 : string, attrs : attrs ) : string {
  sname   = if (attrs.elem != "") then attrs.elem
            else match (attrs.classes) {
              Cons(cname,_) -> cname
              _             -> "span"
            } //attrs.elementName("span")
  attrsd  = if (!(attrs.defaults)) then attrs 
             else context.defaults.matchRules(sname,attrs)

  txt = attrsd.transformText(txt0,context.metadata)
  match(attrsd.input) {
    Pre      -> context.fmtCode(sname, txt, attrs)
    Math     -> context.fmtMath(txt,attrsd)
    MathPre  -> context.fmtMath(txt.mathPre,attrsd)
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
function fmtCite(context : inlineContext, citations : list<(string,string)>, attrs : attrs ) : string {
  var isNum := True
  cs = context.citestyle
  citeTexts = citations.map fun(cite) {
    id = cite.fst
    match(context.labels[id]) {
      Nothing   -> id
      Just(lab) -> {
        if (!(lab.labelText.contains(rxNumCite))) then isNum := False
        match(lab.labelText.find(rxAuthorYear)) {
          Just(cap) -> { 
             if (attrs.hasClass("short")) then cap.groups[2]
             elif (attrs.hasClass("textual")) 
              then (if (attrs.hasClass("long")) then cap.groups[3] else cap.groups[1]) + 
                   (if (!(cs.isNatural || (cs.isAuto && !(isNum)))) 
                     then @"\ [" + cap.groups[2] + "]" else @"\ (" + cap.groups[2] + ")")
             elif (attrs.hasClass("long") && cap.groups[3] != "") then cap.groups[3] + @",\ " + cap.groups[2]
             else cap.groups[1] + @",\ " + cap.groups[2]
           }
          Nothing   -> lab.labelText
        }
      }
    }
  }
  //trace("cites: " + cites.join(","))
  links = zipWith(citations,citeTexts) fun(cite,citeText) {
            context.fmtLink(False,newLink(cite.fst,"",attrs.addClass("bibref"),bench=context.bench),
                                context.formatInline(citeText.replaceAll(rxEtAl,@"_et\ al_.")))
             + context.formatInline(cite.snd)
          }
  txt = if (((cs.isAuto && !(isNum)) || cs.isNatural || cs.isSquare) && attrs.hasClass("textual")) then links.join("; ")
        elif (cs.isNatural || (cs.isAuto && !isNum)) then "(" + links.join("; ") + ")"
        elif (cs.isSquare || cs.isNumeric) then "[" + links.join("; ") + "]"
        elif (cs.isSuper) then context.fmtCmd("sup", links.join(", "))
        else "[" + links.join(", ") + "]"
  context.fmtCmd("span", txt, attrs.addClass("citations"))
}

val rxAuthorYear = regex(@"(.*?)(?:[,;](?: |&nbsp;|\\ )*\(?|(?: |&nbsp;|\\ )*\(?)(\d\d\d\d[A-Za-z]?)\)?(?: *[,;] *)?(.*)$")
val rxNumCite    = regex(@"^[^\w]*\w*\d+")
val rxEtAl       = regex(@"\bet(?: |&nbsp;|\\ )al.(?!_)") 


// Format attributes
function formatAttrs( context : inlineContext, attrs : attrs ) : attrs {
  attrs( label = context.formatInline(attrs.label) )
}

function inlineFootnote( cap : matched, context : inlineContext ) : string {
  id = cap.groups[1].definitionId
  match( context.footnotes[id] ) {
    Just(fn) -> context.fmtFootnote(id,fn)      
    Nothing -> {
      trace("warning: missing footnote definition: " + cap.groups[1])
      context.fmtText("[^" + formatInline(context,cap.groups[1]) + "]") // leave as plain text?
    }
  }
}

