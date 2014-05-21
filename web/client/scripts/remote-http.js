/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], function(Promise,Util) {

function unpersist(obj) {
  return new HttpRemote( obj.url );
}

function type() {
  return "http";
}

function openFile(url) {
  return Promise.resolved( new HttpRemote(url) );
}

function pullFile(url) {
  return Util.requestGET( "remote/http", { url: url } ).then( function(_content,req) {
    return req;
  }, function(err) {
    if (err.httpCode && err.httpCode===404) {
      return Util.requestGET("remote/http", { url: url + ".txt" } ).then( function(_content,req) {
        return req;
      });
    }
    throw err;
  }).then( function(req) {
    return req.responseText;
  });
}

var HttpRemote = (function() {
  function HttpRemote( url ) {    
    var self = this;
    self.url = url;
    self.date = new Date(0);
  }

  HttpRemote.prototype.type = function() {
    return type();
  }

  HttpRemote.prototype.logo = function() {
    return "icon-http.png";
  }

  HttpRemote.prototype.getFolder = function() {
    var self = this;
    return self.url;
  }

  HttpRemote.prototype.persist = function() {
    var self = this;
    return { url: self.url };
  }

  HttpRemote.prototype.getWriteAccess = function() {
    return Promise.resolved();
  }

  HttpRemote.prototype.createNewAt = function(url) {
    return Promise.resolved( new HttpRemote(url) );
  }

  HttpRemote.prototype.pushFile = function( fpath, content ) {
    return Promise.rejected( new Error("not connected: cannot store files on HTTP remote") );
  }

  HttpRemote.prototype.pullFile = function( fpath ) {
    var self = this;
    return pullFile( self.url + "/" + fpath ).then( function(content) {
      var file = {
        path: fpath,
        content: content,
        createdTime: self.date,
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

  return HttpRemote;
})();


return {
  unpersist : unpersist,
  type      : type,
  openFile  : openFile,
  HttpRemote: HttpRemote,
}

});