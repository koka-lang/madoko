/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Process math statically as LaTeX generated snippets
module mathStatic

import std/string
import std/regex
import std/path
import std/file
import std/dict
import common
import options
import texFormatter
import process


public function runBibtex( bibFile : string, opts : options, continue : bool -> <io|e> ()) : <io|e> () {
  if (opts.verbose>=1) println("  running bibtex to generate bibliography...")
  bibtexCmd = opts.bibtex + " \"" + bibFile.basename + "\""
  if (opts.verbose>=3) println("  > " + bibtexCmd)
  system(bibtexCmd, function(err:int,stdout:string,stderr:string) {
    if (err!=0) {
      println("> " + bibtexCmd)
      system(bibtexCmd + " -version") function(errx:int,stdoutx,stderrx) {
        if (errx!=0) {
          println("could not find BibTeX: \"" + bibtexCmd + "\"")
          println("set the 'BibTeX: ...' key or give the '--bib=<cmd>' command line option.")
        }
        else {
          println(stdout + stderr)
        }
        continue(True)
      }
    }
    else continue(False)
  },0,bibFile.dirname)
}

public function runPdfLaTeX( texFile : string, opts : options, content : string = "", continue : () -> io () ) {
  if (opts.verbose>=1) println("  running latex to generate pdf...")
  notfound = "set the 'Pdf Latex: <cmd>' key in the metadata?"
  pdfCmd = if (opts.pdflatex!="") then opts.pdflatex else "pdf" + opts.latex
  runLaTeX( texFile, pdfCmd, opts, content, notfound, 0, True,
    function() { () }, continue )  
}


function runLaTeX( texFile : string, texCmd : string, opts : options, 
                    content : string,
                    notfound : string,
                    runCount : int = 0,
                    showWarnings : bool = True,
                    onError : () -> io (),
                    onSuccess : () -> io () )
{
  latexCmd = texCmd + " -halt-on-error -interaction=batchmode \"" + texFile.basename + "\""
  if (opts.verbose>=3) println("  > " + latexCmd)
  system(latexCmd, function(err:int,stdout:string,stderr:string) {
    logout = readTextFileDef(texFile.changeExt(".log"),"")
    if (err!=0) {
      println("error while running: " + latexCmd)
      //println(stdout + stderr)
      match(logout.find(rxLatexErr)) {
        Just(cap) -> {          
          texContent = readTextFileDef(texFile,"")
          match (content.findLatexLine(cap.matched,texContent)) {
            Just(lineNo) -> println("error: source line: " + lineNo.show)
            Nothing -> ()
          }
          println(cap.matched)
        }
        Nothing -> {
          system(texCmd + " -version") function(errx:int,stdoutx,stderrx) {
            if (errx!=0) {
              println("could not find latex: \"" + texCmd + "\"")
              if (notfound != "") println(notfound)
            }
            else {
              println(stdout + stderr)
            }
          }
        }
      }
      println("log written at: " + texFile.changeExt(".log"))
      onError()
    }
    else {
      if (runCount <= 2 && logout.contains(rxLatexRerun)) {
        if (opts.verbose >= 1) println("  rerun latex to resolve references...")
        runLaTeX( texFile, texCmd, opts, content, notfound, runCount+1, showWarnings, onError, onSuccess)
      }
      else {
        if (showWarnings) then latexShowWarnings(texFile,logout,opts)
        onSuccess()
      }
    }
  },0,texFile.dirname)
} 
val rxLatexErr = regex(@"^\*\* ERROR .*|^![\s\S]*?(?=^\s*(?:Here is how much of TeX's memory you used:|Type X to quit))",multiline=True)

val rxLatexRerun = regex(@"^(Package|Latex) .*?warning\b.*?Rerun\b",multiline=True,ignoreCase=True)

public function mathStatic( math : string, texName : string, xopts : options, content : string, 
                            continue : (maybe<dict<mathinfo>>) -> io () ) : io () 
{
  texFinalName = texName.changeExt(".final.tex")
  oldMath = readTextFileDef(texFinalName,"")
  body = "\\begin{mdSnippets}\n" + math + "\\end{mdSnippets}"
  outTex = fmtTexMathFull(body,if (xopts.mathDocClass!="") then xopts(docClass=xopts.mathDocClass) else xopts)

  outHdr = "% MathDpi: " + xopts.mathDpi.show + 
            ", MathImgDir: " + xopts.mathImgDir +
            ", MathEmbedLimit: " + xopts.mathEmbedLimit.show + 
            ", MathConvert: " + xopts.mathconvert + 
            ", MathDocClass: " + xopts.mathDocClass + "\n"
  outMath = outHdr + outTex
  if (outMath != oldMath || xopts.rebuild) {
    if (xopts.verbose>=1) println("  typesetting math...")
    if (!(tryWriteTextFile(texName,outMath))) {
      println("error: unable to write: " + texName)
      continue(Nothing)
    }
    else {
      mathSnippetsToDvi( texName, xopts, content, oldMath ) {
        pages = match(oldMath.find(rxHdr)) {
                  Just(cap) | cap.matched==outHdr -> mathAnalyseChanged( outMath, xopts.mathdim,xopts.rebuild )
                  _ -> (1,mathAnalyseChanged(outMath,dict(),xopts.rebuild).snd) 
                }
        mathDviToPng( texName.changeExt(".dvi"), xopts, pages ) {
          mathConvertPng( texName.changeExt(".dvi"), xopts, pages ) {
            mathDimAnalyse( texName.changeExt(".dimx"), xopts, pages ) fun(mbmath) {
              if (mbmath.isJust) {
                rename(texName,texFinalName); // save result to prevent rebuilds
              }
              continue(mbmath)
            }
          }
        }      
      }
    }
  }
  else continue(Nothing)
}
val rxHdr = regex(@"^.*\n")

function mathAnalyseChanged( snippets : string, dim : dict<mathinfo>, rebuild : bool ) : (int,int) {
  var page := 1
  var pageLo := 1
  var pageHi := 0
  
  digests = snippets.findAll(rxDigest).list.map( fun(cap) { cap.groups[1] })
  if (rebuild) return (1,digests.length.max(1))

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
                            content : string, oldMath : string, continue : () -> io () ) : io () {
  if (xopts.verbose>=1) println("  running latex on math...")
  notfound = "set either the 'Math Mode: Dynamic' or the 'Latex: <cmd>' key in the metadata"
  runLaTeX( texName, xopts.latex, xopts, content, notfound, 0, False,
    function () { () }, continue ) 
}

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
      if (lineStart.trim.length < 3) then Nothing else { // ensure at least 3 chars for more reliable match
        ilines = src.lines.list.mapIndexed(fun(idx,line) { (idx,line) })
        match(ilines.find(fun(iline){ iline.snd.contains(lineStart)})) {
          Nothing -> Nothing
          Just(iline) -> Just(iline.fst+1)
        }
      }
    }
  }
}
val rxLatexLineNum = regex(@"^l\.(\d+) +(?:\\\[|\$)?(.*)",multiline=True)
val rxLatexEndSnippet = regex(@"\\end{md(Inline|Display)?Snippet}")


function latexShowWarnings(texFile:string,logout:string,opts:options) : io () 
{
  if (opts.verbose<2) then return ()
  warnings = logout.findAll(rxLatexWarning).list.map(fun(cap) { (cap.index,cap.matched) })
  if (warnings.isNil) then return () 

  texlines = readTextFileDef(texFile,"").lines
  warnings.foreach fun(iw) {
    val (index,warning0) = iw
    warning = warning0.replace(rxLatexBrackets,"")
    warn = match(warning.find(rxLatexLine)) {
      Nothing   -> {
        match(warning.find(rxLatexOutputActive)) { 
          Just -> {  // find a page
            match(logout.substr(0,index).findAll(rxLatexPage).list.reverse) {
              Cons(pcap,_) -> warning + "\n> page " + pcap.groups[1]               
              Nil -> warning
            }  
          } 
          Nothing -> warning 
        }
      }
      Just(cap) -> {
        lineNo = cap.groups[1].parseInt.maybe(0,id)
        line = texlines.latexFindLine(lineNo)
        if (line!="") then (warning + "\n> " + line.substr(0,76)) else warning
      }
    }
    println(warn + "\n")
  }
  match(logout.find(rxLatexOutput)) {
    Just(cap) -> println(cap.matched)
    Nothing   -> if (warnings.isCons) println("end of latex warnings.")  
  }
}

val rxLatexLine = regex(@"lines?[\s:]*(\d+).*$") // only match single line warnings
val rxLatexOutputActive = regex(@"\output is active\s*$") // only match single line 
val rxLatexPage = regex(@"\s\[(\d+)\]")
val rxLatexOutput = regex(@"^Output written on .*", multiline=True)
val rxLatexBrackets = regex(@"(\s|[\[\]])+$")
val rxLatexWarning = regex(@"^(Overfull|Underfull|[\w ]*[Ww]arning:)[\s\S]*?\n *$", multiline=True)

function latexFindLine( src : vector<string>, lineNo : int, direction : int = 0 ) : div string
{
  line = latexGetLine(src,lineNo)
  if (line.startsWith(@"\end") && direction <= 0) {
    latexFindLine(src,lineNo-1,-1)
  }
  elif (line.startsWith(@"\begin") && direction >= 0) {
    latexFindLine(src,lineNo+1,1)
  }
  else {
    line
  }
}

function latexGetLine( src : vector<string>, lineNo : int ) : string
{
  if (lineNo <= 0 || lineNo > src.length) then "" else {
    catch( { src[lineNo-1] }, fun(_) { "" })
  }
}

        

function mathDviToPng( dviName : string, xopts : options, pages : (int,int), continue : () -> io () ) : io () 
{  
  val (pageLo,pageHi) = pages
  if (pageHi < pageLo) then return continue()
  stem = dviName.stemname
  
  dvipngCmd = xopts.dvipng + " -T tight -z9 -bg Transparent" + 
                                      " -D" + xopts.mathDpi.show +
                                      (if (pageLo==0) then "" 
                                        else " -p" + pageLo.show + " -l" + pageHi.show) + 
                                      " -o " + combine(xopts.mathImgDir,stem + "-eq-%d.png") +
                                      " " + dviName.basename
  // make sure the output directory exists
  outDir = combine(dviName.dirname,xopts.mathImgDir)
  if (!(fexists(outDir))) {
    if (xopts.verbose>=1) println("  create: " + outDir)
    mkdirp(outDir)
  }                                      
  // run dvipng
  if (xopts.verbose>=1) println("  generating math images... (" + pageLo.show + "-" + pageHi.show + ")")
  if (xopts.verbose>=3) println("  > " + dvipngCmd)
  system(dvipngCmd,function(err2,stdout2,stderr2) {
    if (err2 != 0) {
      println("> " + dvipngCmd)
      println("error: dvipng failed while typesetting math: \n" + stdout2 + stderr2)      
    }
    else {
      continue()
    }
  },0,dirname(dviName))
}

function mathConvertPng( dviName : string,xopts : options, pages : (int,int), continue : () -> io () ) : io () 
{
  if (xopts.mathconvert=="") then continue() else {
    val (pageLo,pageHi) = pages
    convertCmd = xopts.mathconvert + " " + dviName.stemname + "-eq-%d.png[" + 
                          pageLo.show + "-" + pageHi.show + "]" +
                          " -scene " + pageLo.show + " " + dviName.stemname + "-eqc.png"
    if (xopts.verbose>=1) println( "  converting math images..." )
    if (xopts.verbose>=3) println( "  > " + convertCmd )
    system(convertCmd, function(err,stdout,stderr) {
      if (err!=0) {
        println("  > " + convertCmd)
        println("  warning: conversion failed: \n" + stdout + stderr )
      }
      continue()
    },0,combine(dirname(dviName),xopts.mathImgDir))
  }
}

function mathDimAnalyse( dimxName : string, xopts : options, pages : (int,int), continue : (maybe<dict<mathinfo>>) -> io () ) : io () {
  if (xopts.verbose>=1) println("  analyse and embed math images...")
  dims2 = extendDim(pages, dimxName, xopts )
  mdim2 = dims2.parseMathDim(xopts.mathImgDir, xopts.mathDpi, xopts.mathScale)
  mathImageGC(mdim2,xopts.mathdim,dimxName.dirname)
  continue( Just(mdim2) )
}

function mathImageGC( newDim : dict<mathinfo>, oldDim : dict<mathinfo>, outDir : string ) : io ()
{
  oldDim.list.foreach fun(kv) {
    val (digest,mi) = kv
    match(newDim[digest]) {
      Just -> ()
      Nothing -> {
        imageFile = combine(outDir,mi.imageName)
        tryUnlink(imageFile)
      }
    }
  }
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
        imageMod = if (opts.mathconvert!="") then "c" else ""
        imageName = combine(opts.mathImgDir, dimxFile.stemname + "-eq" + imageMod + "-" + cap.groups[2] + ".png")
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
                    warning("cannot read; " + imageFile)
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
                              tryUnlink(imageDigestFile)
                              rename(imageFile,imageDigestFile)
                              buf.length 
                            }
                            else {
                              tryUnlink(imageFile) // delete the image
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
  if (size < 10*kb) 
   then (size.double / kb.double).showFixed(1).align(4) + " kb"
   else ((size + kb - 1)/kb).show.align(4) + " kb"
}

// convert to other units inside tex
//\def\convertto#1#2{\strip@pt\dimexpr #2*65536/\number\dimexpr 1#1}


// parse a dimension file written by latex snippets
public function parseMathDim( txt : string, imgPrefix : string, imgDpi : int, imgScale : int  ) : dict<mathinfo> {
  mi = mdict()
  scale = imgScale.double / 100.0
  txt.findAll(rxDimLine).foreach fun(cap) {
    imageName = imgPrefix + "/math-" + cap.groups[3] + ".png"
    ptwidth   = dimension(cap.groups[4],cap.groups[5])
    ptheight  = dimension(cap.groups[6],cap.groups[7])
    ptdepth   = dimension(cap.groups[8],cap.groups[9])
    pxwidth   = cap.groups[10].parseInt.maybe(-1,id)
    pxheight  = cap.groups[11].parseInt.maybe(-1,id)
    dpi       = cap.groups[12].parseInt.maybe(imgDpi,id)
    size      = cap.groups[13].parseInt.maybe(0,id)
    
    ppt    = dpi.double/72.27
    height = if (pxheight >= 0) then pxheight.double / ppt else ptheight
    width  = if (pxwidth >= 0) then pxwidth.double / ppt else ptwidth
    depth  = ptdepth * (height / ptheight)

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
  f = (fraction + "00000").substr(0,5).parseInt.maybe(0,id).double / 100000.0
  return (w+f)
}