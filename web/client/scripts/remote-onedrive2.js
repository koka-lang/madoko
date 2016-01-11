/*---------------------------------------------------------------------------
  Copyright 2013-2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/date","../scripts/map","../scripts/util","../scripts/oauthRemote"], 
        function(Promise,StdDate,Map,Util,OAuthRemote) {


var onedrive2 = new OAuthRemote( {
  name           : "onedrive2",
  displayName    : "Onedrive",
  defaultDomain  : "https://api.onedrive.com/v1.0",
  accountUrl     : "drive",
  loginUrl       : "https://login.live.com/oauth20_authorize.srf",
  loginParams: {
    client_id    : "000000004C113E9D",
    scope        : ["wl.signin","wl.contacts_skydrive","onedrive.readwrite","wl.offline_access"],
  },
  dialogHeight   : 650,
  dialogWidth    : 800,
  logoutUrl      : "https://login.live.com/oauth20_logout.srf",
  useAuthHeader  : true,  
} );

/* ----------------------------------------------
  Rest entry points
---------------------------------------------- */
var longTimeout = 60000; // 1 minute for pull or push content

function encodeURIPath(s) {
  var p = encodeURI(s);
  return p.replace(/%2F/g,"/");
}

var _driveRoot;
function getRootPath() {
  return Promise.resolved("/drive/root:");
  /*
  if (_driveRoot) return Promise.resolved(_driveRoot);
  return onedrive2.requestGET( { url: "/drive/special/appfolder" } ).then( function(root) {
    if (!root) throw new Error("Unable to determine Madoko app-folder");
    _driveRoot = Util.combine(root.parentReference.path,root.name);
    return _driveRoot;
  });
  */
}

function makeRootPath(fname) {
  return getRootPath().then( function(root) {
    return Util.combine( root, encodeURIPath(fname));
  });
}

function fileInfo(fname) {
  return makeRootPath(fname).then( function(uri) {
    return onedrive2.requestGET( { url: uri });
  });
}

function folderInfo(fname) {
  return makeRootPath(fname).then( function(uri) {
    return onedrive2.requestGET( { url: uri }, { expand: "children" });
  });
}

function pathExists(path) {
  return folderInfo(path).then( function(info) {
    return info;
  }, function(err) {
    return null;
  });
}

function createSubFolder(path,subdir) {
  return makeRootPath(path).then( function(rootUri) {
    return onedrive2.requestPOST( { url: rootUri + ":/children" }, {}, { name: subdir, folder: {} } ).then( function(info) {
      return info;
    }, function(err) {
      if (err.httpCode === 409) return folderInfo(Util.combine(path,subdir));
      throw err;
    });
  });
}

function deleteFile(fname) {
  return makeRootPath(fname).then( function(fileUri) {
    return onedrive2.requestDELETE( {url: fileUri} );
  });
}

function ensureDir(path) {
  return pathExists(path).then( function(info) {
    if (info) return false;
    var fname = Util.combine(path,"_ignore.txt");
    return pushFile(fname," ").then( function() {
      return deleteFile(fname).then( function() {
        return true;
      });
    });
  });
}

function pushFile(fname,content) {
  return makeRootPath(fname).then( function(fileUri) {
    return onedrive2.requestPUT( { url: fileUri + ":/content", timeout: longTimeout }, {}, content ).then( function(info) {
      if (!info) throw new Error("onedrive2: could not push file: " + fname);
      return info;
    });
  });  
}

function getShareLink(fname) {
  return makeRootPath(fname).then( function(fileUri) {
    return onedrive2.requestPOST( { url: fileUri + ":/action.createLink" }, {}, { type: "view" } ).then( function(info) {
      return (info && info.link ? info.link.webUrl : null);
    });
  });  
}



/* ----------------------------------------------
  Main entry points
---------------------------------------------- */

function createAt( folder ) {
  return onedrive2.login().then( function() {
    return new Onedrive2(folder);
  });
}

function unpersist( obj ) {
  if (!obj || obj.type !== Onedrive2.prototype.type) return null;
  return new Onedrive2(obj.folder || "");
}

var Onedrive2 = (function() {

  function Onedrive2( folder ) {
    var self = this;
    self.folder = folder || "";
  }

  Onedrive2.prototype.createNewAt = function(folder) {
    return createAt(folder);
  }

  Onedrive2.prototype.type = onedrive2.name;
  Onedrive2.prototype.logo = onedrive2.logo;
  Onedrive2.prototype.displayName = onedrive2.displayName;
  Onedrive2.prototype.displayType = "onedrive";
  Onedrive2.prototype.title    = "Onedrive & Office 365 cloud storage. Note: does not allow access to files that are shared with you by others."
  Onedrive2.prototype.readonly = false;
  Onedrive2.prototype.canSync  = true;
  Onedrive2.prototype.needSignin = true;
  
  Onedrive2.prototype.getFolder = function() {
    var self = this;
    return self.folder;
  }

  Onedrive2.prototype.getDisplayFolder = function() {
    var self = this;
    return self.getFolder();
  }

  Onedrive2.prototype.persist = function() {
    var self = this;
    return { type: self.type, folder: self.folder };
  }
  
  Onedrive2.prototype.fullPath = function(fname) {
    var self = this;
    return Util.normalize(Util.combine(self.folder,fname));
  }

  Onedrive2.prototype.connect = function() {
    return onedrive2.connect();
  }

  Onedrive2.prototype.login = function() {
    return onedrive2.login();
  }

  Onedrive2.prototype.logout = function(force) {
    return onedrive2.logout(force);
  }

  Onedrive2.prototype.getUserName = function() {
    return onedrive2.getUserName();
  }


  Onedrive2.prototype.pushFile = function( fpath, content ) {
    var self = this;
    return pushFile( self.fullPath(fpath), content ).then( function(info) {
      return { 
        path: fpath,
        createdTime: StdDate.dateFromISO(info.lastModifiedDateTime),
      };
    });
  }

  Onedrive2.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    return fileInfo( self.fullPath(fpath) ).then( function(info) {
      var date = (info && !info.deleted ? StdDate.dateFromISO(info.lastModifiedDateTime) : null);
      var url = info["@content.downloadUrl"];
      if (!date || !url) return Promise.rejected("file not found: " + fpath);
      return Util.requestGET(url, { binary: binary}).then( function(content) {
        var file = {
          path: fpath,
          content: content,
          createdTime: date
        };
        return file;
      });
    });
  }

  Onedrive2.prototype.getMetaData = function( fpath ) {    
    var self = this;
    return fileInfo( self.fullPath(fpath) ).then( function(info) {
      return (info ? { modifiedTime: StdDate.dateFromISO(info.lastModifiedDateTime), deleted : info.deleted } : null);
    }, function(err) {
      if (err && err.httpCode===404) return null;
      throw err;
    });
  }

  Onedrive2.prototype.createSubFolder = function(dirname) {
    var self = this;
    var folder = self.fullPath(dirname);
    return ensureDir( self.fullPath(folder) ).then( function(created) {
      return {folder: folder, created : (created ? true : false) };
    });
  }

  Onedrive2.prototype.listing = function( fpath ) {
    var self = this;
    return folderInfo( self.fullPath(fpath) ).then( function(info) {
      return (info ? info.children : []).map( function(item) {
        item.path = self.fullPath(Util.combine(fpath, item.name));
        item.type = item.folder ? "folder" : "file";
        item.isShared = (item.shared != null);
        return item;
      });
    });
  }

  Onedrive2.prototype.getShareUrl = function(fname) {
    var self = this;
    return getShareLink( self.fullPath(fname) );
  }

  Onedrive2.prototype.getInviteUrl = function() {
    return null;
  };


  return Onedrive2;
})();   



return {
  createAt  : createAt,
  unpersist : unpersist,
  Onedrive2  : Onedrive2,
}

});