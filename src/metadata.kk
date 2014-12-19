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
import std/path
import common
import options
import optionsMeta

// Parse the meta-data at the start of a document,
// and return updated options and the rest of the document
public function parseMeta( options0 : options, fmt : formatter, txt : string ) : (options, string) 
{
  val (mdata2,rest,lineCount) = parsePlainMeta(txt, fmt, options0.modes, verbose=options0.verbose >= 4)
  val options1 = options0.fromMeta(mdata2)
  val options = if (options1.bench || options1.metadata.find(fun(kv){ kv.fst=="defaults" }).bool) 
    then options1(metadata = options1.metadata + mdata2) 
    else { 
      val mdataDef  = parsePlainMeta(defaultMeta(options1), fmt, options1.modes, verbose=options1.verbose >= 4).fst      
      val mdataFull = mdataDef + options0.metadata + mdata2
      val options2  = options0.fromMeta(mdataFull)
      options2( metadata = mdataFull)
    }

  if (options.lineNo > 0)
   then (options(lineNo = options.lineNo + lineCount),rest)
   else (options,rest)  
}




public function parsePlainMeta( txt : string, fmt : formatter, modes : string, metadata : metadata = [], verbose : bool = False, lines : int = 0 ) : (metadata,string,int) 
{
  match(txt.find(rxMeta)) {
    Nothing   -> {
      //if (metadata.isNil) trace("no metadata?: " + txt.substr(0,100))
      (metadata.reverse,txt,lines)
    }
    Just(cap) -> {
      val matchMode = if (cap.groups[1].startsWith("no")) 
                       then !fmt.matchFmt( cap.groups[1].substr(2), modes) 
                       else fmt.matchFmt( cap.groups[1], modes)      
      val kvs = if (matchMode) then {
                  val value = cap.groups[4].joinLines.trim
                  //if (verbose) then trace("meta data:" + cap.groups[3] + ": " + value )
                  if (cap.groups.matchedOn(3))
                   then cap.groups[2].toLower.split(",").list.map(fun(k) { (k.trim,value) })
                   else [(cap.groups[2].normalizeId, value)]
                }
                else []
      val lines2 = txt.substr(0,cap.next).count("\n")
      parsePlainMeta( txt.substr1(cap.next), fmt, modes, kvs + metadata, verbose, lines+lines2 )
    }
  }
} 
val rxMeta = regex(@"^"+ metaKey + @" *(.*(?:\n .*)*)(?:\n+(?=\n|" + metaKey + ")|$)")
val metaKey = @"(?:@(\w+) +)?((?:\w|([\.#~])(?=\S))[\w\-\.#~, ]*?\*?) *[:]"


function defaultMeta( options : options ) : string {
  ( [ @"~Equation : label='[(@equation)]{.equation-label}' .align-center replace='[&label;]{.equation-before}&nl;~ Begin Math { color=""&color;"" math-needpdf=""&math-needpdf;"" line-adjust=0 }&nl;&source;&nl;~ End Math&nl;' tight .para-block line-adjust=0",
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
      @"~Proof    : .block before='[**Proof**. [&caption;]{.thm-caption}]{.proof-before}&nl;'",

      @".Framed   : border-style=solid border-color=black border-width=1px",
      @"~Center   : .align-center",

      @"~Pre      : input=pre .para-block",
      @"~Code     : input=pre",
      @"~Hr       : .madoko",
      @"~Table    : .madoko",
      @"~Dd       : html-elem=dd tex-elem=mdDd margin-left=1.5em",
      @"~Dt       : html-elem=dt tex-elem=mdDt font-weight=bold",
      
      @"~Tex      : input=tex notag",
      @"~TexRaw   : input=texraw",
      @"~HtmlRaw  : input=htmlraw",
      @"~Math     : input=math .para-block",
      @"~MathPre  : input=mathpre .para-block",
      @"~MathDefs : input=mathdefs .hidden",
      @"~HtmlOnly : input=htmlonly notag",
      @"~TexOnly  : input=texonly notag",
      @"~math-inline: input=math",
      @"~math-display: input=math",

      @"~Snippet  : input=math .block snippet-needpdf=true",
      @"~Footnote : label='[@footnote]{.footnote-label}'",
      @"            before='[\/^&label;.^ ]{.footnote-before}'",
      @"            after='&nl;[&#8617;](#back-&id;){.footnote-backref}' line-adjust=0",

      @"Madoko Version: " + version,
      @"Defaults  : True",

      @".booktable:  
          rule-top-width=2px rule-bottom-width=2px 
          rule-mid-width=1.35px th-font-weight=normal   
          rule-top-sep=4pt rule-bottom-sep=4pt rule-mid-sep=3pt 
          th-padding-top=3pt th-padding-bottom=3pt",
    
      @"~Bibitem: replace='?if &bib-search-url; && &searchterm;\
                          ?then &source; [&mglass;](http://&bib-search-url;/search?q=&searchterm;){.bibsearch}'",
      @"@html Bib Search Url: www.bing.com",
      @"lowline: &#x5F;",
      @"@tex lowline: &#0818;",
      @"eg          : e.g.",
      @"ie          : i.e.",
      @"etal        : et al.",

      @"MadokoLogo: Created with [Madoko.net](https://www.madoko.net).",
      @".MadokoLogo: .block text-align=right font-size=xx-small margin-top=4em tight",

      @".thm-caption-content: font-style=italic",
      @"thm-caption-end     : &&;br;",
      @".thm-caption        : replace='?if &source; ?then ([&source;]{.thm-caption-content}).&thm-caption-end;'",
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
  val name = prose.toLower
  "~" + prose + ": .block label='[@" + name + "]{." + name + "-label}' " +
      "before='[**" + prose + "\\ &label;.** [&caption;]{.thm-caption}]{." + name + "-before}'"
}

function heading( depth : int, headingDepth : int, tocDepth : int ) {
  val label = list(1,depth).map( fun(d){ headingCounter(d) } ).join(".")
  val num   = depth.show
  ["~h" + num + ": ", 
   (if (depth > 1) then headingCounter(depth) else ""),
   " label='[" + label + "]{.heading-label}'",
   (if (depth > headingDepth) then "" else " before='[&label;.&ensp;]{.heading-before}'"),
   (if (depth > tocDepth) then "" else " toc")].join
}

// Generate a heading counter "headingCounter(2)" becomes "@h1-h2".
// The prefix "h1-" ensures this counter resets on "@h1" increments.
function headingCounter( depth : int) : string {
  "@" + list(1,depth).map( fun(i) { "h" + i.show } ).join("-")
}
