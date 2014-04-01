/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Main Madoko client-side entry
module webmain

import std/dict
import std/log
import common
import options
import driver
import storage
import mathStatic

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
                          continue: (md:string,stdout:string,files:string,needRerun:bool,options:options) -> io () ) : io () 
{ 
  printRedirect( fun(s) {
    log("stdout",s)
  });

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
    trace("bibtex rerun")
    cont(False)
  } 

  function runMathStatic( content : string, outputname : string,
                          texNameDvi : string, texNamePdf : string,
                          dviPages : pages, pdfPages : pages,
                          oldMathDvi : string, oldMathPdf : string,
                          xopts : options, cont : (maybe<dict<mathinfo>>) -> io () ) : io ()
  {
    rerun := True
    trace("math rerun")
    cont(Nothing)
  }

  runners = Runners(runPdfLatex, runBibtex, runMathStatic )

  withLog("stdout") {
    withLog("files") {
      processContent(inputName, outName, input, copts, True, runners, fun(output,_,_,options1) {
        stdout = getLog("stdout")
        files  = getLog("files")
        continue(output,stdout,files,rerun,options1)
      })
    }
  }
  ()
}
