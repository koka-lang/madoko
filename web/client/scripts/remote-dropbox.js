/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], function(Promise,Util) {

var appKey      = "3vj9witefc2z44w";
var root        = "dropbox";
//var redirectUri = "https://www.madoko.net/redirect/dropbox";
var redirectUri = "https://madoko.cloudapp.net/redirect/dropbox";
var contentUrl  = "https://api-content.dropbox.com/1/files/" + root + "/";
var pushUrl     = "https://api-content.dropbox.com/1/files_put/" + root + "/";
var metadataUrl = "https://api.dropbox.com/1/metadata/" + root + "/";
var fileopsUrl  = "https://api.dropbox.com/1/fileops/";
var accountUrl  = "https://api.dropbox.com/1/account/";
var sharesUrl   = "https://api.dropbox.com/1/shares/" + root + "/";
var sharedFoldersUrl   = "https://api.dropbox.com/1/shared_folders/";

var _access_token = null; // null: never tried ask server, false: tried but not logged in
var _userid = "";

function withAccessToken(action) {
  if (_access_token) return Promise.wrap(action(_access_token));
  if (_access_token === false) return Promise.rejected("Not logged in");
  return Util.requestGET("/oauth/token",{ remote: "dropbox" } ).then( function(access_token) {
    _access_token = access_token;
    return action(_access_token);
  }, function(err) {
    _access_token = false;
    throw err;
  });
}

function dropboxGET( options, params ) {
  return withAccessToken( function(access_token) {
    options.access_token = access_token;
    return Util.requestGET( options, params );
  });
}

function dropboxPOST( options, params, content ) {
  return withAccessToken( function(access_token) {
    options.access_token = access_token;
    return Util.requestPOST( options, params, content );
  });
}


/* ----------------------------------------------
   Login 
---------------------------------------------- */

function logout() {
  if (_access_token) {
    // invalidate the access_token
    Util.requestPOST( {url: "/oauth/logout"}, { remote: "dropbox" } );
  }
  _access_token = false;
  _userid = "";
}

function tryLogin(action) {
  if (_access_token) return Promise.wrap(action(true));
  if (_access_token===false) return Promise.wrap(action(false));
  return withAccessToken( function() { return true; }).then( function() {
    return action(true);
  }, function(err) {
    return action(false);
  });
}

function login(dontForce) {
  return tryLogin( function(ok) {
    if (ok) return;
    if (dontForce) return Promise.rejected( new Error("dropbox: not logged in") );
    var url = "https://www.dropbox.com/1/oauth2/authorize"
    var params = { 
      response_type: "code", 
      client_id: appKey, 
      redirect_uri:  redirectUri,
    };
    return Util.openOAuthLogin("dropbox",url,params,600,600).then( function() {
      _access_token = null; // reset from 'false'
      return withAccessToken( function() { return; } ); // and get the token
    });
  });
}

function withUserId(action) {
  if (_userid) return Promise.wrap(action(_userid));
  return getUserInfo().then( function(info) {
    _userid = info.uid;
    return action(_userid);
  });
}

function getUserName() {
  // don't cache, we use it to determine connected-ness 
  // if (_username) return Promise.resolved(_username);
  return getUserInfo().then( function(info) {
    return info.display_name;
  });
}

function getUserInfo() {
  return dropboxGET( { url: accountUrl + "info" } );
}


/* ----------------------------------------------
  Basic file API
---------------------------------------------- */

function pullFile(fname,binary) {
  var opts = { url: contentUrl + fname, binary: binary };
  return dropboxGET( opts ).then( function(content,req) {
    var infoHdr = req.getResponseHeader("x-dropbox-metadata");
    var info = (infoHdr ? JSON.parse(infoHdr) : { path: fname });
    info.content = content;
    return withUserId( function(uid) {
      info.globalPath = "//dropbox/unshared/" + uid + info.path;
      if (!info.parent_shared_folder_id) return info;
      // shared
      return sharedFolderInfo(info.parent_shared_folder_id).then( function(sinfo) {  // this is cached
        if (sinfo || Util.startsWith(info.path,sinfo.path + "/")) {
          info.sharedPath = "//dropbox/shared/" + sinfo.shared_folder_id + "/" + sinfo.shared_folder_name + "/" + info.path.substr(sinfo.path.length + 1);
          info.globalPath = info.sharedPath; // use the shared path
        }      
        return info;
      }, function(err) {
        Util.message( new Error("dropbox: could not get shared info: " + (err.message || err)), Util.Msg.Error );
        return info;
      });
    });
  });
}

function fileInfo(fname) {
  var url = metadataUrl + fname;
  return dropboxGET( { url: url, timeout: 2500 } );
}

function sharedFolderInfo(id) {
  var url = sharedFoldersUrl + id;
  // TODO: pass access_token as a header; for now this does not work on dropbox due to a CORS bug.
  return withAccessToken( function(token) {
    return Util.requestGET( { url: url, timeout: 2500, cache: -60000 }, { access_token: token } );  // cached, retry after 60 seconds;
  });
}

function folderInfo(fname) {
  var url = metadataUrl + fname;
  return dropboxGET( { url: url, timeout: 2500 }, { list: true });
}

function pushFile(fname,content) {
  var url = pushUrl + fname;
  return dropboxPOST( { url: url }, {}, content ).then( function(info) {
    if (!info) throw new Error("dropbox: could not push file: " + fname);
    return info;
  });
}

function createFolder( dirname ) {
  var url = fileopsUrl + "create_folder";
  return dropboxPOST( {
    url: url,
  }, {
    root: root, 
    path: dirname,
  }).then( function(info) {
    return true; // freshly created
  }, function(err) {
    if (err.httpCode === 403) return false;
    throw err;
  });
}

function getShareUrl( fname ) {
  var url = Util.combine(sharesUrl,fname);
  return dropboxPOST( { url: url }, { short_url: false } ).then( function(info) {
    return (info.url || null);
  });
}

/* ----------------------------------------------
   Main entry points
---------------------------------------------- */

function createAt( folder ) {
  return login().then( function() {
    return new Dropbox(folder);
  });
}

/* ----------------------------------------------
   Remote interface
---------------------------------------------- */

function unpersist(obj) {
  return new Dropbox(obj.folder);
}

function type() {
  return "dropbox";
}

function logo() {
  return "icon-dropbox.png";
}


var Dropbox = (function() {

  function Dropbox( folder ) {
    var self = this;
    self.folder = folder || "";
  }

  Dropbox.prototype.createNewAt = function(folder) {
    return createAt(folder);
  }

  Dropbox.prototype.type = function() {
    return type();
  }

  Dropbox.prototype.logo = function() {
    return logo();
  }

  Dropbox.prototype.getFolder = function() {
    var self = this;
    return self.folder;
  }

  Dropbox.prototype.persist = function() {
    var self = this;
    return { folder: self.folder };
  }

  Dropbox.prototype.fullPath = function(fname) {
    var self = this;
    return Util.combine(self.folder,fname);
  }

  Dropbox.prototype.connect = function(dontForce) {
    return login(dontForce);
  }

  Dropbox.prototype.createSubFolder = function(dirname) {
    var self = this;
    var folder = self.fullPath(dirname);
    return createFolder(folder).then( function(created) {
      return { folder: folder, created: created };
    });
  }

  Dropbox.prototype.pushFile = function( fpath, content ) {
    var self = this;
    return pushFile( self.fullPath(fpath), content ).then( function(info) {
      return { createdTime: new Date(info.modified), rev : info.rev };
    });
  }

  Dropbox.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    return self.getRemoteTime(fpath).then( function(date) {
      if (!date) return Promise.rejected("file not found: " + fpath);
      return pullFile( self.fullPath(fpath), binary ).then( function(info) {
        var file = {
          path: fpath,
          content: info.content,
          createdTime: date,
          globalPath: info.globalPath,
          sharedPath: info.sharedPath
        };
        return file;
      });
    });
  }

  Dropbox.prototype.getRemoteTime = function( fpath ) {    
    var self = this;
    return fileInfo( self.fullPath(fpath) ).then( function(info) {
      return (info && !info.is_deleted ? new Date(info.modified) : null);
    }, function(err) {
      return null;
    });
  }

  Dropbox.prototype.listing = function( fpath ) {
    var self = this;
    return folderInfo( self.fullPath(fpath) ).then( function(info) {
      return (info ? info.contents : []).map( function(item) {
        item.type = item.is_dir ? "folder" : "file";
        item.isShared = item.is_dir && item.icon==="folder_user";
        return item;
      });
    });
  }

  Dropbox.prototype.connected = function() {
    return (_access_token != null);
  }

  Dropbox.prototype.login = function() {
    return login();
  }

  Dropbox.prototype.logout = function() {
    return logout();
  }

  Dropbox.prototype.getUserName = function() {
    var self = this;
    if (!self.connected()) return Promise.resolved(null);
    return getUserName();
  }

  Dropbox.prototype.getShareUrl = function(fname) {
    var self = this;
    return getShareUrl( self.fullPath(fname) );
  };

  return Dropbox;
})();   



return {
  createAt: createAt,
  login: login,
  logout: logout,
  unpersist: unpersist,
  type: type,
  logo: logo,
  Dropbox: Dropbox,
}

});