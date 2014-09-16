/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], function(Promise,Util) {

var appKey      = "3vj9witefc2z44w";
var root        = "dropbox";
var redirectUri = "https://www.madoko.net/redirect/dropbox";
//var redirectUri = "https://madoko.cloudapp.net/redirect/dropbox";
var contentUrl  = "https://api-content.dropbox.com/1/files/" + root + "/";
var pushUrl     = "https://api-content.dropbox.com/1/files_put/" + root + "/";
var metadataUrl = "https://api.dropbox.com/1/metadata/" + root + "/";
var fileopsUrl  = "https://api.dropbox.com/1/fileops/";
var accountUrl  = "https://api.dropbox.com/1/account/";
var sharesUrl   = "https://api.dropbox.com/1/shares/" + root + "/";
var sharedFoldersUrl   = "https://api.dropbox.com/1/shared_folders/";

var appRoot     = "";

var _access_token = null;
var _username = "";
var _userid = "";

function getAccessToken() {
  if (!_access_token) {
    var cookie = Util.getCookie("auth_dropbox");
    if (cookie && typeof(cookie) === "string") {
      var info = (cookie[0]==="{" ? JSON.parse(cookie) : { access_token: cookie } );
      _access_token = info.access_token;
      if (info.uid) _userid = info.uid;
    }
  }
  return _access_token;
}

/* ----------------------------------------------
   Login 
---------------------------------------------- */

function login(dontForce) {
  if (getAccessToken()) return Promise.resolved();
  if (dontForce) return Promise.rejected( new Error("dropbox: not logged in") );
  var url = "https://www.dropbox.com/1/oauth2/authorize"
  var params = { 
    response_type: "token", 
    client_id: appKey, 
    redirect_uri:  redirectUri,
    state: Util.generateOAuthState(),
  };
  return Util.openModalPopup(url,params,"oauth",600,600).then( function() {
    if (!getAccessToken()) throw new Error("dropbox login failed");
    return getUserName();
  });
}

function withUserId(action) {
  if (_userid) return action(_userid);
  return getUserInfo().then( function() {
    return action(_userid);
  });
}

function getUserName() {
  if (_username) return Promise.resolved(_username);
  return getUserInfo().then( function() {
    return _username;
  });
}

function getUserInfo() {
  if (_username && _userinfo) return Promise.resolved();
  return Util.requestGET( accountUrl + "info", { access_token: getAccessToken() } ).then( function(info) {
    if (info) {
      _username = info.display_name;
      _userid = info.uid;
    }
    return;
  });
}

function logout() {
  Util.setCookie("auth_dropbox","",0);
  _access_token = null;
  _username = "";
  _userid = "";
}

function chooseOneFile() {
  return new Promise( function(cont) {
    window.Dropbox.choose( {
      success: function(files) {
        if (!files || !files.length || files.length !== 1) cont(new Error("Can only select a single file to open"));    
        cont(null, files[0].link );
      },
      cancel: function() {
        cont( new Error("dropbox dialog was canceled") );
      },
      linkType: "direct",
      multiselect: false,
      extensions: [".mdk",".md",".mkdn",".markdown"],
    });
  });
}

function loginAndChooseOneFile() {
  Util.setCookie("dropbox-next","choose",60);
  return login().then( function() {
    Util.setCookie("dropbox-next","",0);  
    var err  = Util.getCookie("dropbox-error");
    if (err) {
      throw new Error( decodeURIComponent(err) );
    }
    var link = Util.getCookie("dropbox-choose");
    if (!link) {
      throw new Error( "dropbox: could not read file selection -- try again" );
    }
    return decodeURIComponent(link);
  });
}

/* ----------------------------------------------
  Basic file API
---------------------------------------------- */

function pullFile(fname,binary) {
  var opts = { url: contentUrl + fname, binary: binary };
  return Util.requestGET( opts, { access_token: getAccessToken() }).then( function(content,req) {
    var infoHdr = req.getResponseHeader("x-dropbox-metadata");
    var info = (infoHdr ? JSON.parse(infoHdr) : { });
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
  return Util.requestGET( { url: url, timeout: 2500 }, { access_token: getAccessToken() });
}

function sharedFolderInfo(id) {
  var url = sharedFoldersUrl + id;
  return Util.requestGET( { url: url, timeout: 2500, cache: -10000 }, { access_token: getAccessToken() });  // cached, retry after 10 seconds
}

function folderInfo(fname) {
  var url = metadataUrl + fname;
  return Util.requestGET( { url: url, timeout: 2500 }, { access_token: getAccessToken(), list: true });
}

function pushFile(fname,content) {
  var url = pushUrl + fname;
  return Util.requestPOST( url, { access_token: getAccessToken() }, content ).then( function(info) {
    if (!info) throw new Error("dropbox: could not push file: " + fname);
    return info;
  });
  //, function(err) {
  //  throw new Error("dropbox: could not push file: " + fname + ": " + err.toString());
  //});
}

function createFolder( dirname ) {
  var url = fileopsUrl + "create_folder";
  return Util.requestPOST( url, { 
    access_token: getAccessToken(),
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
  return Util.requestPOST( url, { access_token: getAccessToken(), short_url: false } ).then( function(info) {
    return (info.url || null);
  });
}

/* ----------------------------------------------
   Main entry points
---------------------------------------------- */

function openFile() {
  // carefully login so we avoid popup blockers but can still use dropbox's file picker
  var choose = (getAccessToken() ? chooseOneFile : loginAndChooseOneFile);
  return choose().then( function(fileLink) {
    var cap = new RegExp("^https://" + ".*?/view/[^\\/]+/" + appRoot + "(.*)$").exec(fileLink);
    if (!cap) throw (new Error("Can only select files in the " + appRoot + " folder"));
    return cap[1];
  }).then( function(fname) {
    return { remote: new Dropbox(Util.dirname(fname)), docName: Util.basename(fname) };
  });
}

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
    return (getAccessToken() != null);
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
  openFile: openFile,
  createAt: createAt,
  login: login,
  logout: logout,
  unpersist: unpersist,
  type: type,
  logo: logo,
  Dropbox: Dropbox,
}

});