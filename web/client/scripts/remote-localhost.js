/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util","../scripts/oauthRemote"], 
        function(Promise,Util,OAuthRemote) {

var localhost = new OAuthRemote( {
  name         : "localhost",
  defaultDomain: "https://localhost:8081",
  accountUrl   : "/rest/account/info",
  loginUrl     : "/oauth/authorize",
  logoutUrl    : "/oauth/logout",
  logoutTimeout: 500,
  logo         : "icon-disk.png",
  loginParams  : {
    origin: location.protocol + "//" + location.hostname + (location.port ? ':' + location.port : "")
  }
});


/* ----------------------------------------------
  Basic file API
---------------------------------------------- */
var longTimeout = 30000; // 1 minute for pull or push content

var resturl     = "/rest";
var contentUrl  = resturl + "/files/";
var pushUrl     = resturl + "/files_put/";
var metadataUrl = resturl + "/metadata/";
var fileopsUrl  = resturl + "/fileops/";

function encodeURIPath(s) {
  var p = escape(s);
  return p.replace(/%2F/g,"/");
}

function pullFile(fname,binary) {
  var opts = { url: contentUrl + encodeURIPath(fname), timeout: longTimeout, binary: binary };
  return localhost.requestGET( opts ).then( function(content,req) {
    var infoHdr = req.getResponseHeader("x-localhost-metadata");
    var info = (infoHdr ? JSON.parse(infoHdr) : { path: fname });
    info.content = content;
    return addPathInfo(info);
  });
}

function fileInfo(fname) {
  return localhost.requestGET( { url: metadataUrl + encodeURIPath(fname) } );
}

function sharedFolderInfo(id) {
  var url = sharedFoldersUrl + encodeURIPath(id);
  return localhost.requestGET( { url: url, cache: -60000, contentType: null } );  // cached, retry after 60 seconds;
}

function folderInfo(fname) {
  var url = metadataUrl + encodeURIPath(fname);
  return localhost.requestGET( { url: url }, { list: true });
}

function pushFile(fname,content) {
  var url = pushUrl + encodeURIPath(fname); 
  return localhost.requestPUT( { url: url, timeout: longTimeout }, {}, content ).then( function(info) {
    if (!info) throw new Error("localhost: could not push file: " + fname);
    return addPathInfo(info);
  });  
}

function createFolder( dirname ) {
  var url = fileopsUrl + "create_folder";
  return localhost.requestPOST( url, { root: root, path: dirname }).then( function(info) {
    return true; // freshly created
  }, function(err) {
    if (err && err.httpCode === 403) return false;
    throw err;
  });
}

function getShareUrl( fname ) {
  var url = sharesUrl + encodeURIPath(fname);
  return localhost.requestPOST( { url: url }, { short_url: false } ).then( function(info) {
    if (!info.url) return null;
    var share = info.url;
    // if (Util.extname(fname) === ".html") share = share.replace(/\bdl=0\b/,"dl=1");
    return share;
  }, function(err) {
    Util.message( err, Util.Msg.Trace );
    return null;
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
  return localhost.name;
}

function logo() {
  return localhost.logo;
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

  Localhost.prototype.logo = function() {
    return logo();
  }

  Localhost.prototype.readonly = false;
  Localhost.prototype.canSync  = true;
  Localhost.prototype.needSignin = true;

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
        createdTime: new Date(info.modified),
        globalPath: info.globalPath,
        sharedPath: info.sharedPath,
        rev: info.rev,
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
          globalPath: info.globalPath,
          sharedPath: info.sharedPath
        };
        return file;
      });
    });
  }

  Localhost.prototype.getRemoteTime = function( fpath ) {    
    var self = this;
    return fileInfo( self.fullPath(fpath) ).then( function(info) {
      return (info && !info.is_deleted ? new Date(info.modified) : null);
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
        item.isShared = (item.shared_folder || item.parent_shared_folder_id ? true : false);
        return item;
      });
    });
  }

  Localhost.prototype.getShareUrl = function(fname) {
    var self = this;
    return getShareUrl( self.fullPath(fname) );
  };

  Localhost.prototype.getInviteUrl = function() {
    var self = this;
    return Util.combine("https://www.localhost.com/home", self.folder + "?share=1");
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