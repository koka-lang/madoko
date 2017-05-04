/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/date","../scripts/map","../scripts/util","../scripts/oauthRemote"], 
        function(Promise,StdDate,Map,Util,OAuthRemote) {


var onedrive = new OAuthRemote( {
  name           : "onedrive",
  displayName    : "Onedrive (old)",
  defaultDomain  : "https://apis.live.net/v5.0/",
  accountUrl     : "me",
  loginUrl       : "https://login.live.com/oauth20_authorize.srf",
  loginParams: {
    client_id    : "000000004C113E9D",
    scope        : ["wl.signin","wl.skydrive","wl.contacts_skydrive","wl.skydrive_update","wl.offline_access"],
  },
  dialogHeight   : 650,
  dialogWidth    : 800,
  logoutUrl      : "https://login.live.com/oauth20_logout.srf",
  useAuthHeader  : false,    
} );


/* ----------------------------------------------
   Id's, paths, and sub-directories are quite a hassle :-(
   We set up a special cache for file paths
---------------------------------------------- */

var pathCache = new Map();

function cache( path, action ) {
  var val = pathCache.get(path);
  if (val) return Promise.resolved(val.info);
  return action(path).then( function(info) {
    pathCache.set(path, { time: Date.now(), info: info });
    return info;
  });
}


setInterval( function() {
  var now = Date.now();
  pathCache.forEach( function(path,val) {
    if (now - val.time > 60000) pathCache.remove(path);
  });
}, 60000);


function infoFromId( fileId ) {
  return onedrive.requestGET( { url: fileId.toString(), timeout: 5000 } );
}

function pathFromId( id, path ) {
  if (path == null) path = "";
  if (id === null) return path;
  return infoFromId( id ).then( function(info) {
    if (info.parent_id === null || info.name==="SkyDrive" || info.name==="OneDrive") return path;
    return pathFromId( info.parent_id, (path ? Util.combine(info.name,path) : info.name));
  });
}

function rootInfo() {
  return cache( "me/skydrive", function() { return onedrive.requestGET("me/skydrive"); } );
}

function _getListing( folderId ) {
  return onedrive.requestGET( { url: folderId + "/files", timeout: 5000 } ).then( function(res) {
    return res.data || [];
  });
}

function getListing( path ) {
  return infoFromPath( path ).then( function(info) {
    return _getListing( info.id );
  });
}

function _infoFromName( folderId, name ) {
  return _getListing(folderId).then( function(items) {
    var file = null;
    for (var i = 0; i < items.length; i++) {
      var f = items[i];
      if (f.name == name) {
        file = f;
        break;
      }
    }
    return file;
  });
}

function _infoFromSubDirs( info, parts ) {
  if (parts.length === 0) return Promise.resolved(info);
  var part = parts.shift();
  return _infoFromName( info.id, part ).then( function( subInfo ) {
    if (!subInfo) return null;
    return _infoFromSubDirs( subInfo, parts );
  });
}

function _infoFromSubPath( folderId, path ) {
  return infoFromId( folderId ).then(function(info) {
    if (!path) return info;
    return _infoFromSubDirs( info, path.split("/") );    
  });
}

function infoFromPath( path ) {
  return cache( path, function() {
    return rootInfo().then( function( info ) {
      return _infoFromSubPath( info.id, path );
    });
  });
}

function _ensureSubDirs( folderId, dirs, recurse ) {
  if (dirs.length === 0) return { id: folderId, created: false };
  var dir = dirs.shift();
  return _infoFromName( folderId, dir ).then( function(dirInfo) {
    if (dirInfo) return _ensureSubDirs( dirInfo.id, dirs );
    return onedrive.requestPOST( folderId.toString(), { }, { 
      name: dir, 
      description: "" 
    }).then( function(newInfo) {
      if (dirs.length===0) return { id: newInfo.id, created: true }; // remember we created it
      return _ensureSubDirs( newInfo.id, dirs );
    }, function(err) {
      if (!recurse && err && Util.contains(err.message,"(resource_already_exists)")) {
        // multiple requests can result in this error, try once more
        dirs.unshift(dir);
        return _ensureSubDirs( folderId, dirs, true );
      }
      else {
        throw err; // re-throw
      }    
    });
  });
}

function _ensureSubPath( folderId, path ) {
  if (!path) return Promise.resolved( { id: folderId, created: false } );
  return _ensureSubDirs( folderId, path.split("/"));
}

function ensurePath( path ) {
  return rootInfo().then( function(info) {
    return _ensureSubPath( info.id, path );
  });
}

/* Write a file */

function _writeFileAt( folderId, name, content ) {
  var url = folderId.toString() + "/files/" + name;                  
  return onedrive.requestPUT( { url: url, contentType:";" }, {}, content ).then( function(res) {
    return res;
  }, function (err) {
    if (err && err.httpCode===409) throw new Error("Cannot write file -- shared files are readonly on Onedrive for third-party apps (" + name + ")" + (err.message ? "\n " + err.message : ""));
    throw err;
  });
}

function _writeFile( folderId, path, content ) {
  return _ensureSubPath( folderId, Util.dirname(path) ).then( function(info) {
    return _writeFileAt( info.id, Util.basename(path), content );
  }).then( function(resp) {
    return infoFromId( resp.id );
  });
}

function pushFile( path, content ) {
  return rootInfo().then( function(info) {
    return _writeFile( info.id, path, content );
  });
}

/* ----------------------------------------------
  Main entry points
---------------------------------------------- */

function createAt( folder ) {
  return onedrive.login().then( function() {
    return ensurePath(folder);
  }).then( function(info) {
    return new Onedrive(folder);
  });
}

function unpersist( obj ) {
  if (!obj || obj.type !== Onedrive.prototype.type) return null;
  return new Onedrive(obj.folder || "");
}

var Onedrive = (function() {

  function Onedrive( folder ) {
    var self = this;
    self.folder = folder || "";
  }

  Onedrive.prototype.createNewAt = function(folder) {
    return createAt(folder);
  }

  Onedrive.prototype.type = onedrive.name;
  Onedrive.prototype.logo = onedrive.logo;
  Onedrive.prototype.displayName = onedrive.displayName;
  Onedrive.prototype.title = "Onedrive cloud storage. Note: does not allow access to files that are shared with you by others."
  Onedrive.prototype.readonly = false;
  Onedrive.prototype.canSync  = true;
  Onedrive.prototype.needSignin = true;
  
  Onedrive.prototype.getFolder = function() {
    var self = this;
    return self.folder;
  }

  Onedrive.prototype.getDisplayFolder = function() {
    var self = this;
    return self.getFolder();
  }

  Onedrive.prototype.persist = function() {
    var self = this;
    return { type: self.type, folder: self.folder };
  }
  
  Onedrive.prototype.fullPath = function(fname) {
    var self = this;
    return Util.normalize(Util.combine(self.folder,fname));
  }

  Onedrive.prototype.connect = function() {
    return onedrive.connect();
  }

  Onedrive.prototype.login = function() {
    return onedrive.login();
  }

  Onedrive.prototype.logout = function(force) {
    return onedrive.logout(force);
  }

  Onedrive.prototype.getUserName = function() {
    return onedrive.getUserName();
  }


  Onedrive.prototype.pushFile = function( fpath, content ) {
    var self = this;
    return pushFile( self.fullPath(fpath), content ).then( function(info) {
      return { createdTime: StdDate.dateFromISO(info.updated_time) };
    });
  }

  Onedrive.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    return infoFromPath( self.fullPath(fpath) ).then( function(info) {
      if (!info || !info.source) return Promise.rejected("file not found: " + fpath);
      // onedrive does not do CORS on content so we need to use our server to get it.. :-(
      // no need for binary as our server does the right thing
      return Util.requestGET( "/rest/remote/onedrive", { url: info.source } ).then( function(_content,req) {
          var file = {
          path: fpath,
          content: req.responseText,
          createdTime: StdDate.dateFromISO(info.updated_time),
          // shareUrl: info.source,
        };
        return file;        
      });
    });
  }

  Onedrive.prototype.getMetaData = function( fpath ) {    
    var self = this;
    return infoFromPath( self.fullPath(fpath) ).then( function(info) {
      return (info ? { modifiedTime: StdDate.dateFromISO(info.updated_time), deleted: false } : null);
    });
  }

  Onedrive.prototype.createSubFolder = function(dirname) {
    var self = this;
    return ensurePath( self.fullPath(dirname) ).then( function(info) {
      return { folder: Util.combine(self.folder,dirname), created: info.created };
    });
  }

  Onedrive.prototype.listing = function( fpath ) {
    var self = this;
    return getListing( self.fullPath(fpath) ).then( function(items) {
      return (items ? items : []).map( function(item) {
        item.type = (item.type==="folder" || item.type==="album" ? "folder" : "file");
        item.path = Util.combine(fpath,item.name);
        item.isShared = (item.shared_with && item.shared_with.access !== "Just me");
        return item;
      });
    });
  }

  Onedrive.prototype.getShareUrl = function(fname) {
    var self = this;
    return infoFromPath( self.fullPath(fname) ).then( function(info) {
      return (info ? info.source : null);
    });
  }

  Onedrive.prototype.getInviteUrl = function() {
    return null;
  };


  return Onedrive;
})();   



return {
  createAt  : createAt,
  unpersist : unpersist, 
  Onedrive  : Onedrive,
}

});