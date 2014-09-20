/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], function(Promise,Util) {



var Remote = (function() {

  function Remote(opts) {
    var self = this;
    
    self.name           = opts.name;
    self.client_id      = opts.client_id;
    self.redirect_uri   = opts.redirect_uri;
    self.response_type  = opts.response_type || "code";
    self.authorizeUrl   = opts.authorizeUrl;
    self.accountUrl     = opts.accountUrl;
    self.useAuthHeader  = opts.useAuthHeader || true;
    self.access_token   = null;
    self.userName = null;
    self.userId = null;
  }

  Remote.prototype._withAccessToken = function(action) {
    var self = this;
    if (self.access_token) return Promise.wrap(action(self.access_token));
    if (self.access_token === false) return Promise.rejected("Not logged in");
    return Util.requestGET("/oauth/token",{ remote: self.name } ).then( function(access_token) {
      self.access_token = access_token;
      return action(self.access_token);
    }, function(err) {
      self.access_token = false; // remember we tried
      throw err;
    });
  }

  Remote.prototype._requestXHR = function( options, params, body ) {
    var self = this;
    return self._withAccessToken( function(token) {
      if (options.useAuthHeader !== false && self.useAuthHeader) {
        if (!options.headers) options.headers = {};
        options.headers.Authorization = "Bearer " + token;
      }  
      else {
        if (!params) params = {};
        params.access_token = token;
      }
      return Util.requestXHR( options, params, body ).then( null, function(err) {
        if (err && err.httpCode === 401) { // access token expired 
          self.logout();
        }
        throw err;
      });
    });
  }

  Remote.prototype.requestPOST = function( options, params, content ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    options.method = "POST";
    return self._requestXHR(options,params,content);
  }

  Remote.prototype.requestPUT = function( options, params, content ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    options.method = "PUT";
    return self._requestXHR(options,params,content);
  }

  Remote.prototype.requestGET = function( options, params ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    options.method = "GET";
    return self._requestXHR(options,params);
  }

  Remote.prototype.logout = function() {
    var self = this;
    var token = self.access_token;
    self.access_token = false;
    self.userId = null;
    self.userName = null;

    if (token) {
      // invalidate the access_token
      return Util.requestPOST( {url: "/oauth/logout"}, { remote: "dropbox" } );
    }
    else {
      return Promise.resolved();
    }
  }

  Remote.prototype._tryLogin = function(action) {
    var self = this;
    if (self.access_token) return Promise.wrap(action(true));
    if (self.access_token===false) return Promise.wrap(action(false));
    return self._withAccessToken( function() { return true; }).then( function() {
      return action(true);
    }, function(err) {
      return action(false);
    });
  }

  Remote.prototype.login = function(dontForce) {
    var self = this;
    return self._tryLogin( function(ok) {
      if (ok) return;
      if (dontForce) return Promise.rejected( new Error("Not logged in to " + self.name) );
      var params = { 
        response_type: self.response_type, 
        client_id    : self.client_id, 
        redirect_uri : self.redirect_uri,
      };
      return Util.openOAuthLogin(self.name,self.authorizeUrl,params,600,600).then( function() {
        self.access_token = null; // reset from 'false'
        return self._withAccessToken( function() { return; } ); // and get the token
      });
    });
  }

  Remote.prototype.withUserId = function(action) {
    var self = this;
    if (self.userId) return Promise.wrap(action(self.userId));
    return self.getUserInfo().then( function(info) {
      return action(self.userId);
    });
  }

  Remote.prototype.getUserName = function() {
    var self = this;
    if (self.userName) return Promise.resolved(self.userName);
    return self.getUserInfo().then( function(info) {
      return self.userName;
    });
  }

  Remote.prototype.getUserInfo = function() {
    var self = this;
    return self.requestGET( { url: self.accountUrl } ).then( function(info) {
      self.userId = info.uid || info.id || info.userId || info.user_id || null;
      self.userName = info.display_name || info.name || null;
      return info;
    });
  }

  Remote.prototype.haveToken = function() {
    var self = this;
    return (self.access_token ? true : false);
  }

  Remote.prototype.checkConnected = function() {
    return self.getUserInfo().then( function(info) { return true; }, function(err) { return false; });    
  } 

  return Remote;
})();

var dropbox = new Remote( {
  name         : "dropbox",
  client_id    : "3vj9witefc2z44w",
  redirect_uri : "https://madoko.cloudapp.net/redirect/dropbox",
  response_type: "code",
  accountUrl   : "https://api.dropbox.com/1/account/info",
  authorizeUrl : "https://www.dropbox.com/1/oauth2/authorize",
  useAuthHeader: true,
} );


/* ----------------------------------------------
  Basic file API
---------------------------------------------- */


var root        = "dropbox";
var contentUrl  = "https://api-content.dropbox.com/1/files/" + root + "/";
var pushUrl     = "https://api-content.dropbox.com/1/files_put/" + root + "/";
var metadataUrl = "https://api.dropbox.com/1/metadata/" + root + "/";
var fileopsUrl  = "https://api.dropbox.com/1/fileops/";
var sharesUrl   = "https://api.dropbox.com/1/shares/" + root + "/";
var sharedFoldersUrl = "https://api.dropbox.com/1/shared_folders/";


function pullFile(fname,binary) {
  var opts = { url: contentUrl + fname, binary: binary };
  return dropbox.requestGET( opts ).then( function(content,req) {
    var infoHdr = req.getResponseHeader("x-dropbox-metadata");
    var info = (infoHdr ? JSON.parse(infoHdr) : { path: fname });
    info.content = content;
    return dropbox.withUserId( function(uid) {
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
  return dropbox.requestGET( { url: metadataUrl + fname, timeout: 2500 } );
}

function sharedFolderInfo(id) {
  var url = sharedFoldersUrl + id;
  // TODO: pass access_token as a header; for now this does not work on dropbox due to a CORS bug.
  return dropbox.requestGET( { url: url, timeout: 2500, cache: -60000, useAuthHeader: false } );  // cached, retry after 60 seconds;
}

function folderInfo(fname) {
  var url = metadataUrl + fname;
  return dropbox.requestGET( { url: url, timeout: 2500 }, { list: true });
}

function pushFile(fname,content) {
  var url = pushUrl + fname;
  return dropbox.requestPOST( { url: url }, {}, content ).then( function(info) {
    if (!info) throw new Error("dropbox: could not push file: " + fname);
    return info;
  });
}

function createFolder( dirname ) {
  var url = fileopsUrl + "create_folder";
  return dropbox.requestPOST( url, { root: root, path: dirname }).then( function(info) {
    return true; // freshly created
  }, function(err) {
    if (err.httpCode === 403) return false;
    throw err;
  });
}

function getShareUrl( fname ) {
  var url = Util.combine(sharesUrl,fname);
  return dropbox.requestPOST( { url: url }, { short_url: false } ).then( function(info) {
    return (info.url || null);
  });
}

/* ----------------------------------------------
   Main entry points
---------------------------------------------- */

function createAt( folder ) {
  return dropbox.login().then( function() {
    return new Dropbox(folder);
  });
}

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
    return dropbox.login(dontForce);
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
    return dropbox.haveToken();
  }

  Dropbox.prototype.login = function() {
    return dropbox.login();
  }

  Dropbox.prototype.logout = function() {
    return dropbox.logout();
  }

  Dropbox.prototype.getUserName = function() {
    return dropbox.getUserName();
  }

  Dropbox.prototype.getShareUrl = function(fname) {
    var self = this;
    return getShareUrl( self.fullPath(fname) );
  };

  return Dropbox;
})();   



return {
  createAt: createAt,
  unpersist: unpersist,
  type: type,
  logo: logo,
  Dropbox: Dropbox,
}

});