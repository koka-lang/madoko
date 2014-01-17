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
              xxopts = if (input.endsWith(".xmp.html") || input.endsWith(".xmp")) 
                        then (opts.options)(xmp = True) else opts.options
              mmopts = if (xxopts.xmp) then xxopts
                        else xxopts.parseMeta( icontent.normalizeSource ).fst // get bibdata,bibstyle,mathimg
              dims   = outName.changeExt(".math.dimx").readTextFileDef("")
              mdim   = dims.parseMathDim(mmopts.mathStatic, mmopts.mathDpi, mmopts.mathScale)

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
              if (math != "") {
                mathStatic( math, outName.changeExt(".math.tex"), mopts, content ) fun(mdim2) {
                  // write html again
                  if (mopts.verbose>=1) println("  re-aligning math in HTML...")
                  
                  html2 = markdown(icontent,xopts(mathdim=mdim2))
                  if (!(tryWriteTextFile(outName,html2))) {
                    println("error: unable to write: " + outName) 
                  }
                  else {
                    if (mopts.verbose>=1) println("  done typesetting math.")
                  }
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


function mathStatic( math : string, texName : string, xopts : options, content : string, continue : (dict<mathinfo>) -> io () ) : io () {
  oldMath = readTextFileDef(texName,"")
  body = "\\begin{mdSnippets}\n" + math + "\\end{mdSnippets}"
  outTex = fmtTexFull(body,if (xopts.mathDocClass!="") then xopts(docClass=xopts.mathDocClass) else xopts)

  outHdr = "% MathDpi: " + xopts.mathDpi.show + 
            ", MathStatic: " + xopts.mathStatic +
            ", MathEmbedLimit: " + xopts.mathEmbedLimit.show + 
            ", MathDocClass: " + xopts.mathDocClass + "\n"
  outMath = outHdr + outTex
  if (outMath != oldMath) {
    if (xopts.verbose>=1) println("  typesetting math...")
    if (!(tryWriteTextFile(texName,outMath))) {
      println("error: unable to write: " + texName)
    }
    else {
      mathSnippetsToDvi( texName, xopts, content, outMath, oldMath ) {
        pages = match(oldMath.find(rxHdr)) {
                  Just(cap) | cap.matched==outHdr -> mathAnalyseChanged( outMath, xopts.mathdim )
                  _ -> (0,mathAnalyseChanged(outMath,dict()).snd) 
                }
        mathDviToPng( texName.changeExt(".dvi"), xopts, pages ) {
          mathDimAnalyse( texName.changeExt(".dimx"), xopts, pages, continue )
        }      
      }
    }
  }
}
val rxHdr = regex(@"^.*\n")

function mathAnalyseChanged( snippets : string, dim : dict<mathinfo> ) : (int,int) {
  var page := 1
  var pageLo := 1
  var pageHi := 0
  
  digests = snippets.findAll(rxDigest).list.map( fun(cap) { cap.groups[1] })
  digests.map fun(digest) {
    match(dim[digest]) {
      Nothing  -> {
        pageHi := page
      }
      Just(_) -> {
        if (page==pageLo) then pageLo := page + 1
      } 
    }
    page := page + 1
  }

  (pageLo,pageHi)
}

val rxDigest = regex(@"\\begin{\w+?Snippet}[\[\{]([a-fA-F0-9]{32})[\}\]]")

function mathSnippetsToDvi( texName : string, xopts : options, 
                            content : string, texContent :string, oldMath : string, continue : () -> io () ) : io () {
  latexCmd = xopts.latex + " -halt-on-error -interaction=batchmode \"" + texName.basename + "\""
  if (xopts.verbose>=1) println("  running latex on math...")
  if (xopts.verbose>=3) println("  > " + latexCmd)
  system(latexCmd, function(err:int,stdout:string,stderr:string) {
    if (err!=0) {
      println("error: latex failed while typesetting math:" )
      logout = readTextFileDef(texName.changeExt(".log"),"")
      match(logout.find(rxLatexErr)) {
        Just(cap) -> {
          match(content.findLatexLine(cap.matched,texContent)) {
            Just(lineNo) -> println("error: source line: " + lineNo.show)
            Nothing -> ()
          }
          println(cap.matched)
        }  
        Nothing -> ()
      }
      println("log written at: " + texName.changeExt(".log"))
      tryWriteTextFile(texName,oldMath) // restore old math version
      ()
    }
    else {
      continue()
    }
  },0, dirname(texName))
}
val rxLatexErr = regex(@"^![\s\S]*?(?=^\s*(?:!|Here is how much of TeX's memory you used:|Type X to quit))",multiline=True)

function findLatexLine( src : string, texerr : string, texSrc : string ) : maybe<int> {
  match(texerr.find(rxLatexLineNum)) {
    Nothing -> Nothing
    Just(cap) -> {
      lineStart0 = cap.groups[2]
      lineStart = if (!(lineStart0.contains(rxLatexEndSnippet))) then lineStart0
                  else { // find line before it in the TeX source
                    lineNo = cap.groups[1].parseInt.maybe(0,id)
                    match(texSrc.lines.list.drop(lineNo-2)) {
                      Cons(line) -> line
                      _          -> lineStart0
                    }
                  }

      ilines = src.lines.list.mapIndexed(fun(idx,line) { (idx,line) })
      match(ilines.find(fun(iline){ iline.snd.contains(lineStart)})) {
        Nothing -> Nothing
        Just(iline) -> Just(iline.fst+1)
      }
    }
  }
}
val rxLatexLineNum = regex(@"^l\.(\d+) +(?:\\\[|\$)?(.*)",multiline=True)
val rxLatexEndSnippet = regex(@"\\end{md(Inline|Display)?Snippet}")

function mathDviToPng( dviName : string, xopts : options, pages : (int,int), continue : () -> io () ) : io () 
{  
  val (pageLo,pageHi) = pages
  if (pageHi < pageLo) then return continue()
  
  dvipngCmd = xopts.dvipng + " -T tight -z9 -bg Transparent" + 
                                      " -D" + xopts.mathDpi.show +
                                      (if (pageLo==0) then "" 
                                        else " -p" + pageLo.show + " -l" + pageHi.show) + 
                                      " -o " + combine(xopts.mathStatic,"eq-%d.png") +
                                      " " + dviName.basename
  // make sure the output directory exists
  outDir = combine(dviName.dirname,xopts.mathStatic)
  if (!(fexists(outDir))) {
    if (xopts.verbose>=1) println("  create: " + outDir)
    mkdirp(outDir)
  }                                      
  // run dvipng
  if (xopts.verbose>=1) println("  running dvipng on math... (" + pageLo.show + "-" + pageHi.show + ")")
  if (xopts.verbose>=3) println("  > " + dvipngCmd)
  system(dvipngCmd,function(err2,stdout2,stderr2) {
    if (err2 != 0) {
      println("error: dvipng failed while typesetting math: \n" + stdout2 + stderr2)
    }
    else {
      continue()
    }
  },0,dirname(dviName))
}

function mathDimAnalyse( dimxName : string, xopts : options, pages : (int,int), continue : (dict<mathinfo>) -> io () ) : io () {
  if (xopts.verbose>=1) println("  analyse and embed math images...")
  dims2 = extendDim(pages, dimxName, xopts )
  mdim2 = dims2.parseMathDim(xopts.mathStatic, xopts.mathDpi, xopts.mathScale)
  mathImageGC(mdim2,xopts.mathdim,dimxName.dirname)
  continue( mdim2 )
}

function mathImageGC( newDim : dict<mathinfo>, oldDim : dict<mathinfo>, outDir : string ) : io ()
{
  oldDim.list.foreach fun(kv) {
    val (digest,mi) = kv
    match(newDim[digest]) {
      Just -> ()
      Nothing -> {
        imageFile = combine(outDir,mi.imageName)
        unlink(imageFile)
      }
    }
  }
}


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


function extendDim( pages : (int,int), dimxFile : string, opts : options  ) : io string
{
  val (pageLo,pageHi) = pages
  var imageSize := 0  
  var imageCount := 0
  var embedSize := 0
  var embedCount := 0
  dim = opts.mathdim
  dims = (readTextFileDef(dimxFile.changeExt(".dim"),"")).lines
  dimsx = dims.map fun(line) {
    match(line.find(rxDimLine)) {
      Nothing   -> line
      Just(cap) -> { 
        pageNo = cap.groups[2].parseInt.maybe(0,id)
        digest = cap.groups[3]
        imageName = combine(opts.mathStatic, "eq-" + cap.groups[2] + ".png")
        imageFile = combine(dimxFile.dirname,imageName)
                
        val (pxwidth,pxheight,size,embed) 
          = match(dim[digest]) {
              Just(mi) | (pageNo < pageLo || (pageHi > 0 && pageNo > pageHi)) 
                -> {                  
                  //trace("known image: " + digest)
                  (mi.pxwidth,mi.pxheight,mi.size,mi.imageData)
                }
              _ -> {
                match( tryReadFileSync( imageFile )) {
                  Nothing   -> {
                    trace("cannot read; " + imageFile)
                    (0,0,0,"") // should not happen?
                  }
                  Just(buf) -> {
                    base64 = buf.string("base64")
                    pxwidth = buf.readInt4(16)
                    pxheight = buf.readInt4(20)
                    //trace("image " + cap.groups[2] + ": " + pxwidth.show + "," + pxheight.show)
                    pngprefix = "data:image/png;base64,"

                    embed = if (base64!="" && base64.length + pngprefix.length < opts.mathEmbedLimit)
                             then pngprefix + base64 else ""
                    size  = if (embed=="") then {
                              // give robust name  
                              imageDigestFile = combine(imageFile.dirname,"math-" + digest + ".png")
                              if (fexists(imageDigestFile)) // happens to be duplicate formula
                               then unlink(imageFile)
                               else rename(imageFile,imageDigestFile)
                              buf.length 
                            }
                            else {
                              unlink(imageFile) // delete the image
                              embed.length
                            }
                    (pxwidth,pxheight,size,embed)
                  }
                }
              }
            }
        
        if (pxwidth==0 || pxheight==0) then line else {
          if (embed == "") then {
            imageSize  := imageSize + size
            imageCount := imageCount + 1            
          }
          else {
            embedSize  := embedSize + size
            embedCount := embedCount + 1
          }  
          cap.groups[1] + "," + pxwidth.show + "px," + pxheight.show + "px," + 
            opts.mathDpi.show + "dpi," + size.show + (if (embed=="") then "" else (", " + embed))
        }
      }
    }
  }
  txt = dimsx.unlines
  tryWriteTextFile( dimxFile, txt )
  if (opts.verbose >= 2) {
    totalCount = imageCount + embedCount
    totalSize = imageSize + embedSize
    println("   math images  : " + imageCount.show.align(4) + " in " + imageSize.showSize )
    println("   math embedded: " + embedCount.show.align(4) + " in " + embedSize.showSize )
    println("   math total   : " + totalCount.show.align(4) + " in " + totalSize.showSize )
  }
  txt
}

function showSize( size : int ) : string {
  kb = 1024
//  mb = kb*kb
  if (size < 10*kb) 
   then (size.double / kb.double).showFixed(1).align(4) + " kb"
   else ((size + kb - 1)/kb).show.align(4) + " kb"
//  elif (size < 10*mb) 
//   then (size.double/mb.double).showFixed(1) + "mb"
//   else ((size + mb - 1)/mb).show + "mb"
}

function tryReadFileSync( fname : string ) : io maybe<buffer> {
  catch({ b = readFileSync(fname); Just(b) },fun(_exn){ Nothing } )
}

// parse a dimension file written by latex snippets
function parseMathDim( txt : string, imgPrefix : string, imgDpi : int, imgScale : int  ) : dict<mathinfo> {
  mi = mdict()
  scale = imgScale.double / 100.0
  txt.findAll(rxDimLine).foreach fun(cap) {
    imageName = imgPrefix + "/math-" + cap.groups[3] + ".png"
    ptwidth   = dimension(cap.groups[4],cap.groups[5])
    ptheight  = dimension(cap.groups[6],cap.groups[7])
    depth     = dimension(cap.groups[8],cap.groups[9])
    pxwidth   = cap.groups[10].parseInt.maybe(-1,id)
    pxheight  = cap.groups[11].parseInt.maybe(-1,id)
    dpi       = cap.groups[12].parseInt.maybe(imgDpi,id)
    size      = cap.groups[13].parseInt.maybe(0,id)
    
    ppt    = dpi.double/72.27
    height = if (pxheight >= 0) then pxheight.double / ppt else ptheight
    width  = if (pxwidth >= 0) then pxwidth.double / ppt else ptwidth

    //trace("found: " + cap.groups[2] + ": " + cap.groups[3])
    mi[cap.groups[3]] := Mathinfo(imageName,scale*height,scale*width,scale*depth,
                                    pxwidth,pxheight,size,cap.groups[14])
  }
  return mi.freeze()
} 

val rxDimLine = regex(@"^((\d+) *, *([a-zA-Z0-9]+) *" + 
                          rxDim + rxDim + rxDim + ")" +
                           "(?:" + rxPix + rxPix + rxDpi + rxNum + rxEmbed + ")?$", multiLine=True)
val rxDim = @", *(\d+)(?:\.(\d+))? *pt\b *"
val rxPix = @", *(\d+) *(?:px\b *)?"
val rxDpi = @"(?:, *(\d+) *dpi\b *)?"
val rxEmbed = @"(?:, *(data:.*))?"
val rxNum   = @", *(\d+) *"

function dimension( whole : string, fraction : string ) : double {
  w = whole.parseInt.maybe(0,id).double
  f = (fraction + "00").substr(0,2).parseInt.maybe(0,id).double / 100.0
  return (w+f)
}