/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Options from metadata
module optionsMeta

import std/log
import std/path
import common
import options

public function fromMeta( opts : options, mdata : metadata ) : options {
  //opts = opts0(metadata = opts0.metadata + mdata)
  mdata.foldl(opts) fun(options : options, kv : (string,string)) {
    val (key,xvalue) = kv
    options.update( key, xvalue, mdata )
  }
}

function update( options : options, key : string, xvalue : string, mdata : metadata ) : options {  
  val lvalue = xvalue.toLower
  val value = if (lvalue=="none" || lvalue=="clear" || lvalue=="false") then "" else xvalue
  val ivalue = value.parseInt.maybe(~1,id)

  //trace("from meta: " + key + "=" + value)
  if   (key=="title")  options(title=value)
  elif (key=="prelude") options(prelude=value)
  elif (key=="css")    options(css=if (value=="") then "" else options.css + ";" + value)
  elif (key=="html-meta")    options(htmlMeta=if (value=="") then "" else options.htmlMeta + ";" + value)
  elif (key=="script") options(scripts=if (value=="") then "" else options.scripts + ";" + value)
  elif (key=="script-") options(scriptsx=if (value=="") then "" else options.scriptsx + ";" + value)
  elif (key=="package")  options(packages=if (value=="") then "" else options.packages + ";" + value)
  elif (key=="package-")  options(packagesx=if (value=="") then "" else options.packagesx + ";" + value)
  elif (key=="toc-depth" && ivalue >= 0) options(tocDepth = ivalue)
  elif ((key=="heading-depth" || key=="header-depth") && ivalue >= 0) options(headingDepth = ivalue)
  elif ((key=="heading-base" || key=="header-base" || key=="base-header-level") && ivalue >= 0) options(headingBase = ivalue)
  elif (key=="document-class" || key=="doc-class") options(docClass=value)
  //elif (key=="bib" || key=="bibliography" || key=="bib-data") options(bib=if (value=="") then "" else options.bib + ";" + value)
  elif (key=="bib" || key=="bibliography" || key=="bib-data") {
    if (value!="") log("files", value.changeExt(".bib"))
    options(bib=if (value=="") then "" else options.bib + ";" + value);
  }
  elif (key=="bib-style" || key=="biblio-style" || key=="bibliography-style") {
    if (value.extname!="" || value.dirname!="") {
      log("files", if (value.extname=="") then value.changeExt(".bst") else value)
    }
    options(bibStyle=value)
  }
  elif (key=="mathjax-ext" || key=="mathjax-extension")  options(mjext=if (value=="") then "" else options.mjext + ";" + value)
  elif (key=="html-header") options(htmlHeader=if(value=="") then "" else options.htmlHeader.appendNL(value))
  elif (key=="css-header") options(cssHeader=if(value=="") then "" else options.cssHeader.appendNL(value))
  elif (key=="html-footer") options(htmlFooter=if(value=="") then "" else options.htmlFooter.appendNL(value))
  elif (key=="js-header") options(jsHeader=if(value=="") then "" else options.jsHeader.appendNL(value))
  elif (key=="js-footer") options(jsFooter=if(value=="") then "" else options.jsFooter.appendNL(value))
  elif (key=="tex-header") options(texHeader =if(value=="") then "" else options.texHeader.appendNL(value))
  elif (key=="tex-header-") options(texHeaderx =if(value=="") then "" else options.texHeaderx.appendNL(value))
  elif (key=="tex-footer") options(texFooter =if(value=="") then "" else options.texFooter.appendNL(value))
  elif (key=="tex-section-num") options(texSectionNum=(value!=""))
  elif (key=="fragment-start" || key=="extract-start") options(extractStart=xvalue)
  elif (key=="fragment-end" || key=="extract-end") options(extractEnd=xvalue)
  else {
    options.update2( key, lvalue, value, ivalue, mdata )
  }
}

function update2( options : options, key : string, lvalue : string, value : string, ivalue : int, mdata : metadata ) : options 
{
  if (key=="cite-style") options(citestyle=parseCiteStyle(lvalue))
  elif (key=="cite-all") options(citeAll=(value!="")) 
  elif (key=="math-mode") options.setMathMode(value)
  elif (key=="math-static" || key=="math-dir") options(mathImgDir = if (lvalue=="true") then "math" else value)
  elif (key=="math-scale") options(mathScale=ivalue)
  elif (key=="math-baseline") options(mathBaseline=ivalue)
  elif (key=="math-dpi") options(mathDpi=ivalue) 
  elif (key=="math-embed" || key=="math-embed-limit") options(mathEmbedLimit=if (value=="") then 0 elif (value=="true") then 1024 else (ivalue*1024))
  elif (key=="embed" || key=="embed-limit") options(embedLimit=if (value=="") then 0 elif (value=="true") then 1024 else (ivalue*1024))
  elif (key=="math-document-class" || key=="math-doc-class") options(mathDocClass=value)

  elif (key=="mathjax") then (if (value!="")
                               then options(mathmode=Dynamic, mathjax=(if (lvalue=="true") then "default" else value))
                               else options(mathmode=Static, mathjax=""))
  elif (key=="section-depth") options(sectionMax=ivalue)
  elif (key=="section-base") options(sectionBase=ivalue)
  elif (key=="highlight" || key=="colorize") options(highlight=if (value=="") then False else True)
  elif (key=="highlight-language" || key=="colorizer") options(hilitelang=if (value=="") then "" else options.hilitelang + ";" + value)
  elif (key=="rebuild") options(rebuild=(value != ""))
  elif (key=="star-bold") options(starBold=(value!=""))
  elif (key=="line-no") options(lineNo=ivalue)
  elif (key=="line-no-web") options(lineNoWeb = (lvalue=="true"))
  elif (key=="pretty-align") options(prettyAlign=ivalue)
  elif (key=="logo") options(logo=(lvalue=="true"))
  elif (key=="refer") { log("filesRefer",value); options }
  elif (key=="mode") options(modes = if (value=="") then "" else options.modes + ";" + lvalue)
  elif (key=="copy-styles") options(copyStyles=(value!=""))

  // can only set program options if not running in a sandbox
  elif (!(options.sandbox)) {
    if (key=="latex") options(latex=if (value=="") then "latex" else value)
    elif (key=="dvipng") options(dvipng=if (value=="") then "dvipng" else value)
    elif (key=="pdflatex" || key=="pdf-latex") options(pdflatex=if (lvalue=="true") then "default" else value)
    elif (key=="math-pdflatex" || key=="math-pdf-latex") options(mathpdflatex=if (lvalue=="true") then "default" else value)
    elif (key=="bibtex") options(bibtex=value)
    elif (key=="math-convert") options(mathconvert=value)
    elif (key=="convert") options(convert=value)
    elif (key=="ps2pdf") options(ps2pdf=value)
    elif (key=="dvips") options(dvips=value)
    else {
      options
    }
  }
  else {
    //  if (options.verbose >= 3) warning("custom metadata key: " + key)
    options
  }
}

function appendNL(s : string, t : string ) : string {
  if (s == "" || s.endsWith("\n")) then s + t else s + "\n" + t
}

function setMathMode( options : options, value : string ) : options {
  val nvalue = value.normalizeId
  if (nvalue=="static") then options(mathmode=Static)
  elif (nvalue=="dynamic" || nvalue=="mathjax") then options(mathmode=Dynamic)
  else {
    warning("unrecognized math mode: " + nvalue)
    options
  }
}


function appendValue( xs : list<string>, x : string, sep : string = "&br;" ) : list<string> {
  match(xs.reverse) {
    Nil -> [x]
    Cons(y,yy) -> if (y=="") then Cons(x,yy).reverse else Cons(y + sep + x,yy).reverse
  }
}