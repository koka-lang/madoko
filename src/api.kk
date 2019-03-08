module api

import std/dict
import std/regex
import std/log
import std/path

import backports
import version

import block        // just for the type block
import formatBlock  // just for formatContext
import common       // for label, lineMap, and attrs
import inline       // for parseLineInfo
import driver       // for outputName, processContentLSP
import metadata     // for parseMeta
import madoko       // for normalizeSource, lastPathSegment
import definitions  // for parseBody
import options
import includes


// Types that are part of the public API
// -------------------------------------

// TODO also migrate to range
public struct position (path: string, line: int)

// Line information is 1-based and inclusive.
public struct range (path: string, from: int, to: int)

public struct referenceInfo (
  id: string,
  element: string,
  caption: string,
  position: null<position>
)

public struct documentInfo (
  labels: vector<referenceInfo>,
  blocks: vector<blockInfo>,
  // just for debugging purposes we also include the original formatContext
  context : formatContext,
  log: string
)

// the type of block nodes we export to js / typescript
public struct blockInfo (
  // the block kind
  kind: string,
  // the element id, empty if not present
  id: string,
  // the tag name, empty if not present
  name: string,
  // the child nodes
  content: vector<blockInfo>,
  // the text content
  text: string,
  // the classes
  classes: vector<string>,
  // attributes of the block node (like "caption")
  attributes: dict<string>,
  // TODO also include position and range information.
  position: null<range>
)

// Main Entrypoint
// ---------------

// Runs the frontend to parse and analyze the document but does not
// generate an html or tex document.
//
// Resolves includes and also processes those files.
//
// TODO Currently the logs are very sparse... Did I omit too much of the
// processing to catch errors?
public function analyze(
  inputName : string, content : string, resolveIncludes: bool, continue : (documentInfo) -> io ()
) : io () {
  printRedirect( fun(s) { log("stdout", s) });

  val options = Options(
    version=version/version,
    lineNoWeb=True,
    math=Mathoptions(mode = Static),
    embedLimit=0,
    verbose=1,
    full=Just(False),
    copyStyles=False)
  
  content.include(!resolveIncludes, inputName, "out/test.mdk", [inputName.dirname], options) fun(includedContent, lmap) {

    withLog("stdout") {
      // TODO speed up again, by adding option to not run `formatBlocks` 
      //      AT ALL for the presentation compiler.
      val (_,_,blocks, ctx) = markdown(includedContent, options(lineMap=lmap))
      val stdout = getLog("stdout")
      val labeledElems = ctx.inlineContext.labels.list().map(labelInfo)
      val res = DocumentInfo(vector(labeledElems), blocks.toBlockInfos(inputName), ctx, stdout)
      continue(res)
    }
  }
  ()
}

// Computing position and range information
// ---------------------------------------

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
function toBlockInfos(bs: list<block>, inputName: string): div vector<blockInfo> {
  vector(bs.map(fun(b){ b.toBlockInfo(inputName) }).concatMaybe)
}

// TODO also include range information in extracted block structure
function toBlockInfo(b: block, inputName: string): div maybe<blockInfo> {
  match(b) {
    HLine( attrs ) ->
      Just(BlockInfo("hline", attrs.name, attrs.elem, vector(), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Para( text, attrs ) ->
      Just(BlockInfo("para", attrs.name, attrs.elem, vector(), text, vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Code( text, _, attrs) ->
      Just(BlockInfo("code", attrs.name, attrs.elem, vector(), text, vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Quote( content, attrs) ->
      Just(BlockInfo("quote", attrs.name, attrs.elem, content.toBlockInfos(inputName), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    List( _, content, attrs) ->
      Just(BlockInfo("list", attrs.name, attrs.elem, content.toBlockInfos(inputName), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Item( content, attrs) ->
      Just(BlockInfo("item", attrs.name, attrs.elem, content.toBlockInfos(inputName), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Heading( _, text, attrs) ->
      Just(BlockInfo("heading", attrs.name, attrs.elem, vector(), text, vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    // currently table cells are ignored
    Table( _, _, _, attrs) ->
      Just(BlockInfo("table", attrs.name, attrs.elem, vector(), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Div( content, attrs) ->
      Just(BlockInfo("div", attrs.name, attrs.elem, content.toBlockInfos(inputName), "", vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    Source( text, _, attrs) ->
      Just(BlockInfo("source", attrs.name, attrs.elem, vector(), text, vector(attrs.classes), dict(attrs.keyvals), attrs.range(inputName).null))
    // DefLink( id, link) ->
    // DefFootnote( id, content) ->
    // Empty() ->
    // Special( name, value, attrs) ->
    // Line( text, _, attrs) ->
    _ -> Nothing
  }
}


function labelInfo(elem: (string, label)): referenceInfo {
  val (id, label) = elem
  ReferenceInfo(id, label.element, label.labelCaption, null(label.labelPosition))
}

// TODO change to labelRange
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
