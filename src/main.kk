/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Main Madoko command line interface
module main

import std/path
import std/regex
import common
import options
import storage
import driver
import mathStaticRun
import runLatex
import version

public function main() : io () {
  markdownFiles("") fun(html,inName,outName,opts) {
    ()
  }
}

public function test( s : string = "code_blocks", moreargs = "" ) {
  //main("test/code_blocks.text")
  val root = if (s.contains(path/sep)) then combine("test",s) else combine(["test","new",s])
  val input  = root + ".text"
  val outputDir = "test/out"
  val target = root + ".html"

  markdownFiles("-v --tex --installdir=src --odir=" + outputDir + " " + moreargs + " " + input) 
    fun(outText,_input,output,_options) {
    //trace("-----\n" + outText + "\n-----")
    val targetText = target.readTextFileDef("")
    val outStrip = outText.replaceAll(regex(@"\s"),"")
                      //.replaceAll(regex(@"class=""indent"""),"")
    val targetStrip = targetText.replaceAll(regex(@"\s"),"")
    if (outStrip != targetStrip) {
      trace("\n*** test failed ***")
      //trace(targetText + "\n***")

      var i := 0;
      while { outStrip[i] == targetStrip[i] } { i := i+1 }
      trace("position: " + i.show)
      val preN = 20
      i := max(0, i-preN)
      trace("inferred: " + outStrip.substr(i,preN) + " " + outStrip.substr(i+preN,40) + " ...")
      trace("expected: " + targetStrip.substr(i,preN) + " " + targetStrip.substr(i+preN,40) + "...")
      trace("***")
    }
    else {
      trace("*** test success (modulo whitespace)")
    }
    //println("done!")
  } 
}

val runners = Runners( runLatex/runPdfLaTeX, runLatex/runBibtex, mathStaticRun/runMathStatic )

public function markdownFiles(args : string, action : (string,string,string,options) -> io ()) : io () { 
  val mbopts = parseOptions(version,args);
  match(mbopts) {
    Nothing -> ()
    Just(opts) -> {
      if (opts.outputDir != "" && !(fexistsSync(opts.outputDir))) {
        mkdirp(opts.outputDir)
      }                                      

      opts.inputs.foreach fun(input0) {
        val input   = if (input0.extname=="") then input0 + ".mdk" else input0
        val outName = outputName(input,opts)    
        if (opts.options.verbose > 0) println("process: " + input + " -> " + outName )        
        match (input.tryReadTextFile()) {
          Left -> println("error: unable to read: " + input )
          Right(content) -> {
            processContent(input, outName, content, opts, True, runners, action)
          }
        } 
      } // foreach
    }
  }
}
