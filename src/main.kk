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
import inline  // format type
import madoko
import texFormatter
import mathStatic


public function main() : io () {
  markdownFiles("") fun(html,inName,outName,logs,opts) {
    ()
  }
}

public function test( s : string = "code_blocks", moreargs = "" ) {
  //main("test/code_blocks.text")
  root = if (s.contains(path/sep)) then combine("test",s) else combine(["test","new",s])
  input  = root + ".text"
  outputDir = "test/out"
  target = root + ".html"

  markdownFiles("-v --tex --installdir=src --odir=" + outputDir + " " + moreargs + " " + input) fun(outText,_input,output,logs,_options) {
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


public function markdownFiles(args : string, action : (string,string,string,string,commandOptions) -> <io|e> ()) : <io|e> () { 
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
            content.include(opts.options.bench, outName) fun(icontent) {
              // set up options
              xxopts = if (input.endsWith(".xmp.html") || input.endsWith(".xmp")) 
                        then (opts.options)(xmp = True) else opts.options
              mmopts = if (xxopts.xmp) then xxopts
                        else xxopts.parseMeta( icontent.normalizeSource ).fst // get bibdata,bibstyle,mathimg
              mdim   = if (mmopts.mathjax!="")
                        then dict()
                        else {
                          dims = outName.changeExt(".math.dimx").readTextFileDef("")
                          dims.parseMathDim(mmopts.mathStatic, mmopts.mathDpi, mmopts.mathScale)
                        }

              xopts  = xxopts(mathdim=mdim)
              mopts  = mmopts(mathdim=mdim)  


              // markdown to html          
              val (math,(warns,(logs, html))) = 
                                         withLog("math") {
                                          withLog("warning") { 
                                           withLog("aux") { 
                                            markdown(icontent,xopts) 
                                           }
                                          }
                                         }
              if (warns != "" && xopts.verbose >= 1) {
                print(warns)
              }

              // copy early since async latex may start for math
              tryCopyTextFileFromTo( "madoko.css", opts.installDir, outName.dirname)
              if (xopts.tex) {
                tryCopyTextFileFromTo( "css.sty", opts.installDir, outName.dirname)
                tryCopyTextFileFromTo( "madoko.sty", opts.installDir, outName.dirname)
                ()
              }

              // write html result
              if (!(tryWriteTextFile(outName,html))) {
                println("error: unable to write: " + outName) 
              }

              // possibly typeset math using latex
              if (math != "" && mmopts.mathjax=="") {
                mathStatic( math, outName.changeExt(".math.tex"), mopts, content ) fun(mdim2) {
                  // write html again
                  if (mopts.verbose>=1) println("  re-aligning math in HTML.")
                  
                  html2 = markdown(icontent,xopts(mathdim=mdim2))
                  if (!(tryWriteTextFile(outName,html2))) {
                    println("error: unable to write: " + outName) 
                  }
                  //if (mopts.verbose>=1) println("  done typesetting math.")                  
                }
              }
              
              // generate tex
              if (mopts.tex) {
                outTexName = outName.changeExt(".tex")
                if (mopts.verbose > 0) println("process: " + input + " -> " + outTexName )        
                val (texwarns, tex) = withLog("texwarning",{ markdown(icontent,xopts,FmtTex) } )
                if (texwarns != "" && mopts.verbose >= 2) print(texwarns) 
                //trace(tex)
                if (!(tryWriteTextFile(outTexName,tex))) {
                  println("error: unable to write: " + outTexName) 
                }
              }            

              if (logs != "") {
                // write out the log to an aux file
                writeCitations( logs, outName, mopts )
              }
              action(html,input,outName,logs,opts)
            }
          }
        } 
      } // foreach
    }
  }
}


function writeCitations( auxData : string, outName : string, opts : options ) : io () {
  bibStyleName = if (opts.bibStyle != "") then opts.bibStyle else "plainnat"
  bibNames = opts.bib.splitPaths
  auxName = outName.changeExt(".aux")
  initial = readTextFileDef(auxName,"").replaceAll(rxCite,"").replace(rxEmptyTail,"")
  if (!(tryWriteTextFile(auxName,
        initial + 
        "\n% Madoko generated\n" + auxData + 
        "\n\\bibstyle{" + bibStyleName + "}\n" +
         bibNames.map(fun(nm){ "\\bibdata{" + nm.noext + "}\n" }).join))) then 
  {
    println("error: unable to write citations: " + auxName )
  }
}
val rxCite = regex(@"^\\(citation|bibstyle|bibdata)\b.*$",multiline=True)
val rxEmptyTail = regex(@"(\s|%.*)*$")


function include( txt : string, fast : bool, outName : string, action : (string) -> <io|e> a ) : <io|e> a {
  itxt = if (fast) then txt else txt.replaceAll(rxInclude) fun(cap) {
    fname = cap.groups.firstMatched
    if (fname=="BIB") then {
      bbl = readTextFileDef( outName.changeExt(".bbl"), "" )  
      "~ TeX\n" + (if (bbl=="") then "\\begin{thebibliography}{00}\n\\end{thebibliography}\n" else bbl) + "\n~"
    }
    else {
      match (tryReadTextFile(fname)) {
        Left -> {
          println("warning: unable to read include: " + fname )
          ""
        }
        Right(content) -> content 
      }
    }
  }
  action(itxt)
}
val rxInclude = regex(@"^ *\[(?:(BIB)|INCLUDE *(?: |= *)(?:""([^""\n]+)""|'([^'\n]+)'|([^\s\]]+)) *)\] *(?=\n|$)",multiline=True)



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



