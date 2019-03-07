/*---------------------------------------------------------------------------
  Copyright 2013-2015 Microsoft Corporation.
 
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
import block         // just for the type block
import formatBlock   // just the formatContext
import inline // for inlineContext
import std/regex

// TODO change to { path, from, to } to express ranges
public struct position (path: string, line: int)

// lines are 1-based and inclusive.
public struct range (path: string, from: int, to: int)

public struct labeledElement (
  id: string,
  element: string,
  caption: string,
  position: null<position>
)

public struct analyzeResults (
  lineMap : lineMap,
  labels: vector<labeledElement>,
  blocks: vector<blockElement>,
  // just for debugging purposes we also include the original formatContext
  context : formatContext,  
  log: string
)

// the type of block nodes we export to js / typescript
public struct blockElement (
  // the block kind
  kind: string,
  // the element id, empty if not present
  id: string,
  // the tag name, empty if not present
  name: string,
  // the child nodes
  content: vector<blockElement>,
  // the text content
  text: string,
  // the classes
  classes: vector<string>,
  // attributes of the block node (like "caption")
  attributes: dict<string>,
  // TODO also include position and range information.
  position: null<range>
)

function range(attr: attrs, inputName: string): maybe<range> {
  match (attr.hasKey("data-line-start")) {
    Just(start) -> catch({
      val end = attr.lookupKey("data-line-end", start)
      val (path, startLine) = start.extractPosition(inputName)
      val (_, endLine) = end.extractPosition(inputName)
      Just(Range(path, startLine, endLine))
    }, fun(exn) { Nothing })
    Nothing -> Nothing
  }
}

function extractPosition(locationString: string, inputName: string): exn (string, int) {
  val locs = (inputName + ":" + locationString).split(";").list
  val last = locs.last.split(":")
  (last[0], last[1].parseInt.unJust)
}

// we need the inputName to normalize position information
function toBlockElements(bs: list<block>, inputName: string): div vector<blockElement> {
  vector(bs.map(fun(b){ b.toBlockElement(inputName) }).concatMaybe)
}

// TODO also include range information in extracted block structure
function toBlockElement(b: block, inputName: string): div maybe<blockElement> {
  match(b) {
    HLine( attrs ) -> 
      Just(BlockElement("hline", attrs.name, attrs.elem, vector(), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Para( text, attrs ) -> 
      Just(BlockElement("para", attrs.name, attrs.elem, vector(), text, vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Code( text, _, attrs) -> 
      Just(BlockElement("code", attrs.name, attrs.elem, vector(), text, vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Quote( content, attrs) -> 
      Just(BlockElement("quote", attrs.name, attrs.elem, content.toBlockElements(inputName), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    List( _, content, attrs) -> 
      Just(BlockElement("list", attrs.name, attrs.elem, content.toBlockElements(inputName), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Item( content, attrs) -> 
      Just(BlockElement("item", attrs.name, attrs.elem, content.toBlockElements(inputName), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Heading( _, text, attrs) ->
      Just(BlockElement("heading", attrs.name, attrs.elem, vector(), text, vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    // currently table cells are ignored
    Table( _, _, _, attrs) -> 
      Just(BlockElement("table", attrs.name, attrs.elem, vector(), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Div( content, attrs) ->
      Just(BlockElement("div", attrs.name, attrs.elem, content.toBlockElements(inputName), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Source( text, _, attrs) -> 
      Just(BlockElement("source", attrs.name, attrs.elem, vector(), text, vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    // DefLink( id, link) ->
    // DefFootnote( id, content) ->
    // Empty() -> 
    // Special( name, value, attrs) -> 
    // Line( text, _, attrs) -> 
    _ -> Nothing
  }
}


public function initialOptions( args : string = "" ) : io options {
  val opts = if (args=="") then Options(version=version/version)
              else match(parseOptions(version/version,args)) {
                Just(cmdOpts) -> cmdOpts.options
                Nothing       -> Options(version=version/version)
              }
  opts(lineNoWeb=True,
       math=(opts.math)(embedLimit=512*1024),   // must match server setting!
       embedLimit=0,
       copyStyles=False,
       verboseMaxLine=0)  
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


public function markdown( inputName : string, input : string, outdir : string, options0 : options, modes: string, convertTex : bool,
                          continue: (md:string,stdout:string,needRerun:bool,options:options,
                                      files:string,filesRefer:string,filesWrite:string,labels:string,links:string,customs:string,entities:string) -> io () ) : io () 
{ 
  printRedirect( fun(s) {
    log("stdout",s)
  });

  val extramdata = modes.split(";").list.map( fun(key) { (key,"True") })
  val options    = options0( metadata = options0.metadata + extramdata )

  val copts = coptions(options = options, outputDir = outdir, convertTex = convertTex)
  val outName = outputName(inputName,copts)
  
  var rerun := False;

  function runPdfLatex( srcFile : string, texFile : string, opts : options, content : string, cont : (int) -> io () ) : io () 
  {
    options.printErr("cannot generate pdf in the browser")
    cont(1)
  }

  function runZip( files : list<string>, zipFile : string, opts : options, cont : (bool) -> io () ) : io () {
    options.printErr("cannot zip files in the browser")
    cont(False)
  }

  function runBibtex( bibFiles : list<string>, opts : options, cont : bool -> io () ) : io () 
  {
    rerun := bibFiles.isCons
    //trace("bibtex rerun")
    cont(bibFiles.isCons)
  } 

  function runMathStatic( content : string, inpName : string, outputname : string,
                          texNamePlain : string, texNameFull : string,
                          plainPages : pages, fullPages : pages,
                          oldMathPlain : string, oldMathFull : string,
                          xopts : options, cont : (maybe<(dict<mathinfo>,string)>) -> io () ) : io ()
  {
    rerun := True
    trace("math rerun")
    cont(Nothing)
  }

  val runners = Runners(runPdfLatex, runBibtex, runMathStatic, runZip )

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

// Currently the logs are very sparse... Did I omit too much of the
// processing to catch errors?
public function analyze(
  inputName : string, content : string, outdir : string,
  opts : options,
  continue : (analyzeResults) -> io ()
) : io () { 
  printRedirect( fun(s) { log("stdout", s) });

  val copts = coptions(options = opts, outputDir = outdir, convertTex = False)
  val outName = outputName(inputName, copts)
  withLog("stdout") {
    processContentLSP(inputName, outName, content, copts) fun (blocks, ctx) {
      val stdout = getLog("stdout")
      val labeledElems = ctx.inlineContext.labels.list().map(labelInfo)
      val res = AnalyzeResults(ctx.lineMap, vector(labeledElems), blocks.toBlockElements(inputName), ctx, stdout)
      continue(res)
    }
  }
  ()
}


// Sometimes we don't want to process the full document but only
// obtain the document structure of the currently open editor.
// Sadly, parseBlocks does not provide enough positioning information
// on the blocks ATM.
// public function parseBlocks(text: string): div vector<blockElement> {
//   parseBlocks(text, 0, End, mdata = dict()).toBlockElements
// }

function labelInfo(elem: (string, label)): labeledElement {
  val (id, label) = elem
  LabeledElement(id, label.element, label.labelCaption, null(label.labelPosition))
}

function labelPosition(label : label) : maybe<position> {
  match(label.labelAttrs.hasKey("data-line")) { // || label.labelAttrs.hasKey("data-line-first")
    Just(info) -> {
      val (path, lineno) = parseLineInfo(info)
      Just(Position(path.lastPathSegment, lineno))
      // if (lineno <= 0 || info.startsWith("0;")) then Nothing else Just((path.lastPathSegment, lineno))
    }
    Nothing    -> Nothing    
  }
}

function lastPathSegment( lineInfo : string ) : string {
  match (lineInfo.find(rxLastPath)) {
    Nothing   -> lineInfo
    Just(cap) -> cap.groups[1]
  }
}
val rxLastPath = regex( @";([^:;]+):$" )