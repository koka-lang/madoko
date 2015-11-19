/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/
module process 

import std/path

external include {
  cs file "process-inline.cs"
  js file "process-inline.js"
}

external import {
  js "child_process"
}

public external system( cmd : string, callback : (int,string,string) -> <io|e> (), timeout : int = 0, cwd : string = "") : <io|e> () {
  cs inline "ShellCommand.system(#1,#2,#3,#4)"
  js inline "child_process.exec(#1,{timeout:#3,cwd:(#4!=''?#4:null),windowsVerbatimArguments:true},function(err,stdout,stderr) { (#2)(err?err.code:0,stdout,stderr); });"
}

