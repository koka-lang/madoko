/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// The ":options" type and parsing of the command line
module options

import std/env
import std/flags
import std/regex
import std/string
import std/path
import common // just for parseAttrs

// Do not edit the version, it is set in the Jakefile from package.json
public val version = "0.2.0-beta" 

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

  title    : string = "",  // html title 
  subtitle : string = "",  // sub title 
  css      : string = "madoko.css",  // link to css style
  scripts  : string = "",  // link to javascript file
  mathjax  : string = "",  // use mathjax to render math (use "-" for default path)
  htmlHeader: string= "",  // literal html header
  texHeader: string= "",  // literal tex header
  bibStyle : string = "",  // bibliography style file (.bst)
  bib      : string = "",  // bibliography definition files (.bib)
  packages : string = "madoko",  // link to latex packages (.sty)
  docClass : string = "book",  // latex document class (.cls)
  author   : string = "",
  affiliation: string = "",
  email    : string = "",
  citestyle: citestyle = Auto,   
  
  tocDepth     : int  = 3, // max. depth for inclusion in the table of contents
  headingDepth : int  = 3, // default depth where headings are numbered
  headingBase  : int  = 1, // heading level for #
  metadata  : metadata = []
);               

public struct commandOptions(
  showVersion: bool = False,
  outputDir : string = "",
  installDir: string = "",
  inputs    : list<string> = [],
  options   : options = Options()
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
      Option( "",  ["xmp"],     oflag(fun(o,v) { o(xmp = v) }),        "Only process markdown between <xmp> tags"),
      Option( "",  ["tex"],     oflag(fun(o,v) { o(tex = v) }),        "Output a LaTeX file too"),
            
      Option( "f", ["full"],     oflag(fun(o,v) { o(full=Just(v)) }),         "Generate a full html/latex document"),
      Option( "",  ["sanitize"], oflag(fun(o,v) { o(sanitize = v) }),   "Always escape or suppress user defined html"),
      Option( "",  ["pedantic"], oflag(fun(o,v) { o(pedantic = v) }),   "Pedantic mode"),
      Option( "",  ["bench"],    oflag(setbench),                       "For benchmarking: turn off numbering, footnotes, etc."),
      Option( "",  ["installdir"], creq(fun(co,s) { co(installDir=s) },"DIR"), "Set installation directory explicitly"),
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
  cmdOptions(installDir=if (cmdOptions.installDir=="") then programPath().dirname else cmdOptions.installDir )
}


// Parse the meta-data at the start of a document,
// and return updated options and the rest of the document
public function parseMeta( options0 : options, txt : string ) : (options, string) 
{
  val (mdata2,rest) = parsePlainMeta(txt, verbose=options0.verbose > 2)
  options = options0.fromMeta(mdata2)
  mdata1  = if (options0.metadata.isCons || options.bench) then Nil 
             else parsePlainMeta(defaultMeta(options), verbose=options0.verbose > 3).fst
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
    elif (key=="subtitle")  options(subtitle=value)
    elif (key=="css")    options(css=if (value=="") then "" else options.css + ";" + value)
    elif (key=="script") options(scripts=if (value=="") then "" else options.scripts + ";" + value)
    elif (key=="package")  options(packages=if (value=="") then "" else options.packages + ";" + value)
    elif (key=="toc-depth" && ivalue >= 0) options(tocDepth = ivalue)
    elif (key=="heading-depth" && ivalue >= 0) options(headingDepth = ivalue)
    elif (key=="heading-base" && ivalue >= 0) options(headingBase = ivalue)
    elif (key=="document-class" || key=="doc-class") options(docClass=value)
    elif (key=="bib" || key=="bibliography" || key=="bib-data") options(bib=if (value=="") then "" else options.bib + ";" + value)
    elif (key=="bib-style" || key=="biblio-style") options(bibStyle=value)
    elif (key=="mathjax") options(mathjax=(if (lvalue=="true") then "-" else value))
    elif (key=="html-header") options(htmlHeader = value)
    elif (key=="author") options(author=if (value=="") then "" else options.author + ";" + value)
    elif (key=="affiliation") options(affiliation=if (value=="") then "" else options.affiliation + ";" + value)
    elif (key=="email") options(email=if (value=="") then "" else options.email + ";" + value)    
    elif (key=="cite-style") options(citestyle=parseCiteStyle(lvalue))
    elif (key=="cite-all" && value!="") { log(@"\citation{*}"); options } 
    else options
  }
} 

function parseCiteStyle( s : string ) : citestyle {
  if (s=="numeric") then Numeric
  elif (s=="natural") then Natural
  elif (s=="naturalsq" || s=="square") then Square
  elif (s=="plain") then Plain
  elif (s=="super") then Super
  else Auto
}


public function parsePlainMeta( txt : string, metadata : metadata = [], verbose : bool = False ) : (metadata,string) 
{
  match(txt.find(rxMeta)) {
    Nothing   -> {
      //if (metadata.isNil) trace("no metadata?: " + txt.substr(0,100))
      (metadata.reverse,txt)
    }
    Just(cap) -> {
      value = cap.groups[3].trim
      kvs   = if (cap.groups.matchedOn(2))
               then cap.groups[1].toLower.split(",").list.map(fun(k) { (k,value) })
               else [(cap.groups[1].normalizeId, value)]
      if (verbose) then trace("meta data:" + cap.groups[1] + ": " + value )
      parsePlainMeta( txt.substr1(cap.next), kvs + metadata, verbose )
    }
  }
} 
val rxMeta = regex(@"^"+ metaKey + @" *(.+(?:\n .*)*)(?:\n+(?=\n|" + metaKey + ")|$)")
val metaKey = @"((?:\w|([\.#~])(?=\S))[\w\-\.#~, ]*?) *[:]"

function defaultMeta( options : options ) : string {
  ( [ @"~Equation : label='[(@equation)]{.equation-label}' .align-center replace='[#label]{.equation-before}#nl~~Math#nl#source#nl~~#nl' tight .para-block",
      @"~Figure   : label='[@figure]{.figure-label}' .align-center after='#nl********* {.figureline}#nl[[**Figure\ #label.** ]{.caption-before}#caption]{.figure-caption}#nl{notag}#nl'",
      @"~Figure   : toc=tof toc-line='#label. #caption' tight",
      
      @"~Bibitem  : label='[@bibitem]{.bibitem-label}' before='[\[#label\]\ \ ]{.bibitem-before}' tight texelem=mdBibitem",
      @"~Bibliography : bibstyle='" + options.bibStyle + @"' bibdata='" + options.bib.splitPaths.join(",") + "' texelem=mdBibliography",
      
      @"~Note     : .block before='[**Note**. ]{.note-before}'",
      @"~Remark   : .block before='[**Remark**. ]{.remark-before}'",
      @"~Proof    : .block before='[**Proof**. ]{.proof-before}'",

      @"~Framed   : border-style=solid border-color=black border-width=1px",
      @"~Center   : .align-center",

      @"~Pre      : input=pre .para-block",
      @"~Code     : input=pre",
      
      @"~Tex      : input=tex",
      @"~TexRaw   : input=texraw",
      @"~HtmlRaw  : input=htmlraw",
      @"~Math     : input=math .para-block",
      @"~MathPre  : input=mathpre .para-block",
      @"~MathDefs : input=mathdefs .hidden",
      @"~HtmlOnly : input=htmlonly",
      @"~TexOnly  : input=texonly",

      theorem("Theorem"),
      theorem("Lemma"),
      theorem("Proposition"),
      theorem("Corollary"),
      theorem("Example"),
      theorem("Definition"),
    ] +
    list(1,max(options.headingDepth,options.tocDepth)).map fun(d) { heading(d,options.headingDepth,options.tocDepth) }
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
    (if (depth > headingDepth) then "" else {
       (if (depth > 1) then headingCounter(depth) else "") + 
        " label='[" + label + "]{.heading-label}' before='[#label.\\ \\ \\ ]{.heading-before}'"
     }) +
    (if (depth > tocDepth) then "" else " toc")    
}

// Generate a heading counter "headingCounter(2)" becomes "@h1-h2".
// The prefix "h1-" ensures this counter resets on "@h1" increments.
function headingCounter( depth : int) : string {
  "@" + list(1,depth).map( fun(i) { "h" + i.show } ).join("-")
}
