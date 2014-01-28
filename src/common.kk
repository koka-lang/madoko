/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Common types and operations
module common

import std/log
import std/regex
import std/dict


// Warning messages get logged
public function warning( message : string, logname : string = "warning" ) : () {
  log(logname,"  warning: " + message)
}

/* --------------------------------------
  Grammar rules 
---------------------------------------- */

// A grammar rule. When "regex" matches, "action" is called with the
// capture groups and the a parser context ":c". The action returns
// results of type ":a" (":block" for the block grammar, and ":string"
// for the inline grammar)
public struct rule<a,c>( 
  name : string, 
  regex : regex, 
  action : (cap : matched, context : c) -> a ) 

public alias grammar<a,c> = list<rule<a,c>>

// Replace a rule in a grammar by another one, if the rule name is a prefix of the name of the new rule.
public function ruleReplace( grammar : grammar<a,c>, pred : bool, rule : rule<a,c> ) : grammar<a,c> {
  if (!pred) 
   then grammar
   else grammar.map fun(r) {
     if (rule.name.startsWith(r.name)) then rule else r
   }
}

public function ruleRemove( grammar : grammar<a,c>, pred : bool, names : list<string> ) : grammar<a,c> {
  if (!pred) then return grammar
  grammar.filter fun(rule) {
    names.all( fun(nm) { !(rule.name.startsWith(nm)) })
  } 
}

// Combine rules into one regular expression. 
// For inline expressions, this does not improve the performance much.
public function combineRules( rules : list<rule<a,c>> ) : rule<a,c> {
  val (rxs,lactions) = rules.map( fun(rule) { (rule.regex.source, rule.action) }).unzip
  actions = lactions.vector
  rx = regexAlt(rxs)
  Rule("<combined>",rx,fun(cap : matched, context) {
    i = max(0,cap.groups.alternative)
    unsafeTotal{ actions[i](cap,context) }
  })
}


/* --------------------------------------
  Generic rule matcher 
---------------------------------------- */

// Generic rule matcher: takes a list of rules and applies the action that matches
// on the given "src". Returns the result of the action and the string following the
// match.
public function matchRules( rules : grammar<a,c>, context : c, src : string, def : string -> a ) : (a,int)
{  
  match(rules) {
    Nil -> {
      //trace("Unable to match any rule!")
      (def(src.substr(0,1)), 1) //src.substr(1))
    }
    Cons(rule,rulesNext) -> {
      match (src.find(rule.regex)) {
        Just(cap) -> {
          //if (rule.name[0] != '.') then trace("match: " + rule.name.fill(12) + ": " + cap.matched.show )
          // Uncomment the next line to get a histogram of rule matches
          // ruleInc(rule.name)
          ((rule.action)(cap,context), cap.next)//src.substr(cap.next)) 
        }
        Nothing -> {
          //stat("fail-" + rule.name)
          matchRules(rulesNext,context,src,def)
        }
      }
    }
  }
}

// This is just for statistics
val ruleHist : mdict<global,int> = unsafeTotal{ mdict() }

function ruleInc( rule : string ) : () {
  unsafeTotal {
    match(ruleHist[rule]) {
      Nothing -> ruleHist[rule] := 0
      Just(i) -> ruleHist[rule] := i+1
    }
  } 
}

public function traceRuleHist() {
  unsafeTotal {
    ruleHist.freeze.list.foreach fun(kv) {
      val (rule,i) = kv
      trace( rule.align(20) + ": " + i.show)
    }
  }
}

/* --------------------------------------
 Citations styles 
---------------------------------------- */

public struct citestyle(
  mode  : citemode, 
  open  : string, 
  close : string, 
  citesep : string, 
  aysep : string, 
  yysep : string,
  sort  : bool = False,
  compress : bool = False
)

public type citemode {
  Numeric
  Natural
  Textual
  Super
  Auto
}

public function isNumCite( cs : citestyle ) : bool {
  match(cs.mode) {
    Natural -> False
    Textual -> False
    Auto    -> False
    _       -> True
  }
}

public val citeNatural = Citestyle(Natural,"(",")","; ",", ",", ")
public val citeNumeric = Citestyle(Numeric,"[","]",", ",", ",", ",True,True)
public val citeAuto    = Citestyle(Auto   ,"[","]",", ",", ",", ")
val citeTextual = Citestyle(Textual,"(",")","; ",", ",", ")
val citeSuper   = Citestyle(Super,"","",",",",",",",True,True)

public function parseCiteStyle( text : string ) : citestyle {
  match(text.find(rxCiteSpec)) {
    Just(cap) -> {
      md = if (cap.groups[1]=="natural") then Natural
           elif (cap.groups[1]=="textual") then Textual
           elif (cap.groups[1]=="numeric") then Numeric
           elif (cap.groups[1]=="super") then Super
           else Auto
      cite = match(md) {
        Natural -> citeNatural
        Textual -> citeTextual
        Super   -> citeSuper
        Numeric -> citeNumeric
        _       -> citeAuto
      }
      xsort = if (cap.groups[2]!="") then (cap.groups[2]=="sort") else cite.sort
      xcompress = xsort      
      if (cap.groups.matchedOn(3)) {           
        aysep = if (cap.groups.matchedOn(6)) then cap.groups[6] else cap.groups[5]
        yysep = if (cap.groups.matchedOn(7)) then cap.groups[7] else aysep      
        Citestyle(md,cap.groups[3],cap.groups[4],cap.groups[5],aysep,yysep,xsort,xcompress)
      }
      else {
        if (cite.sort != xsort) 
         then cite(sort=xsort,compress=xcompress) 
         else cite
      }
    } 
    Nothing -> {
      warning( "unrecognized citation style: " + text)
      citeNumeric
    }
  }
}

val rxVal      = @"\s*""([^""]*)""\s*"
val rxValOpt   = "(?:," + rxVal + ")?"
val rxVals     = rxVal + "," + rxVal + "," + rxVal + rxValOpt + rxValOpt
val rxCiteSpec = regex(@"^(natural|textual|numeric|super|auto|)(?:[:](sort|nosort))?(?:[:]" + rxVals + ")?" )

/* --------------------------------------
 Links 
---------------------------------------- */
// A url link.
public struct link( href : string, title : string = "", linkattrs : attrs = attrsNone)

// A definition identifier is always lower case and sequences of spaces are replaced by a single space.
// Used for links for example.
public function definitionId( s : string ) : string {
  s.replaceAll(rxspaces," ").toLower    
}
val rxspaces = regex(@"\s+")

public function newLink( href : string, title : string = "", linkattrs : attrs = attrsNone, bench : bool ) : link {
  Link(href,title,
       if (!bench && href.startsWith("#"))
        then linkattrs.addClass("localref") 
        else linkattrs)
}

// Info for static math based on images
public struct mathinfo (
  imageName : string,
  height    : double,
  width     : double,
  depth     : double,
  pxwidth   : int,
  pxheight  : int,
  size      : int,
  imageData : string   // base64 encoding or ""
)



/* --------------------------------------
 Attributes 
---------------------------------------- */
public type formatter {
  FmtHtml
  FmtTex
}

public function (==)( x : formatter, y : formatter ) : bool {
  match(x) {
    FmtHtml -> y.isFmtHtml
    FmtTex  -> y.isFmtTex
  }
}

// See if a string matches the format. An empty string always matches.
public function matchFmt( fmt : formatter, fmtstr : string ) : bool {
  if (fmtstr=="") return True
  s = fmtstr.toLower
  match(fmt) {
    FmtHtml | s == "html" -> True
    FmtTex  | s == "tex"  -> True
    _ -> False
  }
}

public type input {
  Pre         // preformatted
  MathPre     // TeX math, preformatted
  Math        // TeX math
  MathDefs    // TeX math definitions
  Tex         // TeX code that should be parsed (i.e for the bibliography)
  Raw( only: maybe<formatter> = Nothing ) // Raw content for some backend (or all)
  Markdown( only: maybe<formatter> = Nothing )  // Markdown -- perhaps only for some backend
}

public function showInput( r : input ) {
  match(r) {
    Pre -> "pre"
    MathPre -> "mathpre"
    Math -> "math"
    MathDefs -> "mathdefs"
    Tex-> "tex"
    Raw(monly) -> "raw(" + (monly.maybe("",showFormatter)) + ")"
    Markdown -> "markdown"
  }
}

public function showFormatter( f : formatter ) {
  match(f) {
    FmtTex -> "FmtTex"
    FmtHtml -> "FmtHtml"
  }
}

public function show( attrs : attrs ) : string {
  "{" + attrs.text.substr(0,40) + "... }"
}

// Attributes
public struct attrs  ( 
  empty   : bool = False,
  sticky  : bool = False,
  defaults: bool = True,
  text    : string = "",            // original attribute text

  replacers : list<string> = [],    // replacers
  notag   : bool = False,           // suppress output of tag
  tight   : bool = False,           // suppress first paragraph  
  input   : input = Markdown(),       // how to input the content
 
  elem    : string = "",            // element name
  texelem : string = "",            // element name used for TeX command or environment
  htmlelem : string = "",           // element name used for HTML tag
  name    : string = "",            // id, without "#" prefix
  label   : string = "",            // label: "1.2"
  source  : string = "",            // the original source (only set for certain elements)
  classes : list<string> = [],            // class, without "." prefix
  counters: list<(string,string)> = [],   // counters, without "@" prefix
  keyvals : list<(string,string)> = []    // key=value pairs 
)

public function addClasses( attrs : attrs, classes : list<string> ) : attrs {
  classes.foldl(attrs,fun(acc,c) { acc.addClass(c) })
}

public function addClass( attrs: attrs, cname : string ) : attrs {
  if (cname=="") then return attrs
  if (attrs.classes.find( fun(nm) { cname == nm }).bool)
   then attrs
   else attrs(classes=attrs.classes + [cname], text=attrs.text+" class='" + cname + "'", empty=False)
}

public function addInputClass( attrs : attrs ) : attrs {
  if (attrs.input.isMarkdown) then attrs else attrs.addClass("input-" + attrs.input.showInput)
}

public function addKeyvalIfNotEmpty( attrs : attrs, key : string, value : string ) : attrs {
  if (value==""||key=="") then attrs else attrs.addKeyval(key,value)
}

public function addKeyvalIfNotExist( attrs : attrs, key : string, value : string ) : attrs {
  if (attrs.hasKey(key).bool) then attrs else attrs.addKeyval(key,value)
}

public function addKeyvals( attrs : attrs, kvs : list<(string,string)> ) : attrs {
  kvs.foldl(attrs,fun(acc,kv) { acc.addKeyval(kv.fst,kv.snd) })
}

public function addKeyval( attrs : attrs, key : string, value : string ) : attrs {
  attrs(keyvals=attrs.keyvals.filter(fun(kv){ kv.fst != key }) + [(key,value)], 
        text=attrs.text+" "+key+"="+value.quote, empty=False)
}

function quote( s : string ) : string {
  if (s.contains("\"")) then "'" + s + "'" else "\"" + s + "\""
}

public function lookupKey( attrs : attrs, key : string, def : string ) : string {
  attrs.hasKey(key).maybe(def,id)
}

public function hasKey( attrs : attrs, key : string ) : maybe<string> {
  attrs.keyvals.find( fun(kv) { kv.fst == key }).maybe(Nothing,fun(kv){ Just(kv.snd) })
}

public function hasClass( attrs : attrs, className : string ) : bool {
  attrs.classes.find( fun(cname) { cname==className }).bool
} 


// Generate a fresh id if it is not specified
public function generateHeaderId( attrs : attrs, heading : string ) : attrs {
  if (attrs.name!="") then attrs else {
    newid = heading.normalizeId
    newname = if (newid=="") then "section" else newid
    attrs(text=attrs.text + " id='" + newname + "'", name = newname, empty=False)
  }
}

 
// Normalize an identifier: just keep letters, digits, underscores, colons, stars, and dashes,
// replace whitespace, colons, and stars by a dash, and convert to lower case. 
public function normalizeId( txt : string ) : string {
  txt.replaceAll(regex(@"[^\w\-_:\*\s]+"),"")
     .replaceAll(regex(@"\s+|[:\*]"),"-")
     .toLower
}

public function elementName( attrs : attrs, def : string ) : string {
  if (attrs.elem=="") then def else attrs.elem
}

public val attrsNone = Attrs(empty=True)


// Split semi-colon seperated paths into parts
public function splitPaths( paths : string ) : list<string> {
  paths.split(";").list.filter(fun(s){ s != ""})
}

// Join lines that were broken using `\` followed by a newline.
public function joinLines( s : string ) : string {
  s.replaceAll(rxLineBreak,"")
}
val rxLineBreak = regex(@"\\\n\r?[ \t]*")

