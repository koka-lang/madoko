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
import mathParse


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

function mathHeader( xopts : options, mode : string ) : string 
{
  val initial = ["% MathDpi: " + xopts.mathDpi.show,
                 "MathEmbedLimit: " + xopts.mathEmbedLimit.show,
                 "MathScale: " + xopts.mathScale.show,
                 "MathBaseline: " + xopts.mathBaseline.show,
                 "MathDocClass: " + xopts.mathDocClass,
                 "MathImgDir: " + xopts.mathImgDir
                ]
  val dviDeps = ["Dvipng: " + xopts.dvipng,
                 "Latex: " + xopts.latex, 
                 "MathConvert: " + xopts.mathconvert 
                ]
  val pdfDeps = ["MathPdfLatex: " + xopts.mathpdflatex, 
                 "PdfLatex: " + xopts.pdflatex, 
                 "Convert: " + xopts.convert,
                 "Dvips: " + xopts.dvips,
                 "Ps2pdf: " + xopts.ps2pdf 
                ]
  (initial + (if (mode=="dvi") then dviDeps else pdfDeps)).join(", ") + "\n"
}

function mathContent( xopts : options, mode : string, body : string = "" ) : string {
  val opts = if (xopts.mathDocClass!="") then xopts(docClass=xopts.mathDocClass) else xopts
  val xbody = "\\begin{mdSnippets}\n" + body + "\n\\end{mdSnippets}"
  opts.mathHeader(mode) + fmtTexMathFull(mode=="dvi",xbody,opts)
}

function mathFormat( xopts : options, mode :string, math : string, outName : string ) : (string,string,string)
{
  val texName = outName.appendStem("-math-" + mode).changeExt(".tex")
  val texFinalName = texName.changeExt(".final.tex")  
  (texName,texFinalName,mathContent(xopts,mode,math))
}

public alias runMathStaticFun 
  = ( content : string, inName : string, outName : string,
      texNameDvi : string, texNamePdf : string,
      dviPages : pages, pdfPages : pages,
      oldMathDvi : string, oldMathPdf : string,
      xopts : options, continue : (maybe<dict<mathinfo>>) -> io () ) -> io ()


public function mathStatic( mathDvi : string, mathPdf : string,  
                            inName : string, outName : string, xopts : options, content : string, 
                            runMathStatic : runMathStaticFun,  
                            continue : (maybe<dict<mathinfo>>) -> io () ) : io () 
{
  val (texNameDvi,texNameFinalDvi,outMathDvi) = xopts.mathFormat("dvi",mathDvi,outName)
  val (texNamePdf,texNameFinalPdf,outMathPdf) = xopts.mathFormat("pdf",mathPdf,outName)

  val oldMathDvi = readTextFileDef(texNameFinalDvi,xopts.mathContent("dvi"),True)
  val oldMathPdf = readTextFileDef(texNameFinalPdf,xopts.mathContent("pdf"),True)

  /*
  if (outMathDvi != oldMathDvi) {
    trace("dvi differs!")
    trace("old: " + oldMathDvi)
    trace("new: " + outMathDvi)
  }
  */

  if (outMathDvi == oldMathDvi && outMathPdf == oldMathPdf && !(xopts.rebuild)) 
   then return continue(Nothing)

  xopts.print("rendering math.")
  if ((outMathDvi != oldMathDvi || xopts.rebuild) && !(tryWriteTextFile(texNameDvi,outMathDvi))) {
    xopts.printErr("error: unable to write: " + texNameDvi)
    return continue(Nothing)
  }
  if ((outMathPdf != oldMathPdf || xopts.rebuild) && !(tryWriteTextFile(texNamePdf,outMathPdf))) {
    xopts.printErr("error: unable to write: " + texNamePdf)
    return continue(Nothing)
  }
  
  val rebuildDvi = oldMathDvi.unsnippet("old dvi") != outMathDvi.unsnippet("new dvi")
  val rebuildPdf = oldMathPdf.unsnippet("old pdf") != outMathPdf.unsnippet("new pdf")
  if (rebuildDvi || rebuildPdf) trace("math rebuild")
  val dviPages = mathAnalyseChanged(outMathDvi,xopts.mathdim,xopts.rebuild || rebuildDvi) 
  val pdfPages = mathAnalyseChanged(outMathPdf,xopts.mathdim,xopts.rebuild || rebuildPdf) 

  if (xopts.verbose>=1) {
    if (dviPages.isNil && mathDvi.containsSnippet) xopts.print("math unchanged (dvi)")
    if (pdfPages.isNil && mathPdf.containsSnippet) xopts.print("math unchanged (pdf)")
  }
  if (dviPages.isNil && pdfPages.isNil) then {
    tryRename(texNameDvi,texNameFinalDvi); // save result to prevent rebuilds
    tryRename(texNamePdf,texNameFinalPdf); 
    return continue(Nothing)
  }
  
  runMathStatic( content, inName, outName, texNameDvi, texNamePdf, 
                 dviPages, pdfPages, oldMathDvi, oldMathPdf,
                 xopts, continue )
}


function getHeader( src : string ) : string
{
  match (src.find(rxHdr)) {
    Just(cap) -> cap.matched
    Nothing   -> ""
  }
}
val rxHdr = regex(@"^.*\n")

public alias pages = list<(int,int)>

function range(lo,n) { if (lo<=0) then [] else [(lo,lo+n)] }
  
function compress( pages : list<int>, lo : int = ~1, n : int = 0 ) : pages {
  match(pages) {
    Nil -> range(lo,n)
    Cons(p,ps) -> {
      if (p==lo+n+1) 
       then compress(ps,lo,n+1) 
       else range(lo,n) + compress(ps,p,0)
    }
  }
}

public function inside( page : int, pages : pages ) : bool {
  match(pages) {
    Nil -> False
    Cons((lo,hi),ps) -> {
      (lo <= page && page <= hi) || inside(page,ps)
    }    
  }
}

function mathAnalyseChanged( snippets : string, dim : dict<mathinfo>, rebuild : bool ) : pages
{  
  val digests = snippets.findAll(rxDigest).list.mapIndexed( fun(idx,cap) { (idx+1,cap.groups[1]) })
  val maxPage = digests.length
  
  val pages = digests.concat fun(idigest) {
                val (current,digest) = idigest
                match(dim[digest]) {
                  Just(_)  | !rebuild -> []
                  _ -> [current]
                }
              }
  pages.compress
}

