/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Process math statically as LaTeX generated snippets
module mathStaticRun

import std/string
import std/regex
import std/path
import std/dict
import common
import options
import texFormatter
import storage
import process
import mathParse
import mathStatic

// quote file and command names for shell execution
function quote( s : string ) : string {
  "\"" + s + "\""
}

// normalize a file name: needed for latex 
function norm( fname : string ) : string {
  fname.replaceAll("\\", "/");
}

function concurrent( tasks : list<(cont:(int) -> io ()) -> io ()>, continue : (int) -> io () ) : io () {
  if (tasks.isNil) return continue(0)

  var count   := tasks.length
  var lasterr := 0

  function taskContinue( err : int ) {
    count := count-1
    if (err != 0) lasterr := err
    if (count<=0) continue(lasterr)
  }

  tasks.foreach fun(task) {
    onFail( { count := count-1 }, { task(taskContinue) } )
  }
}

public function runBibtex( bibFile : string, opts : options, continue : bool -> <io|e> ()) : <io|e> () {
  opts.print("running bibtex to generate bibliography...")
  val bibtexCmd = opts.bibtex.quote + " " + bibFile.basename.quote
  opts.print("> " + bibtexCmd,3)
  system(bibtexCmd, fun(err:int,stdout:string,stderr:string) {
    if (err!=0) {
      opts.printErr("error while running: > " + bibtexCmd)
      system(opts.bibtex.quote + " -version") fun(errx:int,stdoutx,stderrx) {
        if (errx!=0) {
          opts.printErr("could not find bibtex: \"" + bibtexCmd + "\"")
          opts.printErr("set the 'BibTeX: ...' key or give the '--bib=<cmd>' command line option.")
        }
        else {
          opts.printErr(stdout + stderr)
        }
        continue(True)
      }
    }
    else {
      if(opts.verbose>=1 && !(stdout=="" && stderr=="")) opts.printErr(stdout + stderr)
      continue(False)
    }
  },0,bibFile.dirname)
}

public function runPdfLaTeX( srcName : string, texFile : string, opts : options, content : string, continue : () -> io () ) {
  opts.print("running " + opts.getPdflatex.stemname + " to generate pdf...")
  val notfound = "set the 'Pdf Latex: <cmd>' key in the metadata?"
  runLaTeX(srcName, texFile, opts.getPdflatex, opts, content, notfound, 0, True,
    fun(err) { continue() } )  
}



function runLaTeX( srcFile : string, texFile : string, texCmd : string, opts : options, 
                    content : string,
                    notfound : string,
                    runCount : int = 0,
                    showWarnings : bool = True,
                    continue : (err : int) -> io () )
{
  val dir = texFile.dirname.norm
  val latexCmd = texCmd.quote + " --output-directory=" + (if (dir=="") then "." else dir).quote + 
                       " --halt-on-error --interaction=nonstopmode --quiet" + 
                      " " + texFile.norm.quote 

  opts.print("> " + latexCmd,3)
  
  system(latexCmd, fun(err:int,stdout:string,stderr:string) {
    val logout = readTextFileDef(texFile.changeExt(".log"),"")
    if (err!=0) {
      opts.printErr("error while running: \n> " + latexCmd)
      trace("error code: " + err.show + "\n" + stdout + stderr)
      //println(stdout + stderr)
      system(texCmd.quote + " -version") fun(errx:int,stdoutx,stderrx) {
        if (errx!=0) {
          opts.printErr("could not find program: \"" + texCmd + "\"")
          if (notfound != "") opts.printErr(notfound)
        }
        else {
          match(logout.find(rxLatexErr)) {
            Just(cap) -> {          
              val texContent = readTextFileDef(texFile,"")
              match (content.findLatexLine(cap.matched,texContent)) {
                Just(lineNo) -> opts.printErr("error: source line: " + lineNo)
                Nothing -> ()
              }
              opts.printErr(cap.matched)
            }
            Nothing -> {
              opts.printErr(stdout + stderr)    
            }
          } 
          opts.printErr("log written at: " + texFile.changeExt(".log"))
        }      
        continue(err)       
      }
    }
    else {
      if (runCount <= 2 && logout.contains(rxLatexRerun)) {
        opts.print("rerun to resolve references...")
        runLaTeX( srcFile, texFile, texCmd, opts, content, notfound, runCount+1, showWarnings, continue)
      }
      else {
        if (showWarnings) then latexShowWarnings(texFile,logout,content,opts)
        continue(0)
      }
    }
  },0,srcFile.dirname)
} 
val rxLatexErr = regex(@"(?:^! LaTeX Error:.*|^\*\* ERROR .*|^(?:!|Runaway argument\?))[\s\S]*?(?=^\s*(?:Here is how much of \w*TeX's memory you used:))",multiline=True,ignoreCase=True)

val rxLatexRerun = regex(@"^(Package|Latex) .*?warning\b.*?Rerun\b",multiline=True,ignoreCase=True)

public function runMathStatic( content : string, inName: string, outName : string,
                        texNameDvi : string, texNamePdf : string,
                        dviPages : pages, pdfPages : pages,
                        oldMathDvi : string, oldMathPdf : string,
                        xopts : options, continue : (maybe<dict<mathinfo>>) -> io () ) : io ()
{
  concurrent([
      fun(cont) { mathSnippetsToDvi( inName, texNameDvi, xopts, content, oldMathDvi, dviPages, pdfPages, cont ) },
      fun(cont) { mathSnippetsToPdf( inName, texNamePdf, xopts, content, oldMathPdf, pdfPages, cont ) }
    ], 
    fun(err) {
      if (err != 0) return continue(Nothing)
      mathDviPdfToPng( texNameDvi.changeExt(".dvi"), texNamePdf.changeExt(".pdf"), xopts, dviPages, pdfPages ) {
        mathConvertPng( texNameDvi, xopts, dviPages ) {
          mathDimAnalyse( outName.changeExt(".dimx"), xopts, dviPages, pdfPages, texNameDvi, texNamePdf) 
            fun(mbmath) {
              if (mbmath.isJust) {
                val texNameFinalDvi = texNameDvi.changeExt(".final.tex")
                val texNameFinalPdf = texNamePdf.changeExt(".final.tex")
                tryRename(texNameDvi,texNameFinalDvi); // save result to prevent rebuilds
                tryRename(texNamePdf,texNameFinalPdf);
              }
              continue(mbmath)
            }
        }
      }
    }
  )      
}


function mathSnippetsToDvi( srcName :string, texName : string, xopts : options, 
                            content : string, oldMath : string, 
                            dviPages : pages, pdfPages : pages,
                           continue : (int) -> io () ) : io () 
{  
  if (dviPages.isNil && (xopts.mathpdflatex!="" || pdfPages.isNil)) return continue(0)

  xopts.print("running " + xopts.latex.stemname + " on math...   (dvi)")
  val notfound = "set either the 'Math Mode: Dynamic' or the 'Latex: <cmd>' key in the metadata"
  runLaTeX( srcName, texName, xopts.latex, xopts, content, notfound, 0, False,
              continue ) 
}  


function mathSnippetsToPdf( srcName: string, texName : string, xopts : options, 
                            content : string, oldMath : string, 
                            pages : pages,
                           continue : (int) -> io () ) : io () 
{  
  if (pages.isNil) return continue(0)
  if (xopts.mathpdflatex != "") {
    // re-run latex to get a pdf
    val notfound = "set the 'Math Pdf Latex' key in the metadata to <cmd> (or empty to use dvips)"
    val texCmd = xopts.getMathpdflatex
    xopts.print("running " + texCmd.stemname + " on math... (pdf)")
    runLaTeX( srcName, texName, texCmd, xopts, content, notfound, 0, False, continue )
  }
  else {
    // use dvips and ps2pdf to get a pdf
    val dir = texName.dirname
    val stem = texName.stemname
    val dvipsCmd = xopts.dvips.quote + " -Ppdf -G0 " + (stem + ".dvi").quote
    val ps2pdfCmd = xopts.ps2pdf.quote + " " + (stem + ".ps").quote
    xopts.print("generating pdf from dvi...")
    xopts.print(">" + dvipsCmd, 3)
    system(dvipsCmd,fun(err,stdout,stderr) {
      if (err != 0) {
        xopts.printErr("> " + dvipsCmd)
        xopts.printErr("error: failure while typesetting math: \n" + stdout + stderr)      
        continue(err)
      }
      else {
        xopts.print(">" + ps2pdfCmd, 3)
        system(ps2pdfCmd, fun(err2,stdout2,stderr2) {
          if (err2 != 0) {
            xopts.printErr("> " + ps2pdfCmd)
            xopts.printErr("error: failure while typesetting math: \n" + stdout2 + stderr2)      
            continue(err2)
          }
          else {
            continue(0)
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
      val lineNo = cap.groups[1].parseInt.maybe(0,id)
      val searchLines = texSrc.lines.list.take(lineNo-1).reverse
      //trace("latex lineno: " + lineNo.show + "\n" + searchLines.join("\n") + "\n\n")
      findLatexLineData(0, searchLines )
      /*
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
      */
    }
  }
}
val rxLatexLineNum = regex(@"^l\.(\d+) +(?:\\\[|\$)?(.*)",multiline=True)
val rxLatexEndSnippet = regex(@"\\end{md(Inline|Display)?Snippet}")

function findLatexLineData( delta : int, lines : list<string> ) : maybe<string> {
  match(lines) {
    Nil -> Nothing
    Cons(line,rest) -> {
      match(line.find(rxLineData)) {
        Nothing -> {
          val newDelta = if (line.contains(rxEndComment)) then delta else delta+1
          findLatexLineData( newDelta, rest )
        }
        Just(cap) -> {
          val last = cap.groups[1].split(";").list.reverse.take(1).join()
          //trace(" found line info: " + cap.matched + ", last: " + last + ", delta: " + delta.show)
          match( last.find(rxLineNo) ) {
            Nothing -> Nothing
            Just(cap2) -> Just(cap2.groups[1]  + (cap2.groups[2].parseInt.maybe(0,id) + delta).show)
          }
        }
      }
    }
  }
}
val rxLineData    = regex( @"^(?:[^\\%]|\\.)*% *(?:mdk-)?data-line=\{([^\}]*)\} *$" )
val rxLineNo      = regex( @"^([^:]*:)?(\d+)$" )
val rxEndComment  = regex( @"^(?:[^\\%]|\\.)*%mdk.*$" )


public function latexStrip( s : string ) : string
{
  s.replaceAll(rxStrip,"")
}

val rxStrip = regex(@"(\\[\w/\-\r\n]*(\[[^\]\r\n]*\])?|\^\^.|'\w*|\}\{[lrct]\}|\]\{[^\]\r\n]*\}|[^a-zA-Z])+") // ;""!\*()/\+=/,~:

public function latexFindLineByMatch( texLine : string, source : string ) : maybe<string> {
  val stripLine = texLine.latexStrip.substr(0,16) // some arbitrary length... seems to work well in practice
  if (stripLine.length < 3) then Nothing else {
    match (source.findLines(stripLine)) {
      Cons(lineNo,rest) -> Just(lineNo.show + (if (rest.isNil) then "" else " (?)"))
      _ -> Nothing      
    }
    /*
    ilines = source.lines.list.mapIndexed(fun(idx,line) { (idx,line) })
    match(ilines.filter(fun(iline){ iline.snd.latexStrip.contains(stripLine) })) {
      Cons(iline,rest) -> Just((iline.fst+1).show + (if (rest.isNil) then "" else " (?)"))
      _ -> Nothing
    }
    */
  }
}

function findLines( source : string, pat : string ) : list<int> {
  val slines  = source.lines.list.map(fun(line) { line.latexStrip })
  val slens   = slines.map(fun(s){ s.length })
  val offsets = findOffsets( slines.join, pat )
  offsets.map fun(ofs) {
    var total := 0
    var current := 1
    slens.foreachUntil fun(len) {
      total := total + len
      if (total > ofs) then return Just(current) 
      current := current + 1
      Nothing
    }
    current
  }
}

function findOffsets( source : string, pat : string ) : list<int> {
  val i0 = source.indexOf(pat)
  val i1 = source.lastIndexOf(pat)
  if (i0 < 0) then []
  elif (i0 == i1) then [i0]
  else [i0,i1]
}

function latexShowWarnings(texFile:string,logout:string, content:string,opts:options) : io () 
{
  if (opts.verbose<2) then {
    if (opts.verbose>=1) {
      match(logout.find(rxLatexOutput)) {
        Just(cap) -> opts.print(cap.matched,1)
        Nothing -> ()
      }
    }
    return ()
  }

  val warnings = logout.findAll(rxLatexWarning).list.map(fun(cap) { (cap.index,cap.matched) })
  if (warnings.isNil) then return () 

  val texlines = readTextFileDef(texFile,"").lines
  println("")
  warnings.foreach fun(iw) {
    val (index,warning0) = iw
    val warning = warning0.replace(rxLatexBrackets,"")
    val warn = match(warning.find(rxLatexLine)) {
      Nothing   -> {
        // no line no: try to display page
        val pre = match(warning.find(rxLatexOutputActive)) { 
                Just -> {  // find a page
                  val page = match(logout.substr(0,index).findAll(rxLatexPage).list.reverse) {
                    Cons(pcap,_) -> (pcap.groups[1].parseInt.maybe(0,id)+1).show 
                    Nil -> "1"
                  }  
                  "> warning: page " + page + "\n"
                } 
                Nothing -> "" 
              }
        pre + warning
      }
      Just(cap) -> {
        val line = if (cap.groups[2].latexStrip != "") then cap.groups[2] 
                else {
                  val lineNo = cap.groups[1].parseInt.maybe(0,id)
                  texlines.latexFindLine(lineNo)
                }                
        val pre = match(latexFindLineByMatch(line,content)) {
          Nothing -> {
            if (opts.verbose >= 4) then opts.printErr("unable to find line: \n> " + line.latexStrip + "\n")
            ""
          }
          Just(srcLineNo) -> "> warning: source line: " + srcLineNo+ "\n"
        }

        pre + warning + (if (cap.groups[2]=="" && line!="") then "\n> " + line.substr(0,74) else "")
      }
    }
    opts.printErr(warn + "\n")
  }
  match(logout.find(rxLatexOutput)) {
    Just(cap) -> opts.printErr(cap.matched)
    Nothing   -> if (warnings.isCons) opts.printErr("end of latex warnings.")  
  }
}

val rxLatexLine = regex(@"lines?[\s:]*(\d+).*(?:\r?\n([\s\S]*))?") 
val rxLatexOutputActive = regex(@"\output is active\s*$") // only match single line 
val rxLatexPage = regex(@"\s\[(\d+)\s*\]")
val rxLatexOutput = regex(@"^Output written on .*", multiline=True)
val rxLatexBrackets = regex(@"(\s|[\[\]])+$")
val rxLatexWarning = regex(@"^(Overfull|Underfull|[\w ]*[Ww]arning:)[\s\S]*?\n *$", multiline=True)

function latexFindLine( src : vector<string>, lineNo : int, direction : int = 0 ) : div string
{
  val line = latexGetLine(src,lineNo)
  if (line.contains(rxEnd) && direction <= 0) {
    latexFindLine(src,lineNo-1,~1)
  }
  elif (line.contains(rxBegin) && direction >= 0) {
    latexFindLine(src,lineNo+1,1)
  }
  else {
    line
  }
}

val rxEnd = regex(@"^\\end|^\s*(\\?\}\s*)*$",multiline=True)
val rxBegin = regex(@"^\\begin|^\s*(\\?\{})*$",multiline=True)

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

function mathDviPdfToPng( texNameDvi : string, texNamePdf : string, xopts : options, 
                          dviPages : pages, pdfPages : pages,  
                          continue : () -> io () ) : io () 
{  
  val dviBasePng = combine(xopts.mathImgDir,texNameDvi.stemname) 
  val dvipngCmd = xopts.dvipng.quote + " -T tight -z9 -bg Transparent" + 
                                      " -D" + xopts.mathDpi.show +
                                      " " + dvipngPages(dviPages) + 
                                      " -o " + (dviBasePng + "-%d.png").quote +
                                      " " + texNameDvi.basename.quote
  val pdfBasePng =  combine(xopts.mathImgDir,texNamePdf.stemname)                                         
  val pdfpngCmd = xopts.convert.quote + " -trim -density " + xopts.mathDpi.show + " " +
                  (texNamePdf.basename + pdfPages.convertPages).quote + " " +
                  (pdfBasePng + pdfPages.convertSuffix + ".png").quote
              

  // make sure the output directory exists
  val outDir = combine(texNameDvi.dirname,xopts.mathImgDir)
  if (!(fexistsSync(outDir))) {
    xopts.print("create image directory: " + outDir)
    mkdirp(outDir)
  }                                      
  
  concurrent([
      fun(cont) { mathCmdToPng( dvipngCmd, texNameDvi.dirname, "dvi", dviPages, xopts, cont) },
      fun(cont) { mathCmdToPng( pdfpngCmd, texNamePdf.dirname, "pdf", pdfPages, xopts, cont) } 
    ], 
    fun(err) {
      if (err==0) {
        continue()
      }
    }
  )
}

function mathCmdToPng( cmd : string, dir : string, mode : string, pages : pages, xopts : options,
                       continue : (int) -> io () ) : io () 
{  
  if (pages.isNil) return continue(0)

  xopts.print("generating math images...  (" + mode + ") (" + pages.pagesShow + ")")
  xopts.print("> " + cmd,3)
  system(cmd,fun(err2,stdout2,stderr2) {
    if (err2 != 0) {
      val output = stdout2 + stderr2
      xopts.printErr("> " + cmd)
      xopts.printErr("error: failure while typesetting math: \n" + output)      
      if (output.contains("Invalid Parameter -")) then {
        xopts.printErr("hint: perhaps you forgot to install ImageMagick?\n      (http://www.imagemagick.org/script/binary-releases.php)")
      }
    }
    continue(err2)
  },0,dir)
}


function mathConvertPng( texName : string,xopts : options, dviPages : pages, continue : () -> io () ) : io () 
{
  if (xopts.mathconvert=="") then continue() else {
    val convertCmd = xopts.mathconvert.quote + " " + (texName.stemname + "-%d.png").quote + 
                          dviPages.convertPages + " " +
                          (texName.stemname + "-c" + dviPages.convertSuffix + ".png").quote
    xopts.print( "converting math images... (dvi)" )
    xopts.print( "> " + convertCmd, 3 )
    system(convertCmd, fun(err,stdout,stderr) {
      if (err!=0) {
        xopts.printErr("> " + convertCmd)
        xopts.printErr("warning: conversion failed: \n" + stdout + stderr )
      }
      continue()
    },0,combine(dirname(texName),xopts.mathImgDir))
  }
}

function mathDimAnalyse( dimxName : string, xopts : options, dviPages : pages, pdfPages : pages,
                         texNameDvi : string, texNamePdf : string,
                         continue : (maybe<dict<mathinfo>>) -> io () ) : io () {
  xopts.print("analyse and embed math images.")
  val dims2 = extendDim(dviPages, pdfPages, texNameDvi, texNamePdf, dimxName, xopts )
  val mdim2 = dims2.parseMathDim(xopts.mathImgDir, xopts.mathDpi, xopts.mathScale, xopts.mathBaseline)
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
        val imageFile = combine(outDir,mi.imageName)
        tryUnlink(imageFile)
      }
    }
  }
}

function extendDim( dviPages : pages, pdfPages : pages, 
                    texNameDvi : string, texNamePdf : string,
                    dimxFile : string, opts : options  ) : io string
{
  var imageSize := 0  
  var imageCount := 0
  var embedSize := 0
  var embedCount := 0  
  val dim = opts.mathdim

  function dimLine( isPdf : bool, pages : pages, line : string ) 
  {
    match(line.find(rxDimLine)) {
      Nothing   -> line
      Just(cap) -> { 
        val pageNo = cap.groups[2].parseInt.maybe(0,id)
        val digest = cap.groups[3]
        val imageStem = (if (isPdf) then texNamePdf.stemname else texNameDvi.stemname) +
                    (if (opts.mathconvert!="") then "-c" else "") + "-" +
                    (if (isPdf || opts.mathconvert!="") then (pageNo-1).show else pageNo.show)

        val imageName = combine(opts.mathImgDir, imageStem + ".png")
        val imageFile = combine(dimxFile.dirname,imageName)
        //trace("read image: " + pageNo.show + ": " + imageFile + ": " + imageFile)
                
        val (pxwidth,pxheight,size,embed) 
          = match(dim[digest]) {
              Just(mi) | !(pageNo.inside(pages)) 
                -> {                  
                  //trace("known image: " + pageNo.show + ": " + imageFile + ": " + digest)
                  (mi.pxwidth,mi.pxheight,mi.size,mi.imageData)
                }
              _ -> { 
                match( tryReadFileSync( imageFile )) {
                  Nothing   -> {
                    opts.printErr("error: cannot read: " + imageFile)
                    (0,0,0,"") // should not happen?
                  }
                  Just(buf) -> {
                    //trace("read image: " + pageNo.show + ": " + imageFile + ": " + imageFile)
                    val base64 = buf.string("base64")
                    val pxwidth = buf.readInt4(16)
                    val pxheight = buf.readInt4(20)
                    //trace("image " + cap.groups[2] + ": " + pxwidth.show + "," + pxheight.show)
                    val pngprefix = "data:image/png;base64,"

                    val embed = if (base64!="" && base64.length + pngprefix.length < opts.mathEmbedLimit)
                             then pngprefix + base64 else ""
                    val imageDigestFile = combine(imageFile.dirname,"math-" + digest + ".png")
                    tryUnlink(imageDigestFile)                              
                    val size  = if (embed=="") then {
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

  val dviDims = readTextFileDef(texNameDvi.changeExt(".dim"),"")
  val pdfDims = readTextFileDef(texNamePdf.changeExt(".dim"),"")
  val dimsx   = dviDims.lines.list.map( fun(line) { dimLine(False,dviPages,line) }) +
            pdfDims.lines.list.map( fun(line) { dimLine(True,pdfPages,line) })
  
  val txt = dimsx.join("\n")
  tryWriteTextFile( dimxFile, txt )
  if (opts.verbose >= 2) {
    val totalCount = imageCount + embedCount
    val totalSize = imageSize + embedSize
    opts.print(" math images  : " + imageCount.show.align(4) + " in " + imageSize.showSize, 2 )
    opts.print(" math embedded: " + embedCount.show.align(4) + " in " + embedSize.showSize, 2 )
    opts.print(" math total   : " + totalCount.show.align(4) + " in " + totalSize.showSize, 2 )
  }
  txt
}

function showSize( size : int ) : string {
  val kb = 1024
  if (size < 10*kb) 
   then (size.double / kb.double).showFixed(1).align(4) + " kb"
   else ((size + kb - 1)/kb).show.align(4) + " kb"
}

// convert to other units inside tex
//\def\convertto#1#2{\strip@pt\dimexpr #2*65536/\number\dimexpr 1#1}

