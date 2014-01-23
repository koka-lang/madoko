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


public function parseAttrs( attrStr : string, elemName : string = "", source : string = "" ) : attrs {
  if (attrStr == "" && elemName == "" && source=="") return attrsNone
  attrs0 = Attrs() // source=source,classes=if (className=="") then [] else [className])
  attrs0.extendAttrs( (if (elemName!="") then "elem='" + elemName + "' " else "") + attrStr, source )
}

public function mergeDefault( attrs : attrs, def : attrs ) : attrs {
  def.extendAttrs(attrs.text, attrs.source)
}


public function matchRules( defaults : dict<string>, elementName : string, attrs : attrs ) : attrs 
{
  def = (attrs.classes.map( fun(cname) { defaults["." + cname] } ) +
         [defaults["#" + attrs.name], defaults["~" + elementName]]).filter(isJust).map(string).join(" ")
  if (def=="") then attrs else {
    //trace("matched " + elementName + ": {" + attrs.text + "} : {" + def + "}" ) 
    attrs.mergeDefault(def.parseAttrs)
  }
}


public function extendAttrs( attrs0 : attrs, attrsStr : string, source : string ) : attrs 
{
  if (attrsStr=="" && source=="") then return attrs0
  attrsx = attrs0(empty=False, sticky=False, source=source, 
                    text=attrs0.text + " " + attrsStr,
                    classes=[])

  kvs = attrsStr.joinLines.parseAttributes  // join lines here.
  
  attrs = kvs.foldl(attrsx) fun(acc:attrs,kv:(string,string,string)) {
    val (name,kwvalue,value) = kv
    start = name.substr(0,1)
    if (kwvalue=="clear") {
      if (start==".") {
        cname = name.substr(1)
        acc(classes = acc.classes.filter(fun(c) { c != cname }))
      }
      elif (start=="@") {
        cname = name.substr(1)
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
    elif (name=="-") {
      Attrs(text=attrsx.text,defaults=False)
    }
    elif (start=="#") {
      //trace("attrs name: " + name + ": " + value.show)
      acc(name = name.substr(1).definitionId, label = if (value!="") then value else acc.label)
    }  
    elif (start==".") {
      acc(classes = acc.classes + [name.substr(1)])
    }
    elif (start=="@") {
      acc(counters = Cons((name.substr(1), value), acc.counters))
    }
    elif (name=="elem") {
      acc(elem = value, classes = [value] + acc.classes )
    }
    elif (name=="tex-elem") {
      acc(texelem = value )
    }
    elif (name=="html-elem") {
      acc(htmlelem = value )
    }
    elif (name=="id") {
      //trace("id: " + value)
      acc(name = value )
    }
    elif (name=="class") {
      acc( classes = acc.classes + [value] )
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
    elif (name=="replace") {
      acc(replacers = acc.replacers + [value])
    }    
    elif (name=="before") {
      acc(replacers = acc.replacers + [value + @"\/#source"])
    }
    elif (name=="after") {
      acc(replacers = acc.replacers + [@"\/#source" + value])
    }
    elif (name=="input") {
      v = kwvalue
      r = if (v=="pre") then Pre
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
      acc(keyvals = acc.keyvals.filter(fun(kval) { kval.fst != name}) + [(name,value)])
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
      value = cap.groups.firstMatched(2)
      kwvalue = if (cap.groups.matchedOn(4)) then cap.groups[4] else ""
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

public function transformText( attrs : attrs, txt : string, metadata : dict<string> ) : string 
{  
  if (attrs.empty) then return txt
  attrs.replacers.foldl(txt,fun(cur,repl) {
    res = repl.applyReplacer(cur,attrs,metadata) 
    //trace("replacer '" + erepl.substr(0,10) + "': " + cur + " -> " + res)
    res
  })
}

function applyReplacer( repl : string, txt : string, attrs : attrs, metadata : dict<string> ) : string 
{
  function expand( s : string ) { 
    s.expandKeys(txt,attrs,metadata,fun(_,_) {""}) 
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
val rxescapedc = @"(?:[^\\\s?]|\\.|\s+(?!$|[\s?]))"

function evalCondition( cond : string ) : bool {
  match(cond.find(rxcompare)) {
    Nothing -> {
      //trace("condition: " + cond.show )
      cond!=""
    }
    Just(cap) -> {
      s = cap.groups[1]
      t = cap.groups[3]
      op = cap.groups[2]
      //trace("condition: " + s.show + " " + op + " " + t.show )
      
      i = s.parseInt.maybe(-1,id)
      j = t.parseInt.maybe(-1,id)
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
        elif (op=="!=") then (s!=t)
        else False
      }
    }
  }
}
val rxcompare = regex(@"^(" + rxesc + @"*)\s*(" + rxop + @")\s*(" + rxesc + @"*)$")

val rxesc = @"(?:(?!" + rxop + @")[^\\]|\\.)"
val rxop  = @"(?:==|!=|>=|<=|<|>)"

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

  rexp = regex( entries.map(fun(e){"(" + e.fst.ungroup + ")"}).join("|"), ignoreCase=flags.contains("i"), multiline=flags.contains("m"))
  convCase = flags.contains("c")

  function replaceGroups( cap : matched ) {
    i = cap.groups.firstMatchedOn(1,entries.length)
    if (i<=0) return ""
    match(entries.drop(i-1)) {
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
                j = gcap.groups[1].parseInt.maybe(0,id)
                // escape \(\|[/ulULE]) to \\(\\|[/uLULE])
                rcap.groups[j].replaceAll(if (convCase) then rxCaseEsc else rxRegEsc,@"\\$2$1")  
              }
              else {
                gcap.matched
              }
            })
          }
        }
      }
    }
  }
  
  gtxt = if (flags.contains("g")) 
          then txt.replaceAll(rexp,replaceGroups) 
          else txt.replace(rexp,replaceGroups)
  if (convCase)
   then gtxt.caseConvert
   else gtxt.replaceAll(rxRegEsc,"$1")
}

// "?#caption?/././"
// val rxcond  = regex(@"^/[?](" + rxescaped + @"+)/(" + rxescaped + @"*)/([gim]*)$")

function regexReplacer( rxText : string, rtxt : string, flags : string, txt : string ) 
{
  rexp = regex(rxText, ignoreCase=flags.contains("i"), multiline=flags.contains("m"))
  convCase = flags.contains("c")

  function replaceGroups( cap : matched ) {
    rtxt.replaceAll( rxCaptureGroup, fun(gcap) {
      if (gcap.groups.matchedOn(1)) {
        i = gcap.groups[1].parseInt.maybe(0,id)
        // escape \(\|[/ulULE]) to \\(\\|[/uLULE])
        cap.groups[i].replaceAll(if (convCase) then rxCaseEsc else rxRegEsc,@"\\$2$1")  
      }
      else {
        gcap.matched
      }
    })
  }  
  gtxt = if (flags.contains("g")) 
          then txt.replaceAll(rexp,replaceGroups) 
          else txt.replace(rexp,replaceGroups)
  //trace("replace (" + rxText.substr(0,20) + "): '" + txt + "' to '" + gtxt + "'")    
  if (convCase)
   then gtxt.caseConvert
   else gtxt.replaceAll(rxRegEsc,"$1")
}

val rxCaptureGroup = regex(@"\\(?:(\d)|\\)")
val rxCaseEsc = regex(@"\\((\\)|[/ulULE])")
val rxRegEsc  = regex(@"\\((\\)|[/])")

function caseConvert( txt : string ) : string {
  txt.replaceAll(regex(@"\\([\\/E])|\\([ul])(.)|\\([UL])([\s\S]*?)(\\E|$)"), fun(cap) {
    if (cap.groups.matchedOn(1)) {
      cap.groups[1]
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

// expand keys in a string
public function expandKeys( txt : string, source : string, attrs : attrs, metadata : dict<string>, notFound : (string,string) -> string = keyNotFound ) : string {  
  if (txt=="") then return txt
  txt.replaceAll(rxkey) fun(cap) {
    key = cap.groups[1]
    if (key=="") then cap.matched  // no key was matched
    elif (key=="label") then attrs.label
    elif (key=="id" && attrs.name != "") then attrs.name 
    elif (key=="nl") then "\n" 
    elif (key=="class") then attrs.classes.join(" ") 
    elif (key=="source") then source // attrs.source 
    else match (attrs.keyvals.find(fun(kv){ kv.fst == key })) {
      Just(kv) -> {
        kv.snd
      }
      Nothing -> match(metadata[key]) {
        Just(value) -> {
          var cval := value
          forWhile(1,1000) fun(i) {  // expand to at most N levels of metadata...
            cres = cval.replaceAll(rxkey) fun(ccap) {
              if (ccap.groups[1]=="") then ccap.matched
              else match(metadata[ccap.groups[1]]) {
                Just(nval) -> nval
                Nothing    -> {
                  notFound(ccap.groups[1],ccap.matched)
                }
              }
            }                 
            if (cres != cval) then { cval := cres; Nothing } else Just(cres)       
          }
          cval
        }
        Nothing -> {
          notFound(key,cap.matched)
        }
      }
    }
  }
}
val rxkey = regex(@"&#[xX]?\d+;|(?:\\/)?#([a-zA-Z][\w\-:]*)(?:;|\\/)?") 

function keyNotFound( key: string, matched : string ) : string {
  warning( "undefined key: " + key)
  matched
}

external smemo( f : (string) -> e a ) : (string -> e a) {
  js inline "((function(){ var dict={}; return (function(s) { if (dict[s]===undefined) dict[s] = (#1)(s); return dict[s]; }); })())"
}

