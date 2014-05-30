/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/map","../scripts/util"], function(Promise,Map,Util) {

var onedriveOptions = {
  client_id     : "000000004C113E9D",
  redirect_uri  : "https://www.madoko.net/redirect/live", 
    //"https://madoko.cloudapp.net/redirect/live",
  scope         : ["wl.signin","wl.skydrive","wl.skydrive_update"],
  response_type : "token",
  display: "touch",
};

var onedriveDomain = "https://apis.live.net/v5.0/";
var onedriveLoginUrl = "https://login.live.com/oauth20_authorize.srf";


/* ----------------------------------------------
   Id's, paths, and sub-directories are quite a hassle :-(
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


function onedriveGet( path ) {
  return onedriveRequest( Util.requestGET( onedriveDomain + path, { access_token: getAccessToken() } ) );
}

function onedriveRequest( req ) {
  return req.then( function(res) {
    return res;
  }, function(err) {
    if (err.message && err.message.indexOf("request_token_expired") >= 0) {
      logout();
    }
    throw err;
  }
  );
}


function infoFromId( fileId ) {
  return onedriveGet( fileId.toString() );
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
  return cache( "me/skydrive", function() { return onedriveGet("me/skydrive"); } );
}

function _getListing( folderId ) {
  return onedriveGet( folderId + "/files").then( function(res) {
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
    var url = onedriveDomain + folderId.toString();
    return onedriveRequest( Util.requestPOST( url, { access_token: getAccessToken() }, { 
      name: dir, 
      description: "" 
    })).then( function(newInfo) {
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
  var url = onedriveDomain + folderId.toString() + "/files/" + name;                  
  return Util.requestPUT( {url:url, contentType:";" }, { access_token: getAccessToken() }, content );
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
  login
---------------------------------------------- */

var _access_token = null;
var _username = "";

function getAccessToken() {
  if (!_access_token) {
    _access_token = Util.getCookie("auth_onedrive");
  }
  return _access_token;
}


function login(dontForce) {
  if (getAccessToken()) return Promise.resolved();
  if (dontForce) return Promise.rejected( new Error("onedrive: not logged in") );
  return Util.openModalPopup(onedriveLoginUrl,onedriveOptions,"oauth",800,800).then( function() {
    if (!getAccessToken()) throw new Error("onedrive login failed");
    return getUserName();
  });
}

function logout() {
  Util.setCookie("auth_onedrive","",0);
  _access_token = null;
  _username = "";
}

function getUserName() {
  if (_username) return Promise.resolved(_username);
  return onedriveGet("/me").then( function(info) {
    _username = info ? info.name : "";
    return _username;
  });
};


/* ----------------------------------------------
  Main entry points
---------------------------------------------- */

function createAt( folder ) {
  return login().then( function() {
    return ensurePath(folder);
  }).then( function(info) {
    return new Onedrive(info.id,folder);
  });
}



/* ----------------------------------------------
  Remote interface
---------------------------------------------- */

function unpersist( obj ) {
  return new Onedrive(obj.folder || "");
}

function type() {
  return "onedrive";
}

var Onedrive = (function() {

  function Onedrive( folder ) {
    var self = this;
    self.folder = folder || "";
  }

  Onedrive.prototype.type = function() {
    return type();
  }

  Onedrive.prototype.logo = function() {
    return "icon-onedrive.png";
  }  

  Onedrive.prototype.persist = function() {
    var self = this;
    return { folder: self.folder };
  }

  Onedrive.prototype.getFolder = function() {
    var self = this;
    return self.folder;
  }

  Onedrive.prototype.fullPath = function(fname) {
    var self = this;
    return Util.combine(self.folder,fname);
  }

  Onedrive.prototype.connect = function(dontForce) {
    return login(dontForce);
  }

  Onedrive.prototype.createNewAt = function(folder) {
    return createAt(folder);
  }

  Onedrive.prototype.pushFile = function( fpath, content ) {
    var self = this;
    return pushFile( self.fullPath(fpath), content ).then( function(info) {
      return Util.dateFromISO(info.updated_time);
    });
  }

  Onedrive.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    return infoFromPath( self.fullPath(fpath) ).then( function(info) {
      if (!info || !info.source) return Promise.rejected("file not found: " + fpath);
      // onedrive does not do CORS on content so we need to use our server to get it.. :-(
      // no need for binary as our server does the right thing
      return Util.requestGET( "remote/onedrive", { url: info.source } ).then( function(_content,req) {
        var file = {
          path: fpath,
          content: req.responseText,
          createdTime: Util.dateFromISO(info.updated_time),
        };
        return file;
      });
    });
  }

  Onedrive.prototype.getRemoteTime = function( fpath ) {    
    var self = this;
    return infoFromPath( self.fullPath(fpath) ).then( function(info) {
      return (info ? Util.dateFromISO(info.updated_time) : null);
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
        return item;
      });
    });
  }


  Onedrive.prototype.connected = function() {
    return (getAccessToken() != null);
  }

  Onedrive.prototype.login = function() {
    return login();
  }


  Onedrive.prototype.logout = function() {
    logout();
  }

  Onedrive.prototype.getUserName = function() {
    var self = this;
    if (!self.connected()) return Promise.resolved(null);
    return getUserName();
  }

  return Onedrive;
})();   



return {
  createAt  : createAt,
  login     : login,
  logout    : logout,
  unpersist : unpersist,
  type      : type,
  Onedrive  : Onedrive,
}

});