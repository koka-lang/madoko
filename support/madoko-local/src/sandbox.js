/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {

var Util    = require("./util.js");

/* --------------------------------------------------------------------
   Ensure files reside in the sandbox
-------------------------------------------------------------------- */

var rxFileChar = "[^\\\\/\\?\\*\\.\\|<>&:\"\\u0000-\\u001F]";
var rxRootRelative = new RegExp( "^(?![\\\\/]|\w:)(" + rxFileChar + "|\\.(?=[^\\.])|[\\\\/](?=" + rxFileChar + "|\\.))+$" );

function makeSafePath(root,path) {
  var root  = Util.normalize(root);
  var fpath = Util.combine( root, path); 
  if (root && ((fpath===root) || (Util.startsWith(fpath,root + "/") && rxRootRelative.test(fpath.substr(root.length+1))))) {
    return fpath;
  }
  else {
    return null;
  }
}

function isSafePath(root,path) {
  return (makeSafePath(root,path) ? true : false);
}

// Create a safe path under a certain root directory and raise an exception otherwise.
function getSafePath(root,path) {
  var fpath = makeSafePath(root,path);
  if (!fpath) {
    throw new Util.HttpError( "Invalid file name due to sandbox: " + path, 401 );
  }
  return fpath;
}


// module interface
return {
  getSafePath: getSafePath,
  isSafePath : isSafePath,
};

});