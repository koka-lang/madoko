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
import common
import options
import metadata
import madoko
import storage
import hilite
import mathParse

public struct runners(
  runPdfLatex : ( texFile : string, opts : options, content : string, continue : () -> io () ) -> io (),
  runBibtex : ( bibFile : string, opts : options, continue : bool -> io ()) -> io (),
  runMathStatic : ( mathDvi : string, mathPdf : string,  
                            outName : string, xopts : options, content : string, 
                            continue : (maybe<dict<mathinfo>>) -> io () ) -> io () 
)

public function processContent( inName : string, outName : string, content : string, 
                          opts : commandOptions, firstTime : bool = False,
                          runners : runners,
                          continue : (string,string,string,options) -> io () ) : io () 
{
  styleDir = opts.installDir + "/../styles"
  content.include(False, outName, [".",inName.dirname,outName.dirname,styleDir]) fun(icontent) {
    // set up options
    opts0  = if (inName.endsWith(".xmp.html") || inName.endsWith(".xmp")) 
              then (opts.options)(xmp = True) else opts.options
    opts1  = opts0(metadata=opts0.metadata + [("docname",inName.stemname),("filename",inName)])

    mmopts = if (opts1.xmp) then opts1 // todo: look at first <xmp> fragment?
              else opts1.parseMeta( FmtHtml, icontent.normalizeSource ).fst  // get bibdata,bibstyle,mathimg

    // always read dims: even in dynamic mode some pdf math may exist
    dims = outName.changeExt(".dimx").readTextFileDef("")
    mdim = dims.parseMathDim(mmopts.mathImgDir, mmopts.mathDpi, mmopts.mathScale)

    xopts  = opts1(mathdim=mdim)
    mopts  = mmopts(mathdim=mdim)  

    if (mopts.verbose>=4) {
      println(mopts.metadata.map(fun(kv) { kv.fst + ": " + kv.snd }).join("\n"))
    }

    // register languages for highlighting
    curdir = cwd()
    mopts.hilitelang.split(";").foreach fun(lang) { 
      fname = if (curdir=="") then lang else lang.replace(rxCurDir,curdir)
      registerLanguage(fname) 
    }


    // copy early since async latex may start for math
    tryCopyTextFileFromTo( "madoko.css", styleDir, outName.dirname)
    if (xopts.tex || xopts.mathmode.isStatic) {
      tryCopyTextFileFromTo( "css.sty", styleDir, outName.dirname)
      tryCopyTextFileFromTo( "madoko.sty", styleDir, outName.dirname)
      ()
    }

    process( inName, outName, content, icontent, xopts, mopts, firstTime, runners) 
      fun() {
        processContent(inName,outName,content,opts,False,runners,continue) // redo!
      }
      fun(html) {
        continue(html,inName,outName,mopts)  
      }
  }
}

val rxCurDir = regex(@"^(\.)(?=[\\/])")

function process( inName : string, outName : string, content : string, icontent : string, 
                  xopts : options, mopts : options, firstTime : bool, runners : runners,
                  redo : () -> io (),
                  continue : (string) -> io () ) : io () 
{
  function genPdf(outTexName:string) {
    if (mopts.pdf) {
      (runners.runPdfLatex)( outTexName, mopts, content, function() { () } )                  
    }        
  }


  function phaseHtml() 
  {
    // markdown to html          
    val (mathDvi,(mathPdf,(warns,(logs, html)))) = 
                               withLog("math-dvi") {
                                withLog("math-pdf") {
                                 withLog("warning") { 
                                  withLog("aux") { 
                                   markdown(icontent,xopts) 
                                 }}}}

    // write html result
    if (!(tryWriteTextFile(outName,html))) {
      mopts.printErr("error: unable to write: " + outName) 
    }

    // write an aux file
    bibAux = outName.appendStem("-bib").changeExt(".aux")
    bibChanged =
      if (logs == "") then False else {
        // write the log to an aux file (both for latex, and one to track changes)
        writeCitations( logs, outName.changeExt(".aux"), inName, mopts )
        writeCitations( logs, bibAux, inName, mopts )                
      }

    // run bibtex?
    if ((bibChanged || mopts.rebuild) && firstTime && mopts.bibtex!="") {
      (runners.runBibtex)( bibAux, mopts ) fun(err) {
        redo()
      }
    }
    else {
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
        (runners.runMathStatic)( mathDvi, mathPdf, outName, mopts, content ) fun(mbmdim2) {
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


// Write citations to an aux file. Returns "True" if the bibliography data changed.
function writeCitations( auxData : string, auxName : string, docName : string, opts : options ) : io bool {
  bibStyleName = if (opts.bibStyle != "") then opts.bibStyle else "plainnat"
  bibNames = opts.bib.splitPaths
    
  oldData = readTextFileDef(auxName,"")
  initial = oldData.replaceAll(rxCite,"").replace(rxEmptyTail,"")
  newData = (if (initial!="") then initial + "\n" else "") + 
            "% Generated by Madoko, version " + version + "\n" + auxData + 
            "\n\\bibstyle{" + bibStyleName + "}\n" +
            bibNames.map(fun(nm){ "\\bibdata{" + combine(relative(auxName.dirname,docName.dirname),nm.noext) + "}\n" }).join

  if (!(tryWriteTextFile(auxName, newData))) then {
    opts.printErr("error: unable to write citations: " + auxName )
  }

  return (oldData != newData)
}
val rxCite = regex(@"^\\(citation|bibstyle|bibdata)\b.*$",multiline=True)
val rxEmptyTail = regex(@"(\s|%.*)*$")


function include( txt : string, fast : bool, outName : string, dirs : list<string>, action : (string) -> <io|e> a ) : <io|e> a {
  itxt = if (fast) then txt else txt.replaceAll(rxInclude) fun(cap) {
    fname = cap.groups.firstMatched
    if (fname=="BIB") then {
      bbl = readTextFileDef( outName.appendStem("-bib").changeExt(".bbl"), "" )  
      "~ TeX\n" + (if (bbl=="") then "\\begin{thebibliography}{00}\n\\end{thebibliography}\n" else bbl) + "\n~"
    }
    else {
      match (trySearchReadTextFile(fname,dirs,".mdk")) {
        Nothing -> {
          println("  warning: unable to read include: " + fname )
          ""
        }
        Just(content) -> content 
      }
    }
  }
  action(itxt)
}
val rxInclude = regex(@"^ {0,3}\[(?:(BIB)|INCLUDE *(?: |= *)(?:""([^""\n]+)""|'([^'\n]+)'|([^\s\]]+)) *)\] *(?=\n|$)",multiline=True)

function searchReadTextFileDef( fname : string, def : string, dirs : list<string>, ext : string = "" ) : io string {
  match(trySearchReadTextFile(fname,dirs,ext)) {
    Nothing -> def
    Just(content) -> content
  } 
}

function trySearchReadTextFile( fname : string, dirs : list<string>, ext : string = "" ) : io maybe<string> {
  match(searchFileSync(dirs,fname)) {
    Nothing -> {
      if (ext=="" || fname.extname != "") then Nothing else {
        match (searchFileSync(dirs,fname.changeExt(ext))) {
          Nothing -> Nothing
          Just(fullname) -> tryReadTextFile(fullname).maybe
        }
      }
    } 
    Just(fullname) -> tryReadTextFile(fullname).maybe
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
  match(tryReadTextFile( fileName )) {
    Left -> False
    Right(txt) -> tryWriteTextFile(outName,txt)
  }
}



