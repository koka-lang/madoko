/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], function(Promise,Util) {

function pullFile(url,binary) {
  // no need for binary as our server sends binary by default
  return Util.requestGET( "rest/remote/http", { url: url } ).then( function(_content,req) {
    return req.responseText;
  }, function(err) {
    if (err.httpCode && err.httpCode===404) {
      return Util.requestGET("rest/remote/http", { url: url + ".txt" } ).then( function(_content,req) {
        return req.responseText;
      });
    }
    throw err;
  });
}

function createAt(folder) {
  return Promise.resolved( new HttpRemote(folder) );
}

function unpersist(obj) {
  return new HttpRemote( obj.url );
}

function type() {
  return "http";
}

function logo() {
  return "icon-http.png";
}



var HttpRemote = (function() {

  function HttpRemote( url ) {    
    var self = this;
    self.url = url;
    self.date = new Date(0);
  }

  HttpRemote.prototype.createNewAt = function(folder) {
    return createAt(folder);
  }

  HttpRemote.prototype.type = function() {
    return type();
  }

  HttpRemote.prototype.logo = function() {
    return logo();
  }

  HttpRemote.prototype.readonly   = true;
  HttpRemote.prototype.canSync    = false;
  HttpRemote.prototype.needSignin = false;
  
  HttpRemote.prototype.getFolder = function() {
    var self = this;
    return self.url;
  }

  HttpRemote.prototype.getDisplayFolder = function() {
    var self = this;
    return self.getFolder();
  }

  HttpRemote.prototype.persist = function() {
    var self = this;
    return { url: self.url };
  }

  HttpRemote.prototype.fullPath = function(fname) {
    var self = this;
    return Util.combine(self.url,fname);
  }

  HttpRemote.prototype.connect = function() {
    return Promise.resolved(0);
  }

  HttpRemote.prototype.login = function() {
    return Promise.resolved();
  }

  HttpRemote.prototype.logout = function(force) {
    return Promise.resolved();
  }

  HttpRemote.prototype.getUserName = function() {
    return Promise.resolved("");
  }


  HttpRemote.prototype.pushFile = function( fpath, content ) {
    return Promise.rejected( new Error("Not connected to writeable cloud storage: cannot store files on HTTP remote") );
  }

  HttpRemote.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    return pullFile( self.url + "/" + fpath, binary ).then( function(content) {
      var sharedPath = "//" + self.type() + "/shared/0/" + self.fullPath(fpath);
      var file = {
        path: fpath,
        content: content,
        createdTime: self.date,
        globalPath : sharedPath,
        sharedPath : sharedPath,
      };
      return file;
    });
  }

  HttpRemote.prototype.getRemoteTime = function( fpath ) {
    var self = this;
    return Promise.resolved(self.date);
  }

  HttpRemote.prototype.createSubFolder = function( path ) {
    var self = this;
    return Promise.resolved({folder: path, created: true });
  }

  HttpRemote.prototype.getShareUrl = function(fname) {
    var self = this;
    return Promise.resolved(null); // self.fullPath(fname));  
  }

  return HttpRemote;
})();


return {
  createAt  : createAt,
  unpersist : unpersist,
  type      : type,
  logo      : logo,
  HttpRemote: HttpRemote,
}

});