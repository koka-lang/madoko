/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Main Madoko command line interface
module main

import std/log
import std/regex
import std/path
import std/file
import std/dict
import common
import options
import metadata
import inline  // format type
import madoko
import texFormatter
import mathStatic
import process
import hilite

public function main() : io () {
  markdownFiles("") fun(html,inName,outName,opts) {
    ()
  }
}

public function test( s : string = "code_blocks", moreargs = "" ) {
  //main("test/code_blocks.text")
  root = if (s.contains(path/sep)) then combine("test",s) else combine(["test","new",s])
  input  = root + ".text"
  outputDir = "test/out"
  target = root + ".html"

  markdownFiles("-v --tex --installdir=src --odir=" + outputDir + " " + moreargs + " " + input) 
    fun(outText,_input,output,_options) {
    //trace("-----\n" + outText + "\n-----")
    targetText = target.readTextFileDef("")
    outStrip = outText.replaceAll(regex(@"\s"),"")
                      //.replaceAll(regex(@"class=""indent"""),"")
    targetStrip = targetText.replaceAll(regex(@"\s"),"")
    if (outStrip != targetStrip) {
      trace("\n*** test failed ***")
      //trace(targetText + "\n***")

      var i := 0;
      while { outStrip[i] == targetStrip[i] } { i := i+1 }
      trace("position: " + i.show)
      preN = 20
      i := max(0, i-preN)
      trace("inferred: " + outStrip.substr(i,preN) + " " + outStrip.substr(i+preN,40) + " ...")
      trace("expected: " + targetStrip.substr(i,preN) + " " + targetStrip.substr(i+preN,40) + "...")
      trace("***")
    }
    else {
      trace("*** test success (modulo whitespace)")
    }
    //println("done!")
  } 
}


public function markdownFiles(args : string, action : (string,string,string,options) -> <io|e> ()) : <io|e> () { 
  val mbopts = parseOptions(args);
  match(mbopts) {
    Nothing -> ()
    Just(opts) -> {
      opts.inputs.foreach fun(input) {
        outName = outputName(input,opts)    
        if (opts.options.verbose > 0) println("process: " + input + " -> " + outName )        
        match (input.tryReadTextFile()) {
          Left -> println("error: unable to read: " + input )
          Right(content) -> {
            processContent(input, outName, content, opts, True, action)
          }
        } 
      } // foreach
    }
  }
}

function processContent( inName : string, outName : string, content : string, 
                          opts : commandOptions, firstTime : bool = False,
                          continue : (string,string,string,options) -> <io|e> () ) : <io|e> () 
{
  styleDir = opts.installDir + "/../styles"
  content.include(False, outName, [styleDir,outName.dirname]) fun(icontent) {
    // set up options
    opts0  = if (inName.endsWith(".xmp.html") || inName.endsWith(".xmp")) 
              then (opts.options)(xmp = True) else opts.options
    opts1  = opts0(metadata=opts0.metadata + [("filename",inName)])              
    mmopts = if (opts1.xmp) then opts1
              else opts1.parseMeta( FmtHtml, icontent.normalizeSource ).fst // get bibdata,bibstyle,mathimg
    mdim   = if (!(mmopts.mathmode.isStatic))
              then dict()
              else {
                dims = outName.changeExt(".math.dimx").readTextFileDef("")
                dims.parseMathDim(mmopts.mathImgDir, mmopts.mathDpi, mmopts.mathScale)
              }

    xopts  = opts1(mathdim=mdim)
    mopts  = mmopts(mathdim=mdim)  

    // register languages for highlighting
    mopts.hilitelang.split(";").foreach fun(lang) { registerLanguage(lang) }

    // copy early since async latex may start for math
    tryCopyTextFileFromTo( "madoko.css", styleDir, outName.dirname)
    if (xopts.tex || xopts.mathmode.isStatic) {
      tryCopyTextFileFromTo( "css.sty", styleDir, outName.dirname)
      tryCopyTextFileFromTo( "madoko.sty", styleDir, outName.dirname)
      ()
    }

    process( inName, outName, content, icontent, xopts, mopts, firstTime) 
      fun() {
        processContent(inName,outName,content,opts,False,continue) // redo!
      }
      fun(html) {
        continue(html,inName,outName,mopts)  
      }
  }
}

function process( inName : string, outName : string, content : string, icontent : string, 
                  xopts : options, mopts : options, firstTime : bool,
                  redo : () -> <io|e> (),
                  continue : (string) -> <io|e> () ) : <io|e> () 
{
  function genPdf(outTexName:string) {
    if (mopts.pdf) {
      runPdfLaTeX( outTexName, mopts, content, function() { () } )                  
    }        
  }


  function phaseHtml() 
  {
    // markdown to html          
    val (math,(warns,(logs, html))) = 
                               withLog("math") {
                                withLog("warning") { 
                                 withLog("aux") { 
                                  markdown(icontent,xopts) 
                                 }
                                }
                               }

    // write html result
    if (!(tryWriteTextFile(outName,html))) {
      println("error: unable to write: " + outName) 
    }

    // write an aux file
    bibAux = outName.changeExt(".bib.aux")
    bibChanged =
      if (logs == "") then False else {
        // write the log to an aux file (both for latex, and one to track changes)
        writeCitations( logs, outName.changeExt(".aux"), mopts )
        writeCitations( logs, bibAux, mopts )                
      }

    // run bibtex?
    if ((bibChanged || mopts.rebuild) && firstTime && mopts.bibtex!="") {
      runBibtex( bibAux, mopts ) fun(err) {
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
        if (mopts.verbose > 0) println("process: " + inName + " -> " + outTexName )        
        val (texwarns, tex) = withLog("texwarning",{ markdown(icontent,xopts,FmtTex) } )
        if (texwarns != "" && mopts.verbose >= 2) print(texwarns) 
        //trace(tex)
        if (!(tryWriteTextFile(outTexName,tex))) {
          println("error: unable to write: " + outTexName) 
        }
      }

      // possibly typeset math using latex
      if (math != "" && mopts.mathmode.isStatic) {
        mathStatic( math, outName.changeExt(".math.tex"), mopts, content ) fun(mbmdim2) {
          match(mbmdim2) {
            Just(mdim2) -> {
              // write html again
              if (mopts.verbose>=1) println("  re-aligning math in HTML.")
              
              html2 = markdown(icontent,xopts(mathdim=mdim2))
              if (!(tryWriteTextFile(outName,html2))) {
                println("error: unable to write: " + outName) 
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
function writeCitations( auxData : string, auxName : string, opts : options ) : io bool {
  bibStyleName = if (opts.bibStyle != "") then opts.bibStyle else "plainnat"
  bibNames = opts.bib.splitPaths
  oldData = readTextFileDef(auxName,"")
  initial = oldData.replaceAll(rxCite,"").replace(rxEmptyTail,"")
  newData = (if (initial!="") then initial + "\n" else "") + 
            "% Generated by Madoko, version " + version + "\n" + auxData + 
            "\n\\bibstyle{" + bibStyleName + "}\n" +
            bibNames.map(fun(nm){ "\\bibdata{" + nm.noext + "}\n" }).join

  if (!(tryWriteTextFile(auxName, newData))) then {
    println("error: unable to write citations: " + auxName )
  }

  return (oldData != newData)
}
val rxCite = regex(@"^\\(citation|bibstyle|bibdata)\b.*$",multiline=True)
val rxEmptyTail = regex(@"(\s|%.*)*$")


function include( txt : string, fast : bool, outName : string, dirs : list<string>, action : (string) -> <io|e> a ) : <io|e> a {
  itxt = if (fast) then txt else txt.replaceAll(rxInclude) fun(cap) {
    fname = cap.groups.firstMatched
    if (fname=="BIB") then {
      bbl = readTextFileDef( outName.changeExt(".bib.bbl"), "" )  
      "~ TeX\n" + (if (bbl=="") then "\\begin{thebibliography}{00}\n\\end{thebibliography}\n" else bbl) + "\n~"
    }
    else {
      match (trySearchReadTextFile(fname,dirs)) {
        Nothing -> {
          println("warning: unable to read include: " + fname )
          ""
        }
        Just(content) -> content 
      }
    }
  }
  action(itxt)
}
val rxInclude = regex(@"^ *\[(?:(BIB)|INCLUDE *(?: |= *)(?:""([^""\n]+)""|'([^'\n]+)'|([^\s\]]+)) *)\] *(?=\n|$)",multiline=True)

function searchReadTextFileDef( fname : string, def : string, dirs : list<string> ) : io string {
  match(trySearchReadTextFile(fname,dirs)) {
    Nothing -> def
    Just(content) -> content
  } 
}

function trySearchReadTextFile( fname : string, dirs : list<string> ) : io maybe<string> {
  match(searchFileSync(dirs,fname)) {
    Nothing -> Nothing
    Just(fullname) -> tryReadTextFile(fullname).maybe
  }
}

function outputName( inputName : string, options : commandOptions ) {
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



