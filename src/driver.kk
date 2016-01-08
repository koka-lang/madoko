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
import bibliography

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