/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Main Madoko client-side entry
module webmain

import std/dict
import common
import options
import driver
import storage

public function initialOptions( args : string = "" ) : io options {
  if (args=="") return Options()
  val opts = parseOptions(args).maybe(CommandOptions(),id)
  opts.options
}

val coptions = CommandOptions()

public function writeTextFile( fileName : string, content : string ) : io () {
  storage/writeTextFileSync( fileName, content )
}

public function addImage( images : dict<imginfo>, imageName : string, data : string ) : dict<imginfo> {
  images + dict([(imageName,Imginfo(imageName,data))])
}

public function println( content : string ) : io () {
  std/core/println( content )
}
public function markdown( inputName : string, input : string, options : options,
                          continue: (output:string,needRerun:bool,options:options) -> io () ) : io () 
{ 
  copts = coptions(options = options)
  outName = outputName(inputName,copts)

  var rerun := False;

  function runPdfLatex( texFile : string, opts : options, content : string, cont : () -> io () ) : io () 
  {
    options.printErr("cannot generate pdf in the browser")
    cont()
  }

  function runBibtex( bibFile : string, opts : options, cont : bool -> io () ) : io () 
  {
    rerun := True
    cont(False)
  } 

  function runMathStatic( mathDvi : string, mathPdf : string,  
                            outputName : string, xopts : options, content : string, 
                            cont : (maybe<dict<mathinfo>>) -> io () ) : io () 
  {
    rerun := True
    cont(Nothing)
  }

  runners = Runners(runPdfLatex, runBibtex, runMathStatic )

  processContent(inputName, outName, input, copts, True, runners, fun(output,_,_,options1) {
    continue(output,rerun,options1)
  })
}
