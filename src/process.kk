/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/
module process 

import std/path
import std/dict

external include {
  cs file "process-inline.cs"
  js file "process-inline.js"
}

external import {
  js "child_process"
}

// quote file and command names for shell execution
public function quote( s : string ) : string {
  "\"" + s + "\""
}

public function system( cmd : string, callback : (int,string,string) -> <io|e> (), timeout : int = 0, cwd : string = "", env : list<(string,string)> = []) : <io|e> () {
  systemx(cmd,callback,timeout,cwd,if (env.isNil) then Nothing else Just(dict(env)))
}

external systemx( cmd : string, callback : (int,string,string) -> <io|e> (), timeout : int = 0, cwd : string = "", env : maybe<dict<string>> = Nothing ) : <io|e> () {
  cs inline "ShellCommand.system(#1,#2,#3,#4)" // TODO: environment
  js inline "child_process.exec(#1,{timeout:#3,cwd:(#4!=''?#4:undefined),env:(#5?(#5).unJust:undefined),windowsVerbatimArguments:true},function(err,stdout,stderr) { (#2)(err?err.code:0,stdout,stderr); });"
}

