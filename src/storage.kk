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
import std/regex

external include {
  js file "storage-inline.js"
}

val sandboxed : ref<global,maybe<list<string>>> = unsafeTotal { ref(Nothing) }

public function enforceSandbox( roots : list<string> = [""] ) : io () {
  sandboxed := Just(roots)
}

public function checkSandbox( path : string ) : io () {
  match (!sandboxed) {
    Nothing -> ()
    Just(roots) -> {
      if (!(path.under(roots))) {
        error("cannot access files outside the sandbox")
      }
    }
  }
}

function under( path : string, roots : list<string> ) : bool {  
  roots.any fun(root) {
    (path.startsWith(root) && path.substr(root.length).contains(rxRootRelative))
  }
}

val rxRootRelative = regex( @"^(?![\/\\])(\.(?=[\/\\]))?([\w\-]|[\.\/\\]\w)+$" )


// Try to read a text file; return a default value in case of an error.
public function readTextFileDef( fileName : string, def : string, required : bool = False ) : io string {
  match (fileName.tryReadTextFile(required)) {
    Left(_exn) -> def
    Right(content) -> content
  }
}

// Try to a text file synchronously (using UTF8 encoding)
public function tryReadTextFile( fileName : string, required : bool = True ) : io either<exception,string> 
{
  catch( { Right(readTextFileSync(fileName,required)) }, fun(exn) { Left(exn) }) 
}


// Search for a file along a list of directories.
public function searchFileSync( dirs : list<string>, fname : string ) : io maybe<string> {
  val fnames = Cons("",dirs).map(fun(dir){ combine(dir,fname) })
  fnames.foreachUntil fun(f) {
    if (f.fexistsSync) then Just(f) else Nothing
  }
}

// Read a text file synchronously (using UTF8 encoding)
public function readTextFileSync( fileName : string, required : bool = True ) : io string
{
  checkSandbox(fileName)
  if (required) log("files",fileName);
  xreadTextFileSync(fileName);
}

external xreadTextFileSync( fileName : string ) : io string
{
  cs inline "System.IO.File.ReadAllText(#1,System.Text.Encoding.UTF8)"
  js inline "$readFileSync(#1,'utf-8')"
}

// Try to write a text file synchronously (using UTF8 encoding). 
// Returns "True" if successful.
public function tryWriteTextFile( fileName : string, content : string )  : io bool 
{
  catch( { writeTextFileSync(fileName,content); True }, fun(_exn) { False } )
}

// Write a text file synchronously (using UTF8 encoding)
public function writeTextFileSync( fileName : string, content : string ) : io () {
  checkSandbox(fileName)
  log("filesWrite", fileName);
  xwriteTextFileSync(fileName, content);
}

external xwriteTextFileSync( fileName : string, content : string )  : io () {
  cs inline "System.IO.File.WriteAllText(#1,#2,System.Text.Encoding.UTF8)"
  js inline "$writeFileSync(#1,'utf-8',#2)"
}

public function fexistsSync( fileName : string ) : io bool {
  catch( {
    checkSandbox(fileName)
    xfexistsSync(fileName)
  }, fun(_) { False } )
}

external xfexistsSync( fileName : string ) : io bool {
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

public function mkdirp( dir : string, mode : int = 0x1FF ) : io () {
  checkSandbox(dir)
  xmkdirp(dir,mode)
}

external xmkdirp( dir : string, mode : int = 0x1FF ) : io () {
  cs inline "System.IO.Directory.CreateDirectory(#1)"
  js inline "$mkdirp(#1,#2)"
}

public function rename( fnameOld : string, fnameNew : string ) : io () {
  checkSandbox(fnameOld)
  checkSandbox(fnameNew)
  xrename(fnameOld,fnameNew)
}

external xrename( fnameOld : string, fnameNew : string ) : io () {
  cs inline "System.IO.File.Move(#1,#2)"
  js inline "$renameSync(#1,#2)"
}

public function tryRename( fnameOld : string, fnameNew : string ) : io () {
  ignore( { rename(fnameOld,fnameNew) });
}

// In the browser, removes all files.
public external clear() : io () {
  cs inline "0"
  js inline "$clear()"
}


// Try to read a binary file in base64; return a default value in case of an error.
public function readBase64FileDef( fileName : string, def : string, required : bool = False ) : io string {
  match (fileName.tryReadBase64File(required)) {
    Left(_exn) -> def
    Right(content) -> content
  }
}

// Try to a binary file synchronously (using base64 encoding)
public function tryReadBase64File( fileName : string, required : bool = True ) : io either<exception,string> 
{
  catch( { Right(readBase64FileSync(fileName,required)) }, fun(exn) { Left(exn) }) 
}

// Read a binary file synchronously (using base64 encoding)
public function readBase64FileSync( fileName : string, required : bool = True ) : io string
{
  checkSandbox(fileName)
  if (required) log("files",fileName)
  xreadBase64FileSync(fileName)
}

external xreadBase64FileSync( fileName : string ) : io string
{
  cs inline "Convert.ToBase64String(System.IO.File.ReadAllBytes(#1))"
  js inline "$readFileSync(#1,'base64')"
}

// Try to write a binary file synchronously (using base64 encoding). 
// Returns "True" if successful.
public function tryWriteBase64File( fileName : string, content : string )  : io bool 
{
  catch( { writeBase64FileSync(fileName,content); True }, fun(_exn) { False } )
}

// Write a binary file synchronously (using base64 encoding)
public function writeBase64FileSync( fileName : string, content : string ) : io () {
  checkSandbox(fileName)
  log("filesWrite", fileName);
  xwriteBase64FileSync(fileName, content);
}

external xwriteBase64FileSync( fileName : string, content : string ) : io ()
{
  cs inline "System.IO.File.WriteAllBytes(#1,Convert.FromBase64String(#2))"
  js inline "$writeFileSync(#1,'base64',#2)"
}

// Delete a file
public function unlinkSync( fileName : string ) : io () {
  checkSandbox(fileName)
  xunlinkSync( fileName )
}

external xunlinkSync( fileName : string ) : io ()
{
  cs inline "System.IO.File.Delete(#1)"
  js inline "$unlinkSync(#1)"
}
