/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Provide client/server storage
// This module provides file access operations. On the web client, these
// operations only provide accesss to a global object of files which is
// *not* persistent. This code is mainly to ensure we can share as much
// code as possible between client and server.
module storage

import std/path
import std/log

external include {
  js file "storage-inline.js"
}

// Try to read a text file; return a default value in case of an error.
public function readTextFileDef( fileName : string, def : string ) : io string {
  match (fileName.tryReadTextFile()) {
    Left(_exn) -> def
    Right(content) -> content
  }
}

// Try to a text file synchronously (using UTF8 encoding)
public function tryReadTextFile( fileName : string ) : io either<exception,string> 
{
  catch( { Right(readTextFileSync(fileName)) }, fun(exn) { Left(exn) }) 
}


// Search for a file along a list of directories.
public function searchFileSync( dirs : list<string>, fname : string ) : io maybe<string> {
  fnames = Cons("",dirs).map(fun(dir){ combine(dir,fname) })
  fnames.foreachUntil fun(f) {
    if (f.fexistsSync) then Just(f) else Nothing
  }
}

// Read a text file synchronously (using UTF8 encoding)
public function readTextFileSync( fileName : string ) : io string
{
  log("files",fileName);
  xreadTextFileSync(fileName);
}

external xreadTextFileSync( fileName : string ) : io string
{
  cs inline "System.IO.File.ReadAllText(#1,System.Text.Encoding.UTF8)"
  js inline "$readFileSync(#1)"
}

// Try to write a text file synchronously (using UTF8 encoding). 
// Returns "True" if successful.
public function tryWriteTextFile( fileName : string, content : string )  : io bool 
{
  catch( { writeTextFileSync(fileName,content); True }, fun(_exn) { False } )
}

// Write a text file synchronously (using UTF8 encoding)
public external writeTextFileSync( fileName : string, content : string )  : io () {
  cs inline "System.IO.File.WriteAllText(#1,#2,System.Text.Encoding.UTF8)"
  js inline "$writeFileSync(#1,#2)"
}


public external fexistsSync( fileName : string ) : io bool {
  cs inline "System.IO.File.Exists(#1)"
  js inline "$fexistsSync(#1)"
}

public external relative( from : string, to : string ) : string {
  cs inline @"Uri.UnescapeDataString(new Uri(#1 + ""\\"", false).MakeRelative(new Uri(#2)));"
  js inline "$relative(#1,#2)"
}

public external cwd() : io string {
  cs inline "System.IO.Directory.GetCurrentDirectory()"
  js inline "$cwd()"
}

public external mkdirp( dir : string, mode : int = 0x1FF ) : io () {
  cs inline "System.IO.Directory.CreateDirectory(#1)"
  js inline "$mkdirp(#1,#2)"
}

public external rename( fnameOld : string, fnameNew : string ) : io () {
  cs inline "System.IO.File.Move(#1,#2)"
  js inline "$renameSync(#1,#2)"
}

public function tryRename( fnameOld : string, fnameNew : string ) : io () {
  ignore( { rename(fnameOld,fnameNew) })
}
