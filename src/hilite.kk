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

// Highlight using highlight.js
external xhilite( src : string, lang : string = "auto") : string {
  js inline "(#2!='auto'?hljs.highlight(#2,#1,true):hljs.highlightAuto(#1)).value"
} 

// Syntax highlight code. 
// If "lang" is the empty string, returns Nothing. 
// Use `auto` for automatic language detection.
public function hilite( src : string, lang : string = "auto") : maybe<string> 
{
  if (lang=="") return Nothing
  catch( { Just(xhilite(src,lang))  }, fun(exn) { 
           warning("could not highlight: " + exn.show)
           Nothing
         })
}


external xregisterLanguage( name : string, fname : string ) : io () {
  js inline "hljs.registerLanguage(#1,require(#2))"
}

public function registerLanguage( fname : string ) : io () {
  if (fname=="") return ()
  name = fname.basename.noext
  catch( { trace("register: " + name + ": " + fname); xregisterLanguage(name,fname) }, 
         fun(exn) { warning("could not register language: " + name ) } )
}