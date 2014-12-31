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
import texParser

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
  if (opts.convertTex) {
    val output = content.parseTex(ignore=False)
    writeTextFileSync(outName,output)
    return continue( output, inName, outName, opts.options );
  }

  val styleDir = opts.installDir + "/../styles"
  val searchDirs = [inName.dirname,outName.dirname,styleDir]
  content.include(False, inName, outName, searchDirs, opts.options) fun(icontent,lmap) {
    // set up options
    val opts0  = if (inName.endsWith(".xmp.html") || inName.endsWith(".xmp"))
                  then (opts.options)(xmp = True) else opts.options
               
    val date   = now()                             
    val opts1  = opts0(lineMap=lmap, metadata=opts0.metadata 
                       + [("docname",inName.stemname),("filename",inName)]
                       + [("date",date.isoLocalDate),("time",date.isoLocalTime.substr(0,5)),
                          ("year",date.year.show),("month",date.month.show2),("day",date.day.show2),
                          ("hours",date.hours.show2),("minutes",date.minutes.show2),("seconds",date.seconds.show2)] )

    val mmopts = if (opts1.xmp) then opts1 // todo: look at first <xmp> fragment?
                  else opts1.parseMeta( FmtHtml, icontent.normalizeSource ).fst  // get bibdata,bibstyle,mathimg

    // always read dims: even in dynamic mode some pdf math may exist
    val dims = outName.changeExt(".dimx").readTextFileDef("",True)
    val mdim = dims.parseMathDim(mmopts.mathImgDir, mmopts.mathDpi, mmopts.mathScale)

    val xopts  = opts1(mathdim=mdim)
    val mopts  = mmopts(mathdim=mdim)  

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
      
    val newopts = opts(embedinfos = opts.embedinfos + infos.dict)
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
    val bibAux = outName.appendStem("-bib").changeExt(".aux")
    val bibChanged =
      if (logs == "") then False else {
        if (mopts.bibStyle.extname != "" || mopts.bibStyle.dirname != "") {
          // copy bst file
          tryCopyTextFileFromTo( mopts.bibStyle.basename, mopts.bibStyle.dirname, outName.dirname )
          ()          
        }
        val bibData = createBibData(bibAux, inName, searchDirs, mopts.bib.splitPaths)
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

// Fixup locations in warnings:
function fixWarnings(txt : string) : string {
  var location := "";
  val ls = txt.lines.list.map fun(line) {
    match(line.find(rxLocation)) {
      Nothing -> {
        match(line.find(rxWarning)) {
          Nothing   -> Just(line + "\n")
          Just(cap) -> Just(cap.groups[1] + location + cap.groups[2] + "\n")
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

// Register colorizers
function registerColorizers( opts : options, searchDirs : list<string>, content : string ) : io ()
{
  val searchDirsEx = searchDirs.concat( fun(dir) { [dir,combine(dir,"lang")] } )
  val registered = mdict()
  val langs1 = opts.hilitelang.split(";").list
  val langs2 = content.findAll(regex(@"(?:^ *```+ *|\blanguage=)([\w\-\/]+)\b",multiline=True)).list.map(fun(cap) { cap.groups[1].basename })
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


// Get hashes of bib files
function createBibData( auxName : string, docName : string, searchDirs : list<string>, bibNames : list<string> ) : io string {
  val (bibStems,bibContents) = bibNames.map( fun(bibName) {
    match(trySearchReadTextFile(bibName,searchDirs,".bib")) {
      Nothing -> {
        println( "warning: unable to find bibliography file: " + bibName )
        []
      }
      Just((bibFile,content)) -> {
        if (dirname(bibFile) != dirname(auxName)) {
          if (!(tryWriteTextFile( combine(dirname(auxName),basename(bibFile)), content))) {
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
function writeCitations( auxData : string, bibData : string, auxName : string, docName : string, opts : options, required : bool ) : io bool {
  val bibStyleName = if (opts.bibStyle != "") then opts.bibStyle.basename.noext else "plainnat"
      
  val oldData = readTextFileDef(auxName,"",required)
  val initial = oldData.replaceAll(rxCite,"").replace(rxEmptyTail,"")
  val newData = (if (initial!="") then initial + "\n" else "") + 
                  "% Generated by Madoko, version " + version + "\n" + auxData + 
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

struct snippet(
  fileName : string,
  startLine: int,
  content  : string
)

function include( text : string, fast : bool, inName : string, outName : string, dirs : list<string>, options : options, action : (string,lineMap) -> <io|e> a ) : <io|e> a {
  if (fast) then return action(text,End) 

  val includes : mdict<global,string> = mdict()
  val snippets : mdict<global,snippet> = mdict()
  val rxSnippetStart = regex(options.extractStart, multiline=True, ignoreCase=True)
  val rxSnippetEnd = regex(options.extractEnd, multiline=True, ignoreCase=True)

  function warning( msg, lineNo = 0, fileName = "") {
    options.printErr( "warning: " + 
             (if (fileName != "" || lineNo > 0)
               then fileName + (if (lineNo > 0) then " (" + lineNo.show + ")" else "") + ": "
               else "") +
             msg )
  }

  function extractSnippet( name, content, fname, lineNo, acc = [] ) : io (list<string>,int) {
    match(content) {
      Nil -> {
        warning("unclosed snippet: " + name, lineNo, fname )
        (Nil,lineNo)
      }
      Cons(line,lines) -> {
        match(line.find(rxSnippetEnd)) {
          Nothing -> match(line.find(rxSnippetStart)) {
            Nothing -> {
              extractSnippet( name, lines, fname, lineNo+1,  Cons(line,acc))
            }
            Just(cap) -> {
              // embedded snippet: extract separately 
              extractSnippet( cap.groups[1].toLower(), lines, fname, lineNo+1 )
              // and for this snippet, ignore this line
              extractSnippet( name, lines, fname, lineNo+1, acc )
            }
          }
          Just(cap) -> {
            val cname = cap.groups[1].toLower()
            if (name == cname) {
              // end of snippet
              if (snippets[name].isJust) {
                warning( "snippet " + name + " is redefined", lineNo, fname )
              }
              snippets[name] := Snippet(fname, lineNo, acc.reverse.join("\n"))
              (lines,lineNo+1)
            }
            else {
              // end of another snippet, ignore it
              extractSnippet( name, lines, fname, lineNo+1, acc )
            }
          }
        }
      }
    }
  }

  function findSnippets( content : list<string>, fname : string, lineNo : int = 1) : io () {
    match(content) {
      Nil -> ()
      Cons(line,lines) -> {
        //trace("find snippet: " + line)
        match(line.find(rxSnippetStart)) {
          Nothing -> findSnippets( lines, fname, lineNo+1 )
          Just(cap) -> {
            val name = cap.groups[1].toLower()
            val (rest, endLineNo) = extractSnippet( name, lines, fname, lineNo+1 )
            findSnippets( rest, fname, endLineNo )
          }
        }
      }
    }
  }

  function readInclude( fname : string, srcname, lineNo ) : io (string,string) 
  {
    if (fname=="") then {
      ("","\n")  // happens for snippet only includes
    }
    elif (fname=="BIB") then {
      val fileName = outName.appendStem("-bib").changeExt(".bbl")
      match (includes[fileName]) {
        Just(content) -> (fname,content)
        Nothing -> {
          val bbl = readTextFileDef( fileName, "", True)  
          val content = ("~ TeX\n" + (if (bbl=="") then "\\begin{thebibliography}{00}\n\\end{thebibliography}\n" else bbl) + "\n~")
          includes[fileName] := content
          (fileName,content)
        }
      }
    }
    else {
      // avoid including recursively
      val searchName = if (fname.extname == "") then fname + ".mdk" else fname;
      val searchDirs = if (inName.basename != searchName) then dirs 
                        else dirs.filter( fun(dir) { dir != inName.dirname });
      // .. and search
      match (trySearchReadTextFile(fname,searchDirs,".mdk")) {
        Nothing -> {
          val fileName = if (extname(fname)=="") then fname + ".mdk" else fname
          log("files", fileName)
          warning("unable to read include: " + fname, lineNo, srcname )
          (fileName,"")
        }
        Just((fileName,content)) -> {
          match(includes[fileName]) {
            Just -> ()
            Nothing -> {
              includes[fileName] := content
              content.lines.list.findSnippets(fileName) // record snippets only once
            }
          }
          (fileName,content)
        } 
      }
    }
  }

  val rxRange = regex(@"^(\d+)(?:--?(\d+))?$")
  val rxSnippetName = regex(@"^(\w+)$")
  function findRange( incfile: string, incline: string, range : string, content : string, fname : string, lineNo : int ) : io (string,int,string)
  {
    if (range=="") return (incfile, 1,content)
    match(range.find(rxRange)) {
      Nothing -> {
        match(range.find(rxSnippetName)) {
          Nothing -> {
            warning( "invalid include range: " + incline, lineNo, fname )
            (incfile,1,content)
          }
          Just(cap) -> {
            // snippet name
            match(snippets[cap.groups[1].toLower()]) {
              Nothing -> {
                warning( "unknown snippet name: " + cap.groups[1], lineNo, fname )
                (incfile,1,content)
              }
              Just(Snippet(fileName,start,fragment)) -> {
                (fileName,start,fragment)
              }
            }
          }
        }
      }
      Just(cap) -> {
        val start = cap.groups[1].parseInt().maybe(1,id)
        if (start<=0) return (incfile,0,"")
        val end   = max(start,cap.groups[2].parseInt().maybe(start,id))
        val fragment = content.lines.list.drop(start-1).take((end - start) + 1).join("\n")
        //trace("include: " + start.show + "," + end.show + ":\n" + fragment)
        (incfile,start,fragment)
      }
    }
  }
  
  function processIncludes( txt : string, fname : string, start : int = 1 ) : io (int,lineMap,string)
  {
    if (start<=0) return (0,End,"")
    var lineNo := start-1
    var lineCount := 0
    var lineMap := End
    val ls = txt.lines.map fun(line) {
      lineNo := lineNo + 1;
      lineCount := lineCount + 1;
      match (line.find(rxInclude)) {
        Nothing -> line
        Just(cap) -> {
          val incname = cap.groups.firstMatched(1,4)
          val (fileName0,content) = readInclude(incname,fname,lineNo)
          val (fileName,istart,fragment)  = fileName0.findRange(cap.matched, cap.groups[5], content, fname, lineNo);
          if (istart<=0) then "" else {
            val (lcount,lmap,icontent) = processIncludes( fragment, fileName, istart )
            lineMap := Include(lineNo,istart,lcount,fileName,lmap,lineMap)
            lineCount := lineCount + lcount - 1
            //trace("include: " + lineNo.show + ", " + lcount.show + ", " + lineCount.show)
            icontent
          }
        }
      }
    }

    (lineCount, lineMap.reverse, ls.unlines)
  }

  val (_lcount,lmap,content) = processIncludes(text,inName)
  action(content,lmap)
}
val rxInclude = regex(@"^ {0,3}\[(?:(BIB)|INCLUDE *(?:= *(?:""([^""\n]+)""|'([^'\n]+)'|([^\s:=\]]+)) *)?(?:[:] *([\w\-]+))?)\] *(?=\n|$)",multiline=True)

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

