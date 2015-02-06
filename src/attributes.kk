/*---------------------------------------------------------------------------
  Copyright 2013 Daan Leijen, Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Attibute operations: parsing, transform text, expand keys, etc.
module attributes

import std/regex
import std/dict
import std/string
import common
import entity

public function parseAttrs( attrStr : string, elemName : string = "", source : string = "" ) : attrs {
  if (attrStr == "" && elemName == "" && source=="") return attrsNone
  val attrs0 = Attrs() // source=source,classes=if (className=="") then [] else [className])
  attrs0.extendAttrs( (if (elemName!="") then "elem='" + elemName + "' " else "") + attrStr, source )
}

public function mergeDefault( attrs : attrs, def : attrs ) : attrs {
  def.extendAttrs(attrs.text, attrs.source)
}


public function matchRules( defaults : dict<string>, elementName : string, attrs : attrs ) : attrs 
{
  if (!(attrs.common/defaults)) return attrs;
  val extra = ["#" + attrs.name.definitionId, "~" + elementName.definitionId]
  applyRules(peano10, defaults, attrs, defaults.getMatches(attrs,dict(),extra) );
}

function applyRules(p : peano, defaults : dict<string>, attrs : attrs, dv : (string,dict<bool>) ) : attrs {
  match(p) {
    Zero -> attrs
    Succ(s) -> {
      val (def,visited) = dv
      if (def=="") return attrs
      val attrs2 = attrs.mergeDefault(def.parseAttrs)      
      applyRules( s, defaults, attrs2, defaults.getMatches(attrs2,visited) )
    }
  }
}

function getMatches( defaults: dict<string>, attrs : attrs, visited : dict<bool> = dict(), extra : list<string> = [] ) : (string, dict<bool>) {
  val keys0 = extra + attrs.classes.map( fun(cname) { "." + cname.definitionId } ) 
  val keys1 = keys0.filter( fun(key) { visited[key].isNothing } )
  val visited1 = visited + keys1.map( fun(key) { (key,True) } ).dict
  val def = keys1.map( fun(key) { defaults[key] }).filter(isJust).map(mbstring).join(" ")
  return (def,visited1)
}


public function extendAttrs( attrs0 : attrs, attrsStr : string, source : string ) : attrs 
{
  if (attrsStr=="" && source=="") then return attrs0
  val attrsx = attrs0(empty=False, sticky=False, source=source, 
                      text=attrs0.text + " " + attrsStr,
                      classes=[])

  val kvs = attrsStr.joinLines.parseAttributes  // join lines here.
  
  val attrs = kvs.foldl(attrsx) fun(acc:attrs,kv:(string,string,string)) {
    val (name,kwvalue,value) = kv
    val start = name.substr(0,1)
    if (kwvalue=="clear") {
      if (start==".") {
        val cname = name.substr(1)
        acc(classes = acc.classes.filter(fun(c) { c != cname }))
      }
      elif (start=="@") {
        val cname = name.substr(1)
        acc(counters = acc.counters.filter(fun(c) { c.fst != cname }))
      }
      elif (name=="class") {
        acc(classes = [])
      }
      elif (name=="replace" || name=="before" || name=="after") {
        acc(replacers = [])
      }
      else {
        acc(keyvals = acc.keyvals.filter( fun(k) { k.fst != name }))  
      }
    }
    elif (name=="clear") {
      Attrs(text=attrsx.text,defaults=False)
    }
    elif (name=="-" || name=="clearnum") {
      acc( counters=[], label="", replacers=[] )
    }
    elif (start=="#") {
      //trace("attrs name: " + name + ": " + value.show)
      acc(name = name.substr(1).definitionId, label = if (value!="") then value else acc.label)
    }  
    elif (start==".") {
      val cname = name.substr(1)
      if (acc.classes.any( fun(nm) { nm == cname } )) 
       then acc else acc(classes = acc.classes + [cname])
    }
    elif (start=="@") {
      acc(counters = acc.counters + [(name.substr(1), value)] )
    }
    elif (name=="elem") {
      val ename = value.definitionId
      acc(elem = ename, classes = [ename] + acc.classes.filter(fun(nm) { nm != ename }) )
    }
    elif (name=="tex-elem") {
      acc(texelem = value )
    }
    elif (name=="html-elem") {
      acc(htmlelem = value )
    }
    elif (name=="id") {
      //trace("id: " + value)
      acc(name = value.definitionId )
    }
    elif (name=="class") {
      val cname = value.definitionId
      if (acc.classes.any( fun(nm) { nm == cname } )) 
       then acc else acc( classes = acc.classes + [cname] )
    }
    elif (name=="label") {
      acc(label = value)
    }
    elif (name=="sticky") {
      acc(sticky=value.toBool)
    }
    elif (name=="notag") {
      acc(notag=value.toBool)
    }
    elif (name=="line") {
      match(value.parseInt()) {
        Nothing -> {
          warning("unrecognized line number: line=" + value )
          acc
        }
        Just(n) -> acc(lineNo=n)
      }
    }
    elif (name=="replace") {
      acc(replacers = acc.replacers + [value])
    }    
    elif (name=="before") {
      acc(replacers = acc.replacers + [value + @"\/&source;"])
    }
    elif (name=="after") {
      acc(replacers = acc.replacers + [@"\/&source;" + value])
    }
    elif (name=="input") {
      val v = kwvalue
      val r = if (v=="pre") then Pre
              elif (v=="raw") then Raw(Nothing)
              elif (v=="texraw") then Raw(Just(FmtTex))
              elif (v=="htmlraw") then Raw(Just(FmtHtml))
              elif (v=="tex") then Tex
              elif (v=="math") then Math
              elif (v=="mathpre") then MathPre
              elif (v=="mathdefs") then MathDefs
              elif (v=="normal") then Markdown()
              elif (v=="markdown") then Markdown()
              elif (v=="htmlonly") then Markdown(Just(FmtHtml))
              elif (v=="texonly") then Markdown(Just(FmtTex))
              else {
                warning( "unrecognized input value: " + value)
                Markdown()
              }         
      acc(input=r)
    }
    elif (name=="tight") {
      acc(tight=value.toBool)
    }
    else {
      //trace("key " + name + "=" + value)
      val cntrs = if (name=="start") then match (value.trim.parseInt) {
                    Just(i) -> acc.counters + [(acc.elem + "-li",(i-1).show)] 
                    Nothing -> acc.counters
                  }
                  elif (name=="list-style-type" && acc.elem.bool) then {
                    //trace("list-style-type: @" + acc.elem + "-li=" + value.trim )
                    acc.counters + [(acc.elem + "-li",value.trim)] 
                  }
                  else acc.counters
      acc(keyvals = acc.keyvals.filter(fun(kval) { kval.fst != name}) + [(name,value)], counters = cntrs)
    }
  }
  attrs.addClasses(attrs0.classes) // last, so the classes are order for 'elementName'
}

val rxAttr = regex(@"^\s*([\w\.#@\-:]+)\s*(?:=\s*(?:'((?:[^\n\\']|\\.)*)'|""((?:[^\n\\""]|\\.)*)""|((?:[^\\""'\s]|\\.)*)))?$")
val rxToken = regex(@"(?:\s*=\s*|'(?:[^\n\\']|\\.)*'|""(?:[^\n\\""]|\\.)*""|\\.|[^'""\\\s])")
val rxSep = regex(@"\s+")

// Parse an attribute string
val parseAttributes : (string) -> list<(string,string,string)> = smemo(parseAttributesX)

// Parse a single attribute
val parseAttribute : (string) -> list<(string,string,string)> = smemo(parseAttributeX)

function parseAttributesX( s : string ) : list<(string,string,string)> 
{
  s.splitAttributes.map(parseAttribute).concat
}

function parseAttributeX( s : string ) : list<(string,string,string)>
{
  match( s.find(rxAttr) ) {
    Nothing -> {
      warning( "invalid attribute: " + s )
      []
    }
    Just(cap) -> {
      val value = cap.groups.firstMatched(2)
      val kwvalue = if (cap.groups.matchedOn(4)) then cap.groups[4] else ""
      [(cap.groups[1].toLower, kwvalue, value)]
    }
  }
}

// Split attributes into a list of attribute definitions
public function splitAttributes( attrdef : string ) : list<string> {
  attrdef.splitExclude( rxSep, rxToken ).map(trim).filter( fun(s){ s != "" } )
}

function unescape( s : string ) : string {
  s
}

function toBool( s : string ) : bool {
  (s=="" || s=="true")
}

public function transformText( attrs : attrs, txt : string, labels : dict<label>, metadata : dict<string> ) : string 
{  
  if (attrs.empty) then return txt
  attrs.replacers.foldl(txt,fun(cur,repl) {
    val res = repl.applyReplacer(cur,attrs,labels,metadata) 
    //trace("replacer '" + erepl.substr(0,10) + "': " + cur + " -> " + res)
    res
  })
}

function applyReplacer( repl : string, txt : string, attrs : attrs, labels : dict<label>, metadata : dict<string> ) : string 
{
  function expand( s : string ) { 
    expandKeys(peanoN,s,txt,attrs,labels,metadata,fun(_,_) {""}) 
  }

  function checkReplace( rrepl : string ) {    
    match(rrepl.find(rxregex)) {
      Nothing -> match(rrepl.find(rxmapping)) {
        Nothing -> rrepl.expand
        Just(mcap) -> {
          regexMapping( mcap.groups[1].expand, mcap.groups[2], txt )
        }
      }
      Just(rcap) -> {
        regexReplacer( rcap.groups[1].expand, rcap.groups[2].expand, rcap.groups[3], txt )
      }
    }
  }

  function checkCond( crepl : string ) {
    match(crepl.find(rxcond)) { 
      Nothing -> {
        checkReplace(crepl)
      }
      Just(ccap) -> {
        if (evalCondition(ccap.groups[1].expand))
          then checkReplace(ccap.groups[2])
        elif (ccap.groups.matchedOn(3))
          then checkReplace(ccap.groups[3])
        else txt
      }
    }
  }

  checkCond(repl)
}

val rxmapping = regex(@"^//((?:[^\\]|\\.)*)//([gimc]*)$")


val rxregex = regex(@"^/(" + rxescaped + @"*)/(" + rxescaped + @"*)/([gimc]*)$")
val rxescaped = @"(?:[^\\/]|\\.)"

val rxcond  = regex(@"^\?if\s+(" + rxescapedc + @"+)\s*\?then\s+(" + rxescapedc + @"*)\s*(?:\?else\s+(" + rxescapedc + @"*)\s*)?$")
val rxescapedc = @"(?:[^\\\s?]|\\.|\?(?!then|else|fi|if)|\s+(?!$|[\s?]))"

function evalCondition( cond : string ) : bool {
  match(cond.find(rxcompare)) {
    Nothing -> {
      //trace("condition: " + cond.show )
      cond!=""
    }
    Just(cap) -> {
      val s = cap.groups[1].trim
      val t = cap.groups[3].trim
      val op = cap.groups[2]
      //trace("condition: " + s.show + " " + op + " " + t.show )
      
      val i = s.parseInt.maybe(~1,id)
      val j = t.parseInt.maybe(~1,id)
      if (i>0 && j>0) then {
        if (op=="==") then (i==j)
        elif (op=="!=") then (i!=j)
        elif (op==">") then (i>j)
        elif (op==">=") then (i>=j)
        elif (op=="<") then (i<j)
        elif (op=="<=") then (i<=j)
        else False
      }
      else {
        if (op=="==") then (s==t)
        elif (op=="&&") then (s!="" && t!="")        
        elif (op=="||") then (s!="" || t!="")
        elif (op=="!=") then (s!=t)
        else False
      }
    }
  }
}
val rxcompare = regex(@"^(" + rxesc + @"*)\s*(" + rxop + @")\s*(" + rxesc + @"*)$")

val rxesc = @"(?:(?!" + rxop + @")[^\\]|\\.)"
val rxop  = @"(?:==|!=|>=|<=|<|>|&&|\|\|)"

// remove all grouping from a regular expression
function ungroup( r : string ) : string {
  r.replaceAll(rxOpenParen, fun(cap) {
    if (cap.groups[1]!="") then "(?:" else cap.matched
    })
}
val rxOpenParen = regex(@"\\.|(\((?!\?))")

val rxEntry      = regex(@"^((?:[^\\/]|\\.)*)/(.*)$")
val rxBar        = regex(@"//")
val rxExcludeBar = regex(@"[^\\/]|\\.|/(?!/)")

// perform a mapping.
function regexMapping( mapping : string, flags : string, txt : string ) : string 
{
  val entries
    = mapping.splitExclude(rxBar,rxExcludeBar).map( fun(entry) {
        match(entry.find(rxEntry)) {
          Just(ecap) -> {
            (ecap.groups[1],ecap.groups[2])
          }
          Nothing -> {
            warning("illegal mapping: " + entry)  
            (entry,"")
          }
        }
      })

  val rexp = regex( entries.map(fun(e){"(" + e.fst.ungroup + ")"}).join("|"), ignoreCase=flags.contains("i"), multiline=flags.contains("m"))
  val convCase = flags.contains("c")

  function replaceGroups( cap : matched ) {
    val i = cap.groups.firstMatchedOn(1,entries.length)
    if (i<=0) return ""
    val subst = match(entries.drop(i-1)) {
      Nil -> cap.matched // should never happen
      Cons(entry) -> {
        val (rx,repl) = entry
        match(cap.matched.find(regex(rx))) // should always match from start to end... 
        {
          Nothing -> cap.matched // should never happen
          Just(rcap) -> {
            // assert: cap.matched == rcap.matched
            repl.replaceAll(rxCaptureGroup, fun(gcap) {
              if (gcap.groups.matchedOn(1)) {
                val j = gcap.groups[1].parseInt.maybe(0,id)
                if (convCase)
                 then rcap.groups[j].replaceAll(rxCaseEsc,@"\\$2$1") // escape replacement
                 else rcap.groups[j]  
              }
              else {
                gcap.matched
              }
            })
          }
        }
      }
    }
    if (convCase)
     then subst.caseConvert // unescape replacement
     else subst
  }
  
  val gtxt = if (flags.contains("g")) 
              then txt.replaceAll(rexp,replaceGroups) 
              else txt.replace(rexp,replaceGroups)
  gtxt
}

// "?#caption?/././"
// val rxcond  = regex(@"^/[?](" + rxescaped + @"+)/(" + rxescaped + @"*)/([gim]*)$")

function regexReplacer( rxText : string, rtxt : string, flags : string, txt : string ) 
{
  val rexp = regex(rxText, ignoreCase=flags.contains("i"), multiline=flags.contains("m"))
  val convCase = flags.contains("c")

  function replaceGroups( cap : matched ) {
    val repl = rtxt.replaceAll( rxCaptureGroup, fun(gcap) {
      if (gcap.groups[1] != "\\") {
        val i = gcap.groups[1].parseInt.maybe(0,id)
        if (convCase) 
         then cap.groups[i].replaceAll( rxCaseEsc, @"\\$2$1" ) // escape replacement
         else cap.groups[i]   
      }
      else {
        gcap.groups[1]
      }
    })
    if (convCase)
     then repl.caseConvert  // do case conversion (and unescape replacements)
     else repl
  }  
  val gtxt = if (flags.contains("g")) 
              then txt.replaceAll(rexp,replaceGroups) 
              else txt.replace(rexp,replaceGroups)
  //trace("replace (" + rxText.substr(0,20) + "): '" + txt + "' to '" + gtxt + "'")    
  gtxt
}

val rxCaptureGroup = regex(@"\\([\d\\])")
val rxCaseEsc = regex(@"\\((\\)|[/ulULE])")
//val rxRegEsc  = regex(@"\\((\\)|[/])")

function caseConvert( txt : string ) : string {
  txt.replaceAll(regex(@"\\([\\/E])|\\([ul])(.)|\\([UL])([\s\S]*?)(\\E|$)"), fun(cap) {
    if (cap.groups.matchedOn(1)) {
      cap.groups[1] // unescape
    }
    elif (cap.groups.matchedOn(2)) {
      if (cap.groups[2]=="u") then cap.groups[3].toUpper else cap.groups[3].toLower      
    }
    elif (cap.groups.matchedOn(4)) {
      if (cap.groups[4]=="U") then cap.groups[5].toUpper else cap.groups[5].toLower      
    }
    else cap.matched
  }) 
}


public function expand( attrs : attrs, metadata : dict<string>, labels : dict<label> = dict() ) : attrs {
  if (attrs.empty) return attrs 

  attrs( keyvals = attrs.keyvals.map fun(kv) {
    (kv.fst, kv.snd.expandKeys( attrs.source, attrs, labels, metadata ))
  })
}

public function expandKeys( txt : string, metadata : dict<string> ) : string {  
  expandKeys(peanoN,txt,"",attrsNone,dict(),metadata)
}

public function expandKeyName( name : string, labels : dict<label>, metadata : dict<string> ) : string {  
  expandKeys(peanoN,"&" + name + ";","",attrsNone,labels,metadata)
}

public function expandKeys( txt : string, source : string, 
                            attrs : attrs, 
                            labels : dict<label>, metadata : dict<string> ) : string {
  expandKeys(peanoN,txt,source,attrs,labels,metadata)
}

// expand keys in a string
private function expandKeys( p0 : peano, txt : string, source : string, 
                            attrs : attrs, 
                            labels : dict<label>, metadata : dict<string>, 
                            notFound : (string,string) -> string = keyNotFound ) : string 
{  
  if (txt=="") then return txt
  match(p0) {
    Zero -> txt
    Succ(p) -> {
      txt.replaceAll(rxkey) fun(cap) {
        val rawkey = cap.groups[1]
        val key = rawkey.normalizeId 
        if (rawkey=="") then cap.matched  // no key was matched
        elif (rawkey=="&") then "&"       // special in replacements
        elif (key=="label" && !(attrs.empty)) then attrs.label
        elif (key=="id" && !(attrs.empty)) then attrs.name 
        elif (key=="class" && !(attrs.empty)) then attrs.classes.join(" ") 
        elif (key=="source" && !(attrs.empty)) then source // attrs.source 
        else match (attrs.keyvals.find(fun(kv){ kv.fst == key })) {
          Just(kv) -> {
            if (txt == kv.snd) then kv.snd
             else expandKeys(p,kv.snd,source,attrs,dict(),metadata,notFound)                
          }
          Nothing  -> match(labels[key]) {
            Just(label) -> label.labelText // already expanded
            Nothing -> match(metadata[key]) {
              Just(value) -> {
                // semi-static scoping: clear out labels, but keep attributes
                expandKeys(p,value,source,attrs,dict(),metadata,notFound)
                // todo? full static scoping: clear out attributes and labels..
                //expandKeys(p,value,"",attrsNone,dict(),metadata,notFound)              
              }
              Nothing -> match(entityNameAsNum(rawkey)) {
                Just(value) -> value
                Nothing     -> notFound(key,cap.matched)
                //entityNameToNum(key)
              }
            }
          }
        }
      }      
    }
  }
}
val rxkey = regex(@"\\&|(?:\\/)?&([\w\-:]*|&);(\\/)?") 

function keyNotFound( key: string, matched : string ) : string {
  warning( "undefined key: " + key)
  matched
}

external smemo( f : (string) -> e a ) : (string -> e a) {
  js inline "((function(){ var dict={}; return (function(s) { if (dict[s]===undefined) dict[s] = (#1)(s); return dict[s]; }); })())"
}

