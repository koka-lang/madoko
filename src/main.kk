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
import process

external import {
  js "fs"
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
              dims   = outName.changeExt("math.dim").readTextFileDef("")
              mdim   = dims.parseMathDim(outName.dirname,"img",opts.options.mathScale)

              dopts  = (opts.options)(mathdim=mdim)  
              xopts  = if (input.endsWith(".xmp.html") || input.endsWith(".xmp")) 
                        then dopts(xmp = True) else dopts

              //val (mopts,mcontent) = parseMeta(xopts,icontent)              
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

              if (math != "") {
                outMathName = outName.changeExt(".math.tex")
                oldMath = readTextFileDef(outMathName,"")
                body = "\\begin{mdSnippets}\n" + math + "\\end{mdSnippets}"
                outMath = fmtTexFull(body,xopts)
                if (outMath != oldMath) {
                  if (xopts.verbose>=1) println("  typesetting math...")
                  if (!(tryWriteTextFile(outMathName,outMath))) {
                    println("error: unable to write: " + outMathName)
                  }
                  else {
                    latexCmd = xopts.latex + " -halt-on-error -interaction=batchmode \"" + outMathName.basename + "\""
                    if (xopts.verbose>=1) println("  running latex on math...")
                    if (xopts.verbose>=2) println("  > " + latexCmd)
                    system(latexCmd, function(err:int,stdout:string,stderr:string) {
                      if (err!=0) {
                        println("error: latex failed while typesetting math: \n" + stdout + stderr )
                      }
                      else {
                        dvipngCmd = xopts.dvipng + " -T tight -z9 -bg Transparent" + 
                                      " -D" + xopts.mathDpi.show +
                                      " -o " + "img" + "/eq-%d.png" +
                                      " " + outMathName.basename.changeExt(".dvi")
                        if (xopts.verbose>=1) println("  running dvipng on math...")
                        if (xopts.verbose>=2) println("  > " + dvipngCmd)
                        system(dvipngCmd,function(err2,stdout2,stderr2) {
                          if (err2 != 0) {
                            println("error: dvipng failed while typesetting math: \n" + stdout2 + stderr2)
                          }
                          else {
                            // write html again
                            if (xopts.verbose>=1) println("  aligning math in HTML...")
                            
                            html2 = markdown(icontent,xopts)
                            if (!(tryWriteTextFile(outName,html2))) {
                              println("error: unable to write: " + outName) 
                            }
                            else {
                              if (xopts.verbose>=1) println("  done typesetting math.")
                            }
                          }
                        },30000,dirname(outMathName))              
                      }     
                    },10000,dirname(outMathName))
                  }                
                }
              }

              if (!(tryWriteTextFile(outName,html))) {
                println("error: unable to write: " + outName) 
              }
              
              if (xopts.tex) {
                outTexName = outName.changeExt(".tex")
                if (opts.options.verbose > 0) println("process: " + input + " -> " + outTexName )        
                val (texwarns, tex) = withLog("texwarning",{ markdown(icontent,xopts,FmtTex) } )
                if (texwarns != "" && xopts.verbose >= 2) print(texwarns) 
                //trace(tex)
                if (!(tryWriteTextFile(outName.changeExt(".tex"),tex))) {
                  println("error: unable to write: " + outName.changeExt(".tex")) 
                }
              }            

              if (logs != "") {
                //trace(logs)
                // write out the log to an aux file
                mopts = if (xopts.xmp) then xopts else xopts.parseMeta( icontent.normalizeSource ).fst // get bibdata and bibstyle
                bibStyleName = if (mopts.bibStyle != "") then mopts.bibStyle else "plainnat"
                bibNames = mopts.bib.splitPaths
                auxName = outName.changeExt(".aux")
                initial = readTextFileDef(auxName,"").replaceAll(rxCite,"").replace(rxEmptyTail,"")
                if (!(tryWriteTextFile(auxName,
                      initial + 
                      "\n% Madoko generated\n" + logs + 
                      "\n\\bibstyle{" + bibStyleName + "}\n" +
                       bibNames.map(fun(nm){ "\\bibdata{" + nm.noext + "}\n" }).join))) then 
                {
                  println("error: unable to write citations: " + auxName )
                }
              }
              tryCopyTextFileFromTo( "madoko.css", opts.installDir, outName.dirname)
              if (xopts.tex) {
                tryCopyTextFileFromTo( "css.sty", opts.installDir, outName.dirname)
                tryCopyTextFileFromTo( "madoko.sty", opts.installDir, outName.dirname)
                ()
              }
              action(html,input,outName,logs,opts)
            }
          }
        } 
      } // foreach
    }
  }
}



val rxCite = regex(@"^\\(citation|bibstyle|bibdata)\b.*$",multiline=True)
val rxEmptyTail = regex(@"(\s|%.*)*$")

public function main() : io () {
  markdownFiles("") fun(html,inName,outName,logs,opts) {
    ()
  }
}

function outputName( inputName : string, options : commandOptions ) {
  noextName = if (inputName.endsWith(".xmp.html")) then inputName.substr(0,inputName.length-9) else inputName.noext 
  outName = noextName + ".html"
  if (options.outputDir=="") 
   then outName 
   else options.outputDir + "/" + outName.basename                  
}


function readTextFileDef( fileName : string, def : string ) : io string {
  match (fileName.tryReadTextFile()) {
    Left(_exn) -> def
    Right(content) -> content
  }
}


function tryCopyTextFile( fileName : string, outName : string ) : io bool {
  match(tryReadTextFile( fileName )) {
    Left -> False
    Right(txt) -> tryWriteTextFile(outName,txt)
  }
}

function tryCopyTextFileFromTo( fname, srcDir, outDir ) {
  tryCopyTextFile( combine(srcDir,fname), combine(outDir,fname))
}



// parse a dimension file written by latex snippets
function parseMathDim( txt : string, cwd : string = ".", imgPrefix : string = ".", imgScale : int = 100 ) : io dict<mathinfo> {
  mi = mdict()
  scale = imgScale.double / 100.0
  txt.findAll(rxDimLine).foreach fun(cap) {
    imageName = imgPrefix + "/eq-" + cap.groups[1] + ".png"
    height = scale * dimension(cap.groups[3],cap.groups[4])
    depth  = scale * dimension(cap.groups[5],cap.groups[6])
    width  = scale * dimension(cap.groups[7],cap.groups[8])
    rawData = readImageData(cwd + "/" + imageName)
    imageData = if (rawData == "" || rawData.length>=1000) then "" 
                 else {
                    trace("inline image: " + imageName )
                    "data:image/png;base64," + rawData
                  }
    mi[cap.groups[2]] := Mathinfo(imageName,height,depth,width,imageData)
  }
  return mi.freeze()
} 

function readImageData( fname : string ) : io string {
  catch( { readFileSyncBase64(fname) }, function(exn) { return "" } )
}

val rxDimLine = regex(@"^(\d+) *, *([a-zA-Z0-9]+) *" + rxDim + rxDim + rxDim + "$", multiLine=True)
val rxDim = @", *(\d+)(?:\.(\d+))? *pt\b *"

function dimension( whole : string, fraction : string ) : double {
  w = whole.parseInt.maybe(0,id).double
  f = (fraction + "00").substr(0,2).parseInt.maybe(0,id).double / 100.0
  return (w+f)
}