/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
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

infixr 5 (<*), (*>), (<*>)



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
  val mdataModed = mdataFull.evalConditionals
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
  val ckey = if (key=="tex-header" || key=="tex-footer" || key=="tex-header-")   
               then Key(key,"%mdk-data-line={" + (lines+1).show + "}\n" + rawvalue )
               else Key(key,value)
  if (pre.isEmpty)
   then ckey
   else Support( pre, [ckey], translateLine(lineMap,lines))
}                 

function parsePlainMeta( txt : string, fmt : formatter, lineMap: lineMap, metadata : cmetadata = [], verbose : bool = False, lines : int = 0 ) : div (cmetadata,string,int) 
{ 
  match(txt.find(rxSupports)) {
    Just(cap) -> {
      val body = parsePlainMeta(cap.groups[2].trim, fmt, lineMap, [], verbose, lines + cap.groups[1].count("\n") )
      trace("@supports: " + cap.groups[2].trim + ": " + body.fst.length.show)
      val support = Support(cap.groups[1].trim.unindent, body.fst, translateLine(lineMap,lines+1))
      val lines2 = txt.substr(0,cap.next).count("\n")
      parsePlainMeta( txt.substr1(cap.next), fmt, lineMap, Cons(support,metadata), verbose, lines + lines2 )
    }
    Nothing -> match(txt.find(rxMeta)) {
      Nothing   -> {
        trace("metadata end: " + txt.substr(0,100))
        (metadata.reverse,txt,lines)
      }
      Just(cap) -> {
        val rawvalue = cap.groups[4] || cap.groups[6]  // 6=:value, 4={value}
        val value    = rawvalue.joinLines.trim
        trace("meta data: " + cap.groups[5] + ": " + cap.groups[2] + ": " + value )
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
val rxMetaComment = @"(?:\s*<!--[\s\S]*?-->(?: *\n)+)*"
val rxMetaKey     = @"(?:@([\w\-@]+) +)?((?:\w|([\.#~])(?=\S))[\w\-\.#~, ]*?\*?) *(?=[\{:])"
val rxMetaValue   = @"(?:[:] *(.*(?:\n .*)*)(?:\n+(?=\n|" + rxMetaKey + @"|@supports\b)|$))"
val rxMetaAttrContent = @"(?:[^\\'""\{\}]|\\[.\n]|'(?:[^\\']|\\[.\n])*'|""(?:[^\\""]|\\[.\n])*"")"
val rxMetaAttrs   = @"(?:\{[:]?(" + rxMetaAttrContent + @"*)(\})\s*)"
val rxMetaGroup   = @"(?:\{((?:" + rxMetaAttrContent + "|" + rxMetaAttrs + @")*)\}\s*)"

val rxMeta        = regex(@"^"+ rxMetaComment + rxMetaKey + @"(?:" + rxMetaAttrs + "|" + rxMetaValue + @")")
val rxSupports    = regex(@"^"+ rxMetaComment + @"@supports\b([^\n\{]*)" + rxMetaGroup)


function unindent( txt : string ) : string {
  val lines = txt.lines.list
  val cindent = lines.map(fun(s) { match(s.find(regex(@"^\s*"))) {
    Nothing -> 0
    Just(cap) -> if (cap.matched.length == s.length) then 100 else cap.matched.length
  }}).minimum
  if (cindent <= 0) 
   then txt
   else lines.map( fun(s) { s.substr(cindent) }).join("\n")
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
      [("email" + authorCount.show, value)]
    }
    elif (key=="author-note") {
      [("author-note" + authorCount.show, value)]
    }
    else []
  }
  mdata + authors + [("author-count", authorCount.show )]
}

// --------------------------------------------------------------
// Flatten conditional keys into non-conditional list
// --------------------------------------------------------------

function evalConditionals( mdata :cmetadata ) : <div> metadata {
  val modes = mdict()
  flatten(mdata,modes)
}

function flatten( mdata:cmetadata, modes:mdict<h,bool>) : <div,st<h>> metadata {
  mdata.concat fun(ckey) {
    match(ckey) {
      Key(key,value) -> {
        [(key,value)]
      }
      Support(condition,body,lineInfo) -> {
        logLocation(lineInfo)
        if (evaluateBool(condition,modes,mdata))
         then flatten(body,modes)
         else []
      }
    }
  }
}


// --------------------------------------------------------------
// Evaluate expressions in the context of metadata
// --------------------------------------------------------------

function evaluateBool( cond : string, modes : mdict<h,bool>, mdata : cmetadata, current : list<string> = []  ) : <div,st<h>> bool {
  var recursive := False
  function lookup(v,display) {
    if (current.contains(v)) {
      recursive := True
      Bool(False)
    }
    else match(lookupMode(modes,v,mdata,Cons(v,current))) {
      Nothing -> error("undefined variable: " + display)
      Just(b) -> Bool(b)
    }
  }
  val b = evaluate( cond, fun(e) { evalExpr(e,lookup).bool }, False)
  trace("evaluated: " + cond + " -> " + b.show + ", recursive: " + recursive.show)
  if (recursive) then False else b  
}


function lookupMode( modes : mdict<h,bool>, mode : string, mdata : cmetadata, current : list<string> ) : <div,st<h>> maybe<bool> {
  match(modes[mode]) {
    Just(value) -> Just(value)
    Nothing -> {
      val mbRes = mdata.reverse.foreachUntil( fun(ckey) { 
        match(ckey) {
          Key(key,raw) -> {
            if (key != mode) then Nothing
             else {
               trace( " lookup: found: " + key + ": " + raw)
               val value = raw.trim.toLower
               val res = (value=="true" || value=="1")
               modes[mode] := res
               Just(res)
             }
          }
          Support(cond,body) -> {
            if (body.containsKey(mode) && evaluateBool(cond,modes,mdata,current)) 
             then lookupMode(modes,mode,body,current)
             else Nothing
          }
        }
      })
      match(mbRes) {
        Nothing -> {
          modes[mode] := False
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

function contains( xs : list<string>, s : string ) : bool {
  xs.find( fun(x) { x == s }).bool
}

// --------------------------------------------------------------
// Evaluate expressions
// --------------------------------------------------------------

type expr  {
  UnOp( op : string, expr : expr)
  BinOp( op: string, left : expr, right : expr )
  Const( c : constant )
  Var( v : string, display : string )
}

type constant {  
  Int( i :int )
  Bool( b : bool )
  String( s : string )
  Regex( r : regex )
}



function evaluate( expr : string, eval : expr -> <exn,div|e> a, default : a ) : <div|e> a {
  match(parseExpr(expr)) {
    Just(res) | res.snd.trim.isEmpty -> {
      catch( fun() { eval(res.fst) }, fun(exn) { 
        warning(exn.show)
        default
      })
    }
    _ -> {
      warning("invalid expression: " + expr)
      default
    }
  }
}

function evalExpr( expr : expr, lookup : (string,string) -> <exn|e> constant ) : <exn|e> constant {
  match(expr) {
    Const(c) -> c
    Var(v,d) -> lookup(v,d)
    UnOp(op,arg) -> {
      if (op=="not") {
        Bool( !(evalExpr(arg, lookup).bool) )
      }
      else error("invalid operator: " + op)
    }
    BinOp(op,arg1,arg2) -> {
      val x1 = evalExpr(arg1,lookup)
      val x2 = evalExpr(arg2,lookup)
      if (op=="and" || op=="&&")  Bool( x1.bool && x2.bool )
      elif (op=="or" || op=="||") Bool( x1.bool || x2.bool )
      elif (op==":" || op=="==") Bool( binop(x1,x2,"==",fun(x,y) { x==y },fun(x,y) { x==y },fun(x,y) { x==y }) )
      elif (op=="!=") Bool( binop(x1,x2,"!=",fun(x,y) { x!=y },fun(x,y) { x!=y },fun(x,y) { x!=y }) )
      elif (op==">") Bool( binop(x1,x2,">",fun(x,y) { x>y },serr,berr) )
      elif (op==">=") Bool( binop(x1,x2,">=",fun(x,y) { x>=y },serr,berr) )
      elif (op=="<") Bool( binop(x1,x2,"<",fun(x,y) { x<y },serr,berr) )
      elif (op=="<=") Bool( binop(x1,x2,"<=",fun(x,y) { x<=y },serr,berr) )
      else error("invalid operator: " + op)
    }
  }
}

function serr( s1 : string, s2 : string ) : exn a { error("cannot compare strings") }
function berr( b1 : bool, b2 : bool ) : exn a { error("cannot compare booleans") }

function binop( c1 : constant, c2: constant, op : string, iop : (int,int) -> exn a, sop : (string,string) -> exn a, bop : (bool,bool) -> exn a) : exn a {
  val msg = "comparing values of different types (" + op + ")"
  match(c1) {
    Int(i1) -> match(c2) {
      Int(i2) -> iop(i1,i2)      
      _       -> error(msg)
    }
    String(s1) -> match(c2) {
      String(s2) -> sop(s1,s2)
      _          -> error(msg)
    }
    Bool(b1) -> match(c2) {
      Bool(b2) -> bop(b1,b2)
      _        -> error(msg)
    }
    _ -> error(msg)
  }
}

function bool( c : constant ) : exn bool {
  match(c) {
    Bool(b)   -> b
    Int(i)    -> (i != 0)
    String(s) -> (s != "")
    Regex()  -> error("cannot use regular expression as a boolean condition")
  }
}


// --------------------------------------------------------------
// Parse Expressions
// --------------------------------------------------------------

val parseExpr = unsafeTotal(parseTerm)

function parseTerm() : div parser<expr> {
  parseUnary() <$ 
  ( (string(@"(and\b|or\b|(:|==|!=|>=|<=|>|<|&&|\|\|)(?=[\s\w]))") <*> (fun(s) { parseExpr(s) })).map2( fun(op,arg2) { return fun(arg1) { BinOp(op,arg1,arg2) }} )
   || succeed( id )
  )
}

function parseUnary() : div parser<expr> {
  (string(@"(!|not\b)") *> parseAtom()).map( fun(e) { UnOp("not",e) } ) ||
  parseAtom()
}

function parseAtom() : div parser<expr> {
  parseModes || parseConst || parseVar ||
  (string(@"\(") *> (fun(s) { parseExpr(s) }) <* string(@"\)"))
}

val parseConst : parser<expr> =
   (parseBool || parseCInt || parseString).map(fun(c) { Const(c) })

val parseVar : parser<expr> =
  string(@"[\w\-]+").map( fun(s) { Var(s.normalizeId, s) } )

val parseCInt : parser<constant> = 
  string(@"\d+").map(fun(s) { Int(parseInt(s).maybe(0,id)) } )

val parseBool : parser<constant> = 
  string(@"true\b").map(fun(s) { Bool(True) } ) 
  ||  string(@"false\b").map(fun(s) { Bool(False) } )

val parseString : parser<constant> = 
  string(@"'(?:[^\\']|\\[.\n])*'|""(?:[^\\""]|\\[.\n])*""").map(fun(s) { String(s.unquote) } )

val parseModes : parser<expr> =
  (parseMode <*> many(parseMode)).map2 fun(x,xs) {
    xs.foldl(x,fun(a,b) { BinOp("and",a,b) } )
  }


val parseMode : parser<expr> =
  satisfy(@"@(no)?([\w\-]*)").map fun(cap) {
    val v = Var(cap.groups[2].normalizeId, cap.groups[2])
    if (cap.groups[1].isEmpty) then v else UnOp("not",v)
  }

// --------------------------------------------------------------
// Parsers
// --------------------------------------------------------------

alias parser<a> = string -> div maybe<(a,string)>

function map( p : parser<a>, f : a -> b ) : parser<b> {
  return fun(s) { 
    match(p(s)) {
      Nothing -> Nothing
      Just(x) -> Just((f(x.fst),x.snd))
    }
  }
}

function map2( p : parser<(a,b)>, f : (a,b) -> c ) : e parser<c> {
  p.map( fun(x) { f(x.fst, x.snd)}) 
}


function (<$)( p1 : parser<a>, p2: parser<a -> b> ) : parser<b> {
  (p1 <*> p2).map2( fun(x,f) { f(x) } )
}

function (*>)( p1 : parser<a>, p2: parser<b> ) : parser<b> {
  (p1 <*> p2).map( fun(x) { x.snd } )
}

function (<*)( p1 : parser<a>, p2: parser<b> ) : parser<a> {
  (p1 <*> p2).map( fun(x) { x.fst } )
}

function (<*>)( p1 : parser<a>, p2 : parser<b> ) : parser<(a,b)> {
  return fun(s) {
    match(p1(s)) {
      Nothing -> Nothing
      Just(x) -> match(p2(x.snd)) {
        Nothing -> Nothing
        Just(y) -> Just(((x.fst,y.fst),y.snd))
      }
    }
  }
}

function (||)( p1 : parser<a>, p2 : parser<a> ) : parser<a> {
  return fun(s) {
    match(p1(s)) {
      Nothing -> p2(s)
      res     -> res
    }
  }
}

function many1( p : parser<a>) : parser<list<a>> {
  (p <*> many(p)).map2( fun(x,xs) { Cons(x,xs) } )
}

function many( p : parser<a> ) : parser<list<a>> {
  return fun(s) { manyx(p,s) }
}

function manyx( p : parser<a>, s : string ) : div maybe<(list<a>,string)> {
  match(p(s)) {
    Nothing -> Just(([],s))
    Just(x) -> match(manyx(p,x.snd)) {
      Nothing -> Nothing
      Just(y) -> Just((Cons(x.fst,y.fst),y.snd))
    }
  }
}

function string( r: string ) : parser<string> {
  satisfy("(" + r + ")").map( fun(cap) { cap.groups[1] })
}

function satisfy( r: string ) : parser<matched> {
  return fun(s) {
    match(s.find(regex(@"^\s*" + r, ignoreCase=True))) {
      Just(cap) -> {
        trace("satisfy: " + cap.matched)
        Just((cap,s.substr1(cap.next)))
      }
      Nothing   -> Nothing
    }
  }
}

function succeed( x : a ) : parser<a> {
  return fun(s) { Just((x,s)) }
}

// --------------------------------------------------------------
// Default metadata
// --------------------------------------------------------------

function filterModed( mdata :metadata ) : <div> metadata {
  val modes = mdict()
  mdata.map( fun(kv) {
    //trace("filter: " + kv.fst)
    match(modes.unMode(kv.fst,mdata)) {
      Just(key) -> Just((key,kv.snd))
      Nothing   -> Nothing
    }
  }).concatMaybe
}


function unMode( modes : mdict<h,bool>, key0 : string, mdata : metadata ) : <div,st<h>> maybe<string> {
  val key = key0.toLower
  match(key.find(rxModed)) {
    Nothing   -> Just(key) 
    Just(cap) -> {
      val neg  = cap.groups[1] == "no"
      val mode = cap.groups[2]
      val isTrue = (mode=="" || modes.getMode(mode,mdata))
      val keep = ((isTrue && !neg) || (!isTrue && neg))
      if (keep)
       then unMode(modes, cap.groups[3], mdata)
       else Nothing
     }
   }
}

function getMode( modes : mdict<h,bool>, mode : string, mdata : metadata ) : <div,st<h>> bool {
  match(modes[mode]) {
    Just(value) -> value
    Nothing -> {
      modes[mode] := False  // prevent infinite recursion
      val mbRes = mdata.reverse.foreachUntil( fun(kv) { 
        val key = kv.fst.toLower
        match( key.find(rxModedKey)) {
          Nothing   | key==mode -> Just(kv.snd) 
          Just(cap) | cap.groups[1].trim.toLower == mode -> {
            match(modes.unMode(kv.fst,mdata)) { // may recurse
              Just(_) -> Just(kv.snd)
              Nothing -> Nothing
            }
          }
          _ -> Nothing
        }        
      })
      match(mbRes) {
        Just(raw) -> {
          val value = raw.trim.toLower
          val res = (value=="true" || value=="1")
          modes[mode] := res
          res        
        }
        Nothing     -> False
      }
    }
  }
}


val rxModed = regex(@"@(no)?([\w\-]*)(?: *)(.*)")
val rxModedKey = regex(@"@[\w\-@]+ +(.*)")

// --------------------------------------------------------------
// Default metadata
// --------------------------------------------------------------

function defaultMeta( options : options, fmt : formatter ) : string {
  ( [ "Tex: False", "Html: False", "Tex2: False","Maketitle: False",
      fmt.showFormatter + ": True",
      @"~Bibliography : bibstyle='" + options.bibStyle + @"' bibdata='" + options.bib.splitPaths.join(",") + "' tex-elem=mdBibliography",
    ] +
    list(1,6).map fun(d) { heading(d,options.headingDepth,options.tocDepth) }
    +
    ["\n"]
  ).join("\n") 
}

function heading( depth : int, headingDepth : int, tocDepth : int ) {
  val label = list(1,depth).map( fun(d){ headingCounter(d) } ).join(".")
  val num   = depth.show
  ["~h" + num + ": ", 
   (if (depth > 1) then headingCounter(depth) else ""),
   " label='[" + label + "]{.heading-label}'",
   (if (depth > headingDepth) then "" else " before='[&label;.&ensp;]{.heading-before}'"),
   (if (depth > tocDepth) then "" else " toc")].join
}

// Generate a heading counter "headingCounter(2)" becomes "@h1-h2".
// The prefix "h1-" ensures this counter resets on "@h1" increments.
function headingCounter( depth : int) : string {
  "@" + list(1,depth).map( fun(i) { "h" + i.show } ).join("-")
}

