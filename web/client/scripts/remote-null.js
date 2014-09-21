/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], function(Promise,Util) {

function createAt(folder) {
  return Promise.resolved( new NullRemote(folder) );
}

function unpersist(obj) {
  return new NullRemote(obj ? obj.folder : "");
}

function type() {
  return "local";
}


function logo() {
  return "icon-local.png";
}


var NullRemote = (function() {
  function NullRemote(folder) {
    var self = this;
    self.folder = folder || "";    
  }

  NullRemote.prototype.createNewAt = function(folder) {
    return createAt(folder);
  }

  NullRemote.prototype.type = function() {
    return type();
  }

  NullRemote.prototype.logo = function() {
    return logo();
  }

  NullRemote.prototype.isRemote = function() {
    return false;
  }

  NullRemote.prototype.getFolder = function() {
    var self = this;
    return self.folder;
  }

  NullRemote.prototype.persist = function() {
    var self = this;
    return { folder: self.folder };
  }

  NullRemote.prototype.fullPath = function(fname) {
    var self = this;
    return Util.combine(self.folder,fname);
  }

  NullRemote.prototype.connect = function() {
    return Promise.resolved(true);
  }

  NullRemote.prototype.login = function(dontForce) {
    return Promise.resolved();
  }

  NullRemote.prototype.logout = function() {
    return Promise.resolved();
  }

  NullRemote.prototype.getUserName = function() {
    return Promise.resolved("");
  }

  NullRemote.prototype.pushFile = function( fpath, content ) {
    return Promise.rejected( new Error("Not connected to cloud storage: cannot store files") );
  }

  NullRemote.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    return Promise.rejected( new Error("Not connected to cloud storage: unable to read: " + fpath) );
  }

  NullRemote.prototype.getRemoteTime = function( fpath ) {
    return Promise.resolved(null);
  }

  NullRemote.prototype.createSubFolder = function( path ) {
    return Promise.resolved({folder: path, created: true });
  }

  NullRemote.prototype.listing = function( fpath ) {
    return Promise.resolved([]);
  }

  NullRemote.prototype.getShareUrl = function(fname) {
    return Promise.resolved(null);
  }

  return NullRemote;
})();


return {
  createAt  : createAt,
  unpersist : unpersist,
  type      : type,
  logo      : logo,
  NullRemote: NullRemote,
}

});