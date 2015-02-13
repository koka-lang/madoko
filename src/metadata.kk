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
public function parseMeta( options0 : options, fmt : formatter, txt : string ) : div (options, string) 
{
  val (txt1,lineCount0) = stripInitialWhite(txt)
  val (mdata2,rest,lineCount) = parsePlainMeta(txt1, fmt, options0.modes, verbose=options0.verbose >= 4, lines=lineCount0 )
  val options1 = options0.fromMeta(mdata2)
  val mdataFull = if (options1.bench || options1.metadata.find(fun(kv){ kv.fst=="defaults" }).bool) 
    then options0.metadata + mdata2
    else { 
      val mdataDef  = parsePlainMeta(defaultMeta(options1,fmt), fmt, options1.modes, verbose=options1.verbose >= 4).fst      
      mdataDef + options0.metadata + mdata2
      //val options2  = options0.fromMeta(mdataFull)
      //options2( metadata = mdataFull)
    }
  val mdataModed = mdataFull.filterModed
  val options2 = options0.fromMeta(mdataModed)
  val options = options2( metadata = mdataModed )

  if (options.lineNo > 0)
   then (options(lineNo = options.lineNo + lineCount),rest)
   else (options,rest)  
}

function stripInitialWhite( txt : string ) : (string,int) {
  match(txt.find(rxInitialWhite)) {
    Nothing   -> (txt,0)
    Just(cap) -> (txt.substr(cap.next), txt.substr(0,cap.next).count("\n"))
  }
}
val rxInitialWhite = regex(@"^(\s|<!--[\s\S]*?-->)+")

function makeKey(k,pre,value,rawvalue,lines) {
  val kstart = k.substr(0,1) 
  val key = if (kstart=="#" || kstart=="." || kstart=="~") then k.trim.toLower else k.trim.normalizeId
  if (key=="tex-header" || key=="tex-footer" || key=="tex-header-")   
   then (pre + key,"%mdk-data-line={" + (lines+1).show + "}\n" + rawvalue )
   else (pre + key,value)
}                 

function parsePlainMeta( txt : string, fmt : formatter, modes : string, metadata : metadata = [], verbose : bool = False, lines : int = 0 ) : (metadata,string,int) 
{ 
  match(txt.find(rxMeta)) {
    Nothing   -> {
      //if (metadata.isNil) trace("no metadata?: " + txt.substr(0,100))
      (metadata.reverse,txt,lines)
    }
    Just(cap) -> {
      //val matchMode = if (cap.groups[1].startsWith("no")) 
      //                 then !fmt.matchFmt( cap.groups[1].substr(2), modes) 
      //                 else fmt.matchFmt( cap.groups[1], modes)      
      val value = cap.groups[4].joinLines.trim
      //if (verbose) then trace("meta data:" + cap.groups[3] + ": " + value )
      val rawkeys = if (cap.groups.matchedOn(3))
                      then cap.groups[2].split(",").list.map(trim)
                      else [cap.groups[2]]     
      val pre = if (cap.groups[1] != "") then "@" + cap.groups[1] + " " else ""
      val kvs = rawkeys.map( fun(k) { makeKey(k,pre,value,cap.groups[4],lines ) } );                
      val lines2 = txt.substr(0,cap.next).count("\n")
      parsePlainMeta( txt.substr1(cap.next), fmt, modes, kvs + metadata, verbose, lines+lines2 )
    }
  }
} 
val rxMeta = regex(@"^"+ metaKey + @" *(.*(?:\n .*)*)(?:\n+(?=\n|" + metaKey + ")|$)")
val metaKey = @"(?:@(\w+) +)?((?:\w|([\.#~])(?=\S))[\w\-\.#~, ]*?\*?) *[:]"

// --------------------------------------------------------------
// Complete author keys
// --------------------------------------------------------------

// fill out all the authorN keys
public function completeAuthorKeys( mdata : metadata ) : metadata {
  var authorCount := 0
  val authors = mdata.concat fun(kv) {
    val (key,value) = kv
    if (key=="author") {
      authorCount := authorCount+1
      [("author" + authorCount.show, value)]
    }
    elif (key=="affiliation" || key=="institute" || key=="address") {
      [("affiliation" + authorCount.show, value)]
    }
    elif (key=="email") {
      [("email" + authorCount.show, value)]
    }
    elif (key=="author-note") {
      [("author-note" + authorCount.show, value)]
    }
    else []
  }
  mdata + authors + [("author-count", authorCount.show )]
}

// --------------------------------------------------------------
// Filter moded keys
// --------------------------------------------------------------

public function filterModed( mdata :metadata ) : <div> metadata {
  val modes = mdict()
  mdata.map( fun(kv) {
    //trace("filter: " + kv.fst)
    match(modes.unMode(kv,mdata)) {
      Just(key) -> Just((key,kv.snd))
      Nothing   -> Nothing
    }
  }).concatMaybe
}


function unMode( modes : mdict<h,bool>, kv : (string,string), mdata : metadata ) : <div,st<h>> maybe<string> {
  match(kv.fst.find(rxModed)) {
    Nothing   -> Just(kv.fst) 
    Just(cap) -> {
      val neg  = cap.groups[1] == "no"
      val mode = cap.groups[2]
      val isTrue = (mode=="" || modes.getMode(mode,mdata))
      val keep = ((isTrue && !neg) || (!isTrue && neg))
      if (keep)
       then Just(cap.groups[3])
       else Nothing
     }
   }
}

function getMode( modes : mdict<h,bool>, mode : string, mdata : metadata ) : <div,st<h>> bool {
  match(modes[mode]) {
    Just(value) -> value
    Nothing -> {
      modes[mode] := False  // prevent infinite recursion
      val mbRes = mdata.reverse.foreachUntil( fun(kv) { 
        match( kv.fst.find(rxModed)) {
          Nothing   | kv.fst==mode -> Just(kv.snd) 
          Just(cap) | cap.groups[3] == mode -> {
            match(modes.unMode(kv,mdata)) { // may recurse
              Just(_) -> Just(kv.snd)
              Nothing -> Nothing
            }
          }
          _ -> Nothing
        }        
      })
      match(mbRes) {
        Just(raw) -> {
          val value = raw.trim.toLower
          val res = (value=="true" || value=="1")
          modes[mode] := res
          res        
        }
        Nothing     -> False
      }
    }
  }
}


val rxModed = regex(@"@(no)?(\w*) (.*)")


// --------------------------------------------------------------
// Default metadata
// --------------------------------------------------------------

function defaultMeta( options : options, fmt : formatter ) : string {
  ( [ fmt.showFormatter + ": True",
      @"~Equation    : label='[(@equation)]{.equation-label}' replace='[&label;]{.equation-before}&nl;~ Begin MathDisplay { color=""&color;"" math-needpdf=""&math-needpdf;"" line-adjust=0}&nl;&source;&nl;~ End MathDisplay&nl;' tight .para-block line-adjust=0",
      @"~Math        : replace='~ Begin MathDisplay { color=""&color;"" math-needpdf=""&math-needpdf;"" line-adjust=0}&nl;&source;&nl;~ End MathDisplay&nl;' tight .para-block",

      @"~TableFigure : label='[@tablefigure]{.table-label}' toc=tot .Floating float-env=table float-name=Table",
      @"~Figure      : label='[@figure]{.figure-label}' toc=tof .Floating float-env=figure float-name=Figure",
      
      @".Floating    : .align-center elem=floating html-elem=figure",
      @".Floating    : after='&nl;********* {.figureline}&nl;[[**&float-name;\ &label;.** ]{.caption-before}[&caption;]{.caption-text}]{.figure-caption html-elem=fig-caption}&nl;{notag}&nl;'",
      @".Floating    : toc-line='&label;. &caption;'",

      @"~SubFigureRow  : .columns .align-center",
      @"~SubFigure     : @SubFigure=lower-alpha label='@Figure@SubFigure' fig-label='(@SubFigure)' caption=''",
      @"           after='&br;[&toc-line;]{.subfig-caption}' tight text-align=center .column",
      @"          toc-line='[&fig-label; ]{.caption-before} &caption;'",
      @"          toc=tof toc-depth=2",

      
      @"~Bibitem  : label='[@bibitem]{.bibitem-label}' cite-label='&label;'",
      @"            before='[\[&label;\]\ \ ]{.bibitem-before}' tight tex-elem=mdBibitem",

      @"~Bibliography : bibstyle='" + options.bibStyle + @"' bibdata='" + options.bib.splitPaths.join(",") + "' tex-elem=mdBibliography",
      
      @"~Article  : html-elem='article'",
      @"~Section  : html-elem='section' tex-elem='mdSection'",
      @"~Aside    : html-elem='aside'",
      @"~Nav      : html-elem='nav'",

      @".Note     : .block before='[**[&caption;]{.note-caption}**. ]{.note-before}&nl;' caption='Note'",
      @"~Remark   : .Note caption='Remark'",
      @".Todo     : .Note caption='Todo'",
      @"~Proof    : .block before='[**Proof**. [&caption;]{.thm-caption}]{.proof-before}&nl;'",

      @".Framed   : border-style=solid border-color=black border-width=1px",
      @"~Center   : .align-center",
      @"~Remote   : tight margin-bottom=0pt",

      @"~Pre      : input=pre .para-block",
      @"~Code     : input=pre",
      @"~Hr       : .madoko",
      @"~Table    : .madoko",
      @"~Dd       : html-elem=dd tex-elem=mdDd margin-left=1.5em",
      @"~Dt       : html-elem=dt tex-elem=mdDt font-weight=bold",

      @".Ul-Li    : @ul-li label=""[(@ul-li)]{.ul-li-label}""",
      @".Ol-Li    : @ol-li label=""[(@ol-li)]{.ol-li-label}""",
      @".Dl-Li    : @dl-li label=""[(@dl-li)]{.dl-li-label}""",
      @"~Ol       : @ol-li=decimal",
      @"~Ul       : @ul-li=decimal",
      @"~Dl       : @dl-li=decimal",
      @".li-label : display=inline-block width=2.5em margin-left=-3em margin-right=0.5em text-align=right",
      
      @"~Tex        : input=tex notag",
      @".TexRaw     : input=texraw",
      @".HtmlRaw    : input=htmlraw",
      @".MathInline : input=math",
      @"~MathDisplay: input=math .para-block",
      @"~MathPre    : input=mathpre .para-block",
      @"~MathDefs   : input=mathdefs .hidden",
      @"~HtmlOnly   : input=htmlonly notag",
      @"~TexOnly    : input=texonly notag",
      @"~math-inline: input=math",
      @"~math-display: input=math",

      @"~Snippet  : input=math .block snippet-needpdf=true",
      @"~Footnote : label='[@footnote]{.footnote-label}'",
      @"            before='[\/^&label;.^ ]{.footnote-before}'",
      @"            after='&nl;[&#8617;](#back-&id;){.footnote-backref}' line-adjust=0",

      @"~FlushLeft : .align-left",
      @"~FlushRight: .align-right",
      @"~Comment   : .exclude",

      @"Madoko Version: " + version,
      @"Defaults  : True",

      @".booktable:  
          rule-top-width=2px rule-bottom-width=2px 
          rule-mid-width=1.35px thead-tr-font-weight=normal   
          rule-top-sep=4pt rule-bottom-sep=4pt rule-mid-sep=3pt 
          thead-tr-1-padding-top=3pt thead-tr-padding-bottom=3pt",
    
      @"~Bibitem: replace='?if &bib-search-url; && &searchterm;\
                          ?then &source; [&mglass;](http://&bib-search-url;/search?q=&searchterm;){.bibsearch}'",
      @"@html Bib Search Url: www.bing.com",
      @"lowline: &#x5F;",
      @"@tex lowline: &#0818;",
      @"qed         : [&box;]{float=right}",
      @"@tex qed    : [\qed]{input=texraw}",
      @"eg          : e.g.",
      @"ie          : i.e.",
      @"etal        : et al.",
      @"vfill       : \/",
      @"@tex vfill  : [\vfill]{input=texraw}",
      @"LogoLatex       : $\mbox{\LaTeX}$",
      @"LogoTex         : $\mbox{\TeX}$",
      @"LogoLatexe      : $\mbox{\LaTeXe}$",
      @"LogoBibtex      : $\mbox{\sc{Bib}\TeX}$",
      @"LogoAmstex      : $\mbox{\AmSTeX}$",

      @".noindent     : text-indent=0em",
      @"smallskip     : []{display=block margin-bottom=0.5em}",
      @"@tex smallskip: [\smallskip]{input=texraw}",
      @"medskip     : []{display=block margin-bottom=1em}",
      @"@tex medskip: [\medskip]{input=texraw}",
      @"bigskip     : []{display=block margin-bottom=2em}",
      @"@tex bigskip: [\bigskip]{input=texraw}",

      @"LogoMadoko: Created with [Madoko.net](https://www.madoko.net).",
      @".LogoMadoko: .block text-align=right font-size=xx-small margin-top=4em tight",

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
  ).join("\n") + metadataTitle
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


val metadataTitle : string = 
@"
@tex maketitle            : true

@maketitle ~Author        : display=inline-block .AuthorMaketitle
@maketitle ~TitleBlock    : display=inline-block .TitleBlockMaketitle
@maketitle ~TitleHeader,~Authors,~AuthorRow: notag
@maketitle ~Title         : replace=""[&source;]{ tex-elem=mdxTitle }"" notag
@maketitle ~Subtitle      : replace=""[&source;]{ tex-elem=mdxSubTitle }"" notag
@maketitle ~TitleNote     : replace=""[&source;]{ tex-elem=mdxTitleNote }"" notag
@maketitle ~TitleFooter   : replace=""[&source;]{ tex-elem=mdxTitleFooter }"" notag
@maketitle ~AuthorName    : replace=""[&source;]{ tex-elem=mdxAuthorName }"" notag
@maketitle ~AuthorAddress : replace=""[&source;]{ tex-elem=mdxAuthorAddress }"" notag
@maketitle ~AuthorNote    : replace=""[&source;]{ tex-elem=mdxAuthorNote }""  notag
@maketitle ~AuthorEmail   : replace=""[&source;]{ tex-elem=mdxAuthorEmail }"" notag

~TitleBlock,~TitleHeader  : tight
~Title,~Subtitle          : tight
~TitleNote,~TitleFooter   : tight  
~Authors,~AuthorRow,~Author: tight
~AuthorName,~AuthorAddress: tight
~AuthorEmail,~AuthorNote  : tight 

@nomaketitle ~TitleBlock,~TitleHeader,~Authors,~TitleFooter: .align-center
@nomaketitle ~TitleBlock,~Title,~Subtitle,~TitleNote:.para-block

@nomaketitle ~Authors     : width=80%
@nomaketitle ~AuthorRow   : .columns margin-top=2ex width=100% 
@nomaketitle ~Author      : .column text-align=center
@nomaketitle .AuthorEmail : .email

@nomaketitle ~Title       : font-size=xx-large font-weight=bold margin-bottom=0.5ex
@nomaketitle ~Subtitle    : font-size=x-large margin-bottom=0.5ex
@nomaketitle ~AuthorName  : font-size=large
@nomaketitle ~TitleFooter : margin-top=0.5ex
"