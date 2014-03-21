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
import std/dict
import common
import options
import texFormatter
import storage
import process
import mathParse

// quote file and command names for shell execution
function quote( s : string ) : string {
  "\"" + s + "\""
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
  bibtexCmd = opts.bibtex.quote + " -quiet \"" + bibFile.basename + "\""
  opts.print("> " + bibtexCmd,3)
  system(bibtexCmd, function(err:int,stdout:string,stderr:string) {
    if (err!=0) {
      opts.printErr("> " + bibtexCmd)
      system(bibtexCmd + " -version") function(errx:int,stdoutx,stderrx) {
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

public function runPdfLaTeX( texFile : string, opts : options, content : string, continue : () -> io () ) {
  opts.print("running " + opts.getPdflatex.stemname + " to generate pdf...")
  notfound = "set the 'Pdf Latex: <cmd>' key in the metadata?"
  runLaTeX( texFile, opts.getPdflatex, opts, content, notfound, 0, True,
    function(err) { continue() } )  
}



function runLaTeX( texFile : string, texCmd : string, opts : options, 
                    content : string,
                    notfound : string,
                    runCount : int = 0,
                    showWarnings : bool = True,
                    continue : (err : int) -> io () )
{
  latexCmd = texCmd.quote + " -halt-on-error -interaction=batchmode \"" + texFile.basename + "\""
  opts.print("> " + latexCmd,3)
  system(latexCmd, function(err:int,stdout:string,stderr:string) {
    logout = readTextFileDef(texFile.changeExt(".log"),"")
    if (err!=0) {
      opts.printErr("error while running: \n> " + latexCmd)
      //println(stdout + stderr)
      system(texCmd + " -version") function(errx:int,stdoutx,stderrx) {
        if (errx!=0) {
          opts.printErr("could not find program: \"" + texCmd + "\"")
          if (notfound != "") opts.printErr(notfound)
        }
        else {
          match(logout.find(rxLatexErr)) {
            Just(cap) -> {          
              texContent = readTextFileDef(texFile,"")
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
        runLaTeX( texFile, texCmd, opts, content, notfound, runCount+1, showWarnings, continue)
      }
      else {
        if (showWarnings) then latexShowWarnings(texFile,logout,content,opts)
        continue(0)
      }
    }
  },0,texFile.dirname)
} 
val rxLatexErr = regex(@"^\*\* ERROR .*|^![\s\S]*?(?=^\s*(?:Here is how much of \w*TeX's memory you used:))",multiline=True)

val rxLatexRerun = regex(@"^(Package|Latex) .*?warning\b.*?Rerun\b",multiline=True,ignoreCase=True)

function mathHeader( xopts : options, mode : string ) : string 
{
  initial = ["% MathDpi: " + xopts.mathDpi.show,
             "MathImgDir: " + xopts.mathImgDir,
             "MathEmbedLimit: " + xopts.mathEmbedLimit.show,
             "MathDocClass: " + xopts.mathDocClass
            ]
  dviDeps = ["Dvipng: " + xopts.dvipng,
             "Latex: " + xopts.latex, 
             "MathConvert: " + xopts.mathconvert 
            ]
  pdfDeps = ["MathPdfLatex: " + xopts.mathpdflatex, 
             "PdfLatex: " + xopts.pdflatex, 
             "Convert: " + xopts.convert,
             "Dvips: " + xopts.dvips,
             "Ps2pdf: " + xopts.ps2pdf 
            ]
  (initial + (if (mode=="dvi") then dviDeps else pdfDeps)).join(", ") + "\n"
}

function mathContent( xopts : options, mode : string, body : string = "" ) : string {
  opts = if (xopts.mathDocClass!="") then xopts(docClass=xopts.mathDocClass) else xopts
  xbody = "\\begin{mdSnippets}\n" + body + "\n\\end{mdSnippets}"
  opts.mathHeader(mode) + fmtTexMathFull(mode=="dvi",xbody,opts)
}

function mathFormat( xopts : options, mode :string, math : string, outName : string ) : (string,string,string)
{
  texName = outName.appendStem("-math-" + mode).changeExt(".tex")
  texFinalName = texName.changeExt(".final.tex")  
  (texName,texFinalName,mathContent(xopts,mode,math))
}

public function mathStatic( mathDvi : string, mathPdf : string,  
                            outName : string, xopts : options, content : string, 
                            continue : (maybe<dict<mathinfo>>) -> io () ) : io () 
{
  val (texNameDvi,texNameFinalDvi,outMathDvi) = xopts.mathFormat("dvi",mathDvi,outName)
  val (texNamePdf,texNameFinalPdf,outMathPdf) = xopts.mathFormat("pdf",mathPdf,outName)

  oldMathDvi = readTextFileDef(texNameFinalDvi,xopts.mathContent("dvi"))
  oldMathPdf = readTextFileDef(texNameFinalPdf,xopts.mathContent("pdf"))
   
  if (outMathDvi == oldMathDvi && outMathPdf == oldMathPdf && !(xopts.rebuild)) 
   then return continue(Nothing)

  xopts.print("rendering math.")
  if (mathDvi != oldMathDvi && !(tryWriteTextFile(texNameDvi,outMathDvi))) {
    xopts.printErr("error: unable to write: " + texNameDvi)
    return continue(Nothing)
  }
  if (mathPdf != oldMathPdf && !(tryWriteTextFile(texNamePdf,outMathPdf))) {
    xopts.printErr("error: unable to write: " + texNamePdf)
    return continue(Nothing)
  }
  
  rebuildDvi = oldMathDvi.getHeader != outMathDvi.getHeader
  rebuildPdf = oldMathPdf.getHeader != outMathPdf.getHeader
  dviPages = mathAnalyseChanged(outMathDvi,xopts.mathdim,xopts.rebuild || rebuildDvi) 
  pdfPages = mathAnalyseChanged(outMathPdf,xopts.mathdim,xopts.rebuild || rebuildPdf) 

  if (xopts.verbose>=1) {
    if (dviPages.isNil && mathDvi.containsSnippet) xopts.print("math unchanged (dvi)")
    if (pdfPages.isNil && mathPdf.containsSnippet) xopts.print("math unchanged (pdf)")
  }
  if (dviPages.isNil && pdfPages.isNil) then {
    tryRename(texNameDvi,texNameFinalDvi); // save result to prevent rebuilds
    tryRename(texNamePdf,texNameFinalPdf); 
    return continue(Nothing)
  }
  
  concurrent([
      fun(cont) { mathSnippetsToDvi( texNameDvi, xopts, content, oldMathDvi, dviPages, pdfPages, cont ) },
      fun(cont) { mathSnippetsToPdf( texNamePdf, xopts, content, oldMathPdf, pdfPages, cont ) }
    ], 
    fun(err) {
      if (err != 0) return continue(Nothing)
      mathDviPdfToPng( texNameDvi.changeExt(".dvi"), texNamePdf.changeExt(".pdf"), xopts, dviPages, pdfPages ) {
        mathConvertPng( texNameDvi, xopts, dviPages ) {
          mathDimAnalyse( outName.changeExt(".dimx"), xopts, dviPages, pdfPages, texNameDvi, texNamePdf) 
            function(mbmath) {
              if (mbmath.isJust) {
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

function getHeader( src : string ) : string
{
  match (src.find(rxHdr)) {
    Just(cap) -> cap.matched
    Nothing   -> ""
  }
}
val rxHdr = regex(@"^.*\n")

alias pages = list<(int,int)>

function range(lo,n) { if (lo<=0) then [] else [(lo,lo+n)] }
  
function compress( pages : list<int>, lo : int = -1, n : int = 0 ) : pages {
  match(pages) {
    Nil -> range(lo,n)
    Cons(p,ps) -> {
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

function mathAnalyseChanged( snippets : string, dim : dict<mathinfo>, rebuild : bool ) : pages
{  
  digests = snippets.findAll(rxDigest).list.mapIndexed( fun(idx,cap) { (idx+1,cap.groups[1]) })
  maxPage = digests.length
  
  pages = digests.concat fun(idigest) {
            val (current,digest) = idigest
            match(dim[digest]) {
              Just(_)  | !rebuild -> []
              _ -> [current]
            }
          }
  pages.compress
}



function mathSnippetsToDvi( texName : string, xopts : options, 
                            content : string, oldMath : string, 
                            dviPages : pages, pdfPages : pages,
                           continue : (int) -> io () ) : io () 
{  
  if (dviPages.isNil && (xopts.mathpdflatex!="" || pdfPages.isNil)) return continue(0)

  xopts.print("running " + xopts.latex.stemname + " on math...   (dvi)")
  notfound = "set either the 'Math Mode: Dynamic' or the 'Latex: <cmd>' key in the metadata"
  runLaTeX( texName, xopts.latex, xopts, content, notfound, 0, False,
              continue ) 
}  


function mathSnippetsToPdf( texName : string, xopts : options, 
                            content : string, oldMath : string, 
                            pages : pages,
                           continue : (int) -> io () ) : io () 
{  
  if (pages.isNil) return continue(0)
  if (xopts.mathpdflatex != "") {
    // re-run latex to get a pdf
    notfound = "set the 'Math Pdf Latex' key in the metadata to <cmd> (or empty to use dvips)"
    texCmd = xopts.getMathpdflatex
    xopts.print("running " + texCmd.stemname + " on math... (pdf)")
    runLaTeX( texName, texCmd, xopts, content, notfound, 0, False, continue )
  }
  else {
    // use dvips and ps2pdf to get a pdf
    dir = texName.dirname
    stem = texName.stemname
    dvipsCmd = xopts.dvips.quote + " -Ppdf -G0 " + stem + ".dvi"
    ps2pdfCmd = xopts.ps2pdf.quote + " " + stem + ".ps"
    xopts.print("generating pdf from dvi...")
    xopts.print(">" + dvipsCmd, 3)
    system(dvipsCmd,function(err,stdout,stderr) {
      if (err != 0) {
        xopts.printErr("> " + dvipsCmd)
        xopts.printErr("error: failure while typesetting math: \n" + stdout + stderr)      
        continue(err)
      }
      else {
        xopts.print(">" + ps2pdfCmd, 3)
        system(ps2pdfCmd, function(err2,stdout2,stderr2) {
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
  s.replaceAll(rxStrip,"")
}

val rxStrip = regex(@"(\\[\w/\-\r\n]*(\[[^\]\r\n]*\])?|\^\^.|'\w*|\}\{[lrct]\}|\]\{[^\]\r\n]*\}|[^a-zA-Z])+") // ;""!\*()/\+=/,~:

public function latexFindLineByMatch( texLine : string, source : string ) : maybe<string> {
  stripLine = texLine.latexStrip.substr(0,16) // some arbitrary length... seems to work well in practice
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
  slines  = source.lines.list.map(fun(line) { line.latexStrip })
  slens   = slines.map(fun(s){ s.length })
  offsets = findOffsets( slines.join, pat )
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
  i0 = source.indexOf(pat)
  i1 = source.lastIndexOf(pat)
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

  warnings = logout.findAll(rxLatexWarning).list.map(fun(cap) { (cap.index,cap.matched) })
  if (warnings.isNil) then return () 

  texlines = readTextFileDef(texFile,"").lines
  println("")
  warnings.foreach fun(iw) {
    val (index,warning0) = iw
    warning = warning0.replace(rxLatexBrackets,"")
    warn = match(warning.find(rxLatexLine)) {
      Nothing   -> {
        // no line no: try to display page
        pre = match(warning.find(rxLatexOutputActive)) { 
                Just -> {  // find a page
                  page = match(logout.substr(0,index).findAll(rxLatexPage).list.reverse) {
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
        line = if (cap.groups[2].latexStrip != "") then cap.groups[2] 
                else {
                  lineNo = cap.groups[1].parseInt.maybe(0,id)
                  texlines.latexFindLine(lineNo)
                }                
        pre = match(latexFindLineByMatch(line,content)) {
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
  line = latexGetLine(src,lineNo)
  if (line.contains(rxEnd) && direction <= 0) {
    latexFindLine(src,lineNo-1,-1)
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
  dviBasePng = combine(xopts.mathImgDir,texNameDvi.stemname) 
  dvipngCmd = xopts.dvipng.quote + " -T tight -z9 -bg Transparent" + 
                                      " -D" + xopts.mathDpi.show +
                                      " " + dvipngPages(dviPages) + 
                                      " -o " + dviBasePng + "-%d.png" +
                                      " " + texNameDvi.basename
  pdfBasePng =  combine(xopts.mathImgDir,texNamePdf.stemname)                                         
  pdfpngCmd = xopts.convert.quote + " -trim -density " + xopts.mathDpi.show + " " +
                  texNamePdf.basename + pdfPages.convertPages + " " +
                  pdfBasePng + pdfPages.convertSuffix + ".png"
              

  // make sure the output directory exists
  outDir = combine(texNameDvi.dirname,xopts.mathImgDir)
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
  system(cmd,function(err2,stdout2,stderr2) {
    if (err2 != 0) {
      xopts.printErr("> " + cmd)
      xopts.printErr("error: failure while typesetting math: \n" + stdout2 + stderr2)      
    }
    continue(err2)
  },0,dir)
}


function mathConvertPng( texName : string,xopts : options, dviPages : pages, continue : () -> io () ) : io () 
{
  if (xopts.mathconvert=="") then continue() else {
    convertCmd = xopts.mathconvert + " " + texName.stemname + "-%d.png" + 
                          dviPages.convertPages + " " +
                          texName.stemname + "-c" + dviPages.convertSuffix + ".png"
    xopts.print( "converting math images... (dvi)" )
    xopts.print( "> " + convertCmd, 3 )
    system(convertCmd, function(err,stdout,stderr) {
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
  dims2 = extendDim(dviPages, pdfPages, texNameDvi, texNamePdf, dimxName, xopts )
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

function extendDim( dviPages : pages, pdfPages : pages, 
                    texNameDvi : string, texNamePdf : string,
                    dimxFile : string, opts : options  ) : io string
{
  var imageSize := 0  
  var imageCount := 0
  var embedSize := 0
  var embedCount := 0  
  dim = opts.mathdim

  function dimLine( isPdf : bool, pages : pages, line : string ) 
  {
    match(line.find(rxDimLine)) {
      Nothing   -> line
      Just(cap) -> { 
        pageNo = cap.groups[2].parseInt.maybe(0,id)
        digest = cap.groups[3]
        imageStem = (if (isPdf) then texNamePdf.stemname else texNameDvi.stemname) +
                    (if (opts.mathconvert!="") then "-c" else "") + "-" +
                    (if (isPdf || opts.mathconvert!="") then (pageNo-1).show else pageNo.show)

        imageName = combine(opts.mathImgDir, imageStem + ".png")
        imageFile = combine(dimxFile.dirname,imageName)
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

  dviDims = readTextFileDef(texNameDvi.changeExt(".dim"),"")
  pdfDims = readTextFileDef(texNamePdf.changeExt(".dim"),"")
  dimsx   = dviDims.lines.list.map( fun(line) { dimLine(False,dviPages,line) }) +
            pdfDims.lines.list.map( fun(line) { dimLine(True,pdfPages,line) })
  
  txt = dimsx.join("\n")
  tryWriteTextFile( dimxFile, txt )
  if (opts.verbose >= 2) {
    totalCount = imageCount + embedCount
    totalSize = imageSize + embedSize
    opts.print(" math images  : " + imageCount.show.align(4) + " in " + imageSize.showSize, 2 )
    opts.print(" math embedded: " + embedCount.show.align(4) + " in " + embedSize.showSize, 2 )
    opts.print(" math total   : " + totalCount.show.align(4) + " in " + totalSize.showSize, 2 )
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

