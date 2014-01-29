/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// The ":options" type and parsing of the command line
module options

import std/log
import std/env
import std/dict
import std/flags
import std/regex
import std/string
import std/path
import std/date
import common // just for parseAttrs

// Do not edit the version, it is set in the Jakefile from package.json
public val version = "0.3.2-beta" 

// Metadata is just a string to string map.
public alias metadata = list<(string,string)>
  
// The options
public struct options(
  bench    : bool = False, // turn off more expensive features for benchmarking
  verbose  : int  = 0,      // be more verbose
  pedantic : bool = False, // more pedantic list style mode
  sanitize : bool = False, // never output user defined html and attributes
  xmp      : bool = False, // only process markdown between xmp tags
  full     : maybe<bool> = Nothing, // generate a full html/latex file instead of a snippet
  tex      : bool = False,  // generate latex file too
  pdf      : bool = False,  // generate pdf file too 
  
  title    : string = "",  // html title 
  subtitle : string = "",  // sub title 
  css      : string = "madoko.css",  // link to css style
  scripts  : string = "",  // link to javascript file
  htmlHeader: string= "",  // literal html header
  htmlMeta : string = "name=\"viewport\" content=\"initial-scale=1.0\"",  // html meta tags
  texHeader: string= "",   // literal tex header
  texHeaderx: string= "",  // literal tex header in non-math mode only
  
  bibStyle : string = "",  // bibliography style file (.bst)
  bib      : string = "",  // bibliography definition files (.bib)
  
  packages : string = "madoko",  // link to latex packages (.sty)
  packagesx: string = "",        // packages in non-math mode only
  docClass : string = "book",    // latex document class (.cls)
  
  author   : string = "",
  affiliation: string = "",
  email    : string = "",

  citestyle     : citestyle = citeNumeric,     
  tocDepth      : int  = 3, // max. depth for inclusion in the table of contents
  headingDepth  : int  = 3, // default depth where headings are numbered
  headingBase   : int  = 1, // heading level for #
  sectionMax    : int  = 0, // maximal depth for adding sections (0 = disable)
  sectionBase   : int  = 1, // starting section level.
  
  mathmode      : mathmode = Static, // mode used to render math
  mathjax       : string = "",  // mathjax scripts path (use "-" for default path)
  mjext         : string = "",  // semicolon separated list of mathjax extensions
  
  mathImgDir    : string = "math",    // directory for static math images
  mathScale     : int    = 108,  // math scaling in percentage
  mathDpi       : int    = 300,  // math resolution 
  mathEmbedLimit: int = 1024, // maximal embedded image size  
  mathDocClass  : string = "[10pt]book",

  highlight     : bool = True,
  hilitelang    : string = "",  // semi-colon separated list

  latex         : string = "latex",
  dvipng        : string = "dvipng",
  pdflatex      : string = "",
  bibtex        : string = "bibtex",
  
  metadata      : metadata = [],
  mathdim       : dict<mathinfo> = dict(),
  mathconvert   : string = ""
);               

public struct commandOptions(
  showVersion : bool = False,
  outputDir   : string = "",
  installDir  : string = "",
  inputs      : list<string> = [],
  options     : options = Options()
);

function creq( f : (commandOptions,string) -> commandOptions, help : string ) : optionArg<commandOptions>
{
  Req(f,help)
}

function cflag( f : (commandOptions,bool) -> commandOptions ) : optionArg<commandOptions>
{
  Flag(f)
}

function oflag( f : (options,bool) -> options ) : optionArg<commandOptions>
{
  Flag(function(co:commandOptions,b:bool) { co(options = f(co.options,b)) })
}

function oreq( f : (options,string) -> options, help : string ) : optionArg<commandOptions>
{
  Req(function(co:commandOptions,v:string) { co(options = f(co.options,v)) },help) 
}

function setbench( o : options, b : bool ) {
  if (b) {
    o(tocDepth=0,bench=True)
  }
  else {
    o(tocDepth=3,bench=False)
  }
}

val optionsDesc : list<option<commandOptions>>
  = [ Option( "",  ["version"], cflag(fun(co,v) { co(showVersion = v) }),   "Display version information" ),
      Option( "v", ["verbose"], oflag(fun(o,v) { o(verbose = if (v) then o.verbose + 1 else 0) }),     "Be more verbose"),
      Option( "",  ["odir"],    creq(fun(co,s) { co(outputDir=s) },"DIR"), "Write output files to the specified directory" ),
      Option( "",  ["xmp"],     oflag(fun(o,v) { o(xmp = v) }),       "Only process markdown between <xmp> tags"),
      Option( "",  ["tex"],     oflag(fun(o,v) { o(tex = v) }),       "Output a LaTeX file too"),
      Option( "",  ["pdf"],     oflag(fun(o,v) { o(pdf = v, tex = if (v) then True else o.tex) }),        "Generate PDF using LaTeX"),      
      
      Option( "f", ["full"],     oflag(fun(o,v) { o(full=Just(v)) }), "Generate a full html/latex document"),
      Option( "",  ["sanitize"], oflag(fun(o,v) { o(sanitize = v) }), "Always escape or suppress user defined html"),
      Option( "",  ["pedantic"], oflag(fun(o,v) { o(pedantic = v) }), "Pedantic mode"),
      Option( "",  ["bench"],    oflag(setbench),                     "For benchmarking: turn off numbering, footnotes, etc."),
      Option( "",  ["installdir"], creq(fun(co,s) { co(installDir=s) },"DIR"), "Set installation directory explicitly"),

      Option( "",  ["bibtex"],   oreq(fun(o,v) { o(bibtex = v) },"CMD"),   "bibtex command"),
      Option( "",  ["pdflatex"], oreq(fun(o,v) { o(pdflatex = v)},"CMD"),  "pdflatex command"),
      Option( "",  ["dvipng"],   oreq(fun(o,v) { o(dvipng = v) },"CMD"),   "dvipng command (for math)"),
      Option( "",  ["latex"],    oreq(fun(o,v) { o(latex = v) },"CMD"),    "latex command (for math)"),            
    ]

// Parse the options from the command line given some extra arguments (default `""`).
public function parseOptions( extra : string = "") : io maybe<commandOptions>
{
  parseOptionList(env/arguments + extra.split(" ").list.filter(fun(s) { s != "" }))
}

public function parseOptionList( cmdargs  : list<string> ) : io maybe<commandOptions>
{
  header = "usage:\n madoko [options] files\n\noptions:"
  // testOptions.usageInfo( header ).println
  val (options,args,errs) = parse( CommandOptions(), optionsDesc, cmdargs )
  
  if (!(errs.isNil)) {
    println( errs.join("\n") + "\n" + optionsDesc.usageInfo(header) )    
    Nothing
  }
  elif (options.showVersion) {
    println( "Madoko, version " + version + ".")
    Nothing
  }
  elif (args.isNil) {
    optionsDesc.usageInfo(header).println
    Nothing
  }    
  else {
    Just(options(inputs = args).check())
  }
}

// sanitize options
function check( cmdOptions : commandOptions ) : io commandOptions 
{
  date = now()
  cmdOptions(installDir=if (cmdOptions.installDir=="") then programPath().dirname else cmdOptions.installDir,
             options=(cmdOptions.options)(metadata=cmdOptions.options.metadata + 
                                                   [("date",date.isoDate),("time",date.isoTime)]))
}


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
    else {
      //  if (options.verbose >= 3) warning("custom metadata key: " + key)
      options
    }
  }
}

// Mathematics rendering mode.
public type mathmode {
  Static  // latex generated images
  Dynamic // mathjax
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
  ( [ @"~Equation : label='[(@equation)]{.equation-label}' .align-center replace='[#label]{.equation-before}#nl~ Begin Math#nl#source#nl~ End Math#nl' tight .para-block",
      @"~Figure   : label='[@figure]{.figure-label}' .align-center html-elem=figure",
      @"~Figure   : after='#nl********* {.figureline}#nl[[**Figure\ #label.** ]\
                           {.caption-before}#caption]{.figure-caption html-elem=fig-caption}#nl{notag}#nl'",
      @"~Figure   : toc=tof toc-line='#label. #caption'",
      
      @"~Bibitem  : label='[@bibitem]{.bibitem-label}' cite-label='#label'",
      @"            before='[\[#label\]\ \ ]{.bibitem-before}' tight tex-elem=mdBibitem",

      @"~Bibliography : bibstyle='" + options.bibStyle + @"' bibdata='" + options.bib.splitPaths.join(",") + "' tex-elem=mdBibliography",
      
      @"~Article  : html-elem='article'",
      @"~Section  : html-elem='section' tex-elem='mdSection'",
      @"~Aside    : html-elem='aside'",
      @"~Nav      : html-elem='nav'",

      @"~Note     : .block before='[**Note**. ]{.note-before}#nl'",
      @"~Remark   : .block before='[**Remark**. ]{.remark-before}#nl'",
      @"~Proof    : .block before='[**Proof**. ]{.proof-before}#nl'",

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
      "before='[**" + prose + "\\ #label.** ]{." + name + "-before}'"
}

function heading( depth : int, headingDepth : int, tocDepth : int ) {
  label = list(1,depth).map( fun(d){ headingCounter(d) } ).join(".")
  num   = depth.show
  "~h" + num + ": " + 
    (if (depth > 1) then headingCounter(depth) else "") + 
    " label='[" + label + "]{.heading-label}'" +
    (if (depth > headingDepth) then "" else " before='[#label.&ensp;]{.heading-before}'") +
    (if (depth > tocDepth) then "" else " toc")    
}

// Generate a heading counter "headingCounter(2)" becomes "@h1-h2".
// The prefix "h1-" ensures this counter resets on "@h1" increments.
function headingCounter( depth : int) : string {
  "@" + list(1,depth).map( fun(i) { "h" + i.show } ).join("-")
}
