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
  runLaTeX( texFile, opts.getPdflatex, opts, content, notfound, 0, True,
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
      println("error while running: \n  > " + latexCmd)
      //println(stdout + stderr)
      system(texCmd + " -version") function(errx:int,stdoutx,stderrx) {
        if (errx!=0) {
          println("could not find latex: \"" + texCmd + "\"")
          if (notfound != "") println(notfound)
        }
        else {
          match(logout.find(rxLatexErr)) {
            Just(cap) -> {          
              texContent = readTextFileDef(texFile,"")
              match (content.findLatexLine(cap.matched,texContent)) {
                Just(lineNo) -> println("error: source line: " + lineNo)
                Nothing -> ()
              }
              println(cap.matched)
            }
            Nothing -> {
              println(stdout + stderr)    
            }
          } 
          println("log written at: " + texFile.changeExt(".log"))
        }      
        onError()        
      }
    }
    else {
      if (runCount <= 2 && logout.contains(rxLatexRerun)) {
        if (opts.verbose >= 1) println("  rerun latex to resolve references...")
        runLaTeX( texFile, texCmd, opts, content, notfound, runCount+1, showWarnings, onError, onSuccess)
      }
      else {
        if (showWarnings) then latexShowWarnings(texFile,logout,content,opts)
        onSuccess()
      }
    }
  },0,texFile.dirname)
} 
val rxLatexErr = regex(@"^\*\* ERROR .*|^![\s\S]*?(?=^\s*(?:Here is how much of \w*TeX's memory you used:))",multiline=True)

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
            ", MathDocClass: " + xopts.mathDocClass +
            ", Dvipng: " + xopts.dvipng + 
            ", Latex: " + xopts.latex + 
            ", MathConvert: " + xopts.mathconvert + 
            ", MathPdfLatex: " + xopts.mathpdflatex + 
            ", Convert: " + xopts.convert + 
            ", Dvips: " + xopts.dvips + 
            ", Ps2pdf: " + xopts.ps2pdf + 
            "\n"
  outMath = outHdr + outTex
  if (outMath != oldMath || xopts.rebuild) {
    if (xopts.verbose>=1) println("  typesetting math...")
    if (!(tryWriteTextFile(texName,outMath))) {
      println("error: unable to write: " + texName)
      continue(Nothing)
    }
    else {
      doRebuild = xopts.rebuild || (oldMath.find(rxHdr).maybe("",fun(cap){cap.matched}) != outHdr)
      val (pages,dviPages,pdfPages) = mathAnalyseChanged(outMath,xopts.mathdim,doRebuild) 
      match(pages) {
        Nil -> {
          if (xopts.verbose>=1) println("  no changes")
          rename(texName,texFinalName); // save result to prevent rebuilds
          continue(Just(xopts.mathdim))
        }
        _ -> {
          mathSnippetsToDvi( texName, xopts, content, oldMath, dviPages, pdfPages ) {
            mathSnippetsToPdf( texName, xopts, content, oldMath, pdfPages ) {
              mathDviPdfToPng( texName.changeExt(".dvi"), xopts, dviPages, pdfPages ) {
                mathConvertPng( texName, xopts, dviPages ) {
                  mathDimAnalyse( texName.changeExt(".dimx"), xopts, dviPages, pdfPages) function(mbmath) {
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
      }      
    }
  }
  else continue(Nothing)
}
val rxHdr = regex(@"^.*\n")

alias pages = list<(int,int)>

function range(lo,n) { if (lo<=0) then [] else [(lo,lo+n)] }
  
function compress( pages : list<(a,int)>, lo : int = -1, n : int = 0 ) : pages {
  match(pages) {
    Nil -> range(lo,n)
    Cons((_,p),ps) -> {
      if (p==lo+n+1) 
       then compress(ps,lo,n+1) 
       else range(lo,n) + compress(ps,p,0)
    }
  }
}

function inside( page : int, pages : pages ) : bool {
  match(pages) {
    Nil -> False
    Cons((lo,hi),ps) -> {
      (lo <= page && page <= hi) || inside(page,ps)
    }    
  }
}

function mathAnalyseChanged( snippets : string, dim : dict<mathinfo>, rebuild : bool ) : (pages,pages,pages) 
{  
  digests = snippets.findAll(rxDigest).list.map( fun(cap) { (cap.groups[1]!="", cap.groups[2]) })
  maxPage = digests.length
  idigests = zip(digests,list(1,maxPage))
  
  pages = idigests.concat fun(idigest) {
            val ((needPdf,digest),current) = idigest
            match(dim[digest]) {
              Just(_)  | !rebuild -> []
              _ -> [(needPdf,current)]
            }
          }
  val (pdfPages,dviPages) = pages.partition( fst )          
  (pages.compress,dviPages.compress,pdfPages.compress)
}

val rxDigest = regex(@"\\begin{md(?:Inline|Display)Snippet(Pdf)?}[\[\{]([a-fA-F0-9]{32})[\}\]]")


function mathSnippetsToDvi( texName : string, xopts : options, 
                            content : string, oldMath : string, 
                            dviPages : pages, pdfPages : pages,
                           continue : () -> io () ) : io () 
{  
  if (dviPages.isNil && (xopts.mathpdflatex!="" || pdfPages.isNil)) return continue()

  if (xopts.verbose>=1) println("  running latex on math... (dvi mode)")
  notfound = "set either the 'Math Mode: Dynamic' or the 'Latex: <cmd>' key in the metadata"
  runLaTeX( texName, xopts.latex, xopts, content, notfound, 0, False,
              function () { () }, continue ) 
}  


function mathSnippetsToPdf( texName : string, xopts : options, 
                            content : string, oldMath : string, 
                            pages : pages,
                           continue : () -> io () ) : io () 
{  
  if (pages.isNil) return continue()
  if (xopts.mathpdflatex != "") {
    // re-run latex to get a pdf
    if (xopts.verbose>=1) println("  running latex on math... (pdf mode)")
    notfound = "set the 'Math Pdf Latex' key in the metadata to <cmd> (or empty to use dvips)"
    texCmd = xopts.getMathpdflatex
    runLaTeX( texName, texCmd, xopts, content, notfound, 0, False,
      function () { () }, continue ) 
  }
  else {
    // use dvips and ps2pdf to get a pdf
    dir = texName.dirname
    stem = texName.stemname
    dvipsCmd = xopts.dvips + " -Ppdf -G0 " + stem + ".dvi"
    ps2pdfCmd = xopts.ps2pdf + " " + stem + ".ps"
    if (xopts.verbose>=1) println("  generating pdf from dvi...")
    if (xopts.verbose>=3) println("  >" + dvipsCmd)
    system(dvipsCmd,function(err,stdout,stderr) {
      if (err != 0) {
        println("> " + dvipsCmd)
        println("error: failure while typesetting math: \n" + stdout + stderr)      
      }
      else {
        if (xopts.verbose>=3) println("  >" + ps2pdfCmd)
        system(ps2pdfCmd, function(err2,stdout2,stderr2) {
          if (err2 != 0) {
            println("> " + ps2pdfCmd)
            println("error: failure while typesetting math: \n" + stdout2 + stderr2)      
          }
          else {
            continue()
          }
          },0,dir)
      }
    },0,dir)
  }  
}


function findLatexLine( src : string, texerr : string, texSrc : string ) : maybe<string> {
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
      latexFindLineByMatch(lineStart,src)
    }
  }
}
val rxLatexLineNum = regex(@"^l\.(\d+) +(?:\\\[|\$)?(.*)",multiline=True)
val rxLatexEndSnippet = regex(@"\\end{md(Inline|Display)?Snippet}")

public function latexStrip( s : string ) : string
{
  s.replaceAll(rxStrip,"").toLower
}

val rxStrip = regex(@"(\\[\w/\-]*(\[[^\]\n]*\])?|[^a-zA-Z_;'""!\*()/\-\+=/\.,~:])+")

public function latexFindLineByMatch( texLine : string, source : string ) : maybe<string> {
  stripLine = texLine.latexStrip
  if (stripLine.length < 3) then Nothing else {
    ilines = source.lines.list.mapIndexed(fun(idx,line) { (idx,line) })
    match(ilines.filter(fun(iline){ iline.snd.latexStrip.contains(stripLine) })) {
      Cons(iline,rest) -> Just((iline.fst+1).show + (if (rest.isNil) then "" else " (?)"))
      _ -> Nothing
    }
  }
}


function latexShowWarnings(texFile:string,logout:string, content:string,opts:options) : io () 
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
        // no line no: try to display page
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
        line = if (cap.groups[2] != "") then cap.groups[2] 
                else {
                  lineNo = cap.groups[1].parseInt.maybe(0,id)
                  texlines.latexFindLine(lineNo)
                }                
        pre = match(latexFindLineByMatch(line,content)) {
          Nothing -> "" // "unable to find line: \n> " + line + "\n> " + line.latexStrip + "\n"
          Just(srcLineNo) -> "> warning: source line: " + srcLineNo+ "\n"
        }

        pre + warning + (if (cap.groups[2]=="" && line!="") then "\n> " + line.substr(0,76) else "")
      }
    }
    println(warn + "\n")
  }
  match(logout.find(rxLatexOutput)) {
    Just(cap) -> println(cap.matched)
    Nothing   -> if (warnings.isCons) println("end of latex warnings.")  
  }
}

val rxLatexLine = regex(@"lines?[\s:]*(\d+).*(?:\r?\n(.*))?") 
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

function pagesShow( pages : pages ) : string {
  pages.map( fun(rng) {
    val (lo,hi) = rng
    lo.show + (if (lo>=hi) then "" else "-" + hi.show)
    }).join(",")
}        

function dvipngPages( pages : pages ) : string {
  pages.map( fun(rng) {
    val (lo,hi) = rng
    "-pp " + lo.show + (if (lo>=hi) then "" else "-" + hi.show)
    }).join(" ")
}        

function convertPages( pages : pages ) : string {
  "[" + pages.map( fun(rng) {
    val (lo,hi) = rng
    (lo-1).show + (if (lo>=hi) then "" else "-" + (hi-1).show)
    }).join(",") + "]"
}

function convertSuffix( pages : pages ) : string {
  match(pages) {
    Cons((lo,hi)) | lo==hi -> "-" + (lo-1).show
    _ -> ""
  }
}        

function mathDviPdfToPng( dviName : string, xopts : options, 
                          dviPages : pages, pdfPages : pages,  
                          continue : () -> io () ) : io () 
{  
  stem = dviName.stemname
  basepng = combine(xopts.mathImgDir,stem) 
  
  dvipngCmd = xopts.dvipng + " -T tight -z9 -bg Transparent" + 
                                      " -D" + xopts.mathDpi.show +
                                      " " + dvipngPages(dviPages) + 
                                      " -o " + basepng + "-dvi-%d.png" +
                                      " " + dviName.basename
  pdfpngCmd = xopts.convert + " -trim -density " + xopts.mathDpi.show + " " +
                  stem + ".pdf" + pdfPages.convertPages + " " +
                  basepng + "-pdf" + pdfPages.convertSuffix + ".png"
              

  // make sure the output directory exists
  outDir = combine(dviName.dirname,xopts.mathImgDir)
  if (!(fexists(outDir))) {
    if (xopts.verbose>=1) println("  create: " + outDir)
    mkdirp(outDir)
  }                                      
  
  dir = dviName.dirname
  mathCmdToPng( dvipngCmd, dir, "dvi", dviPages, xopts) {
    mathCmdToPng( pdfpngCmd, dir, "pdf", pdfPages, xopts, continue )
  } 
}

function mathCmdToPng( cmd : string, dir : string, mode : string, pages : pages, xopts : options,
                       continue : () -> io () ) : io () 
{  
  if (pages.isNil) return continue()

  if (xopts.verbose>=1) println("  generating math images... (" + mode + ") (" + pages.pagesShow + ")")
  if (xopts.verbose>=3) println("  > " + cmd)
  system(cmd,function(err2,stdout2,stderr2) {
    if (err2 != 0) {
      println("> " + cmd)
      println("error: failure while typesetting math: \n" + stdout2 + stderr2)      
    }
    else {
      continue()
    }
  },0,dir)
}


function mathConvertPng( texName : string,xopts : options, dviPages : pages, continue : () -> io () ) : io () 
{
  if (xopts.mathconvert=="") then continue() else {
    convertCmd = xopts.mathconvert + " " + texName.stemname + "-dvi-%d.png" + 
                          dviPages.convertPages + " " +
                          texName.stemname + "-dvi-c" + dviPages.convertSuffix + ".png"
    if (xopts.verbose>=1) println( "  converting math images... (dvi)" )
    if (xopts.verbose>=3) println( "  > " + convertCmd )
    system(convertCmd, function(err,stdout,stderr) {
      if (err!=0) {
        println("  > " + convertCmd)
        println("  warning: conversion failed: \n" + stdout + stderr )
      }
      continue()
    },0,combine(dirname(texName),xopts.mathImgDir))
  }
}

function mathDimAnalyse( dimxName : string, xopts : options, dviPages : pages, pdfPages : pages, continue : (maybe<dict<mathinfo>>) -> io () ) : io () {
  if (xopts.verbose>=1) println("  analyse and embed math images...")
  dims2 = extendDim(dviPages, pdfPages, dimxName, xopts )
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

function extendDim( dviPages : pages, pdfPages : pages, dimxFile : string, opts : options  ) : io string
{
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
        isPdf  = pageNo.inside(pdfPages)
        digest = cap.groups[3]
        imageMod = (if (isPdf) then "-pdf-" else "-dvi-") +
                   (if (opts.mathconvert!="") then "c-" else "") +
                   (if (isPdf || opts.mathconvert!="") then (pageNo-1).show else pageNo.show)

        imageName = combine(opts.mathImgDir, dimxFile.stemname + imageMod + ".png")
        imageFile = combine(dimxFile.dirname,imageName)
                
        val (pxwidth,pxheight,size,embed) 
          = match(dim[digest]) {
              Just(mi) | !(isPdf || pageNo.inside(dviPages)) 
                -> {                  
                  //trace("known image: " + pageNo.show + ": " + imageFile + ": " + digest)
                  (mi.pxwidth,mi.pxheight,mi.size,mi.imageData)
                }
              _ -> { 
                match( tryReadFileSync( imageFile )) {
                  Nothing   -> {
                    warning("cannot read; " + imageFile)
                    (0,0,0,"") // should not happen?
                  }
                  Just(buf) -> {
                    //trace("read image: " + pageNo.show + ": " + imageFile + ": " + digest)
                    base64 = buf.string("base64")
                    pxwidth = buf.readInt4(16)
                    pxheight = buf.readInt4(20)
                    //trace("image " + cap.groups[2] + ": " + pxwidth.show + "," + pxheight.show)
                    pngprefix = "data:image/png;base64,"

                    embed = if (base64!="" && base64.length + pngprefix.length < opts.mathEmbedLimit)
                             then pngprefix + base64 else ""
                    imageDigestFile = combine(imageFile.dirname,"math-" + digest + ".png")
                    tryUnlink(imageDigestFile)                              
                    size  = if (embed=="") then {
                              // give robust name  
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
    page      = cap.groups[2].parseInt.maybe(0,id)
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
    mi[cap.groups[3]] := Mathinfo(imageName,page,scale*height,scale*width,scale*depth,
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