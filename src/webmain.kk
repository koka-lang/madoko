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
import version
import common
import options
import driver
import storage
import mathStatic

public function initialOptions( args : string = "" ) : io options {
  val opts = if (args=="") then Options(version=version/version)
              else match(parseOptions(version/version,args)) {
                Just(cmdOpts) -> cmdOpts.options
                Nothing       -> Options(version=version/version)
              }
  opts(lineNoWeb=True,
       mathEmbedLimit=512*1024,   // must match server setting!
       embedLimit=512*1024,
       copyStyles=False)  
}

val coptions = CommandOptions()

public function writeTextFile( fileName : string, content : string ) : io () {
  storage/writeTextFileSync( fileName, content )
}

public function readTextFile( fname : string ) : io string {
  readTextFileSync( fname );
}

public function unlinkFile( fname : string ) : io () {
  unlinkSync(fname)
}

public function clearStorage() : io () {
  clear();
}

public function addImage( embeds : dict<embedinfo>, imageName : string, data : string ) : dict<embedinfo> {
  embeds + dict([(imageName,Embedinfo(imageName,data))])
}


public function markdown( inputName : string, input : string, outdir : string, options : options, convertTex : bool,
                          continue: (md:string,stdout:string,needRerun:bool,options:options,
                                      files:string,filesRefer:string,filesWrite:string,labels:string,links:string,customs:string,entities:string) -> io () ) : io () 
{ 
  printRedirect( fun(s) {
    log("stdout",s)
  });

  val copts = coptions(options = options, outputDir = outdir, convertTex = convertTex)
  val outName = outputName(inputName,copts)
  
  var rerun := False;

  function runPdfLatex( srcFile : string, texFile : string, opts : options, content : string, cont : () -> io () ) : io () 
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

  function runMathStatic( content : string, inpName : string, outputname : string,
                          texNameDvi : string, texNamePdf : string,
                          dviPages : pages, pdfPages : pages,
                          oldMathDvi : string, oldMathPdf : string,
                          xopts : options, cont : (maybe<dict<mathinfo>>) -> io () ) : io ()
  {
    rerun := True
    trace("math rerun")
    cont(Nothing)
  }

  val runners = Runners(runPdfLatex, runBibtex, runMathStatic )

  withLog("stdout") {
    withLog("files") {
      withLog("filesRefer") {
        withLog("filesWrite") {
          withLog("labels") {
            withLog("links") {
            withLog("customs") {
            withLog("entities") {
                processContent(inputName, outName, input, copts, True, runners, fun(output,_,_,options1) {
                  val stdout = getLog("stdout")
                  val files  = getLog("files")
                  val filesRefer  = getLog("filesRefer")
                  val filesWrite  = getLog("filesWrite")
                  val labels = getLog("labels")
                  val links = getLog("links")
                  val customs = getLog("customs")
                  val entities = getLog("entities")
                  continue(output,stdout,rerun,options1,files,filesRefer,filesWrite,labels,links,customs,entities)
                })
            }}}
          }
        }
      }
    }
  }
  ()
}
