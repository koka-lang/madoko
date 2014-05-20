/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], function(Promise,Util) {

var appKey      = "3vj9witefc2z44w";
var root        = "dropbox";
var redirectUri = "https://madoko.cloudapp.net/redirect/" + root + "/";
var contentUrl  = "https://api-content.dropbox.com/1/files/" + root + "/";
var pushUrl     = "https://api-content.dropbox.com/1/files_put/" + root + "/";
var metadataUrl = "https://api.dropbox.com/1/metadata/" + root + "/";
var fileopsUrl  = "https://api.dropbox.com/1/fileops/";
var appRoot     = "";

var _access_token = null;

function getAccessToken() {
  if (!_access_token) {
    _access_token = Util.getCookie("auth_dropbox");
  }
  return _access_token;
}

function login() {
  if (getAccessToken()) return Promise.resolved();

  var url = "https://www.dropbox.com/1/oauth2/authorize?response_type=token&client_id=" + appKey + "&redirect_uri=" + redirectUri;
  var w = window.open(url);
  return new Promise( function(cont) {
    var timer = setInterval(function() {   
      if(w.closed) {  
        clearInterval(timer);  
        if (getAccessToken()) {
          cont(null);
        }
        else {
          cont(new Error("dropbox login failed"));
        }
      }  
    }, 100); 
  });
}

function logout() {
  document.cookie = "auth_dropbox=;secure;path=/;max-age=-1";
  _access_token = null;
}

function chooseOneFile() {
  return new Promise( function(cont) {
    window.Dropbox.choose( {
      success: function(files) {
        if (!files || !files.length || files.length !== 1) cont(new Error("Can only select a single file to open"));    
        cont(null, files[0] );
      },
      cancel: function() {
        cont( new Error("dropbox dialog was canceled") );
      },
      linkType: "direct",
      multiselect: false,
      extensions: [".mdk",".md",".mkdn"],
    });
  });
}

function chooseFile() {
  return chooseOneFile().then( function(file) {
    var cap = new RegExp("^https://" + ".*?/view/[^\\/]+/" + appRoot + "(.*)$").exec(file.link);
    if (!cap) cont(new Error("Can only select files in the " + appRoot + " folder"));
    console.log(file);
    return cap[1];
  });
}

function pullFile(fname) {
  var url = contentUrl + fname;
  return Util.requestGET( url, { access_token: getAccessToken() });
}

function fileInfo(fname) {
  var url = metadataUrl + fname;
  return Util.requestGET( url, { access_token: getAccessToken() }).then( function(info) {
    return (typeof info === "string" ? JSON.parse(info) : info);
  });
}

function pushFile(fname,content) {
  var url = pushUrl + fname;
  return Util.requestPOST( url, { access_token: getAccessToken() }, content ).then( function(info) {
    if (!info) throw new Error("dropbox: could not push file: " + fname);
    return (typeof info === "string" ? JSON.parse(info) : info);
  }, function(err) {
    console.log(err);
  });
}

function createFolder( dirname ) {
  var url = fileopsUrl + "create_folder";
  return Util.requestPOST( url, { 
    access_token: getAccessToken(),
    root: root, 
    path: dirname,
  }).then( function(info) {
    return dirname;
  }, function(err) {
    if (err.httpCode === 403) return null;
    throw err;
  });
}


function openFile() {
  return login().then( function() {
    return chooseFile();
  }).then( function(fname) {
    return { dropbox: new Dropbox(Util.dirname(fname)), docName: Util.basename(fname) };
  });
}

function unpersist(obj) {
  return new Dropbox(obj.folder);
}

function type() {
  return "dropbox";
}

var Dropbox = (function() {

  function Dropbox( folder ) {
    var self = this;
    self.folder = folder;
  }

  Dropbox.prototype.createNewAt = function(folder) {
    return new Dropbox(folder);
  }

  Dropbox.prototype.type = function() {
    return type();
  }

  Dropbox.prototype.logo = function() {
    return "icon-dropbox.png";
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

  Dropbox.prototype.getWriteAccess = function() {
    return login();
  }

  Dropbox.prototype.createSubFolder = function(dirname) {
    var self = this;
    return createFolder(self.fullPath(dirname));
  }

  Dropbox.prototype.pushFile = function( file, content ) {
    var self = this;
    return pushFile( self.fullPath(file.path), content ).then( function(info) {
      return new Date(info.modified);
    })
  }

  Dropbox.prototype.pullFile = function( fpath ) {
    var self = this;
    return self.getRemoteTime(fpath).then( function(date) {
      if (!date) return Promise.rejected("file not found: " + fpath);
      return pullFile( self.fullPath(fpath) ).then( function(_content,req) {
        var file = {
          path: fpath,
          content: req.responseText,
          createdTime: date,
        };
        return file;
      });
    });
  }

  Dropbox.prototype.getRemoteTime = function( fpath ) {    
    var self = this;
    return fileInfo( self.fullPath(fpath) ).then( function(info) {
      return (info ? new Date(info.modified) : null);
    }, function(err) {
      return null;
    });
  }

  return Dropbox;
})();   



return {
  openFile: openFile,
  login: login,
  logout: logout,
  unpersist: unpersist,
  type: type,
  Dropbox: Dropbox,
}

});