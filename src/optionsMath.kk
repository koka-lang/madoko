/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Setting math options
module optionsMath

import std/log
import std/path
import common
import options
import optionsSandbox


public function updateMath( options:options, key: string, lvalue: string, value:string, ivalue: int, bvalue:bool ) : options 
{
  if (key=="mathjax-ext" || key=="mathjax-extension")  options(math = (options.math)(mjext=if (value=="") then "" else options.math.mjext + ";" + value))
  elif (key=="math-mode") options.setMathMode(value)
  elif (key=="math-static" || key=="math-dir") options(math = (options.math)(imgDir = if (lvalue=="true") then "math" else value))
  elif (key=="math-scale") options(math = (options.math)(scale=ivalue))
  elif (key=="math-scale-svg") options(math = (options.math)(scaleSvg=ivalue))
  elif (key=="math-scale-png") options(math = (options.math)(scalePng=ivalue))
  elif (key=="math-baseline") options(math = (options.math)(baseline=ivalue))
  elif (key=="math-dpi") options(math = (options.math)(dpi=ivalue))
  elif (key=="math-embed" || key=="math-embed-limit") options(math = (options.math)(embedLimit=if (value=="") then 0 elif (value=="true") then 1024 else (ivalue*1024)))
  elif (key=="math-document-class" || key=="math-doc-class") options(math = (options.math)(docClass=value))
  elif (key=="math-render") options(math = (options.math)(render = options.parseMathRender(lvalue,options.math.render)))
  elif (key=="math-render-full") options(math = (options.math)(renderFull = options.parseMathRender(lvalue,options.math.renderFull ) ))
  elif (key=="math-svg-share-paths") options(math = (options.math)(svgShare=bvalue))
  elif (key=="math-svg-precision") options(math = (options.math)(svgPrec=min(6,max(ivalue,0))))
  elif (key=="math-svg-use-fonts") options(math = (options.math)(svgFontFormat=if (bvalue) then "woff,ah" else "none"))
  elif (key=="math-svg-font-format") options(math = (options.math)(svgFontFormat=lvalue))
  elif (key=="mathjax") then (if (value!="")
                               then options(math = (options.math)(mode=Dynamic, mathjax=(if (lvalue=="true") then "default" else value)))
                               else options(math = (options.math)(mode=Static, mathjax="")))
  else {
    options.updateSandbox(key,lvalue,value,ivalue)
  }  
}


function setMathMode( options : options, value : string ) : options {
  val nvalue = value.normalizeId
  if (nvalue=="static") then options(math = (options.math)(mode=Static))
  elif (nvalue=="dynamic") then options(math = (options.math)(mode=Dynamic))
  elif (nvalue=="mathjax") then options(math = (options.math)(mode=Dynamic, mathjax=if (options.math.mathjax.bool) then options.math.mathjax else "default"))
  else {
    warning("unrecognized math mode: " + nvalue)
    options
  }
}

function parseMathRender( options : options, value : string, def : maybe<mathrender> ) : maybe<mathrender> {
  if (value=="png") then Just(Png)
  elif (value=="svg") then Just(Svg)
  else {
    warning("unrecognized math rendering mode: " + value + ", expecting one of 'png' or 'svg'")
    def
  }
}