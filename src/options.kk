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
import common 

// Do not edit the version, it is set in the Jakefile from package.json
public val version = "0.8.3-beta" 

// Metadata is just a string to string map.
public alias metadata = list<(string,string)>


// Mathematics rendering mode.
public type mathmode {
  Static  // latex generated images
  Dynamic // mathjax
}
  
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
  rebuild  : bool = False,  // always rebuild bibtex, math etc.
  sandbox  : bool = False,  // run in a sandbox: only allow reading/writing from a subdirectory
  
  title    : string = "",  // html title 
  subtitle : string = "",  // sub title 
  css      : string = "madoko.css",  // link to css style
  scripts  : string = "",  // link to javascript file
  htmlHeader: string= "",  // literal html header
  htmlFooter: string= "",  // literal html footer
  htmlMeta : string = "name=\"viewport\" content=\"initial-scale=1.0\"",  // html meta tags
  texHeader: string= "",   // literal tex header
  texHeaderx: string= "",  // literal tex header in non-math mode only
  texFooter: string= "",   // literal tex footer 
  
  bibStyle : string = "",  // bibliography style file (.bst)
  bib      : string = "",  // bibliography definition files (.bib)
  
  packages : string = "madoko",  // link to latex packages (.sty)
  packagesx: string = "",        // packages in non-math mode only
  docClass : string = "",        // latex document class (.cls)
  
  author        : list<string> = [],
  affiliation   : list<string> = [],
  email         : list<string> = [],
  authorNotes   : list<string> = [],
  titleNote     : string = "",
  titleRunning  : string = "",
  authorRunning : string = "",

  citestyle     : citestyle = citeNumeric,     
  citeAll       : bool = False,
  tocDepth      : int  = 3, // max. depth for inclusion in the table of contents
  headingDepth  : int  = 3, // default depth where headings are numbered
  headingBase   : int  = 1, // heading level for #
  sectionMax    : int  = 0, // maximal depth for adding sections (0 = disable)
  sectionBase   : int  = 1, // starting section level.
  starBold      : bool = False, // use * for bold?
  prettyAlign   : int  = 2, // default alignment spaces for .pretty mode
  logo          : bool = True, // generate a logo at the end of the document
  modes         : string = "", // semi-colon separated modes for matching metadata keys (i.e. "preview")
  
  mathmode      : mathmode = Static,  // mode used to render math
  mathjax       : string = "",        // mathjax scripts path (use "default" for default path)
  mjext         : string = "",        // semicolon separated list of mathjax extensions
  
  mathImgDir    : string = "math",    // directory for static math images
  mathScale     : int    = 108,       // math scaling in percentage
  mathDpi       : int    = 300,       // math resolution 
  mathEmbedLimit: int    = 512*1024,  // maximal embedded math image size  
  mathDocClass  : string = "[10pt]book",
  
  highlight     : bool = True,
  hilitelang    : string = "",        // semi-colon separated list

  pdflatex      : string = "",        // defaults to 'xe' + latex cmd
  bibtex        : string = "bibtex",
  mathconvert   : string = "",        // if non-empty, use cmd to post process math images
  latex         : string = "latex",   // used to generate dvi for math
  dvipng        : string = "dvipng",  // used to extract png images for math
  
  mathpdflatex  : string = "default",        // if non-empty, used when pdf is needed for snippets. Use "default" for default program
  dvips         : string = "dvips",   // used with ps2pdf when mathpdflatex is empty
  ps2pdf        : string = "ps2pdf",
  convert       : string = "convert", // used to extract png's from pdf for math that needs it
  
  metadata      : metadata = [],
  mathdim       : dict<mathinfo> = dict(),  // static math dimension information
  embedinfos    : dict<embedinfo> = dict(),   // embed data, used in a browser
  embedLimit    : int = 512*1024,             // limit for embedding data (javascript, css, etc.)
  lineNo        : int = 1,                  // emit line no's. Use 0 to suppress.
  lineNoWeb     : bool = False,             // emit line no info in html pages. 
  copyStyles    : bool = True,              // copy standard style files
  lineMap       : lineMap = End,            // keep track of line numbers in include files      
  extractStart  : string = @"^(?:\/\/|--|[#%]) *BEGIN *: *(\w+) *$",
  extractEnd    : string = @"^(?:\/\/|--|[#%]) *END *(?:[:] *(\w+) *)?$"
);

public function getPdflatex( opts : options ) : string {
  if (opts.pdflatex != "" && opts.pdflatex != "default") then opts.pdflatex 
   else combine(opts.latex.dirname,"xe" + opts.latex.basename)
}               

public function getMathpdflatex( opts : options ) : string {
  if (opts.mathpdflatex != "default") then opts.mathpdflatex 
   else opts.getPdflatex
}               

public function getMathjax( opts : options ) : string {
  if (opts.mathjax != "default") then opts.mathjax
   else "https://c328740.ssl.cf1.rackcdn.com/mathjax/latest/MathJax.js?config=TeX-AMS-MML_HTMLorMML"
}

public struct commandOptions(
  showVersion : bool = False,
  convertTex  : bool = False,
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
  Flag(fun(co:commandOptions,b:bool) { co(options = f(co.options,b)) })
}

function oreq( f : (options,string) -> options, help : string ) : optionArg<commandOptions>
{
  Req(fun(co:commandOptions,v:string) { co(options = f(co.options,v)) },help) 
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
      Option( "",  ["tex"],     oflag(fun(o,v) { o(tex = v) }),       "Generate a LaTeX file too"),
      Option( "",  ["pdf"],     oflag(fun(o,v) { o(pdf = v, tex = if (v) then True else o.tex) }),        "Generate PDF using LaTeX"),      
      Option( "",  ["convert-tex"], cflag(fun(co,v) { co(convertTex=v) }), "Convert input from TeX to Markdown"),
      
      Option( "f", ["fragment"], oflag(fun(o,v) { o(full=Just(!v)) }), "Generate a fragment instead of a full document"),
      Option( "",  ["logo"],     oflag(fun(o,v) { o(logo=v) }),        "Generate a logo at the end of the document" ),
      Option( "",  ["sanitize"], oflag(fun(o,v) { o(sanitize = v) }), "Always escape or suppress user defined html"),
      Option( "" , ["sandbox"],  oflag(fun(o,v) { o(sandbox=v) }),    "Run in a sandbox for secure server execution"),
      Option( "",  ["pedantic"], oflag(fun(o,v) { o(pedantic = v) }), "Pedantic mode"),
      Option( "",  ["bench"],    oflag(setbench),                     "For benchmarking: turn off numbering, etc."),
      Option( "",  ["installdir"], creq(fun(co,s) { co(installDir=s) },"DIR"), "Set installation directory explicitly"),
      Option( "r", ["rebuild"],  oflag(fun(o,v) { o(rebuild=v) }),    "Force rebuild bibliography, math, etc."),

      Option( "m", ["meta"],     oreq(setMeta, "key:val"), "Semi-colon separated list of metadata values")
    ]

function setMeta( opts0 : options, value : string ) : options {
  val keyvals = value.split(";").list
  keyvals.foldl(opts0) fun(opts : options,keyval) {
    val i = keyval.indexOf(":")
    if (i > 0) {
      val key = keyval.substr(0,i).trim
      val s   = keyval.substr(i+1).trim
      opts(metadata = opts.metadata + [(key,s)] )
    }
    else {
      warning("illegal --meta option: " + value)
      opts
    }    
  }
}

// Parse the options from the command line given some extra arguments (default `""`).
public function parseOptions( extra : string = "") : io maybe<commandOptions>
{
  parseOptionList(env/arguments + extra.split(" ").list.filter(fun(s) { s != "" }))
}

public function parseOptionList( cmdargs  : list<string> ) : io maybe<commandOptions>
{
  // testOptions.usageInfo( header ).println
  val (options,args,errs) = parse( CommandOptions(), optionsDesc, cmdargs )
  
  if (!(errs.isNil)) {
    println( errs.join("\n") + "\n" + fullUsageInfo() )    
    Nothing
  }
  elif (options.showVersion) {
    println( "Madoko, version " + version + ".")
    Nothing
  }
  elif (args.isNil) {
    fullUsageInfo().println
    Nothing
  }    
  else {
    Just(options(inputs = args).check())
  }
}

function fullUsageInfo() {
  val header = "usage:\n madoko [options] files\n\noptions:"
  optionsDesc.usageInfo(header) + "\n\nPrefix a flag with 'no-' to negate it. For example '--no-logo'."
}

// sanitize options
function check( cmdOptions : commandOptions ) : io commandOptions 
{
  cmdOptions(installDir=if (cmdOptions.installDir=="") then programPath().dirname else cmdOptions.installDir)
}


public function getDocName( opts : options ) : string {
  match(opts.metadata.find(fun(kv) { kv.fst == "docname" })) {
    Just(kv) -> kv.snd + ": "
    Nothing  -> ""
  }
}

function cutoff( s : string, n : int ) : string {
  if (n<=1) return s
  s.lines.map(fun(line) { 
    if (line.length >= n) then line.substr(0,n-1) + "\n" + line.substr(n-1) else line
  }).unlines
}

public function indent( opts : options, s : string ) : string {
  s.cutoff(78).lines.map(fun(line) { "  " + line }).unlines
}

public function print( opts :options, msg : string, level : int = 1  ) {
  if (opts.verbose >= level) println(opts.indent(opts.getDocName + msg))
}

public function printErr( opts :options, msg : string, level : int = 0  ) {
  if (opts.verbose >= level) println(opts.indent(msg))
}
