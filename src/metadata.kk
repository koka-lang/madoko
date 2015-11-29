/*---------------------------------------------------------------------------
  Copyright 2013-2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// The parsing of metadata
module metadata

import std/log
import std/dict
import std/regex
import std/string
import std/path
import common
import options
import optionsMeta
import expression



// Parse the meta-data at the start of a document,
// and return updated options and the rest of the document
public function parseMeta( options0 : options, fmt : formatter, txt : string ) : div (options, string) 
{
  // read initial metadata
  val (txt1,lineCount0) = stripInitialWhite(txt)
  val (mdata1,rest,lineCount) = parsePlainMeta(txt1, fmt, options0.lineMap, verbose=options0.verbose >= 4, lines=lineCount0 )
  // read further <!--meta sections
  val mdatas = rest.findAll( rxMetaSection ).list.map fun(cap) {
    val (metaTxt,lineCountMeta) = stripInitialWhite(cap.groups[1] + "\n")
    val lineNo = lineCount + rest.substr(0,cap.index).count("\n") + lineCountMeta
    val (mdatax,_,_) = parsePlainMeta(metaTxt, fmt, options0.lineMap, [], options0.verbose >= 4, lineNo )
    mdatax
  }
  val mdata2 = mdata1 + mdatas.concat
  val mdataDef  = parsePlainMeta(defaultMeta(options0,fmt), fmt,options0.lineMap, verbose=options0.verbose >= 4).fst      
  // set options from metadata
  val mdataFull = mdataDef + options0.cmetadata + mdata2
  val mdataModed = mdataFull.evalConditionals(options0.verbose >= 4)
  val options2 = options0.fromMeta(mdataModed)
  val options = options2( metadata = mdataModed )

  if (options.lineNo > 0)
   then (options(lineNo = options.lineNo + lineCount),rest)
   else (options,rest)  
}
val rxMetaSection = regex(@"^<!--meta *\n([\s\S]*?)^-->", multiline=True)

function stripInitialWhite( txt : string ) : (string,int) {
  match(txt.find(rxInitialWhite)) {
    Nothing   -> (txt,0)
    Just(cap) -> (txt.substr(cap.next), txt.substr(0,cap.next).count("\n"))
  }
}
val rxInitialWhite = regex(@"^(\s|<!--(?!meta\b|madoko\b)[\s\S]*?-->)+")


// --------------------------------------------------------------
// metadata with support conditionals
// --------------------------------------------------------------

alias cmetadata = list<ckey>

type ckey {
  Key( key: string, value : string )
  Support( condition: string, body: list<ckey>, lineInfo : string )
}

function cmetadata( options : options ) : cmetadata {
  options.metadata.map( fun(kv) { Key(kv.fst, kv.snd) } )
}

// --------------------------------------------------------------
// Parse metadata keys
// --------------------------------------------------------------

function makeKey(k,pre,value,rawvalue,lineMap,lines,isMatching) : ckey {
  val kstart = k.substr(0,1) 
  val isrule = (kstart=="#" || kstart=="." || kstart=="~")
  val key = if (isrule) then k.trim.toLower
            elif (isMatching) then "~" + k.trim.toLower 
            else k.trim.normalizeId
  if (key.startsWith("~")) {
    log("customs","{\"name\":" + key.json + ",\"display\":" + 
        (if (isrule) then k.substr(1) else k).json + "}")
  }
  val ckey = if (key=="tex-header" || key=="tex-footer" || key=="tex-header-" || key=="tex-doc-header" || key=="tex-doc-header-" )   
               then Key(key,"%mdk-data-line={" + translateLine(lineMap,lines+1) + "}\n" + rawvalue )
               else Key(key,value)
  if (pre.isEmpty)
   then ckey
   else Support( pre, [ckey], translateLine(lineMap,lines))
}                 

function parsePlainMeta( txt : string, fmt : formatter, lineMap: lineMap, metadata : cmetadata = [], verbose : bool = False, lines : int = 0 ) : div (cmetadata,string,int) 
{ 
  match(txt.find(rxMetaComment)) {
    Just(cap) -> {
      if (cap.groups[1].bool) {
        parsePlainMeta(cap.groups[2].unindent + txt.substr1(cap.next), fmt, lineMap, metadata, verbose, 
                       lines + txt.substr(0,cap.index).count("\n") + 1)
      }
      else {
        parsePlainMeta(txt.substr1(cap.next), fmt, lineMap, metadata, verbose, 
                        lines + txt.substr(0,cap.next).count("\n"))
      }
    }
    Nothing -> {
      match(txt.find(rxSupports)) {
        Just(cap) -> {
          if (verbose) trace("meta data: @if " +  cap.groups[1].trim + "{" + cap.groups[2] + "}{" )
          val (body,rest,_) = parsePlainMeta(cap.groups[2].unindent.trim, fmt, lineMap, [], verbose, lines + cap.groups[1].count("\n") )
          if (rest != "") warning("invalid metadata: " + rest.cutoff(40))
          if (verbose) trace("}" )
          val support = Support(cap.groups[1].trim, body, translateLine(lineMap,lines+1))
          val lines2 = txt.substr(0,cap.next).count("\n")
          parsePlainMeta( txt.substr1(cap.next), fmt, lineMap, Cons(support,metadata), verbose, lines + lines2 )
        }
        Nothing -> match(txt.find(rxMeta)) {
          Nothing   -> {
            //trace("metadata end: " + txt.substr(0,100))
            (metadata.reverse,txt,lines)
          }
          Just(cap) -> {
            val rawvalue = cap.groups[4] || cap.groups[6]  // 6=:value, 4={value}
            val value    = rawvalue.joinLines.trim
            if (verbose) trace("meta data: " + cap.groups[2] + ": " + value.cutoff(80) )
            val rawkeys = //if (cap.groups.matchedOn(3)) then 
                          cap.groups[2].split(",").list.map(trim)
                          //else [cap.groups[2]]     
            val pre = if (cap.groups[1] != "") then "@" + cap.groups[1] + " " else ""
            val kvs = rawkeys.map( fun(k) { makeKey(k,pre,value,rawvalue,lineMap,lines,(cap.groups[5]=="}")) } );                
            val lines2 = txt.substr(0,cap.next).count("\n")
            parsePlainMeta( txt.substr1(cap.next), fmt,lineMap, kvs + metadata, verbose, lines+lines2 )
          }
        }
      }
    }
  }
} 

val rxMetaKey     = @"(?:@([\w\-@]+) +)?((?:\w|([\.#~])(?=\S))[\w\-\.#~, ]*?\*?) *(?=[\{:])"
val rxMetaValue   = @"(?:[:] *(.*(?:\n .*)*)(?:\n+(?=\n|" + rxMetaKey + @"|@(?:if|supports)\b|<!--)|$))"
val rxMetaAttrContent = @"(?:[^\\'""\{\}/]|\\[\s\S]|'(?:[^\\']|\\[\s\S])*'|""(?:[^\\""]|\\[\s\S])*""|/(?:[^\\/\n]|\\.)*/)"
val rxMetaAttrs   = @"(?:\{[:]?(" + rxMetaAttrContent + @"*)(\})\s*)"
val rxMetaGroup   = @"(?:\{((?:" + rxMetaAttrContent + "|" + rxMetaAttrs + @")*)\} *(?:\n|$)\s*)"

val rxMetaComment = regex(@"^(?:\s*<!--(?:(meta|madoko)\b *\n)?([\s\S]*?)-->(?: *\n)+)+")
val rxMeta        = regex(@"^"+ rxMetaKey + @"(?:" + rxMetaAttrs + "|" + rxMetaValue + @")")
val rxSupports    = regex(@"^@(?:if|supports)\b([^\n\{]*)" + rxMetaGroup)

public function cutoff( s : string, n : int ) : string {
  if (s.length > n) then s.substr(0,n) + "..." else s
}

// --------------------------------------------------------------
// Complete author keys
// --------------------------------------------------------------

// fill out all the authorN keys
public function completeAuthorKeys( mdata : metadata ) : metadata {
  var authorCount := 0
  val authors = mdata.concat fun(kv) {
    val (key,value) = kv
    if (key=="author") {
      authorCount := authorCount+1
      [("author" + authorCount.show, value)]
    }
    elif (key=="affiliation" || key=="institute" || key=="address") {
      [("affiliation" + authorCount.show, value)]
    }
    elif (key=="email") {
      [("email" + authorCount.show, value.escapeAt)]
    }
    elif (key=="author-note") {
      [("author-note" + authorCount.show, value)]
    }
    else []
  }
  mdata + authors + [("author-count", authorCount.show )]
}

function escapeAt( s : string ) : string {
  s.replaceAll(regex(@"\\(.)|(@)"), @"\$1$2")
}

// --------------------------------------------------------------
// Flatten conditional keys into non-conditional list
// --------------------------------------------------------------

function evalConditionals( mdata :cmetadata, verbose : bool = False ) : <div> metadata {
  val modes = mdict()
  flatten(mdata,modes,verbose)
}

function flatten( mdata:cmetadata, modes:mdict<h,constant>, verbose : bool ) : <div,st<h>> metadata {
  mdata.concat fun(ckey) {
    match(ckey) {
      Key(key,value) -> {
        [(key,value)]
      }
      Support(condition,body,lineInfo) -> {
        logLocation(lineInfo)
        val b = evaluateBool(condition,modes,mdata) 
        if (verbose) then trace("evaluate: " + condition + " -> " + b.show + ": " + lineInfo)
        if (b)
         then flatten(body,modes,verbose)
         else []
      }
    }
  }
}


// --------------------------------------------------------------
// Evaluate expressions in the context of metadata
// --------------------------------------------------------------

function evaluateBool( cond : string, modes : mdict<h,constant>, mdata : cmetadata, current : list<string> = []  ) : <div,st<h>> bool {
  var recursive := False
  function lookup(v,display) {
    if (current.contains(v)) {
      recursive := True
      String("False")
    }
    else match(lookupMode(modes,v,mdata,Cons(v,current))) {
      Nothing -> error("undefined variable: " + display)
      Just(c) -> c
    }
  }
  val b = evaluate( cond, fun(e) { evalExpr(e,lookup).bool }, False)
  // trace("evaluate: " + cond + " -> " + b.show + " (recursive=" + recursive.show + ")" )
  if (recursive) 
   then False // a self-dependent support block evaluates to false
   else b  
}


function lookupMode( modes : mdict<h,constant>, mode : string, mdata : cmetadata, current : list<string> ) : <div,st<h>> maybe<constant> {
  match(modes[mode]) {
    Just(c) -> {
      //trace("pre-evaluated: " + mode + ": " + c.show)
      Just(c)
    }
    Nothing -> {
      val mbRes = mdata.reverse.foreachUntil( fun(ckey) { 
        match(ckey) {
          Key(key,raw) -> {
            if (key != mode) then Nothing
             else {
               val res = String(raw)
               //trace("found var: " + key + ": " + raw)
               modes[mode] := res
               Just(res)
             }
          }
          Support(cond,body,_lineInfo) -> {
            if (body.containsKey(mode)) then {
              if (evaluateBool(cond,modes,mdata,current)) {
                //trace(" look inside: " + cond)
                lookupMode(modes,mode,body,current)
              }
              else {
                //trace(" support " + cond + " contains " + mode + " but is false: " + lineInfo )
                Nothing               
              }
            }
            else {
               //trace(" support " + cond + " does not contain " + mode + ": " + lineInfo )
               //trace(" -> " + body.map(fun(ckey) { match(ckey) { Key(k) -> k; _ -> "<support>" } }).join(","))
               Nothing
            }
          }
        }
      })
      match(mbRes) {
        Nothing -> {
          modes[mode] := String("False")
          Nothing
        }
        _ -> mbRes
      }
    }
  }
}

function containsKey( mdata : cmetadata, key : string ) : div bool {
  mdata.any( fun(ckey) {
    match(ckey) {
      Key(k) -> k == key
      Support(_cond,body) -> body.containsKey(key)
    }
  })
}


// --------------------------------------------------------------
// Default metadata
// --------------------------------------------------------------

function defaultMeta( options : options, fmt : formatter ) : string {
  ( [ "Tex: False", "Html: False", "Prelude: prelude",
      // formatter
      fmt.showFormatter + ": True",
      // legacy for old prelude
      @"~Bibliography : bibstyle='" + options.bibStyle + @"' bibdata='" + options.bib.splitPaths.join(",") + "' tex-elem=mdBibliography",
    ] +
    ["\n"]
  ).join("\n") 
}

