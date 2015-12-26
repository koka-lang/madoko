/*---------------------------------------------------------------------------
  Copyright 2013-2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

/*
function execProcess( cmd, options, cb ) {
  var args = cmd.split(/\s+/).map(function(arg) { return unquote(arg); } );
  var child = child_process.spawn( args[0], args.slice(1), options );
  var stderr = "";
  var stdout = "";
  child.stdin.write("\n");
  child.stdout.on('data', function(data) {
    stdout += data.toString();
  });
  child.stderr.on('data', function(data) {
    stderr += data.toString();
  });
  child.on( 'close', function(code) {
    console.log("child closed");
    child.stdin.end();
    cb((code===0 ? null : {code: code}),stdout,stderr);
  });
}

function unquote(s) {
  return s.replace(/^(?:\"(.*)\"|'(.*)')$/, "$1$2");
}
*/