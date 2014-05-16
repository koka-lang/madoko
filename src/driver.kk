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

public struct runners(
  runPdfLatex : ( srcFile : string, texFile : string, opts : options, content : string, continue : () -> io () ) -> io (),
  runBibtex : ( bibFile : string, opts : options, continue : bool -> io ()) -> io (),
  runMathStatic : runMathStaticFun
)

public function processContent( inName : string, outName : string, content : string, 
                          opts : commandOptions, firstTime : bool = False,
                          runners : runners,
                          continue : (output:string,inputName:string,outputName:string,options:options) -> io () ) : io () 
{
  if (opts.options.sandbox) enforceSandbox()
  styleDir = opts.installDir + "/../styles"
  searchDirs = [inName.dirname,outName.dirname,styleDir];
  content.include(False, outName, searchDirs) fun(icontent,lmap) {
    // set up options
    opts0  = if (inName.endsWith(".xmp.html") || inName.endsWith(".xmp"))
              then (opts.options)(xmp = True) else opts.options
               
    date   = now()                             
    opts1  = opts0(lineMap=lmap, metadata=opts0.metadata 
                    + [("docname",inName.stemname),("filename",inName)]
                    + [("date",date.isoLocalDate),("time",date.isoLocalTime.substr(0,5))] )

    mmopts = if (opts1.xmp) then opts1 // todo: look at first <xmp> fragment?
              else opts1.parseMeta( FmtHtml, icontent.normalizeSource ).fst  // get bibdata,bibstyle,mathimg

    // always read dims: even in dynamic mode some pdf math may exist
    dims = outName.changeExt(".dimx").readTextFileDef("",True)
    mdim = dims.parseMathDim(mmopts.mathImgDir, mmopts.mathDpi, mmopts.mathScale)

    xopts  = opts1(mathdim=mdim)
    mopts  = mmopts(mathdim=mdim)  

    if (mopts.verbose>=4) {
      println(mopts.metadata.map(fun(kv) { kv.fst + ": " + kv.snd }).join("\n"))
    }

    // register languages for highlighting
    registerColorizers(mopts, searchDirs, icontent);

    // copy early since async latex may start for math
    if (mopts.copyStyles && !(xopts.sandbox)) {
      tryCopyTextFileFromTo( "madoko.css", styleDir, outName.dirname )
      if (xopts.tex || xopts.mathmode.isStatic) {
        tryCopyTextFileFromTo( "css.sty", styleDir, outName.dirname)
        tryCopyTextFileFromTo( "madoko.sty", styleDir, outName.dirname)
        ()
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
      (runners.runPdfLatex)( inName, outTexName, mopts, content, function() { () } )                  
    }        
  }

  function embedFiles( opts: options, files : list<string>, html0 : string ) : io (options,string) {
    if (files.length == 0) return (opts,html0);

    val infos = files.concat fun(fname) {
                  mime = mimeFromExt(fname);
                  data = if (mime.startsWith("text/")) 
                              then searchReadTextFileDef(fname,"",searchDirs,"",False)
                            elif (mime.startsWith("image/"))
                              then {
                                //trace("embed image: " + fname)
                                img = readBase64FileDef(combine(inName.dirname,fname),"",False)
                                ("data:" + mime + ";base64," + img)
                              }
                            else ""

                  // write the file to the out directory
                  if (data != "" && (opts.pdf || data.length > mopts.embedLimit)) { 
                    newName = combine(outName.dirname,fname)
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
      
    val newopts = opts(embedinfos = opts.embedinfos + infos.dict)
    val newhtml = markdown(icontent,newopts)
    (newopts,newhtml)
  }

  function phaseHtml() 
  {
    // markdown to html          
    val (fileEmbed,(mathDvi,(mathPdf,(warns,(logs, html0))))) = 
                              withLog("embed") {
                               withLog("math-dvi") {
                                withLog("math-pdf") {
                                 withLog("warning") { 
                                  withLog("aux") { 
                                   markdown(icontent,xopts0) 
                                 }}}}}

    // write an aux file
    bibAux = outName.appendStem("-bib").changeExt(".aux")
    bibChanged =
      if (logs == "") then False else {
        bibData = createBibData(bibAux, inName, searchDirs, mopts.bib.splitPaths)
        // write the log to an aux file (one for latex, and one to track changes)
        writeCitations( logs, bibData, outName.changeExt(".aux"), inName, mopts, False )
        writeCitations( logs, bibData, bibAux, inName, mopts, True )                
      }

    // run bibtex?
    if ((bibChanged || mopts.rebuild) && firstTime && mopts.bibtex!="") {
      (runners.runBibtex)( bibAux, mopts ) fun(err) {
        redo()
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
      if (warns != "" && mopts.verbose >= 1) {
        print(warns)
      }

      // generate tex
      outTexName = outName.changeExt(".tex")
      if (mopts.tex) {
        if (mopts.verbose >= 1) println("process: " + inName + " -> " + outTexName )        
        val (texwarns, tex) = withLog("texwarning",{ markdown(icontent,xopts,FmtTex) } )
        if (texwarns != "" && mopts.verbose>=3) print(texwarns) 
        //trace(tex)
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
              
              html2 = markdown(icontent,xopts(mathdim=mdim2))
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

// Register colorizers
function registerColorizers( opts : options, searchDirs : list<string>, content : string ) : io ()
{
  searchDirsEx = searchDirs.concat( fun(dir) { [dir,combine(dir,"lang")] } )
  registered = mdict()
  langs1 = opts.hilitelang.split(";").list
  langs2 = content.findAll(regex(@"^ *```+ *([\w\-\/]+)\b",multiline=True)).list.map(fun(cap) { cap.groups[1].basename })
  (langs1 + langs2).foreach fun(lang) {
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
              langName = lang.basename.noext.toLower
              //trace("register language: " + langName + ":\n" + definition )
              registerLanguage(langName,definition)
            }
          }
        }
      }
    }
  }         
}


// Get hashes of bib files
function createBibData( auxName : string, docName : string, searchDirs : list<string>, bibNames : list<string> ) : io string {
  bibNames.map( fun(bibName) {
    match(trySearchReadTextFile(bibName,searchDirs,".bib")) {
      Nothing -> {
        println( "warning: unable to find bibliography file: " + bibName )
        ""
      }
      Just((bibFile,content)) -> {
        if (dirname(bibFile) != dirname(auxName)) {
          if (!(tryWriteTextFile( combine(dirname(auxName),basename(bibFile)), content))) {
            println("warning: unable to copy bibliography file to output directory: " + bibName)
          }
        }
        "\\bibdata{" + stemname(bibFile) + "}\n%md5:" + md5(content) + "\n"
      }
    }
  }).join
}

// Write citations to an aux file. Returns "True" if the bibliography data changed.
function writeCitations( auxData : string, bibData : string, auxName : string, docName : string, opts : options, required : bool ) : io bool {
  bibStyleName = if (opts.bibStyle != "") then opts.bibStyle else "plainnat"
      
  oldData = readTextFileDef(auxName,"",required)
  initial = oldData.replaceAll(rxCite,"").replace(rxEmptyTail,"")
  newData = (if (initial!="") then initial + "\n" else "") + 
            "% Generated by Madoko, version " + version + "\n" + auxData + 
            "\n\\bibstyle{" + bibStyleName + "}\n" + bibData
            
  if (newData != oldData) {
    if (!(tryWriteTextFile(auxName, newData))) then {
      opts.printErr("error: unable to write citations: " + auxName )
    }
  }
  
  oldCites = oldData.findAll(rxCite).list.map(fun(cap) { cap.matched }).join("\n");
  newCites = newData.findAll(rxCite).list.map(fun(cap) { cap.matched }).join("\n");
  //trace("oldCites: " + oldCites)
  //trace("newCites: " + newCites)
  return (oldCites != newCites)
}
val rxCite = regex(@"^(\\(citation|bibstyle|bibdata)\b.*)|(%md5:.*)$",multiline=True)
val rxEmptyTail = regex(@"(\s|%.*)*$")


function include( text : string, fast : bool, outName : string, dirs : list<string>, action : (string,lineMap) -> <io|e> a ) : <io|e> a {
  if (fast) then return action(text,End) 

  function readInclude( fname : string ) : io (string,string) 
  {
    if (fname=="BIB") then {
      fileName = outName.appendStem("-bib").changeExt(".bbl")
      bbl = readTextFileDef( fileName, "", True)  
      (fileName, "~ TeX\n" + (if (bbl=="") then "\\begin{thebibliography}{00}\n\\end{thebibliography}\n" else bbl) + "\n~")
    }
    else {
      match (trySearchReadTextFile(fname,dirs,".mdk")) {
        Nothing -> {
          fileName = if (extname(fname)=="") then fname + ".mdk" else fname
          log("files", fileName)
          println("  warning: unable to read include: " + fname )
          (fileName,"")
        }
        Just(res) -> res 
      }
    }
  }

  function processIncludes( txt : string) : io (int,lineMap,string)
  {
    var lineNo := 0;
    var lineCount := 0;
    var lineMap := End;
    ls = txt.lines.map fun(line) {
      lineNo := lineNo + 1;
      lineCount := lineCount + 1;
      match (line.find(rxInclude)) {
        Nothing -> line
        Just(cap) -> {
          val fname = cap.groups.firstMatched
          val (fileName,content) = readInclude(fname)
          val (lcount,lmap,icontent) = processIncludes( content )
          lineMap := Include(lineNo,lcount,fileName,lmap,lineMap)
          lineCount := lineCount + lcount - 1
          //trace("include: " + lineNo.show + ", " + lcount.show + ", " + lineCount.show)
          icontent
        }
      }
    }

    (lineCount, lineMap.reverse, ls.unlines)
  }

  val (_lcount,lmap,content) = processIncludes(text)
  action(content,lmap)
}
val rxInclude = regex(@"^ {0,3}\[(?:(BIB)|INCLUDE *(?: |= *)(?:""([^""\n]+)""|'([^'\n]+)'|([^\s\]]+)) *)\] *(?=\n|$)",multiline=True)

function searchReadTextFileDef( fname : string, def : string, dirs : list<string>, ext : string = "", required : bool = True ) : io string {
  match(trySearchReadTextFile(fname,dirs,ext,required)) {
    Nothing -> def
    Just((_,content)) -> content
  } 
}

function trySearchReadTextFile( fname : string, dirs : list<string>, ext : string = "", required : bool = True  ) : io maybe<(string,string)> {
  match(searchFileSync(dirs,fname)) {
    Nothing -> {
      if (ext=="" || fname.extname != "") then Nothing else {
        match (searchFileSync(dirs,fname.changeExt(ext))) {
          Nothing -> Nothing
          Just(fullname) -> tryReadTextFile(fullname,required).maybe.maybe(Nothing,fun(txt){ Just((fullname,txt)) })
        }
      }
    } 
    Just(fullname) -> tryReadTextFile(fullname,required).maybe.maybe(Nothing,fun(txt){ Just((fullname,txt)) })
  }
}

public function outputName( inputName : string, options : commandOptions ) : string {
  noextName = if (inputName.endsWith(".xmp.html")) then inputName.substr(0,inputName.length-9) else inputName.noext 
  outName = noextName + ".html"
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

val mimes = dict([
  ("","text/plain"),
  ("mdk","text/plain"),
  ("txt","text/plain"),
  ("css","text/css"),
  ("html","text/html"),
  ("htm","text/html"),
  ("js","text/javascript"),
  
  ("tex","text/tex"),
  ("sty","text/latex"),
  ("cls","text/latex"),
  ("bib","text/plain"),
  ("bbl","text/plain"),
  ("aux","text/plain"),

  ("png","image/png"),
  ("jpg","image/jpg"),
  ("jpeg","image/jpg"),
  ("gif","image/gif"),
  ("svg","image/svg+xml")
]);

function mimeFromExt( fname : string ) : string {
  ext = extname(fname).substr(1);
  match(mimes[ext]) {
    Just(mime) -> mime
    Nothing    -> ""
  }
}

