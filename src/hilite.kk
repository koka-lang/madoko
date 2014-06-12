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
  js monarch "./monarch"
}

// hilite mode. abstract.
public type hilitemode;

// struct
struct hilite( highlighted : string, finalMode : hilitemode )

// Highlight using highlight.js. Use 'auto' for automatic language detection
external xhilite( src : string, lang : string, mode : hilitemode ) : hilite {
  js inline "(function(){ var res = monarch.highlightTextFragment(#3,#1); return Hilite(res.html,res.next); })()"
} 

external xinitialMode( lang : string) : hilitemode {
  js inline "(function(){ var res = monarch.getInitialMode(#1); if (!res) throw new Error('unknown language: ' + #1); return res; })()"
}


// Syntax highlight code. 
// If "lang" is the empty string, returns Nothing. 
public function hilite( src : string, lang : string ) : maybe<string> 
{
  if (lang=="") return Nothing
  catch( { Just(xhilite(src,lang.toLower,xinitialMode(lang.toLower)).highlighted)  }, fun(exn) { 
           warning("could not highlight: " + exn.show)
           Nothing
         })
}


// Syntax highlight code. 
// If "lang" is the empty string, returns Nothing. 
// Use `auto` for automatic language detection.
public function hilitePartial( src : string, lang : string, mbMode : maybe<hilitemode> = Nothing) : maybe<(string,hilitemode)>
{
  if (lang=="") return Nothing
  catch( { 
    val mode = match(mbMode) {
      Nothing -> xinitialMode(lang.toLower)
      Just(m) -> m
    }
    val res = xhilite(src,lang.toLower,mode)
    Just( (res.highlighted,res.finalMode) )
   }, 
   fun(exn) { 
     warning("could not highlight: " + exn.show)
     Nothing
   })
}

external xxregisterLanguage( name : string, definition : string ) : io () {
  js inline "monarch.register(#2,#1)"
}

public function registerLanguage( name : string, definition: string ) : io () {
  catch( { //trace("register: " + name + ": " + fname); 
           xxregisterLanguage(name.toLower,definition) }, 
         fun(exn) { println("error: could not register language: " + name  + "\n" + exn.show /* + "\n" + fulldef */ ) } )
}

external xcanHilite( name : string ) : bool {
  js inline "(monarch.getLanguage(#1) != null)"
}

public function canHilite( name : string ) : bool {
  xcanHilite( name.toLower )
}