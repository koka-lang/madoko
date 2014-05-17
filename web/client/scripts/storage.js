/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util", 
        "../scripts/merge", "../scripts/dropbox"], function(Promise,util,merge,dropbox) {

function onedriveError( obj, premsg ) {
  msg = "onedrive: " + (premsg ? premsg + ": " : "")
  if (obj && obj.error) {
    var err = obj.error.message || obj.error.toString();
    err = err.replace(/^WL\..*:\s*/,"").replace(/^.*?Detail:\s*/,"");
    if (util.startsWith(err,"Cannot read property 'focus'")) err = "Cannot open dialog box. Enable pop-ups?";
    msg = msg + err; // + (obj.error.code ? " (" + obj.error.code + ")" : "");
  }
  else if (obj && typeof obj === "string") {
    msg = msg + obj;
  }
  else {
    msg = msg + "unknown error";
  }
  //console.log(msg);
  return msg;
}


function onedrivePromise( call, premsg ) {
  var promise = new Promise();
  call.then( 
    function(res) {
      promise.resolve(res);
    },
    function(resFail) {
      promise.reject(onedriveError(resFail,premsg),resFail);
    },
    function(prog) {
      promise.progress(prog);
    }
  );
  return promise;
}


function onedriveAccessToken() {
  if (!WL) return "";
  var session = WL.getSession();
  if (!session || !session.access_token) return "";
  return "access_token=" + session.access_token;
}

var onedriveDomain = "https://apis.live.net/v5.0/";

function onedriveGet( path, errmsg ) {
  if (typeof WL === "undefined" || !WL) return Promise.rejected( onedriveError("no connection",errmsg), {} );
  //return onedrivePromise( WL.api( { path: path, method: "GET" }), errmsg );
  var url = onedriveDomain + path + "?" + onedriveAccessToken();
  return util.requestGET( url );
}

function onedriveWriteFileAt( file, folderId, content ) {
  // TODO: resolve sub-directories
  var self = this;
  var url = onedriveDomain + folderId + "/files/" + util.basename(file.path) + "?" +
              onedriveAccessToken();    
  return util.requestPUT( {url:url,contentType:";" }, content );
}



function onedriveGetFileInfoFromId( file_id ) {
  return onedriveGet( file_id );
}

function onedriveGetWriteAccess() {
  if (typeof WL === "undefined" || !WL) return Promise.rejected( onedriveError("no connection") );
  return onedrivePromise( WL.login({ scope: ["wl.signin","wl.skydrive","wl.skydrive_update"]}), "get write access" );  
}


function unpersistOnedrive( obj ) {
  return new Onedrive(obj.folderId, obj.folder || "");
}

var Encoding = {
  Base64: "base64",
  Utf8: "utf-8",

  decode: function( enc, text ) {
    if (enc===Encoding.Base64) {
      return util.decodeBase64(text);
    }
    else {
      return text;
    }
  },

  encode: function( enc, data ) {
    if (!data) return "";
    if (enc===Encoding.Base64) {
      return btoa(data);
    }
    else {
      return data;
    }
  },

  fromExt: function(fpath) {
    var mime = util.mimeFromExt(fpath);
    return (util.startsWith(mime,"text/") ? Encoding.Utf8 : Encoding.Base64);
  },
};


function onedriveGetPathFromId( id, path ) {
  if (path == null) path = "";
  if (id === null) return path;
  return onedriveGetFileInfoFromId( id ).then( function(info) {
    if (info.parent_id === null || info.name==="SkyDrive" || info.name==="OneDrive") return path;
    return onedriveGetPathFromId( info.parent_id, (path ? util.combine(info.name,path) : info.name));
  });
}

function onedriveGetFileInfoAt( folderId, path ) {
  return onedriveGet( folderId + "/files", "get files").then( function(res) {
    var file = null;
    if (res.data) {
      for (var i = 0; i < res.data.length; i++) {
        var f = res.data[i];
        if (f.name == path) {
          file = f;
          break;
        }
      }
    }
    //if (!file) console.log("onedrive: unable to find: " + path);
    return file;
  });
}

function onedriveGetFileInfo( folderId, path ) {
  var dir = util.dirname(path);
  if (dir==="") return onedriveGetFileInfoAt(folderId,path);
  // recurse
  var subdir = util.firstdirname(path);
  return onedriveGetFileInfoAt( folderId, subdir ).then( function(subFolder) {
    if (!subFolder) return null;
    return onedriveGetFileInfo( subFolder.id, path.substr(subdir.length+1) );
  });
}

function onedriveEnsureFolder( folderId, subFolderName, recurse ) {
  return onedriveGetFileInfo( folderId, subFolderName ).then( function(folder) {
    if (folder) return folder.id;
    var url = onedriveDomain + folderId + "?" + onedriveAccessToken();
    return util.requestPOST( url, { name: subFolderName, description: "" } ).then( function(newFolder) {
        return newFolder.id;
      }, function(err) {
        if (!recurse && err && util.contains(err.message,"(resource_already_exists)")) {
          // multiple requests can result in this error, try once more
          return onedriveEnsureFolder( folderId, subFolderName, true );
        }
        else {
          throw err; // re-throw
        }
      }
    );
  })
}

var Onedrive = (function() {

  function Onedrive( folderId, folder ) {
    var self = this;
    self.folderId = folderId;
    self.folder = folder;
  }

  Onedrive.prototype.type = function() {
    return "Onedrive";
  }

  Onedrive.prototype.logo = function() {
    return "onedrive-logo.png";
  }

  Onedrive.prototype.persist = function() {
    var self = this;
    return { folderId: self.folderId, folder: self.folder };
  }

  Onedrive.prototype.getFolder = function() {
    var self = this;
    return self.folder;
  }

    // todo: abstract WL.getSession(). implement subdirectories.
  Onedrive.prototype._getFileInfo = function( path ) {  
    var self = this;
    return onedriveGetFileInfo( self.folderId, path );
  }


  Onedrive.prototype.getWriteAccess = function() {
    return onedriveGetWriteAccess();
  }



  function onedriveWriteFile( file, folder, folderId, content ) {
    var dir = util.dirname(file.path).substr(folder.length);    
    if (dir === "") return onedriveWriteFileAt( file, folderId, content );
    // we need to resolve the subdirectories.
    var subdir = dir.replace( /[\/\\].*$/, ""); // take the first subdir
    return onedriveEnsureFolder( folderId, subdir ).then( function(subId) {
      return onedriveWriteFile( file, util.combine(folder,subdir), subId, content );
    });
  }


  Onedrive.prototype.pushFile = function( file, content ) {
    var self = this;
    return onedriveWriteFile( file, "", self.folderId, content ).then( function(resp) {
      return onedriveGetFileInfoFromId( resp.id );
    }).then( function(info) {
      return util.dateFromISO(info.updated_time);
    });
  }

  Onedrive.prototype.pullFile = function( fpath ) {
    var self = this;
    return self._getFileInfo( fpath ).then( function(info) {
      if (!info || !info.source) return Promise.rejected("file not found: " + fpath);
      return util.requestGET( "onedrive", { url: info.source } ).then( function(_content,req) {
        var file = {
          path: fpath,
          content: req.responseText,
          createdTime: util.dateFromISO(info.updated_time),
        };
        return file;
      });
    });
  }

  Onedrive.prototype.getRemoteTime = function( fpath ) {    
    var self = this;
    return self._getFileInfo( fpath ).then( function(info) {
      return (info ? util.dateFromISO(info.updated_time) : null);
    });
  }

  return Onedrive;
})();   


function onedriveOpenFile() {
  if (typeof WL === "undefined" || !WL) return Promise.rejected( onedriveError("no connection") );
  return onedrivePromise( WL.fileDialog( {
    mode: "open",
    select: "single",
  })).then( function(res) {
    if (!(res.data && res.data.files && res.data.files.length==1)) {
      return Promise.rejected(onedriveError("no file selected"));
    }
    return res.data.files[0];
  }).then( function(file) {
    return onedriveGetFileInfoFromId( file.id ).then( function(info) {
      //var storage = new Storage(info.parent_id);
      return onedriveGetPathFromId(info.parent_id).then( function(folder) {
        var onedrive = new Onedrive(info.parent_id, folder);
        return { storage: new Storage(onedrive), docName: file.name };
      });
    });
  });
}     

function dropboxOpenFile() {
  return dropbox.openFile().then( function(info) {
    return {storage: new Storage(info.dropbox), docName: info.docName };
  });
}

function onedriveOpenFolder() {
  if (typeof WL === "undefined" || !WL) return Promise.rejected( onedriveError("no connection") );
  return onedrivePromise( WL.fileDialog( {
    mode: "save",
    select: "single",
  })).then( function(res) {
    if (!(res.data && res.data.folders && res.data.folders.length==1)) {
      return Promise.rejected(onedriveError("no save folder selected"));
    }
    return new Storage(new Onedrive(res.data.folders[0].id) );
  });
}     


function onedriveInit(options) {
  if (typeof WL === "undefined") {
    WL = null;
    return;
  }
  if (!options.response_type) options.response_type = "token";
  if (!options.scope) options.scope = ["wl.signin","wl.skydrive"];    
  WL.init(options).then( function(res) {
    console.log("initialized onedrive");
  }, function(resFail) {
    console.log("failed to initialize onedrive");
  });
}


var LocalRemote = (function() {
  function LocalRemote(folder) {    
    var self = this;
    self.folder = folder || "remote/";
  }

  LocalRemote.prototype.type = function() {
    return "local";
  }

  LocalRemote.prototype.logo = function() {
    return "local-logo.svg";
  }

  LocalRemote.prototype.persist = function() {
    var self = this;
    return { folder: self.folder };
  }

  LocalRemote.prototype.getWriteAccess = function() {
    return Promise.resolved();
  }

  LocalRemote.prototype.pushFile = function( file, content ) {
    var self = this;
    var obj  = { modifiedTime: new Date(), content: file.content, mime: file.mime, encoding: file.encoding, position: file.position }
    if (!localStorage) throw new Error("no local storage: " + file.path);
    localStorage.setItem( self.folder + file.path, JSON.stringify(obj) );
    return Promise.resolved(obj.modifiedTime);
  }

  LocalRemote.prototype.pullFile = function( fpath ) {
    var self = this;
    if (!localStorage) throw new Error("no local storage");
    var json = localStorage.getItem(self.folder + fpath);
    var obj = JSON.parse(json);
    if (!obj || !obj.modifiedTime) return Promise.rejected( new Error("local storage: unable to read: " + fpath) );
    var file = {
      path: fpath,
      content: obj.content, 
      createdTime: obj.modifiedTime,
      encoding: obj.encoding || Encoding.fromExt(fpath),
      mime: obj.mime || util.mimeFromExt(fpath),
      position: obj.position,
    };
    return Promise.resolved(file);
  }

  LocalRemote.prototype.getRemoteTime = function( fpath ) {
    var self = this;
    if (!localStorage) throw new Error("no local storage");
    try { 
      var json = localStorage.getItem(self.folder + fpath);
      var obj = JSON.parse(json);
      if (!obj || !obj.modifiedTime) return cont(null, null);
      return Promise.resolved(obj.modifiedTime);
    }
    catch(exn) {
      return Promise.resolved(null);
    }
  }

  return LocalRemote;
})();


var NullRemote = (function() {
  function NullRemote() {    
  }

  NullRemote.prototype.type = function() {
    return "null";
  }

  NullRemote.prototype.logo = function() {
    return "madoko-icon-100.png";
  }

  NullRemote.prototype.getFolder = function() {
    return "Madoko/document";
  }

  NullRemote.prototype.persist = function() {
    return { };
  }

  NullRemote.prototype.getWriteAccess = function() {
    return Promise.resolved();
  }

  NullRemote.prototype.pushFile = function( file, content ) {
    return Promise.rejected( new Error("not connected: cannot store files") );
  }

  NullRemote.prototype.pullFile = function( fpath ) {
    var self = this;
    return Promise.rejected( new Error("not connected to storage: unable to read: " + fpath) );
  }

  NullRemote.prototype.getRemoteTime = function( fpath ) {
    return Promise.resolved(null);
  }

  return NullRemote;
})();


function serverGetInitialContent(fpath) {
  if (!util.extname(fpath)) fpath = fpath + ".mdk";
  if (!util.isRelative(fpath)) throw new Error("can only get initial content for relative paths");
  return util.requestGET( fpath );
}

function localOpenFile() {
  if (!localStorage) throw new Error( "no local storage available, upgrade your browser");
  var local = new LocalRemote();
  return Promise.resolved( { storage: new Storage(local), docName: "document.mdk" } );
}


function unpersistRemote(remoteType,obj) {
  if (obj && remoteType) {
    if (remoteType===Onedrive.prototype.type()) {
      return unpersistOnedrive(obj);
    }
    else if (remoteType===dropbox.type()) {
      return dropbox.unpersist(obj);
    }
    else if (remoteType==LocalRemote.prototype.type()) {
      return new LocalRemote(obj.folder);
    }
  }
  return new NullRemote();
}
  
function unpersistStorage( obj ) {
  var remote = unpersistRemote( obj.remoteType, obj.remote );
  var storage = new Storage(remote);
  storage.files = util.unpersistMap( obj.files );
  // be downward compatible with old storage..
  storage.files.forEach( function(fpath,file) {
    if (file.kind) {
      file.encoding = Encoding.fromExt(fpath);
      file.mime = util.mimeFromExt(fpath);
      delete file.url;
    }
    if (typeof file.createdTime === "string") {
      file.createdTime = new Date(file.createdTime);
    }
    else if (!file.createdTime) {
      file.createdTime = new Date(0);
    }
    delete file.generated;
  });
  return storage;
}

function syncToLocal( storage, docStem, newStem ) {
  var local = new Storage(new LocalRemote());  
  return syncTo( storage, local, docStem, newStem );
}

function syncToOnedrive( storage, docStem, newStem ) {
  return onedriveGetWriteAccess().then( function() {
    return onedriveOpenFolder();
  }).then( function(onedrive) {
    return syncTo( storage, onedrive, docStem, newStem );
  });
}

function newOnedriveAt( folder ) {
  return onedriveEnsureFolder( "me/skydrive", folder ).then( function(folderId) {
    return new Onedrive(folderId,folder);
  });
}

function newDropboxAt( folder ) {
  return Promise.resolved( new dropbox.Dropbox(folder) );
}

function saveTo(  storage, toRemote, docStem, newStem ) 
{
  var newStem = (newStem === docStem ? "" : newStem);
  var newName = (newStem ? newStem : docStem) + ".mdk";
  var toStorage = new Storage(toRemote);
  return toStorage.readFile( newName, false ).then( 
    function(file) {
      throw new Error( "cannot save, document already exists: " + util.combine(toStorage.folder(), newName) );
    },
    function(err) {
      storage.forEachFile( function(file0) {
        var file = util.copy(file0);
        file.modified = true;
        if (newStem) {
          file.path = file.path.replace( 
                          new RegExp( "(^|[\\/\\\\])(" + docStem + ")((?:[\\.\\-][\\w\\-\\.]*)?$)" ), 
                            "$1" + newStem + "$3" );
        }
        toStorage.files.set( file.path, file );
      });
      return toStorage.sync().then( function(){ return {storage: toStorage, docName: newName }; } );
    }
  );
}  

function isEditable(file) {
  return (util.startsWith(file.mime,"text/") && !util.hasGeneratedExt(file.path));
}

function getEditPosition(file) {
  return (file.position || { lineNumber: 1, column: 1 });
}

function pushAtomic( fpath, time ) {
  return util.requestPOST( "rest/push-atomic", { name: fpath, time: time.toISOString() } );
}

var Storage = (function() {
  function Storage( remote ) {
    var self = this;
    self.remote    = remote;
    self.files     = new util.Map();
    self.listeners = [];
    self.unique    = 1;
    // we only pull again from remote storage every minute or so..
    self.pullFails = new util.Map();
    self.pullIval  = setInterval( function() { 
      self.pullFails.clear(); 
    }, 60000 );
  }

  Storage.prototype.destroy = function() {
    var self = this;
    self._fireEvent("destroy");
    self.listeners = [];
    if (self.pullIval) {
      clearInterval( self.pullIval );
      self.pullIval = 0;
    }
  }

  Storage.prototype.folder = function() {
    var self = this;
    return self.remote.getFolder();
  }

  Storage.prototype.persist = function(minimal) {
    var self = this;
    var pfiles;
    if (minimal) {
      var map = self.files.copy();
      map.forEach( function(path,file) {
        if (!util.startsWith(file.mime,"text/") || util.hasGeneratedExt(path)) map.remove(path);
      });
      pfiles = map.persist();
    }
    else {
      pfiles = self.files.persist();
    }

    return { 
      remote: self.remote.persist(), 
      remoteType: self.remote.type(),
      files: pfiles 
    };
  };

  /* Generic */
  Storage.prototype.forEachFile = function( action ) {
    var self = this;
    self.files.forEach( function(fname,file) {
      return action(file);
    });
  }

  Storage.prototype.isConnected = function() {
    var self = this;
    return (self.remote && self.remote.type() !== "null");
  }

  Storage.prototype.isSynced = function() {
    var self = this;
    var synced = true;
    self.forEachFile( function(file) {
      if (file.modified) {
        synced = false;
        return false; // break
      }
    });
    return synced;
  }

  Storage.prototype.writeFile = function( fpath, content, opts ) {
    var self = this;    
    var file = self.files.get(fpath);
    opts = self._initFileOptions(fpath,opts);
    
    if (file) {
      // modify existing file
      if (file.content === content) return;
      file.encoding  = file.encoding || opts.encoding;
      file.mime      = file.mime || opts.mime;
      file.modified  = file.modified || (content !== file.content);
      file.content   = content;
      file.position  = opts.position || file.position;
      self._updateFile(file);
    }
    else {
      // create new file
      self._updateFile( {
        path      : fpath,
        encoding  : opts.encoding,
        mime      : opts.mime,
        content   : content,
        original  : content,
        createdTime: new Date(),
        modified  : false,
        position  : opts.position,
      });
    }
  }

  Storage.prototype.addEventListener = function( type, listener ) {
    if (!listener) return;
    var self = this;
    var id = self.unique++;
    var entry = { type: type, id: id };
    if (typeof listener === "object" && listener.handleEvent) {
      entry.listener = listener;
    }
    else {
      entry.action = listener;
    }
    self.listeners.push( entry );
    return id;
  }

  Storage.prototype.clearEventListener = function( id ) {
    var self = this;
    self.listeners = self.listeners.filter( function(listener) {
      return (listener && 
                (typeof id === "object" ? listener.listener !== id : listener.id !== id));
    });
  }

  // private
  Storage.prototype._updateFile = function( finfo ) {
    var self = this;
    util.assert(typeof finfo==="object");
    finfo.path    = finfo.path || "unknown.mdk";
    finfo.content = finfo.content || "";
    finfo.encoding    = finfo.encoding || Encoding.fromExt(finfo.path);
    finfo.mime        = finfo.mime || util.mimeFromExt(finfo.path);
    finfo.createdTime = finfo.createdTime || new Date();
    
    // check same content
    // var file = self.files.get(fpath);
    // if (file && file.content === finfo.content) return;

    // update
    self.files.set(finfo.path,finfo);
    self._fireEvent("update", { file: finfo });
  }

  Storage.prototype._fireEvent = function( type, obj ) {
    var self = this;
    if (!obj) obj = {};
    if (!obj.type) obj.type = type;        
    self.listeners.forEach( function(listener) {
      if (listener) {
        if (listener.listener) {
          listener.listener.handleEvent(obj);
        }
        else if (listener.action) {
          listener.action(obj);
        }
      }
    });
  }

  Storage.prototype._initFileOptions = function( fpath, opts ) {
    var self = this;
    if (!opts) opts = {};
    if (!opts.encoding) opts.encoding = Encoding.fromExt(fpath);
    if (!opts.mime) opts.mime = util.mimeFromExt(fpath);
    if (opts.searchDirs==null) opts.searchDirs = [];
    return opts;
  }

  Storage.prototype.setEditPosition = function(fpath,pos) {
    var self = this;
    var file = self.files.get(fpath);
    if (!file || !pos) return;
    file.position = pos;    
  }

  Storage.prototype._pullFile = function( fpath, opts ) {
    var self = this;
    opts = self._initFileOptions(fpath,opts);
    return self.remote.pullFile(fpath).then( function(file) {
      file.path      = file.path || fpath;
      file.mime      = opts.mime;
      file.encoding  = opts.encoding;
      file.modified  = false;
      file.content   = Encoding.encode(opts.encoding,file.content);
      file.original  = file.content;
      file.position  = file.position || opts.position;
      return file;
    });
  }
  
  /* Interface */
  Storage.prototype._pullFileSearch = function( fbase, opts, dirs ) {
    var self = this;
    if (!dirs || dirs.length===0) return Promise.resolved(null);
    var dir = dirs.shift();
    return self._pullFile( util.combine(dir,fbase), opts ).then( function(file) {
        return file;
      }, function(err) {
        if (dirs.length===0) return null;
        return self._pullFileSearch( fbase, opts, dirs );
      });
  }

  Storage.prototype.readFile = function( fpath, createOnErr, opts ) {  // : Promise<file>
    var self = this;
    var file = self.files.get(fpath);
    if (file) return Promise.resolved(file);

    // prevent too many calls to remote storage... 
    if (self.pullFails.contains(fpath)) return Promise.rejected(new Error("cannot find file: " + fpath));

    opts = self._initFileOptions(fpath,opts);
    var dirs = [util.dirname(fpath)].concat(opts.searchDirs);
    return self._pullFileSearch( util.basename(fpath), opts, dirs ).then( function(file) {      
      if (file) {
        self._updateFile( file );
        return file;
      }
      else  {
        function noContent() {
          if (createOnErr) {
            self.writeFile(fpath,"",opts);
            return self.files.get(fpath);            
          }
          else {
            self.pullFails.set(fpath,true);
            throw new Error("cannot find file: " + fpath);
          }
        }

        // only try standard style if necessary
        if (!util.hasEmbedExt(fpath)) {
          return noContent();
        }

        // try to find the file as a madoko standard style on the server..
        var spath = "styles/" + fpath;
        var opath = "out/" + fpath;
        if (util.extname(fpath) === ".json" && !util.dirname(fpath)) spath = "styles/lang/" + fpath;

        return serverGetInitialContent(spath).then( function(_content,req) {
            var content = req.responseText;
            if (!content) return noContent();
            self.writeFile(opath,content,opts);
            return self.files.get(opath);
          },
          function(_err) {
            return noContent();
          });
      }      
    });    
  }

  function isRoot( fpath, roots ) {
    if (util.contains(roots,fpath)) return true;
    if (util.firstdirname(fpath) === "out") {  // so "out/madoko.css" is not collected
      if (util.contains(roots,fpath.substr(4))) return true;
    }
    if (util.extname(fpath) === ".pdf" || util.extname(fpath) === ".html") return true;
    return false;
  }

  Storage.prototype.collect = function( roots ) {
    var self = this;
    self.forEachFile( function(file) {
      if (!isRoot(file.path,roots) && 
          (!file.content || !isEditable(file) || !file.modified) ) {
        self.files.remove(file.path);
      }
    });
  }

  Storage.prototype.existsLocal = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    return (file != null);
  }

  var rxConflicts = /^ *<!-- *begin +merge +.*?--> *$/im;

  Storage.prototype.sync = function( diff, cursors ) {
    var self = this;
    var remotes = new util.Map();

    return self.remote.getWriteAccess().then( function() {      
      var syncs = self.files.elems().map( function(file) { return self._syncFile(diff,cursors,file); } );
      return Promise.when( syncs ).then( function(res) {
        res.forEach( function(msg) {
          if (msg) util.message(msg, util.Msg.Trace);
        });
      });
    });
  }

  Storage.prototype._syncFile = function(diff,cursors,file) {  // : Promise<string>
    var self = this;
    return self.remote.getRemoteTime( file.path ).then( function(remoteTime) {
      if (!remoteTime) remoteTime = new Date(0);
      if (file.createdTime.getTime() < remoteTime.getTime()) {
        return self._pullFile(file.path, file).then( function(remoteFile) {
          return self._syncPull(diff,cursors,file,remoteFile);
        });
      }
      else {
        return self._syncPush(file,remoteTime);
      }
    });
  }

  Storage.prototype.pushFile = function( file ) {
    var self = this;
    return self.remote.pushFile(file, Encoding.decode( file.encoding, file.content ));
  }

  Storage.prototype._syncPush = function(file,remoteTime) {
    var self = this;
    // file.createdTime >= remoteTime
    if (file.createdTime.getTime() === remoteTime.getTime() && !file.modified) {
      // nothing to do
      return self._syncMsg(file,"up-to-date");
    }
    else if (util.startsWith(file.mime,"text/") && rxConflicts.test(file.content)) {
      // don't save files with merge conflicts
      throw new Error( self._syncMsg(file,"cannot save to server: resolve merge conflicts first!", "save to server") );
    }
    else {
      // write back the client changes
      return pushAtomic( file.path, remoteTime ).then( function() {
        // note: if the remote file is deleted and the local one unmodified, we may choose to delete locally?
        var file0 = util.copy(file);
        return self.pushFile( file0 ).then( function(createdTime) {
          //newFile.modified = false;
          var file1 = self.files.get(file.path);
          if (file1) { // could be deleted in the mean-time?
            file1.original = file0.content;
            file1.modified = (file1.content !== file0.content); // could be modified in the mean-time
            file1.createdTime = createdTime;
            self._updateFile(file1);
          }
          return self._syncMsg(file, "save to server"); 
        });
      }, function(err) {
        if (err.httpCode == 409) 
          throw new Error( self._syncMsg(file,"cannot save to server: file was saved concurrently by another user!", "save to server") );
        else 
          throw err;
      });
    }
  }

  Storage.prototype._syncPull = function(diff,cursors,file,remoteFile) {
    var self = this;
    var canMerge = util.startsWith(file.mime, "text/");
    // file.createdTime < remoteFile.createdTime
    if (file.modified && canMerge) {
      if (rxConflicts.test(file.content)) {
        throw new Error( self._syncMsg(file, "cannot update from server: resolve merge conflicts first!", "update from server" ));
      }
      return self._syncMerge(diff,cursors,file,remoteFile);
    }
    else {
      // overwrite with server content
      if (!canMerge && file.modified) {
        util.message( "warning: binary file modified on server and client, overwrite local one: " + file.path, util.Msg.Warning );
      }
      self._updateFile( remoteFile );
      return self._syncMsg( remoteFile, "update from server");
    }
  }

  Storage.prototype._syncMerge = function(diff,cursors,file,remoteFile) {
    var self = this;
    var original = (file.original != null ? file.original : file.content);
    var content  = file.content;
    return merge.merge3(diff, null, cursors["/" + file.path] || 1, 
                        original, remoteFile.content, file.content).then( 
      function(res) {
        self._fireEvent("flush", { path: file.path }); // save editor state
        if (content !== file.content) {
          // modified in the mean-time!
          throw new Error( self._syncMsg(file,"merged from server, but modified in the mean-time","merge from server"));
        }
        if (cursors["/" + file.path]) {
          cursors["/" + file.path] = res.cursorLine;
        }
        if (res.conflicts) {
          // don't save if there were real conflicts
          remoteFile.original = file.orginal; // so next merge does not get too confused
          remoteFile.content  = res.merged;
          remoteFile.modified = true;
          self._updateFile(remoteFile);
          throw new Error( self._syncMsg( file, "merged from server but cannot save: resolve merge conflicts first!", "merge from server") );
        }
        else {
          // write back merged result
          var file0 = util.copy(remoteFile);
          file0.content  = res.merged;
          file0.modified = true;
          self._updateFile(file0);
          return pushAtomic(file0.path, remoteFile.createdTime).then( function() {
            return self.pushFile(file0).then( function(createdTime) {
              var file1 = self.files.get(file.path);
              if (file1) { // could be deleted?
                file1.modified    = (file1.content !== file0.content); // could be modified in the mean-time
                file1.createdTime = createdTime;
                file1.original    = file0.content;
                self._updateFile(file1);
              }
              return self._syncMsg( file, "merge from server" );
            });
          }, function(err) {
            if (err.httpCode == 409) 
              throw new Error( self_syncMsg( file, "merged from server but cannot save: file was saved concurrently by another user", "merge from server" ) );
            else 
              throw err;
          });
        }
      }
    );
  }

  Storage.prototype._syncMsg = function( file, msg, action ) {
    var self = this;
    return file.path + (action ? ": " + action : "") + (msg ? ": " + msg : "");
  }

  /*
  Storage.prototype._syncFileX = function(diff,cursors,file) {  // : Promise<string>
    var self = this;

    function message(msg,action) {
      return file.path + (action ? ": " + action : "") + (msg ? ": " + msg : "");
    }

    // only text files
    // if (file.kind === File.Image) return Promise.resolved(message("skip"));

    return self.remote.getRemoteTime( file.path ).then( function(remoteTime) {
      var noRemote = (remoteTime==null);

      if (!remoteTime) {
        // file is deleted on server?
        remoteTime = file.createdTime;
      }

      if (file.modified) 
      {
        if (rxStartMerge.test(file.content)) {
          throw new Error( message("cannot save to server: resolve merge conflicts first!", "save to server") );
        }
        else if (util.startsWith(file.mime,"text/") && file.createdTime !== remoteTime) {
          // modified on client and server
          if (!diff) {
            return message( "modified on server!", "merge from server" );
          }
          else {
            return self._pullFile(file.path,file).then( function(remoteFile) {
              if (remoteFile.content === "" && file.content !== "") {
                // do not merge an empty file
                return self.remote.pushFile(file).then( function(newFile) {
                  newFile.modified= false;
                  newFile.original = newFile.content;
                  self._updateFile(newFile);
                  return message( "merge from server was empty, wrote back changes" );
                });
              }

              var original = (file.original != null ? file.original : file.content);
              return merge.merge3(diff, null, cursors["/" + file.path] || 1, 
                                original, remoteFile.content, file.content
                      ).then( function(res) {
                  if (cursors["/" + file.path]) {
                    cursors["/" + file.path] = res.cursorLine;
                  }
                  if (res.conflicts) {
                    // don't save if there were real conflicts
                    remoteFile.original = file.orginal; // so next merge does not get too confused
                    remoteFile.content  = res.merged;
                    remoteFile.modified= true;
                    self._updateFile(remoteFile);
                    throw new Error( message("merged from server but cannot save: resolve merge conflicts first!", "merge from server") );
                  }
                  else {
                    // write back merged result
                    remoteFile.content  = res.merged;
                    return self.remote.pushFile(remoteFile).then( function(newFile) {
                      newFile.modified= false;
                      newFile.original = newFile.content;
                      self._updateFile(newFile);
                      return message( "merge from server" );      
                    });
                  }
                });  
            });
          }
        }
        else {          
          // write back the client changes
          return self.remote.pushFile( file ).then( function(newFile) {
            newFile.modified= false;
            newFile.original = newFile.content;
            self._updateFile(newFile);
            return message("save to server"); 
          });
        }
      }
      // not modified locally
      else if (file.createdTime !== remoteTime) {
        // update from server
        self.files.remove(file.path);
        return self.readFile(file.path, false ).then( function(newfile) {
            return message("update from server");
          },
          function(err) {
            self.files.set(file.path,file); // restore
            throw err;
          }
        );
      }
      else if (noRemote) {
        // just present on our side, push to server
        return self.remote.pushFile( file ).then( function(newFile) {
          newFile.modified= false;
          newFile.original = newFile.content;
          self._updateFile(newFile);
          return message("(re)save to server"); 
        });        
      }
      else {
        // nothing to do
        return message("up-to-date");
      }
    });
  }
  */

  return Storage;
})();
  

return {
  onedriveInit: onedriveInit,
  onedriveOpenFile: onedriveOpenFile,
  dropboxOpenFile: dropboxOpenFile,
  localOpenFile: localOpenFile,
  newOnedriveAt: newOnedriveAt,
  newDropboxAt: newDropboxAt,
  saveTo: saveTo,  
  Storage: Storage,
  LocalRemote: LocalRemote,
  NullRemote: NullRemote,
  Encoding: Encoding,
  unpersistStorage: unpersistStorage,
  isEditable: isEditable,
  getEditPosition: getEditPosition,

}
});