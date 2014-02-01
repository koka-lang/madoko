/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// The parsing of metadata
module metadata

import std/log
import std/dict
import std/regex
import std/string
import common
import options

// Parse the meta-data at the start of a document,
// and return updated options and the rest of the document
public function parseMeta( options0 : options, fmt : formatter, txt : string ) : (options, string) 
{
  val (mdata2,rest) = parsePlainMeta(txt, fmt, verbose=options0.verbose >= 4)
  options = options0.fromMeta(mdata2)
  mdata1  = if (options.bench || options.metadata.find(fun(kv){ kv.fst=="defaults" }).bool) then Nil 
             else parsePlainMeta(defaultMeta(options), fmt, verbose=options0.verbose >= 4).fst
  mdata = options.metadata + mdata1 + mdata2             
  (options(metadata = mdata),rest)  
}

public function fromMeta( opts : options, mdata : metadata ) : options {
  //opts = opts0(metadata = opts0.metadata + mdata)
  mdata.foldl(opts) fun(options : options, kv : (string,string)) {
    val (key,xvalue) = kv
    lvalue = xvalue.toLower
    value = if (lvalue=="none" || lvalue=="clear" || lvalue=="false") then "" else xvalue
    ivalue = value.parseInt.maybe(-1,id)

    //trace("from meta: " + key + "=" + value)
    if   (key=="title")  options(title=value)
    elif (key=="sub-title" || key=="subtitle")  options(subtitle=value)
    elif (key=="css")    options(css=if (value=="") then "" else options.css + ";" + value)
    elif (key=="html-meta")    options(htmlMeta=if (value=="") then "" else options.htmlMeta + ";" + value)
    elif (key=="script") options(scripts=if (value=="") then "" else options.scripts + ";" + value)
    elif (key=="package")  options(packages=if (value=="") then "" else options.packages + ";" + value)
    elif (key=="package-")  options(packagesx=if (value=="") then "" else options.packagesx + ";" + value)
    elif (key=="toc-depth" && ivalue >= 0) options(tocDepth = ivalue)
    elif ((key=="heading-depth" || key=="header-depth") && ivalue >= 0) options(headingDepth = ivalue)
    elif ((key=="heading-base" || key=="header-base" || key=="base-header-level") && ivalue >= 0) options(headingBase = ivalue)
    elif (key=="document-class" || key=="doc-class") options(docClass=value)
    elif (key=="bib" || key=="bibliography" || key=="bib-data") options(bib=if (value=="") then "" else options.bib + ";" + value)
    elif (key=="bib-style" || key=="biblio-style" || key=="bibliography-style") options(bibStyle=value)
    elif (key=="mathjax-ext" || key=="mathjax-extension")  options(mjext=if (value=="") then "" else options.mjext + ";" + value)
    elif (key=="html-header") options(htmlHeader=if(value=="") then "" else options.htmlHeader + "\n" + value)
    elif (key=="tex-header") options(texHeader =if(value=="") then "" else options.texHeader + "\n" + value)
    elif (key=="tex-header-") options(texHeaderx =if(value=="") then "" else options.texHeaderx + "\n" + value)
    elif (key=="author") {
      if (value=="") then options(author="") else {
        options(author=options.author + ";" + value, 
                affiliation=options.affiliation + ";", email=options.email + ";")
      }
    }
    elif (key=="affiliation" || key=="institute") options(affiliation=if (value=="") then "" else options.affiliation + value)
    elif (key=="email") options(email=if (value=="") then "" else options.email + value)    
    elif (key=="title-date") options(titleDate=value)
    elif (key=="cite-style") options(citestyle=parseCiteStyle(lvalue))
    elif (key=="cite-all" && value!="") { log("aux",@"\citation{*}"); options } 
    elif (key=="math-static" || key=="math-dir") options(mathImgDir = if (value=="true") then "math" else value)
    elif (key=="math-scale") options(mathScale=ivalue)
    elif (key=="math-dpi") options(mathDpi=ivalue) 
    elif (key=="math-embed" || key=="math-embed-limit") options(mathEmbedLimit=if (value=="") then 0 elif (value=="true") then 1024 else (ivalue*1024))
    elif (key=="latex") options(latex=if (value=="") then "latex" else value)
    elif (key=="dvipng") options(dvipng=if (value=="") then "dvipng" else value)
    elif (key=="math-document-class" || key=="math-doc-class") options(mathDocClass=value)
    elif (key=="pdflatex" || key=="pdf-latex") options(pdflatex=value)
    elif (key=="bibtex") options(bibtex=value)
    elif (key=="math-mode") options.setMathMode(value)
    elif (key=="math-convert") options(mathconvert=value)
    elif (key=="mathjax") then (if (value!="")
                                 then options(mathmode=Dynamic, mathjax=(if (lvalue=="true") then "-" else value))
                                 else options(mathmode=Static, mathjax=""))
    elif (key=="section-depth") options(sectionMax=ivalue)
    elif (key=="section-base") options(sectionBase=ivalue)
    elif (key=="highlight") options(highlight=if (value=="") then False else True)
    elif (key=="highlight-language") options(hilitelang=if (value=="") then "" else options.hilitelang + ";" + value)
    elif (key=="rebuild") options(rebuild=(value != ""))
    else {
      //  if (options.verbose >= 3) warning("custom metadata key: " + key)
      options
    }
  }
}

function setMathMode( options : options, value : string ) : options {
  nvalue = value.normalizeId
  if (nvalue=="static") then options(mathmode=Static)
  elif (nvalue=="dynamic" || nvalue=="mathjax") then options(mathmode=Dynamic)
  else {
    warning("unrecognized math mode: " + nvalue)
    options
  }
}


public function parsePlainMeta( txt : string, fmt : formatter, metadata : metadata = [], verbose : bool = False ) : (metadata,string) 
{
  match(txt.find(rxMeta)) {
    Nothing   -> {
      //if (metadata.isNil) trace("no metadata?: " + txt.substr(0,100))
      (metadata.reverse,txt)
    }
    Just(cap) -> {
      kvs = if (fmt.matchFmt(cap.groups[1])) then {
              value = cap.groups[4].joinLines.trim
              if (verbose) then trace("meta data:" + cap.groups[2] + ": " + value )
              if (cap.groups.matchedOn(3))
               then cap.groups[2].toLower.split(",").list.map(fun(k) { (k,value) })
               else [(cap.groups[2].normalizeId, value)]
            }
            else []
      parsePlainMeta( txt.substr1(cap.next), fmt, kvs + metadata, verbose )
    }
  }
} 
val rxMeta = regex(@"^"+ metaKey + @" *(.*(?:\n .*)*)(?:\n+(?=\n|" + metaKey + ")|$)")
val metaKey = @"(?:@(\w+) +)?((?:\w|([\.#~])(?=\S))[\w\-\.#~, ]*?\*?) *[:]"

function defaultMeta( options : options ) : string {
  ( [ @"~Equation : label='[(@equation)]{.equation-label}' .align-center replace='[&label;]{.equation-before}&nl;~ Begin Math { color=""&color;"" }&nl;&source;&nl;~ End Math&nl;' tight .para-block",
      @"~Figure   : label='[@figure]{.figure-label}' .align-center html-elem=figure",
      @"~Figure   : after='&nl;********* {.figureline}&nl;[[**Figure\ &label;.** ]\
                           {.caption-before}&caption;]{.figure-caption html-elem=fig-caption}&nl;{notag}&nl;'",
      @"~Figure   : toc=tof toc-line='&label;. &caption;'",
      
      @"~Bibitem  : label='[@bibitem]{.bibitem-label}' cite-label='&label;'",
      @"            before='[\[&label;\]\ \ ]{.bibitem-before}' tight tex-elem=mdBibitem",

      @"~Bibliography : bibstyle='" + options.bibStyle + @"' bibdata='" + options.bib.splitPaths.join(",") + "' tex-elem=mdBibliography",
      
      @"~Article  : html-elem='article'",
      @"~Section  : html-elem='section' tex-elem='mdSection'",
      @"~Aside    : html-elem='aside'",
      @"~Nav      : html-elem='nav'",

      @"~Note     : .block before='[**Note**. ]{.note-before}&nl;'",
      @"~Remark   : .block before='[**Remark**. ]{.remark-before}&nl;'",
      @"~Proof    : .block before='[**Proof**. ]{.proof-before}&nl;'",

      @"~Framed   : border-style=solid border-color=black border-width=1px",
      @"~Center   : .align-center",

      @"~Pre      : input=pre .para-block",
      @"~Code     : input=pre",
      @"~Hilite   : html-elem='pre'",
      @"~Hr       : .madoko",
      @"~Table    : .madoko",
      
      @"~Tex      : input=tex",
      @"~TexRaw   : input=texraw",
      @"~HtmlRaw  : input=htmlraw",
      @"~Math     : input=math .para-block",
      @"~MathPre  : input=mathpre .para-block",
      @"~MathDefs : input=mathdefs .hidden",
      @"~HtmlOnly : input=htmlonly",
      @"~TexOnly  : input=texonly",

      @"Madoko Version: " + version,
      @"Defaults  : True",

      theorem("Theorem"),
      theorem("Lemma"),
      theorem("Proposition"),
      theorem("Corollary"),
      theorem("Example"),
      theorem("Definition"),
    ] +
    list(1,6).map fun(d) { heading(d,options.headingDepth,options.tocDepth) }
    +
    ["\n"]
  ).join("\n")
}

function theorem( prose : string ) {
  name = prose.toLower
  "~" + prose + ": .block label='[@" + name + "]{." + name + "-label}' " +
      "before='[**" + prose + "\\ &label;.** ]{." + name + "-before}'"
}

function heading( depth : int, headingDepth : int, tocDepth : int ) {
  label = list(1,depth).map( fun(d){ headingCounter(d) } ).join(".")
  num   = depth.show
  "~h" + num + ": " + 
    (if (depth > 1) then headingCounter(depth) else "") + 
    " label='[" + label + "]{.heading-label}'" +
    (if (depth > headingDepth) then "" else " before='[&label;.&ensp;]{.heading-before}'") +
    (if (depth > tocDepth) then "" else " toc")    
}

// Generate a heading counter "headingCounter(2)" becomes "@h1-h2".
// The prefix "h1-" ensures this counter resets on "@h1" increments.
function headingCounter( depth : int) : string {
  "@" + list(1,depth).map( fun(i) { "h" + i.show } ).join("-")
}
