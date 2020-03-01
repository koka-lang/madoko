/*---------------------------------------------------------------------------
  Copyright 2013-2015 Microsoft Corporation.

  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

function system_exec(cmds, callback, timeout, cwd, env) {
   //js inline "child_process.exec(#1,{timeout:#3,cwd:(#4!=''?#4:undefined),env:(#5?(#5).unJust:undefined),windowsVerbatimArguments:true},function(err,stdout,stderr) { (#2)(err?err.code:0,stdout,stderr); });"
   // console.log("systemx exec: " + cmds);
   var options = {
     timeout: timeout,
     cwd: (cwd!=''?cwd:undefined),
     env: (env?(env).unJust:undefined),
     windowsVerbatimArguments: true,
   };
   var allout = "";
   var allerr = "";
   var lasterr = 0;
   var commands = cmds.split(";");
   var count = commands.length;
   var i;
   for(i = 0; i < count; i++) {
     var cmd = commands[i];
     // console.log(" exec: " + cmd);
     child_process.exec(cmd, options, function(err,stdout,stderr) {
       allout += stdout + "\n";
       allerr += stderr + "\n";
       if (err) lasterr = err.code;
       count--;
       if (count<=0) {
         (callback)( lasterr, allout, allerr);
       }
     });
   }
}
