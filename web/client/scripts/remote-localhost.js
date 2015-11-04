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
    self.hosted = (window !== window.top);
    self.user   = {};
    self.unique = 1;
    self.promises = {};
    self.origin = null;
    self.mount  = null;
    if (self.hosted) {
      if (params.origin) {
        self.origin = params.origin;
      }
      else if (window.location.ancestorOrigins !== undefined &&
               window.location.ancestorOrigins.length===1) {
        self.origin = window.location.ancestorOrigins[0];
      }
      else if (document.referrer) {
        var cap = /^((https?:\/\/)?[^?#\/\s]+)/.exec(document.referrer);
        if (cap) self.origin = cap[0]; 
      }
    }
    if (!self.origin) self.hosted = false;
    
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
    return self.postMessage( info, params.timeout || 10000);
  }

  FrameRemote.prototype.postMessage = function( info, timeout ) {
    var self = this;
    if (!self.hosted) return Promise.rejected("Madoko can only access the local file system through a local host");
    //if (info.params && info.params.mount && self.mount && info.params.mount !== self.mount) {
    //  return Promise.rejected( errorMessageMount( self.mount, info.params.mount ) );
    // }
    var promise = new Promise();
    var id = self.unique++;
    info.messageId = id; 
    info.eventType = "localhost";
    var timeoutId = 0;
    if (timeout && timeout > 1) {
      timeoutId = setTimeout( function() { 
        self._onMessage( { messageId: id, error: "remote request timed out" } );            
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

  FrameRemote.prototype.connect = function(_mount) {
    var self = this;
    if (!self.hosted) return Promise.resolved({ code: 401 });
    return self.login().then( function(realmount) {
      return { mount: realmount, code: 0 };
    });    
  }

  FrameRemote.prototype.login = function(mount) {
    var self = this;
    if (!self.hosted) return Promise.rejected( { htmlMessage: "To access the Local Disk, you must run the <a href='https://www.npmjs.com/package/madoko-local' target='_blank'>madoko-local</a> program." });
    return self.postMessage( { method: "GET:config", params: { mount: mount } }, 5000 ).then( function(res) {
      self.user = {
        username: res.username,
        userid  : res.userid,
        email   : res.email,
      };
      self.mount = res.mount;
      return res.mount;
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

  FrameRemote.prototype.reload = function(force) {
    var self = this;
    self.request("reload", { force: force });
  }

  FrameRemote.prototype.setTitle = function(title) {
    var self = this;
    self.request("title", { title: title });
  }

  return FrameRemote;
})();


var localhost = new FrameRemote({
});


/* ----------------------------------------------
  Basic file API
---------------------------------------------- */

function pullFile(mount,fname,binary) {
  return localhost.request( "GET:readfile", { mount: mount, path: fname, binary: binary } ).then( function(content) {
    return { content: content, path: fname };
  });
}

function fileInfo(mount,fname) {
  return localhost.request( "GET:metadata", { mount: mount, path: fname });
}

function folderInfo(fname) {
  return localhost.request( "GET:metadata", { path: fname } );
}

function pushFile(mount, fname,content,remoteTime) {
  return localhost.request( "PUT:writefile", { mount: mount, path: fname, remoteTime: (remoteTime ? remoteTime.toISOString() : null) }, content ).then( function(info) {
    return info;
  });  
}

function createFolder( mount, dirname ) {
  return localhost.request( "POST:createfolder", { mount: mount, path: dirname }).then( function(info) {
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
  return new Localhost(obj.folder,obj.mount);
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

  function Localhost( folder, mount ) {
    var self = this;
    self.folder = folder || "";
    self.mount  = mount;
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

  Localhost.prototype.title    = "Local disk storage. Documents are read and written to the local disk. Requires the 'madoko-local' program to offer secure access.";
  Localhost.prototype.readonly = false;
  Localhost.prototype.canSync  = true;
  Localhost.prototype.needSignin = false;
  Localhost.prototype.hasAtomicPush = true;

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
    return { type: self.type(), folder: self.folder, mount: self.mount };
  }

  Localhost.prototype.fullPath = function(fname) {
    var self = this;
    return Util.combine(self.folder,fname);
  }

  Localhost.prototype.connect = function() {
    var self = this;
    return localhost.connect(self.mount).then( function(res) {
      if (!self.mount && res.mount) self.mount = res.mount;
      return res.code;
    });
  }

  Localhost.prototype.login = function() {
    var self = this;
    return localhost.login(self.mount).then( function(mount) {
      if (!self.mount && mount) self.mount = mount;
    });
  }

  Localhost.prototype.logout = function(force) {
    return localhost.logout(force);
  }

  Localhost.prototype.getUserName = function() {
    return localhost.getUserName();
  }

  Localhost.prototype.pushFile = function( fpath, content, remoteTime ) {
    var self = this;
    return pushFile( self.mount, self.fullPath(fpath), content, remoteTime ).then( function(info) {
      if (!info || !info.path) {
        throw new Error("illegal return value");
      }
      return { 
        path: info.path,
        createdTime: Date.dateFromISO(info.modified),        
      };
    });
  }

  Localhost.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    return self.getRemoteTime(fpath).then( function(date) { // TODO: can we make this one request?
      if (!date) throw new Error("file not found: " + fpath);
      return pullFile( self.mount, self.fullPath(fpath), binary ).then( function(info) {
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
    return fileInfo( self.mount, self.fullPath(fpath) ).then( function(info) {
      return (info && info.modified ? Date.dateFromISO(info.modified) : null);
    });
  }

  Localhost.prototype.createSubFolder = function(dirname) {
    var self = this;
    var folder = self.fullPath(dirname);
    return createFolder(self.mount,folder).then( function(created) {
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
  localhost  : localhost,
}

});