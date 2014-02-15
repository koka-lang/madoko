/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Syntax highlighting
module hilite

import std/regex
import std/path
import common

external import {
  js hljs "highlight.js"
}

// hilite mode. abstract.
public type hilitemode;

// struct
struct hilite( highlighted : string, finalMode : hilitemode )

// Highlight using highlight.js. Use 'auto' for automatic language detection
external xhilite( src : string, lang : string, mode : hilitemode ) : hilite {
  js inline "(function(){ var res = (#2!='auto'? hljs.highlight(#2,#1,true,#3) : hljs.highlightAuto(#1)); return Hilite(res.value,res.top) })()"
} 

external xinitialMode() : hilitemode {
  js inline "null"
}

val initialMode = xinitialMode()

// Syntax highlight code. 
// If "lang" is the empty string, returns Nothing. 
// Use `auto` for automatic language detection.
public function hilite( src : string, lang : string = "auto") : maybe<string> 
{
  if (lang=="") return Nothing
  catch( { Just(xhilite(src,lang.toLower,initialMode).highlighted)  }, fun(exn) { 
           warning("could not highlight: " + exn.show)
           Nothing
         })
}

// Syntax highlight code. 
// If "lang" is the empty string, returns Nothing. 
// Use `auto` for automatic language detection.
public function hilitePartial( src : string, lang : string, mode : maybe<hilitemode> = Nothing) : maybe<(string,hilitemode)>
{
  if (lang=="") return Nothing
  catch( { 
    res = xhilite(src,lang.toLower,mode.maybe(initialMode,id))
    Just( (res.highlighted,res.finalMode) )
   }, 
   fun(exn) { 
     warning("could not highlight: " + exn.show)
     Nothing
   })
}

external xregisterLanguage( name : string, fname : string ) : io () {
  js inline "hljs.registerLanguage(#1,require(#2))"
}

public function registerLanguage( fname : string ) : io () {
  if (fname=="") return ()
  name = fname.basename.noext.toLower
  catch( { //trace("register: " + name + ": " + fname); 
           xregisterLanguage(name,fname) }, 
         fun(exn) { println("error: could not register language: " + fname  + "\n" + exn.show ) } )
}