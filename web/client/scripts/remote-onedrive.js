/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], function(Promise,Util) {

var onedriveOptions = {
  client_id     : "000000004C113E9D",
  redirect_uri  : "https://www.madoko.net/redirect/live", 
  scope         : ["wl.signin","wl.skydrive","wl.skydrive_update"],
  response_type : "token",
  secure_cookie : true,
};

var onedriveUrl = "https://apis.live.net/v5.0/";


/* Helpers */

function makeError( obj, premsg ) {
  var msg = "onedrive: " + (premsg ? premsg + ": " : "")
  if (obj && obj.error) {
    var err = obj.error.message || obj.error.toString();
    err = err.replace(/^WL\..*:\s*/,"").replace(/^.*?Detail:\s*/,"");
    if (Util.startsWith(err,"Cannot read property 'focus'")) err = "Cannot open dialog box. Enable pop-ups?";
    msg = msg + err; // + (obj.error.code ? " (" + obj.error.code + ")" : "");
  }
  else if (obj && typeof obj === "string") {
    msg = msg + obj;
  }
  else {
    msg = msg + "unknown error";
  }
  return msg;
}

function makePromise( call, premsg ) {
  return new Promise(call).then( 
    function(res) {
      return res;
    },
    function(err) {
      throw makeError(err,premsg);
    }
  );
}


/* Id's, paths, and sub-directories are quite a hassle :-( */

function onedriveGet( path ) {
  return Util.requestGET( onedriveDomain + path, { access_token: getAccessToken() } );
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
  return onedriveGet( "me/skydrive" );
}

function _infoFromName( folderId, name ) {
  return onedriveGet( folderId + "/files").then( function(res) {
    var file = null;
    if (res.data) {
      for (var i = 0; i < res.data.length; i++) {
        var f = res.data[i];
        if (f.name == name) {
          file = f;
          break;
        }
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

function infoFromSubPath( info, path ) {
  if (!path) return Promise.resolved(info);
  return infoFromSubDirs( info, path.split("/") );
}

function infoFromPath( path ) {
  return rootInfo().then( function( info ) {
    return infoFromSubPath( info, path );
  });
}

function _ensureSubDirs( folderId, dirs, recurse ) {
  if (dirs.length === 0) return folderId;
  var dir = dirs.shift();
  return _infoFromName( folderId, dir ).then( function(dirInfo) {
    if (dirInfo) return _ensureSubDirs( dirInfo.id, dirs );
    var url = onedriveDomain + folderId.toString();
    return Util.requestPOST( url, { access_token: getAccessToken() }, { 
      name: dir, 
      description: "" 
    }).then( function(newInfo) {
      var id = newInfo.id;
      id.created = true;  // remember we created it for createSubFolder call.
      return _ensureDirs( newInfo.id, dirs );
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

function ensureSubPath( folderId, path ) {
  if (!path) return Promise.resolved(folderId);
  return _ensureSubDirs( folderId, path.split("/"));
}

function ensurePath( path ) {
  return rootInfo().then( function(info) {
    return ensureSubPath( info.id, path );
  });
}


/* Login */

var _access_token = null;
function getAccessToken() {
  if (!_access_token && typeof WL !== "undefined" && WL) {
    try {
      var session = WL.getSession();
      if (session && session.access_token) {
        _access_token = session.access_token;
      }
    }
    catch(exn) { 
      console.log(exn);
    };
  }
  return _access_token;
}

function login() {
  if (getAccessToken()) return Promise.resolved();
  return makePromise(WL.init(onedriveOptions)).then( function() {
    getAccessToken();
    WL.Event.subscribe("auth.sessionChange", function(ev) {
      _access_token = null;
    });
    WL.Event.subscribe("auth.logout", function(ev) {
      _access_token = null;
    });
    return;
  });
}

function logout() {
  WL.logout();
}

/* Open a file */

function chooseFile() {
  return makePromise( WL.fileDialog( {
    mode: "open",
    select: "single",
  })).then( function(res) {
    if (!(res.data && res.data.files && res.data.files.length==1)) {
      throw new Error("onedrive: no file selected");
    }
    return res.data.files[0];
  }).then( function(file) {
    return infoFromId( file.id );
  });
}     

function openFile() {
  return login().then( function() {
    return chooseFile();
  }).then( function(info) {
    return pathFromId( info.parent_id ).then( function(path) {
      return { remote: new Onedrive(info.parent_id, path), docName: Util.basename(info.name) };
    });
  });
}

function openFolder() {
  return makePromise( WL.fileDialog( {
    mode: "save",
    select: "single",
  })).then( function(res) {
    if (!(res.data && res.data.folders && res.data.folders.length==1)) {
      return Promise.rejected(onedriveError("no save folder selected"));
    }
    return res.data.folders[0].id;
  }).then( function(folderId) {
    return pathFromId( folderId ).then( function(folder) {
      return new Onedrive(folderId, folder);
    });
  });
}     

/* Write a file */

function _writeFileAt( folderId, name, content ) {
  var url = onedriveDomain + folderId.toString() + "/files/" + name;                  
  return Util.requestPUT( {url:url, contentType:";" }, { access_token: getAccessToken() }, content );
}

function writeFile( folderId, path, content ) {
  return ensureSubPath( folderId, Util.dirname(path) ).then( function(subId) {
    return _writeFileAt( subId, Util.basename(path), content );
  }).then( function(resp) {
    return infoFromId( resp.id );
  });
}


/* Onedrive interface */

function unpersist( obj ) {
  return new Onedrive(obj.folderId, obj.folder || "");
}

function type() {
  return "Onedrive";
}

function createAt( folder ) {
  return login().then( function() {
    return ensurePath(folder);
  }).then( function(folderId) {
    return new Onedrive(folderId,folder);
  });
}

var Onedrive = (function() {

  function Onedrive( folderId, folder ) {
    var self = this;
    self.folderId = folderId;
    self.folder = folder;
  }

  Onedrive.prototype.type = function() {
    return type();
  }

  Onedrive.prototype.logo = function() {
    return "icon-onedrive.png";
  }  

  Onedrive.prototype.persist = function() {
    var self = this;
    return { folderId: self.folderId, folder: self.folder };
  }

  Onedrive.prototype.getFolder = function() {
    var self = this;
    return self.folder;
  }

  Onedrive.prototype.getWriteAccess = function() {
    return login();
  }

  Onedrive.prototype.createNewAt = function(folder) {
    return createAt(folder);
  }

  Onedrive.prototype.pushFile = function( file, content ) {
    var self = this;
    return writeFile( self.folderId, file, content ).then( function(info) {
      return Util.dateFromISO(info.updated_time);
    });
  }

  Onedrive.prototype.pullFile = function( fpath ) {
    var self = this;
    return infoFromSubPath( self.folderId, fpath ).then( function(info) {
      if (!info || !info.source) return Promise.rejected("file not found: " + fpath);
      // onedrive does not do CORS on content so we need to use our server to get it.. :-(
      return Util.requestGET( "onedrive", { url: info.source } ).then( function(_content,req) {
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
    return infoFromSubPath( self.folderId, fpath ).then( function(info) {
      return (info ? Util.dateFromISO(info.updated_time) : null);
    });
  }

  Onedrive.prototype.createSubFolder = function(dirname) {
    var self = this;
    return ensureSubPath(self.folderId,dirname).then( function(folderId) {
      return { folder: Util.combine(self.folder,dirname), created: folderId && folderId.created };
    });
  }


  return Onedrive;
})();   



return {
  openFile  : openFile,
  openFolder: openFolder,
  createAt  : createAt,
  login     : login,
  logout    : logout,
  unpersist : unpersist,
  type      : type,
  Onedrive  : Onedrive,
}

});