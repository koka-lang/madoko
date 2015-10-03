/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util","../scripts/date"], 
        function(Promise,Util,Date) {

var FrameRemote = (function() {
  function FrameRemote( params ) {
    var self = this;
    if (!params) params = {};

    self.hostWindow = params.hostWindow || window.parent;
    self.origin = params.origin || "http://localhost";
    self.hosted = (window !== window.top);
    self.user   = {};
    self.unique = 1;
    self.promises = {};

    if (!self.hosted) return;
    window.addEventListener( "message", function(ev) {
      if (ev.origin !== self.origin) return;
      if (ev.source !== self.hostWindow) return;
      if (typeof ev.data !== "object") return;
      var info = ev.data;
      if (info.eventType !== "localhost") return;
      self._onMessage( info );
    });
  }

  FrameRemote.prototype.request = function( request, params, content ) {
    var self = this;
    var info = { 
      method: request,
      params: params
    };
    if (content) info.content = content;
    return self.postMessage( info, params.timeout);
  }

  FrameRemote.prototype.postMessage = function( info, timeout ) {
    var self = this;
    if (!self.hosted) return Promise.rejected("Madoko can only access the local file system through a local host");

    var promise = new Promise();
    var id = self.unique++;
    info.messageId = id; 
    info.eventType = "localhost";
    var timeoutId = 0;
    if (timeout && timeout > 1) {
      timeoutId = setTimeout( function() { 
        self._onMessage( { messageId: id, timedOut: true } );            
      }, timeout);
    }
    self.promises[id] = { promise: promise, timeoutId: timeoutId };
    self.hostWindow.postMessage( info, self.origin );
    return promise;
  }

  FrameRemote.prototype._onMessage = function( info ) {
    var self = this;
    if (!info || typeof info.messageId === "undefined") return;
    var promise = self.promises[info.messageId];
    delete self.promises[info.messageId];
    if (!promise) return;
    if (promise.timeoutId) clearTimeout(promise.timeoutId);
    if (info.error) {
      promise.promise.reject(info.error);
    }
    else {
      promise.promise.resolve(info.result);
    }
  }

  FrameRemote.prototype.connect = function() {
    var self = this;
    return self.postMessage( { method: "login" } ).then( function(res) {
      self.user = res;
      return 0;
    }, function(err) {
      return 401;
    });
  }

  FrameRemote.prototype.login = function() {
    var self = this;
    if (!self.hosted) return Promise.rejected( { htmlMessage: "To access the Local Disk, you must run the <a href='https://www.npmjs.com/package/madoko'>madoko-disk</a> program." });
    return self.postMessage( { method: "login" } ).then( function(res) {
      self.user = res;
      return;      
    });
  }


  FrameRemote.prototype.withUserId = function(action) {
    var self = this;
    return Promise.wrap(action, self.user.id);
  }


  FrameRemote.prototype.getUserName = function() {
    var self = this;
    return Promise.resolved(self.user.name);
  }

  FrameRemote.prototype.getUserInfo = function() {
    var self = this;
    return Promise.resolved(self.user);
  }

  return FrameRemote;
})();


var localhost = new FrameRemote({
  origin: "http://localhost",
});


/* ----------------------------------------------
  Basic file API
---------------------------------------------- */

function pullFile(fname,binary) {
  return localhost.request( "get/pull", { path: fname, binary: binary } ).then( function(content) {
    return { content: content, path: fname };
  });
}

function fileInfo(fname) {
  return localhost.request( "get/metadata", { path: fname });
}

function folderInfo(fname) {
  return localhost.request( "get/metadata", { path: fname } );
}

function pushFile(fname,content) {
  return localhost.request( "put/push", { path: fname }, content ).then( function(info) {
    return info;
  });  
}

function createFolder( dirname ) {
  return localhost.request( "post/createfolder", { path: dirname }).then( function(info) {
    return true; // freshly created
  }, function(err) {
    if (err && err.httpCode === 403) return false;
    throw err;
  });
}



/* ----------------------------------------------
   Main entry points
---------------------------------------------- */

function createAt( folder ) {
  return localhost.login().then( function() {
    return new Localhost(folder);
  });
}

function unpersist(obj) {
  return new Localhost(obj.folder);
}

function type() {
  return "localhost";
}

function logo() {
  return "icon-localhost.png";
}

/* ----------------------------------------------
   Localhost remote object
---------------------------------------------- */

var Localhost = (function() {

  function Localhost( folder ) {
    var self = this;
    self.folder = folder || "";
  }

  Localhost.prototype.createNewAt = function(folder) {
    return createAt(folder);
  }

  Localhost.prototype.type = function() {
    return type();
  }

  Localhost.prototype.displayName = function() {
    return "Local Disk";
  }

  Localhost.prototype.logo = function() {
    return logo();
  }

  Localhost.prototype.readonly = false;
  Localhost.prototype.canSync  = true;
  Localhost.prototype.needSignin = false;

  Localhost.prototype.getFolder = function() {
    var self = this;
    return self.folder;
  }

  Localhost.prototype.getDisplayFolder = function() {
    var self = this;
    return self.getFolder();
  }

  Localhost.prototype.persist = function() {
    var self = this;
    return { type: self.type(), folder: self.folder };
  }

  Localhost.prototype.fullPath = function(fname) {
    var self = this;
    return Util.combine(self.folder,fname);
  }

  Localhost.prototype.connect = function() {
    return localhost.connect();
  }

  Localhost.prototype.login = function() {
    return localhost.login();
  }

  Localhost.prototype.logout = function(force) {
    return localhost.logout(force);
  }

  Localhost.prototype.getUserName = function() {
    return localhost.getUserName();
  }

  Localhost.prototype.pushFile = function( fpath, content ) {
    var self = this;
    return pushFile( self.fullPath(fpath), content ).then( function(info) {
      return { 
        path: info.path,
        createdTime: Date.dateFromISO(info.modified),        
      };
    });
  }

  Localhost.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    return self.getRemoteTime(fpath).then( function(date) { // TODO: can we make this one request?
      if (!date) return Promise.rejected("file not found: " + fpath);
      return pullFile( self.fullPath(fpath), binary ).then( function(info) {
        var file = {
          path: fpath,
          content: info.content,
          createdTime: date,
          type: "file",
        };
        return file;
      });
    });
  }

  Localhost.prototype.getRemoteTime = function( fpath ) {    
    var self = this;
    return fileInfo( self.fullPath(fpath) ).then( function(info) {
      return (info && !info.is_deleted ? Date.dateFromISO(info.modified) : null);
    }, function(err) {
      if (err && err.httpCode===404) return null;
      throw err;
    });
  }

  Localhost.prototype.createSubFolder = function(dirname) {
    var self = this;
    var folder = self.fullPath(dirname);
    return createFolder(folder).then( function(created) {
      return { folder: folder, created: created };
    });
  }

  Localhost.prototype.listing = function( fpath ) {
    var self = this;
    return folderInfo( self.fullPath(fpath) ).then( function(info) {
      return (info ? info.contents : []).map( function(item) {
        item.type = item.is_dir ? "folder" : "file";
        return item;
      });
    });
  }

  Localhost.prototype.getShareUrl = function(fname) {
    var self = this;
     return Promise.resolved(null);
  };

  Localhost.prototype.getInviteUrl = function() {
    var self = this;
    return null;
  };

  return Localhost;
})();   



return {
  createAt : createAt,
  unpersist: unpersist,
  type     : type,
  logo     : logo,
  Localhost  : Localhost,
}

});