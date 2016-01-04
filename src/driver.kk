/*---------------------------------------------------------------------------
  Copyright 2013-2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Main Madoko driver: provides files etc. and calls madoko.markdown
module driver

import std/log
import std/regex
import std/path
import std/dict
import std/date
import std/string
import std/crypto
import common
import options
import metadata
import madoko
import block    // for lineMap
import storage
import hilite
import mathParse
import mathStatic
import texParser
import includes
import runcsl

public struct runners(
  runPdfLatex : ( srcFile : string, texFile : string, opts : options, content : string, continue : () -> io () ) -> io (),
  runBibtex : ( bibFiles : list<string>, opts : options, continue : bool -> io ()) -> io (),
  runMathStatic : runMathStaticFun
)

public function processContent( inName : string, outName : string, content : string, 
                          opts : commandOptions, firstTime : bool = False,
                          runners : runners,
                          continue : (output:string,inputName:string,outputName:string,options:options) -> io () ) : io () 
{
  if (opts.options.sandbox) enforceSandbox()
  if (opts.convertTex) {
    val output = content.parseTex(ignore=False)
    writeTextFileSync(outName,output)
    return continue( output, inName, outName, opts.options );
  }

  val styleDir = opts.installDir + "/../styles"
  val searchDirs = [inName.dirname,outName.dirname,styleDir]
  content.include(False, inName, outName, searchDirs, opts.options) fun(icontent0,lmap) {
    // remove madoko comments
    val icontent = icontent0.removeMadokoComments
    // set up options
    val opts0  = if (inName.endsWith(".xmp.html") || inName.endsWith(".xmp"))
                  then (opts.options)(xmp = True) else opts.options
               
    val date   = now()                             
    val opts1  = opts0(lineMap=lmap, 
                       processTimeout=if (opts0.sandbox) then 60000 else opts0.processTimeout,
                       metadata=opts0.metadata 
                       + [("docname",inName.stemname),("filename",inName)]
                       + [("madoko-version",opts0.version)]
                       + [("date",date.isoLocalDate),("time",date.isoLocalTime.substr(0,5)),
                          ("year",date.year.show),("month",date.month.show2),("day",date.day.show2),
                          ("hours",date.hours.show2),("minutes",date.minutes.show2),("seconds",date.seconds.show2)] )

    // extract default cite-style if it exists
    val opts2  = opts1.extractCitestyle(outName)

    val mmopts = if (opts2.xmp) then opts2 // todo: look at first <xmp> fragment?
                  else opts2.parseMeta( FmtHtml, icontent.normalizeSource ).fst  // get bibdata,bibstyle,mathimg

    // always read dims: even in dynamic mode some pdf math may exist
    val dims = if (mmopts.rebuild) then "" else outName.changeExt(".dimx").readTextFileDef("",True)
    val (mdim,svgdefs,_) = dims.parseMathDim(mmopts.math)

    val xopts  = opts2(math=(opts2.math)(dim=mdim,svgDefs=svgdefs))
    val mopts  = mmopts(math=(mmopts.math)(dim=mdim,svgDefs=svgdefs))

    // register languages for highlighting
    registerColorizers(mopts, searchDirs, icontent);

    // copy early since async latex may start for math
    if (mopts.copyStyles) { // && !(xopts.sandbox) // allow even in sandbox
      if (mopts.embedLimit < 16*1024) {  // only copy standard css style if it will not be embedded
        tryCopyTextFileFromNoSandboxTo( "madoko.css", styleDir, outName.dirname )
      }
      if (xopts.tex || mopts.math.mode.isStatic) { // only copy style files if generating tex or if math is static
        val isTex2  = match(mopts.metadata.find( fun(md) { md.fst == "tex2" } )) {
                        Just(md) -> md.snd.toLower == "true"  
                        _ -> False
                      }
        val files = if (isTex2)
                     then ["ellipse.sty","options.sty","longbox.sty","longfbox.sty","madoko2.sty"]
                     else ["css.sty","madoko.sty"]                      
        files.foreach fun(fname) { 
          tryCopyTextFileFromNoSandboxTo(fname, styleDir, outName.dirname )
        }
      }
    }

    process( inName, outName, searchDirs, content, icontent, xopts, mopts, firstTime, runners) 
      fun() {
        processContent(inName,outName,content,opts,False,runners,continue) // redo!
      }
      fun(html) {
        continue(html,inName,outName,mopts)  
      }
  }
}

val rxCurDir = regex(@"^(\.)(?=[\\/])")

function process( inName : string, outName : string, searchDirs : list<string>,
                  content : string, icontent : string, 
                  xopts0 : options, mopts : options, firstTime : bool, runners : runners,
                  redo : () -> io (),
                  continue : (string) -> io () ) : io () 
{
  function genPdf(outTexName:string) {
    if (mopts.pdf) {
      (runners.runPdfLatex)( inName, outTexName, mopts, content, fun() { () } )                  
    }        
  }

  function embedFiles( opts: options, files : list<string>, html0 : string ) : io (options,string) {
    if (files.length == 0) return (opts,html0);

    val infos = files.concat fun(fname) {
                  val mime = mimeFromExt(fname);
                  val data = if (mime.startsWith("text/")) 
                                then searchReadTextFileDef(fname,"",searchDirs,"",False)
                              elif (mime.startsWith("image/"))
                                then {
                                  //trace("embed image: " + fname)
                                  val img = readBase64FileDef(combine(inName.dirname,fname),"",False)
                                  if (img != "") then "data:" + mime + ";base64," + img else img
                                }
                              else ""

                  // write the file to the out directory
                  if (data != "" && (opts.pdf || data.length > mopts.embedLimit)) { 
                    val newName = combine(outName.dirname,fname) 
                    if (newName.normalize != fname.normalize) {
                      //trace("copying: " + fname + " to " + newName)
                      mkdirp(newName.dirname)
                      if (mime.startsWith("text/")) {
                        tryWriteTextFile(newName,data);
                      }
                      else {
                        tryWriteBase64File(newName,data.replace(regex(@"^data:[^;]*;base64,"),""));
                      }
                      ()
                    }
                  }  
                  
                  // embed
                  if (data != "" && data.length < mopts.embedLimit) 
                   then [(fname,Embedinfo(fname,data))]
                  else {
                    if (fname!="" && mopts.embedLimit > 0) {
                      mopts.printErr("warning: unable to embed: " + fname + 
                                       (if (data.length > 0) then " (too large)" else " (does not exist)"))
                    }
                    []
                  }
                }
    if (infos.length == 0) return (opts,html0)
      
    val newopts = opts(embedinfos = opts.embedinfos + infos.dict, verbose=min(opts.verbose,1))
    val newhtml = markdown(icontent,newopts)
    (newopts,newhtml)
  }

  function phaseHtml() 
  {
    // markdown to html          
    val (fileEmbed,(mathPlain,(mathFull,(warns0,(logs, html0))))) = 
                              withLog("embed") {
                               withLogCompress("math-plain") {
                                withLogCompress("math-full") {
                                 withLogCompress("warning") { 
                                  withLogCompress("aux") { 
                                   markdown(icontent,xopts0) 
                                 }}}}}
    // write an aux file
    val bibChanged =
      if (logs == "") then []
      else {
        /*
        if (mopts.bibStyle.extname != "" || mopts.bibStyle.dirname != "") {
          // copy bst file
          tryCopyTextFileFromTo( mopts.bibStyle.basename, mopts.bibStyle.dirname, outName.dirname )
          ()          
        }
        */
        writeCitationsData( logs, outName, searchDirs, mopts.bib.splitPaths, mopts )
      }

    // run bibtex?
    if (!bibChanged.isNil && firstTime && mopts.bibtex!="") {
      if (mopts.bib.bool) {
        genBibtex( runners.runBibtex, bibChanged, outName.dirname, searchDirs, mopts ) fun(err) {
          redo()
        }
      }
      else {
        mopts.printErr("warning: found citations but no bibliography file is specified.\n Hint: specify 'Bibliography: <myfile>.bib' in the metadata.")
        redo() // TODO: restructure to not call redo
      }
    }
    else {
      // do embedding
      val (xopts,html) = embedFiles(xopts0,fileEmbed.split("\n").list,html0);                                 

      // write html result
      if (!(tryWriteTextFile(outName,html))) {
        mopts.printErr("error: unable to write: " + outName) 
      }

      // show warnings
      val warns = fixWarnings(warns0)
      if (warns != "") {
        log("stdout",warns)
        if (mopts.verbose >= 1) {
          print(warns)
        }
      }

      // generate tex
      val outTexName = outName.changeExt(".tex")
      if (mopts.tex) {
        if (mopts.verbose >= 1) println("process: " + inName + " -> " + outTexName )        
        val (texwarns, tex) = withLog("texwarning",{ markdown(icontent,xopts,FmtTex) } )
        if (texwarns != "") {
          log("stdout",texwarns)
          if (mopts.verbose>=1) {
            print(texwarns) 
          }
        }
        if (!(tryWriteTextFile(outTexName,tex))) {
          mopts.printErr("error: unable to write: " + outTexName) 
        }
      }

      // possibly typeset math using latex
      if ((mathPlain.containsSnippet && mopts.math.mode.isStatic) || mathFull.containsSnippet) {
        if (mopts.verbose>=2 && mopts.math.mode.isDynamic && mathFull.containsSnippet) {
          mopts.print("warning: dynamic math mode but some math requires pdf",2)
        }
        mathStatic( mathPlain, mathFull, inName, outName, mopts, content, runners.runMathStatic ) fun(mbmres) {
          match(mbmres) {
            Just((mdim2,svgdefs)) -> {
              // write html again
              mopts.print("re-aligning math in HTML.")
              
              val html2 = markdown(icontent,xopts(math=(xopts.math)(dim=mdim2,svgDefs=svgdefs)))
              if (!(tryWriteTextFile(outName,html2))) {
                mopts.printErr("error: unable to write: " + outName) 
              }
            }
            Nothing -> ()
          }
          //if (mopts.verbose>=1) println("  done typesetting math.")
          genPdf(outTexName)
        }
      }    
      else {
        genPdf(outTexName)
      }    

      continue(html)            
    }
  }

  phaseHtml()
}


function extractCitestyle( opts : options, outName : string ) : io options {
  val auxName  = outName.noext + "-bib.bbl.mdk" // the first..
  val contents = readTextFileDef( auxName, "", False )
  match (contents.find(rxCiteStyle)) {
    Nothing   -> opts
    Just(cap) -> {
      match(parseCiteStyle(cap.groups[1])) {
        Nothing  -> opts
        Just(cs) -> opts(citestyle=Just(cs))
      }
    }
  }
}
val rxCiteStyle = regex(@"\bcite\-style *: *""([^""]+)""")

function searchReadTextFile( fname, searchDirs, ext, required, mopts ) : io fileinfo {
  match(trySearchReadTextFile(fname,searchDirs,ext,required)) {
    Nothing -> {
      mopts.printErr("warning: unable to read: " + fname.defaultExt(ext))
      Fileinfo(fname,"")
    }
    Just((fullname,contents)) -> Fileinfo(fullname,contents)
  }
}

function genBibCsl( aux : auxinfo, outdir, searchDirs, mopts : options ) : io () {
  mopts.print("bibliography " + (if (aux.auxid.bool) then "(" + aux.auxid + ") " else "") + "style: " + aux.style.styleName)
  val searchDirsCsl = searchDirs.concat( fun(dir) { [dir,combine(dir,"csl")] } )
  val searchDirsLoc = searchDirs.concat( fun(dir) { [dir,combine(dir,"locales")] } )

  val madokoStyle = searchReadTextFile( "madoko.csl", searchDirsCsl, "", True, mopts)
  val locale      = searchReadTextFile( "locales-" + aux.style.locale + ".xml",searchDirsLoc, "", True, mopts )
  val auxcontents = readTextFileDef(aux.auxfile,"",False)
  val bibfiles    = mopts.bib.splitPaths.map( fun(bib) { 
                      searchReadTextFile(bib, searchDirs,".bib",True,mopts) 
                    })
  val citations   = auxcontents.findCitations
  val cslStyle0   = searchReadTextFile( aux.style.styleName, searchDirsCsl, ".csl", True, mopts )
  val cslStyle    = match (cslStyle0.contents.find(rxIndepParent)) {
                      Nothing   -> cslStyle0
                      Just(cap) -> {
                        mopts.print("      parent style: " + cap.groups[1])
                        searchReadTextFile( cap.groups[1], searchDirsCsl, ".csl", True, mopts )
                      }
                    }

  if (citations.length > 0 && cslStyle.contents.bool && madokoStyle.contents.bool && locale.contents.bool) {
    // ready to invoke CSL processor
    val res = runCsl( citations, bibfiles, cslStyle, madokoStyle, locale, aux.auxid , "")
    if (res.warnings.bool) mopts.printErr(res.warnings);
    if (res.errors.bool) {
      mopts.printErr(res.errors)
    }
    else {    
      writeTextFileSync( aux.auxfile.changeExt(".bbl.mdk"), res.bibliography )
      writeTextFileSync( aux.auxfile.changeExt(".bib.json"), res.bib)   
      writeFinalAux( aux.auxfile ) 
    }
  }
}

val rxIndepParent = regex(@"<link *href *= *""(?:https?://www.zotero.org/styles/)?([^""]+)"" *rel *= *""independent-parent"" */>")

function findCitations( aux : string ) : list<citeinfo> {
  var lineinfo := ""
  aux.lines.list.map( fun(line) {
    match (line.find(rxDataLine)) {
      Just(cap) -> {
        lineinfo := cap.groups[1]
        Nothing
      }
      Nothing -> match(line.find(rxCitation)) {
        Just(cap) -> Just(Citeinfo(cap.groups[1], lineinfo ))
        Nothing   -> Nothing
      }
    }   
  }).concatMaybe
}
val rxCitation = regex(@"^\\citation\{([^\}]+)\}")
val rxDataLine = regex(@"^%mdk-data-line=\{([^\}]+)\}")

function genBibtex( runBibtex, auxInfos : list<auxinfo>, outdir, searchDirs, mopts : options, continue : (bool) -> io () ) : io () {
  val (csls,bsts) = auxInfos.partition( fun(info) { info.style.isCsl } );

  function continueCsl(biberr) {
    csls.foreach fun(aux) {
      genBibCsl( aux, outdir, searchDirs, mopts )
    }
    continue(biberr);
  }

  // copy .bst files to the output directory since Bibtex requires that
  bsts.foreach fun(aux) {
    val bstyle = aux.style.styleName
    if (bstyle.extname != "" || bstyle.dirname != "") {
      // copy bst file
      tryCopyTextFileFromTo( bstyle.basename.defaultExt(".bst"), bstyle.dirname, outdir, True )
      ()
    }     
  }
  
  // run Bibtex first
  runBibtex(bsts.map(auxfile),mopts) fun(err:bool) {
    if (!err) {
      bsts.foreach fun(bib) {
        val bblname = bib.auxfile.changeExt(".bbl");
        match (tryReadTextFile(bblname, True)) {
          Left -> warning("Unable to read bibliography file: " + bblname);
          Right(bbl) -> {
            val bibl    = parseTex(bbl,bib.auxid,mopts.citestyle.maybe(citeNumeric,id),bib.style.styleName.stemname)
            val mdkname = bblname + ".mdk";
            writeTextFileSync(mdkname,bibl);  
            writeFinalAux(bib.auxfile)      
          }
        }
      }
    }
    continueCsl(err);
  }
}

function writeFinalAux( auxfile : string ) : io () {
  tryCopyTextFile( auxfile, auxfile.changeExt(".final.aux"), True )
  ()
}

// Fixup locations in warnings:
function fixWarnings(txt : string) : string {
  var location := "";
  val hist = mdict();
  val ls = txt.lines.list.map fun(line) {
    match(line.find(rxLocation)) {
      Nothing -> {
        match(line.find(rxWarning)) {
          Nothing   -> Just(line + "\n")
          Just(cap) -> {
            val count = hist[line].mbint
            hist[line] := count+1
            if (count == 4) 
             then Just("warning: " + location + " ignoring from now on:" + line + "\n")
            elif (count > 4)
             then Nothing
             else Just(cap.groups[1] + location + cap.groups[2] + "\n")
          }
        }
      }
      Just(cap) -> {
        location := cap.groups[1] + ":"
        Nothing
      }
    }
  }
  ls.concatMaybe.join
}
val rxLocation = regex(@"^\s*location:(.*)",ignoreCase=True)
val rxWarning  = regex(@"^(\s*(?:error|warning):)(.*)",ignoreCase=True)

// Remove <!--madoko comments
function removeMadokoComments( txt : string ) : string {
  txt.replaceAll( rxMadokoComment, "\n$1\n")
}
val rxMadokoComment = regex(@"^<!--madoko[ \t\r]*\n([\s\S]*?)^-->[ \t\r]*\n", ignoreCase=True, multiline=True)

// Register colorizers
function registerColorizers( opts : options, searchDirs : list<string>, content : string ) : io ()
{
  val searchDirsEx = searchDirs.concat( fun(dir) { [dir,combine(dir,"lang")] } )
  val registered = mdict()
  val langs1 = opts.hilitelang.split(";").list
  val langs2 = content.findAll(regex(@"(?:^ *```+ *|\blanguage\s*[:=])([\w\-\/]+)\b",multiline=True)).list.map(fun(cap) { cap.groups[1].basename })
  val langs  = (langs1 + langs2).map(toLower)
  langs.foreach fun(lang) {
    match (registered[lang]) {
      Just -> ()
      Nothing -> {
        registered[lang] := True
        if (lang != "") {
          match( trySearchReadTextFile(lang,searchDirsEx,".json")) {
            Nothing -> {
              log("files", changeExt(lang,".json"))
              opts.printErr("warning: unable to read language definition: " + lang)
            }
            Just((_,definition)) -> {
              val langName = lang.basename.noext.toLower
              //trace("register language: " + langName + ":\n" + definition )
              registerLanguage(langName,definition)
            }
          }
        }
      }
    }
  }         
}

type bibstyle {
  Bst( styleName: string, locale: string )
  Csl( styleName: string, locale: string )
}

struct auxinfo(
  auxfile: string,
  auxid  : string,
  style  : bibstyle
)

function writeCitationsData( citeData : string, outName : string, searchDirs : list<string>, bibNames : list<string>, opts : options ) : io list<auxinfo> {
  val defaultAux = outName.noext + "-bib.aux"
  val cites = splitCiteData( citeData, opts ) // split citations over multiple bibliographies
  val bibData = createBibData( outName.dirname, searchDirs, bibNames, opts.citestyle ) // copy bib files and compute md5's  
  cites.filterMap( fun(kv) {
    val (auxStem,(auxData,bibStyle)) = kv
    val auxName = outName.noext + "-bib"+ (if (auxStem=="") then "" else "-" + auxStem) + ".aux"
    val changed = writeCitations(auxData, bibData, bibStyle, auxName, opts)  // write aux files and compare to final.aux for changes
    //trace("bib: " + auxName + ", changed: " + changed.show + "\n" + auxData.indent(2))
    if (changed || opts.rebuild) then Just( Auxinfo(auxName,auxStem,bibStyle) ) else Nothing
  })
}

// split citations in different parts: one for each bibliography ([BIB=<id>] element)
function splitCiteData( citeData : string, opts : options ) : io list<(string,(string,bibstyle))> {
  if (citeData.trim == "") return []
  val style = if (opts.cslStyle!="") then Csl(opts.cslStyle,opts.locale)
              elif (opts.bibStyle != "") then Bst(opts.bibStyle.basename.noext,opts.locale) 
              else Bst("plainnat",opts.locale)
  match(citeData.find(rxBibFile)) {
    Nothing   -> return [("",(citeData,style))]
    Just(cap) -> {
      val auxName = cap.groups[1]
      val auxRaw  = citeData.substr(0,cap.index) // allow backward citations too??
      val auxData = 
        if (auxName.isEmpty) then auxRaw 
         else auxRaw.replaceAll("\\citation{" + auxName + ":", "\\citation{")
      val stylex = if (cap.groups[2].bool) then Csl(cap.groups[2],cap.groups[4])
                   elif (cap.groups[3].bool) then Bst(cap.groups[3],cap.groups[4])
                   else style
      auxInsert( auxName, auxData, stylex, splitCiteData( citeData.substr1(cap.next), opts ))
    }
  }
}
val rxBibFile = regex(@"^ *%mdk bib: *([^\s,]*) *(?:, *csl-style: *([^\s,]*) *)?(?:, *bib-style: *([^\s,]*))?(?:, *locale: *([^\s,]* *))?$", multiline=True )

function auxInsert( auxName : string, auxData : string, style : bibstyle, xs : list<(string,(string,bibstyle))> ) : list<(string,(string,bibstyle))> {
  match(xs) {
    Nil -> [(auxName,(auxData,style))]
    Cons(x,xx) -> {
      if (x.fst == auxName) 
       then Cons( (x.fst, (auxData + "\n" + x.snd.fst, style)), xx)
       else Cons( x, auxInsert(auxName,auxData,style, xx) )
    }
  }
}


// Find and copy bib files to the output directory, and return a `bibdata` command with md5 hash
function createBibData( auxDir : string, searchDirs : list<string>, bibNames : list<string>, mcs : maybe<citestyle> ) : io string {
  val (bibStems,bibContents) = bibNames.map( fun(bibName) {
    match(trySearchReadTextFile(bibName,searchDirs,".bib")) {
      Nothing -> {
        warning( "unable to find bibliography file: " + bibName )
        []
      }
      Just((bibFile,content)) -> {
        // trace("bib: found: " + bibFile)
        if (dirname(bibFile) != auxDir) {
          if (!(tryWriteTextFile( combine(auxDir,basename(bibFile)), content))) {
            println("warning: unable to copy bibliography file to output directory: " + bibName)
          }
        }
        // "\\bibdata{" + stemname(bibFile) + "}\n%md5:" + md5(content) + "\n"
        [(stemname(bibFile),content)]
      }
    }
  }).concat.unzip
  val digest = bibContents.join.md5  
  "\\bibdata{" + bibStems.join(",") + "}\n%md5:" + digest + 
    (match(mcs) { Nothing -> ""; Just(cs) -> "\n%\\citestyle{" + cs.show + "}" }) + "\n"
}

// Write citations to an aux file. Returns "True" if the bibliography data changed.
function writeCitations( auxData : string, bibData : string, bibStyle: bibstyle, auxName : string, opts : options ) : io (bool) {
  val oldData = readTextFileDef(auxName.changeExt(".final.aux"),"",True)
  val newData = "% Generated by Madoko, version " + opts.version + "\n" + auxData + "\n" +
                  (match(bibStyle) {
                    Bst(style,locale) -> "\\bibstyle{" + style.stemname + "}\n%\\biblocale{" + locale + "}\n"
                    Csl(style,locale) -> "%\\cslstyle{" + style + "}\n%\\csllocale{" + locale + "}\n"
                  }) 
                  + bibData
                  
  if (newData != oldData) {
    if (!(tryWriteTextFile(auxName, newData))) then {
      opts.printErr("error: unable to write citations: " + auxName )
    }
  }
  
  val oldCites = oldData.findAll(rxCite).list.map(fun(cap) { cap.matched }).join("\n");
  val newCites = newData.findAll(rxCite).list.map(fun(cap) { cap.matched }).join("\n");
  //trace("oldCites: " + oldCites)
  //trace("newCites: " + newCites)
  return (oldCites != newCites)
}
val rxCite = regex(@"^(?:(?:%?\\(citation|bibstyle|biblocale|bibdata|cslstyle|cslocale|citestyle)\b.*)|(?:%md5:.*))$",multiline=True)


public function outputName( inputName : string, options : commandOptions ) : string {
  val noextName = if (inputName.endsWith(".xmp.html")) then inputName.substr(0,inputName.length-9) else inputName.noext 
  val outName = if (options.convertTex) then inputName + ".mdk" else noextName + ".html"
  if (options.outputDir=="") 
   then outName 
   else options.outputDir + "/" + outName.basename                  
}

function tryCopyTextFileFromTo( fname, srcDir, outDir, required = False ) {
  tryCopyTextFile( combine(srcDir,fname), combine(outDir,fname), required)
}

function tryCopyTextFile( fileName : string, outName : string, required = False ) : io bool {
  match(tryReadTextFile( fileName, required )) {
    Left -> False
    Right(txt) -> tryWriteTextFile(outName,txt)
  }
}


function tryCopyTextFileFromNoSandboxTo( fname, srcDir, outDir ) {
  val inName = combine(srcDir,fname)
  val outName = combine(outDir,fname)
  catch { 
    val txt = readTextFileNoSandbox( inName )
    tryWriteTextFile(outName,txt)    
    ()
  }
  fun(exn) { () }
}


public function withLogCompress( name: string, action : () -> <ndet|e> a ) : <ndet|e> (string,a) {
  val (log,x) = withLog(name,action)
  (log.replaceAll(rxDataLinesPre,""), x)
}

val rxDataLinesPre = regex("(?:\r?\n%mdk-data-line=.*(?=\r?\n%mdk-data-line))+")