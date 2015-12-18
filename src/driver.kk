/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
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

    val mmopts = if (opts1.xmp) then opts1 // todo: look at first <xmp> fragment?
                  else opts1.parseMeta( FmtHtml, icontent.normalizeSource ).fst  // get bibdata,bibstyle,mathimg

    // always read dims: even in dynamic mode some pdf math may exist
    val dims = if (mmopts.rebuild) then "" else outName.changeExt(".dimx").readTextFileDef("",True)
    val mdim = dims.parseMathDim(mmopts.mathImgDir, mmopts.mathDpi, mmopts.mathScale,mmopts.mathBaseline)

    val xopts  = opts1(mathdim=mdim)
    val mopts  = mmopts(mathdim=mdim)  

    // register languages for highlighting
    registerColorizers(mopts, searchDirs, icontent);

    // copy early since async latex may start for math
    if (mopts.copyStyles && !(xopts.sandbox)) {
      if (mopts.embedLimit < 16*1024) {  // only copy standard css style if it will not be embedded
        tryCopyTextFileFromTo( "madoko.css", styleDir, outName.dirname )
        ()
      }
      if (xopts.tex || mopts.mathmode.isStatic) { // only copy style files if generating tex or if math is static
        val isTex2  = match(mopts.metadata.find( fun(md) { md.fst == "tex2" } )) {
                        Just(md) -> md.snd.toLower == "true"  
                        _ -> False
                      }
        val files = if (isTex2)
                     then ["ellipse.sty","options.sty","longbox.sty","longfbox.sty","madoko2.sty"]
                     else ["css.sty","madoko.sty"]                      
        files.foreach fun(fname) { 
          tryCopyTextFileFromTo(fname, styleDir, outName.dirname )
          ()
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
    val (fileEmbed,(mathDvi,(mathPdf,(warns0,(logs, html0))))) = 
                              withLog("embed") {
                               withLog("math-dvi") {
                                withLog("math-pdf") {
                                 withLog("warning") { 
                                  withLog("aux") { 
                                   markdown(icontent,xopts0) 
                                 }}}}}
    // write an aux file
    val bibChanged =
      if (logs == "") then []
      else {
        if (mopts.bibStyle.extname != "" || mopts.bibStyle.dirname != "") {
          // copy bst file
          tryCopyTextFileFromTo( mopts.bibStyle.basename, mopts.bibStyle.dirname, outName.dirname )
          ()          
        }
        writeCitationsData( logs, outName, searchDirs, mopts.bib.splitPaths, mopts )
      }

    // run bibtex?
    if (!bibChanged.isNil && firstTime && mopts.bibtex!="") {
      if (mopts.bib.bool) {
        genBibtex( runners.runBibtex, bibChanged, mopts ) fun(err) {
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
      if ((mathDvi.containsSnippet && mopts.mathmode.isStatic) || mathPdf.containsSnippet) {
        if (mopts.verbose>=2 && mopts.mathmode.isDynamic && mathPdf.containsSnippet) {
          mopts.print("warning: dynamic math mode but some math requires pdf",2)
        }
        mathStatic( mathDvi, mathPdf, inName, outName, mopts, content, runners.runMathStatic ) fun(mbmdim2) {
          match(mbmdim2) {
            Just(mdim2) -> {
              // write html again
              mopts.print("re-aligning math in HTML.")
              
              val html2 = markdown(icontent,xopts(mathdim=mdim2))
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

function genBibtex( runBibtex, auxfiles : list<(string,string)>, mopts : options, continue : (bool) -> io () ) : io () {
  runBibtex(auxfiles.map(fst),mopts) fun(err) {
    auxfiles.foreach fun(aux) {
      val (auxname,id) = aux
      val bblname = auxname.changeExt(".bbl");
      match (tryReadTextFile(bblname, True)) {
        Left -> warning("Unable to read bibliography file: " + bblname);
        Right(bbl) -> {
          val bibl    = parseTex(bbl,id,mopts.citestyle)
          val mdkname = bblname + ".mdk";
          writeTextFileSync(mdkname,bibl);        
        }
      }
    }
    continue(err);
  }
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

function writeCitationsData( citeData : string, outName : string, searchDirs : list<string>, bibNames : list<string>, opts : options ) : io list<(string,string)> {
  val defaultAux = outName.noext + "-bib.aux"
  val cites = splitCiteData( citeData )
  //trace("bibnames: " + bibNames.join(","))
  //trace("cite data:\n" + citeData.indent(2))
  val bibData = createBibData( outName.dirname, searchDirs, bibNames )
  /*
    val bibData = createBibData(bibAux, inName, searchDirs, mopts.bib.splitPaths)
    // write the log to an aux file (one for latex, and one to track changes)
    // note: 2015/11/13: writing for latex is not necessary since madoko handles citations (?)
    // writeCitations( logs, bibData, outName.changeExt(".aux"), inName, mopts, False )
    writeCitations( logs, bibData, bibAux, inName, mopts, True )              
  */
  cites.filterMap( fun(kv) {
    val (auxStem,auxData) = kv
    val auxName = outName.noext + "-bib"+ (if (auxStem=="") then "" else "-" + auxStem) + ".aux"
    val changed = writeCitations(auxData, bibData, auxName, opts, True)
    //trace("bib: " + auxName + ", changed: " + changed.show + "\n" + auxData.indent(2))
    if (changed || opts.rebuild) then Just((auxName,auxStem)) else Nothing
  })
}

function splitCiteData( citeData : string ) : io list<(string,string)> {
  if (citeData.trim == "") return []
  match(citeData.find(rxBibFile)) {
    Nothing   -> return [("",citeData)]
    Just(cap) -> {
      val auxName = cap.groups[1]
      val auxRaw  = citeData.substr(0,cap.index)
      val auxData = 
        if (auxName.isEmpty) then auxRaw 
         else auxRaw.replaceAll("\\citation{" + auxName + ":", "\\citation{")
      auxInsert( auxName, auxData, splitCiteData( citeData.substr1(cap.next) ))
    }
  }
}
val rxBibFile = regex(@"^ *%mdk bib: *([^\s]*)\s*", multiline=True )

function auxInsert( auxName : string, auxData : string, xs : list<(string,string)> ) : list<(string,string)> {
  match(xs) {
    Nil -> [(auxName,auxData)]
    Cons(x,xx) -> {
      if (x.fst == auxName) 
       then Cons( (x.fst, auxData + "\n" + x.snd), xx)
       else Cons( x, auxInsert(auxName,auxData,xx) )
    }
  }
}


// Get hashes of bib files
function createBibData( auxDir : string, searchDirs : list<string>, bibNames : list<string> ) : io string {
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
  "\\bibdata{" + bibStems.join(",") + "}\n%md5:" + digest + "\n"
}

// Write citations to an aux file. Returns "True" if the bibliography data changed.
function writeCitations( auxData : string, bibData : string, auxName : string, opts : options, required : bool ) : io bool {
  val bibStyleName = if (opts.bibStyle != "") then opts.bibStyle.basename.noext else "plainnat"
      
  val oldData = readTextFileDef(auxName,"",required)
  val initial = oldData.replaceAll(rxCite,"").replace(rxEmptyTail,"")
  val newData = (if (initial!="") then initial + "\n" else "") + 
                  "% Generated by Madoko, version " + opts.version + "\n" + auxData + 
                  "\n\\bibstyle{" + bibStyleName + "}\n" + bibData
                  
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
val rxCite = regex(@"^(\\(citation|bibstyle|bibdata)\b.*)|(%md5:.*)$",multiline=True)
val rxEmptyTail = regex(@"(\s|%.*)*$")


public function outputName( inputName : string, options : commandOptions ) : string {
  val noextName = if (inputName.endsWith(".xmp.html")) then inputName.substr(0,inputName.length-9) else inputName.noext 
  val outName = if (options.convertTex) then inputName + ".mdk" else noextName + ".html"
  if (options.outputDir=="") 
   then outName 
   else options.outputDir + "/" + outName.basename                  
}

function tryCopyTextFileFromTo( fname, srcDir, outDir ) {
  tryCopyTextFile( combine(srcDir,fname), combine(outDir,fname))
}

function tryCopyTextFile( fileName : string, outName : string ) : io bool {
  match(tryReadTextFile( fileName, False )) {
    Left -> False
    Right(txt) -> tryWriteTextFile(outName,txt)
  }
}

