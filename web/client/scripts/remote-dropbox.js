/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.

  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util","../scripts/date","../scripts/oauthRemote"],
        function(Promise,Util,StdDate,OAuthRemote) {

var dropbox = new OAuthRemote( {
  name         : "dropbox",
  defaultDomain: "https://api.dropboxapi.com/2/",
  revokeUrl    : "https://api.dropboxapi.com/2/auth/token/revoke",
  loginUrl     : "https://www.dropbox.com/oauth2/authorize",
  loginParams  : {
    client_id: "3vj9witefc2z44w",
  },
  logoutUrl    : "https://www.dropbox.com/logout",
  logoutTimeout: 500,
});


/* ----------------------------------------------
  Basic file API
---------------------------------------------- */
var longTimeout     = 60000; // 1 minute for pull or push content
var filelistUrl     = "files/list_folder";
var metadataUrl     = "files/get_metadata";
var sharedFoldersUrl= "sharing/get_folder_metadata";
var createFolderUrl = "files/create_folder_v2";
var contentUrl      = "https://content.dropboxapi.com/2/";
var pullUrl         = contentUrl + "files/download";
var pushUrl         = contentUrl + "files/upload";
var sharesUrl       = contentUrl + "sharing/create_shared_link_with_settings";

function encodeURIPath(s) {
  var p = encodeURI(s);
  return p.replace(/%2F/g,"/");
}

function dropboxPath(fname) {
  var f = Util.normalize(fname);
  return (f ? "/" + f : "");
}

function addPathInfo(info) {
  return dropbox.withUserId( function(uid) {
    info.globalPath = "//dropbox/unshared/" + uid + info.path;
    if (!info.sharing_info || !info.sharing_info.parent_shared_folder_id) return info;
    // shared
    return sharedFolderInfo(info.sharing_info.parent_shared_folder_id).then( function(sinfo) {  // this is cached
      if (sinfo) {
        var subpath = (Util.startsWith(info.path,sinfo.path_lower + "/") ? info.path.substr(sinfo.path_lower.length+1) : info.path);
        var shared = (Util.startsWith(sinfo.path_lower, "/") ? sinfo.path_lower.substr(1) : sinfo.path_lower);
        info.sharedPath = "//dropbox/shared/" + sinfo.shared_folder_id + "/" + shared + "/" + subpath;
        info.globalPath = info.sharedPath; // use the shared path
      }
      return info;
    }, function(err) {
      Util.message( new Error("dropbox: could not get shared info: " + (err.message || err)), Util.Msg.Error );
      return info;
    });
  });
}

function pullFile(fname,binary) {
  var opts = { 
    url: pullUrl, 
    timeout: longTimeout, 
    binary: binary,
    headers: { "Dropbox-API-Arg": { path: dropboxPath(fname) } },
    contentType: "text/plain"
  };
  return dropbox.requestGET( opts ).then( function(content,req) {
    var infoHdr = req.getResponseHeader("Dropbox-API-Result");
    var info = (infoHdr ? JSON.parse(infoHdr) : { path: fname });
    info.content = content;
    return addPathInfo(info);
  }, function(err) {
    if (err && err.httpCode === 409) return null;
    throw err;
  });
}

function fileInfo(fname) {
  return dropbox.requestPOST( { url: metadataUrl }, null, { path: dropboxPath(fname), include_deleted: true } );
}

function sharedFolderInfo(id) {
  var url = sharedFoldersUrl;
  var body = { shared_folder_id: id, actions: [] };
  return dropbox.requestPOST( { url: url, cache: -60000 }, null, body );  // cached, retry after 60 seconds;
}

function folderInfo(fname) {
  var url = filelistUrl
  return dropbox.requestPOST( { url: url }, null, { path: (fname ? "/" + fname : "") });
}

function pushFile(fname,content,binary) {
  var opts = {
    url: pushUrl,
    timeout: longTimeout,
    headers: { "Dropbox-API-Arg": {
      path: dropboxPath(fname),
      mode: { ".tag": "overwrite" }
    }},
    contentType: (binary ? "application/octet-stream" : "text/plain; charset=dropbox-cors-hack")
  }
  return dropbox.requestPOST( opts, null, content ).then( function(info) {
    if (!info) throw new Error("dropbox: could not push file: " + fname);
    return addPathInfo(info);
  });
}

function createFolder( dirname ) {
  return dropbox.requestPOST( createFolderUrl, null, { path: dropboxPath(dirname) }).then( function(info) {
    return true; // freshly created
  }, function(err) {
    if (err && err.httpCode === 403) return false;
    throw err;
  });
}

function getShareUrl( fname ) {
  var now = new Date();
  var oneweekLater = now.setDate( now.getDate() + 7 ); // handles overflow
  var settings = {
    path: dropboxPath(fname),
    settings: {
      requested_visibility: "public",
      expires: oneweekLater.toISOString()
    }
  }
  return dropbox.requestPOST( { url: sharesUrl }, null, settings ).then( function(info) {
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
  return dropbox.login().then( function() {
    return new Dropbox(folder);
  });
}

function unpersist(obj) {
  if (!obj || obj.type !== dropbox.name) return null;
  return new Dropbox(obj.folder);
}


/* ----------------------------------------------
   Dropbox remote object
---------------------------------------------- */

var Dropbox = (function() {

  function Dropbox( folder ) {
    var self = this;
    self.folder = folder || "";
  }

  Dropbox.prototype.createNewAt = function(folder) {
    return createAt(folder);
  }

  Dropbox.prototype.type        = dropbox.name;
  Dropbox.prototype.logo        = dropbox.logo;
  Dropbox.prototype.displayName = dropbox.displayName;
  Dropbox.prototype.title     = "Dropbox cloud storage. Offers full functionality including collaborative editing."
  Dropbox.prototype.readonly  = false;
  Dropbox.prototype.canSync   = true;
  Dropbox.prototype.needSignin = true;

  Dropbox.prototype.getFolder = function() {
    var self = this;
    return self.folder;
  }

  Dropbox.prototype.getDisplayFolder = function() {
    var self = this;
    return self.getFolder();
  }

  Dropbox.prototype.persist = function() {
    var self = this;
    return { type: self.type, folder: self.folder };
  }

  Dropbox.prototype.fullPath = function(fname) {
    var self = this;
    return Util.normalize(Util.combine(self.folder,fname));
  }

  Dropbox.prototype.connect = function() {
    return dropbox.connect();
  }

  Dropbox.prototype.login = function() {
    return dropbox.login();
  }

  Dropbox.prototype.logout = function(force) {
    return dropbox.logout(force);
  }

  Dropbox.prototype.getUserName = function() {
    return dropbox.getUserName();
  }

  Dropbox.prototype.pushFile = function( fpath, content ) {
    var self = this;
    var binary = (content instanceof ArrayBuffer || content.buffer instanceof ArrayBuffer);
    return pushFile( self.fullPath(fpath), content, binary ).then( function(info) {
      return {
        path: info.path_display,
        createdTime: StdDate.dateFromISO(info.server_modified),
        globalPath: info.globalPath,
        sharedPath: info.sharedPath,
        rev: info.rev,
      };
    });
  }

  Dropbox.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    // return self.getMetaData(fpath).then( function(meta) { // TODO: can we make this one request?
    //  if (!meta || meta.deleted) return Promise.rejected("file not found: " + fpath);
    return pullFile( self.fullPath(fpath), binary ).then( function(info) {
      if (!info) return Promise.rejected("file not found: " + fpath );
      var file = {
        path: fpath,
        content: info.content,
        createdTime: StdDate.dateFromISO(info.server_modified), //meta.modifiedTime,
        globalPath: info.globalPath,
        sharedPath: info.sharedPath
      };
      return file;
    });
    //});
  }

  Dropbox.prototype.getMetaData = function( fpath ) {
    var self = this;
    return fileInfo( self.fullPath(fpath) ).then( function(info) {
      if (!info) return null; 
      return { 
        modifiedTime: StdDate.dateFromISO(info.server_modified), 
        deleted: (info[".tag"]==="deleted") 
      };
    }, function(err) {
      if (err && (err.httpCode===404 || err.httpCode===409)) return null;
      throw err;
    });
  }

  Dropbox.prototype.createSubFolder = function(dirname) {
    var self = this;
    var folder = self.fullPath(dirname);
    return createFolder(folder).then( function(created) {
      return { folder: folder, created: created };
    });
  }

  Dropbox.prototype.listing = function( fpath ) {
    var self = this;
    return folderInfo( self.fullPath(fpath) ).then( function(info) {
      return (info ? info.entries : []).map( function(item) {
        item.type = item[".tag"] || "file";
        item.path = Util.normalize(item.path_display || item.path_lower || "");
        item.isShared = (item.sharing_info || item.shared_folder || item.parent_shared_folder_id ? true : false);
        return item;
      });
    });
  }

  Dropbox.prototype.getShareUrl = function(fname) {
    var self = this;
    return getShareUrl( self.fullPath(fname) );
  };

  Dropbox.prototype.getInviteUrl = function() {
    var self = this;
    return Util.combine("https://www.dropbox.com/home", self.folder + "?share=1");
  };

  return Dropbox;
})();



return {
  createAt : createAt,
  unpersist: unpersist,
  Dropbox  : Dropbox,
}

});
