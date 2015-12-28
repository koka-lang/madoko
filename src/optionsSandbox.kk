/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Setting sandboxed options
module optionsSandbox

import std/log
import std/path
import common
import options


public function updateSandbox( options : options, key : string, lvalue : string, value : string, ivalue : int ) : options 
{
  // can only set program options if not running in a sandbox
  if (!(options.sandbox)) {
    if (key=="latex") options(latex=if (value=="") then "latex" else value)
    elif (key=="dvipng") options(math = (options.math)(dvipng=if (value=="") then "dvipng" else value))
    elif (key=="dvisvg") options(math = (options.math)(dvisvg=if (value=="") then "dvisvgm" else value))
    elif (key=="pdflatex" || key=="pdf-latex") options(pdflatex=if (lvalue=="true") then "default" else value)
    elif (key=="math-latex-full" || key=="math-pdflatex" || key=="math-pdf-latex") options(math = (options.math)(latexFull=if (lvalue=="true") then "default" else value))
    elif (key=="math-latex") options(math = (options.math)(latex=if (lvalue=="true") then "default" else value))
    elif (key=="bibtex") options(bibtex=value)
    elif (key=="convert") options(math = (options.math)(convert=value))
    elif (key=="ps2pdf") options(math = (options.math)(ps2pdf=value))
    elif (key=="dvips") options(math = (options.math)(dvips=value))
    elif (key=="process-timeout") options(processTimeout=if (value!="" && ivalue > 0) then ivalue * 1000 else 0)
    else {
      options
    }
  }
  else {
    // in sandbox, only set safe program options
    if (key=="latex") options(latex=if (value=="") then "latex" else safeLatex(lvalue, options.latex) )
    elif (key=="pdflatex" || key=="pdf-latex") options(pdflatex=if (lvalue=="true") then "default" else safeLatex(lvalue, options.pdflatex) )
    elif (key=="math-latex-full" || key=="math-pdflatex" || key=="math-pdf-latex") options(math = (options.math)(latexFull=if (lvalue=="true") then "default" else safeLatex(lvalue, options.math.latexFull) ))
    elif (key=="math-latex") options(math = (options.math)(latex=if (lvalue=="true") then "default" else safeLatex(lvalue, options.math.latex) ))
    elif (key=="bibtex") options(bibtex=safeBibtex(lvalue,options.bibtex)) 
    else {
      //  if (options.verbose >= 3) warning("custom metadata key: " + key)
      options
    }
  }
}

function safeLatex( s : string, def : string ) {
  if (s=="latex" || s=="xelatex" || s=="pdflatex") 
   then s else def
}
function safeBibtex( s : string, def : string ) {
  if (s=="bibtex" || s=="bibtex8") 
   then s else def
}
