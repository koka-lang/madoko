/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], function(Promise,Util) {

function unpersist() {
  return new NullRemote();
}

function type() {
  return "null";
}

var NullRemote = (function() {
  function NullRemote() {    
  }

  NullRemote.prototype.type = function() {
    return type();
  }

  NullRemote.prototype.logo = function() {
    return "icon-local.png";
  }

  NullRemote.prototype.getFolder = function() {
    return "Madoko/document";
  }

  NullRemote.prototype.persist = function() {
    return { };
  }

  NullRemote.prototype.getWriteAccess = function() {
    return Promise.resolved();
  }

  NullRemote.prototype.createNewAt = function(folder) {
    return Promise.resolved( new NullRemote() );
  }

  NullRemote.prototype.pushFile = function( fpath, content ) {
    return Promise.rejected( new Error("not connected: cannot store files") );
  }

  NullRemote.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    return Promise.rejected( new Error("not connected to storage: unable to read: " + fpath) );
  }

  NullRemote.prototype.getRemoteTime = function( fpath ) {
    return Promise.resolved(null);
  }

  NullRemote.prototype.createSubFolder = function( path ) {
    return Promise.resolved({folder: path, created: true });
  }

  return NullRemote;
})();


return {
  unpersist : unpersist,
  type      : type,
  NullRemote: NullRemote,
}

});