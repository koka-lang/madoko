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
var onServer = ($std_core.getHost() === "nodejs");

var $readFileSync;
var $writeFileSync;
var $renameSync;
var $fexistsSync;
var $relative;
var $mkdirp;
var $cwd;
var $clear;
var $unlinkSync;
var vfs = {};

if (onServer) {
  var fs = require("fs");
  var path = require("path");
  var xmkdirp = require('mkdirp');

  $readFileSync = function(fname,enc) { return fs.readFileSync(fname,(enc && enc !== "buffer") ? {encoding:enc} : null); };
  $writeFileSync = function(fname,enc,data) { return fs.writeFileSync(fname,data,(enc && enc !== "buffer") ? {encoding:enc} : null); };
  $fexistsSync = function(fname) { return (fs.existsSync(fname) != 0);};
  $relative = function(dir,p) { return path.relative(dir,p); };
  $cwd = function() { return process.cwd(); };
  $mkdirp = function(dir,mode) { return xmkdirp.sync(dir,mode); };
  $renameSync = function(oldname,newname) { return fs.renameSync(oldname,newname); };
  $clear = function() { };
  $unlinkSync = function(fname) { return fs.unlinkSync(fname); }; 
}
else {
  $readFileSync = function(fname,enc) {
    var data = vfs["/" + fname];
    if (data === undefined) throw ("Could not read: " + fname);
    return data;
  }

  $writeFileSync = function(fname,enc,data) {
    vfs["/" + fname] = data;
  }

  $fexistsSync = function(fname) {
    return (vfs["/" + fname] !== undefined);
  }

  $relative = function(dir,p) {
    return p; // TODO: implement this client side.
  }

  $cwd = function() {
    return "."; // ??
  }

  $mkdirp = function(dir,mode) {
    // do nothing
  }

  $renameSync = function(oldname,newname) {
    $writeFileSync( newname, "binary", $readFileSync(oldname) );
  }

  $clear = function() {
    vfs = {};
  }

  $unlinkSync = function(fname) {
    var data = vfs["/" + fname];
    if (data != null) {
      delete vfs["/" + fname];
    }
    return null;
  }
}
