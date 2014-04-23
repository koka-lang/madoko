/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util", "../scripts/merge"], function(Promise,util,merge) {

function onedriveError( obj, premsg ) {
  msg = "onedrive: " + (premsg ? premsg + ": " : "")
  if (obj && obj.error && obj.error.message) {
    msg = msg + obj.error.message + (obj.error.code ? " (" + obj.error.code + ")" : "");
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


function onedriveGet( path, errmsg ) {
  if (typeof WL === "undefined" || !WL) return Promise.rejected( onedriveError("no connection",errmsg), {} );
  return onedrivePromise( WL.api( { path: path, method: "GET" }), errmsg );
}


function onedriveGetFileInfoFromId( file_id ) {
  return onedriveGet( file_id );
}

function onedriveGetWriteAccess() {
  if (typeof WL === "undefined" || !WL) return Promise.rejected( onedriveError("no connection") );
  return onedrivePromise( WL.login({ scope: ["wl.signin","wl.skydrive","wl.skydrive_update"]}), "get write access" );  
}


function unpersistOnedrive( obj ) {
  return new Onedrive(obj.folderId);
}

var Onedrive = (function() {

  function Onedrive( folderId ) {
    var self = this;
    self.folderId = folderId;
  }

  Onedrive.prototype.type = function() {
    return "Onedrive";
  }

  Onedrive.prototype.logo = function() {
    return "onedrive-logo.png";
  }

  Onedrive.prototype.persist = function() {
    var self = this;
    return { folderId: self.folderId };
  }

    // todo: abstract WL.getSession(). implement subdirectories.
  Onedrive.prototype.getFileInfo = function( path ) {  
    var self = this;
    return onedriveGet( self.folderId + "/files", "get files").then( function(res) {
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
      // if (!file) return cont( onedriveError("unable to find: " + path), file )
      return file;
    });
  }


  Onedrive.prototype.getWriteAccess = function() {
    return onedriveGetWriteAccess();
  }

  function onedriveAccessToken() {
    if (!WL) return "";
    var session = WL.getSession();
    if (!session || !session.access_token) return "";
    return "access_token=" + session.access_token;
  }

  var onedriveDomain = "https://apis.live.net/v5.0/";
  
  Onedrive.prototype.writeFile = function( file ) {
    // TODO: resolve sub-directories
    var self = this;
    var url = onedriveDomain + self.folderId + "/files/" + file.path + "?" +
                onedriveAccessToken();
    return util.requestPUT( {url:url,contentType:";" }, file.content );
  }

  Onedrive.prototype.pushFile = function( file ) {
    var self = this;
    return self.writeFile( file ).then( function(resp) {
      return onedriveGetFileInfoFromId( resp.id );
    }).then( function(info) {
      var newFile = util.copy(file);
      newFile.createdTime = info.updated_time;
      return newFile;
    });
  }

  Onedrive.prototype.pullTextFile = function( fpath, kind ) {
    var self = this;
    return self.getFileInfo( fpath ).then( function(info) {
      if (!info || !info.source) return Promise.rejected("file not found: " + fpath);
      return util.requestGET( "onedrive", { url: info.source } ).then( function(content) {
        var file = {
          kind: kind || File.fromPath(fpath) || File.Generated,
          path: fpath,
          content: content,
          url: "",
          createdTime: info.updated_time,                    
          written: false,
        };
        return file;
      });
    });
  }

  Onedrive.prototype.getRemoteTime = function( fpath ) {    
    var self = this;
    return self.getFileInfo( fpath ).then( function(info) {
      return (info ? info.updated_time : null);
    });
  }

  Onedrive.prototype.getImageUrl = function( fpath ) {    
    var self = this;
    return self.pullTextFile( fpath, File.Image ).then(function(file) {
      file.content = btoa(file.content);
      var encoding = "image/png";
      var ext = util.extname(fpath);
      if (ext==="jpg") encoding = "image/jpg";
      else if (ext==="gif") encoding = "image/gif"
      file.url = "data:" + encoding + ";base64," + file.content;
      return file;
    });
    /*
    return self.getFileInfo( fpath ).then( function (info) {
      if (!info) return Promise.rejected("image not found");
      //if (!WL)   return cont("no connection");
      var url = onedriveDomain + info.id + "/picture?type=full&" + onedriveAccessToken();
      var file = {
        path: fpath,
        kind: File.Image,
        url : url,
        content: "",
        createdTime: info.updated_time,
        written: false,
      };
      return file;
    });
    */
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
      var onedrive = new Onedrive(info.parent_id);
      return { storage: new Storage(onedrive), docName: file.name };
    });
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

  LocalRemote.prototype.pushFile = function( file ) {
    var self = this;
    var obj  = { modifiedTime: new Date().toISOString(), content: file.content, kind: file.kind }
    if (!localStorage) throw new Error("no local storage: " + file.path);
    localStorage.setItem( self.folder + file.path, JSON.stringify(obj) );
    var newFile = util.copy(file);
    newFile.createdTime = obj.modifiedTime;
    return Promise.resolved(newFile);
  }

  LocalRemote.prototype.pullTextFile = function( fpath, kind ) {
    var self = this;
    if (!localStorage) throw new Error("no local storage");
    var json = localStorage.getItem(self.folder + fpath);
    var obj = JSON.parse(json);
    if (!obj || !obj.modifiedTime) return Promise.rejected( new Error("local storage: unable to read: " + fpath) );
    var file = {
      path: fpath,
      kind: obj.kind || kind,
      content: obj.content,
      createdTime: obj.modifiedTime,
      written: false,
      url: "",
    };
    return Promise.resolved(file);
  }

  LocalRemote.prototype.getImageUrl = function( fpath ) {
    return Promise.rejected( new Error("local storage cannot store images") );
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
    return "null-logo.svg";
  }

  NullRemote.prototype.persist = function() {
    return { };
  }

  NullRemote.prototype.getWriteAccess = function() {
    return Promise.resolved();
  }

  NullRemote.prototype.pushFile = function( file ) {
    return Promise.rejected( new Error("not connected: cannot store files") );
  }

  NullRemote.prototype.pullTextFile = function( fpath, kind ) {
    var self = this;
    return Promise.rejected( new Error("not connected to storage: unable to read: " + fpath) );
  }

  NullRemote.prototype.getImageUrl = function( fpath ) {
    return Promise.rejected( new Error("not connected: cannot store images") );
  }

  NullRemote.prototype.getRemoteTime = function( fpath ) {
    return Promise.resolved(null);
  }

  return NullRemote;
})();


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
  return storage;
}

function syncToLocal( storage, docStem, newStem ) {
  var local = new Storage(new LocalRemote());  
  return syncTo( storage, local, docStem, newStem );
}

function syncToOnedrive( storage, docStem, newStem ) {
  return onedriveOpenFolder().then( function(onedrive) {
    return syncTo( storage, onedrive, docStem, newStem );
  })
}


function syncTo(  storage, toStorage, docStem, newStem ) 
{
  var newName = (newStem ? newStem : docStem) + ".mdk";
  return toStorage.readTextFile( newName, false ).then( 
    function(file) {
      throw new Error( "cannot save, document already exists: " + newName );
    },
    function(err) {
      storage.forEachFile( function(file0) {
        var file = util.copy(file0);
        file.written = true;
        if (newStem) {
          file.path = file.path.replace( 
                          new RegExp( "(?:^|[\\/\\\\])(" + docStem + ")((?:[\\.\\-][\\w\\-\\.]*)?$)" ), 
                            newStem + "$2" );
        }
        toStorage.files.set( file.path, file );
      });
      return toStorage.sync().then( function(){ return {storage: toStorage, docName: newName }; } );
    }
  );
}  

var File = { 
  Text:"text", Image:"image", Generated:"generated",


  fromPath: function(path) {
    // absolute paths should never be created
    if (util.contains(path,":") || util.startsWith(path,".") || util.startsWith(path,"/")) return null;

    if (util.hasTextExt(path)) {
      return File.Text;      
    }
    else if (util.hasImageExt(path)) {
      return File.Image;
    }
    else {
      return null;
    }
  }
};


var Storage = (function() {
  function Storage( remote ) {
    var self = this;
    self.remote    = remote;
    self.files     = new util.Map();
    self.listeners = [];
    self.unique    = 1;
  }

  Storage.prototype.persist = function() {
    var self = this;
    return { 
      remote: self.remote.persist(), 
      remoteType: self.remote.type(),
      files: self.files.persist() 
    };
  };

  /* Generic */
  Storage.prototype.createTextFile = function(fpath,content,kind) {
    var self = this;
    kind = kind || File.Text;
    self.writeTextFile(fpath,content,kind);
  }

  Storage.prototype.forEachFileKind = function( kinds, action ) {
    var self = this;
    self.files.forEach( function(fname,file) {
      if (util.contains(kinds,file.kind)) {
        action(file.path, file.content);
      }
    });
  }

  Storage.prototype.forEachFile = function( action ) {
    var self = this;
    self.files.forEach( function(fname,file) {
      return action(file);
    });
  }

  Storage.prototype.isSynced = function() {
    var self = this;
    var synced = true;
    self.forEachFile( function(file) {
      if (file.written) {
        synced = false;
        return false; // break
      }
    });
    return synced;
  }

  Storage.prototype.writeTextFile = function( fpath, content, kind) {
    var self = this;
    kind = kind || File.Text;
    var file = self.files.get(fpath);

    if (file) {
      if (file.content === content) return;
      file.kind = file.kind || kind;
      file.written = true; //file.written || (content !== file.content);
      file.content = content;
      self._updateFile(file);
    }
    else {
      self._updateFile( {
        path     : fpath,
        kind     : kind,
        content  : content,
        original : content,
        written  : (content !== ""),
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
    finfo.url     = finfo.url || "";
    finfo.content = finfo.content || "";
    finfo.kind    = finfo.kind || File.Text;
    finfo.createdTime = finfo.createdTime || new Date().toISOString();
      
    
    // check same content
    // var file = self.files.get(fpath);
    // if (file && file.content === finfo.content) return;

    // update
    self.files.set(finfo.path,finfo);
    self._fireEvent("update", { file: finfo });
  }

  Storage.prototype._fireEvent = function( type, obj ) {
    var self = this;
    self.listeners.forEach( function(listener) {
      if (listener) {
        if (!obj.type) obj.type = type;
        if (listener.listener) {
          listener.listener.handleEvent(obj);
        }
        else if (listener.action) {
          listener.action(obj);
        }
      }
    });
  }

  
  /* Interface */
  Storage.prototype.readTextFile = function( fpath, createOnErrKind ) {  // : Promise<file>
    var self = this;
    var file = self.files.get(fpath);
    if (file) return Promise.resolved(file);

    return self.remote.pullTextFile( fpath, createOnErrKind ).then( function(file) {
        file.original = file.content;
        self._updateFile( file );
        return file;
      },
      (createOnErrKind ? 
        function(err) {
          self.createTextFile(fpath,"",createOnErrKind);
          return self.files.get(fpath);
        } :
        undefined)
    );    
  }

  Storage.prototype.collect = function( roots ) {
    var self = this;
    self.forEachFile( function(file) {
      if (!file.content && !util.contains(roots,file.path)) {
        self.files.remove(file.path);
      }
    });
  }

  Storage.prototype.existsLocal = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    return (file != null);
  }

  Storage.prototype.getImageUrl = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    if (file) {
      if (file.kind !== File.Image) throw new Error("not an image: " + fpath); 
      return Promise.resolved(file.url);
    }
    else {
      return self.remote.getImageUrl( fpath ).then( function(file) {
        self._updateFile( file );
        return file.url;
      });
    }
  }

  var rxStartMerge = /^ *<!-- *begin +merge +.*?--> *$/im;

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

    function message(msg,action) {
      return file.path + (action ? ": " + action : "") + (msg ? ": " + msg : "");
    }

    // only text files
    if (file.kind === File.Image) return Promise.resolved(message("skip"));

    return self.remote.getRemoteTime( file.path ).then( function(remoteTime) {
      if (!remoteTime) {
        // file is deleted on server?
        remoteTime = file.createdTime;
      }

      if (file.written) 
      {
        if (rxStartMerge.test(file.content)) {
          throw new Error( message("cannot save to server: resolve merge conflicts first!", "save to server") );
        }
        else if (file.kind === File.Text && file.createdTime !== remoteTime) {
          // modified on client and server
          if (!diff) {
            return message( "modified on server!", "merge from server" );
          }
          else {
            return self.remote.pullTextFile(file.path, null).then( function(remoteFile) {
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
                    remoteFile.written = true;
                    self._updateFile(remoteFile);
                    throw new Error( message("merged from server but cannot save: resolve merge conflicts first!", "merge from server") );
                  }
                  else {
                    // write back merged result
                    remoteFile.content  = res.merged;
                    return self.remote.pushFile(remoteFile).then( function(newFile) {
                      newFile.written = false;
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
            newFile.written = false;
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
        return self.readTextFile(file.path, false ).then( function(newfile) {
            return message("update from server");
          },
          function(err) {
            self.files.set(file.path,file); // restore
            throw err;
          }
        );
      }
      else {
        // nothing to do
        return message("up-to-date");
      }
    });
  }

  return Storage;
})();
  

return {
  onedriveInit: onedriveInit,
  onedriveOpenFile: onedriveOpenFile,
  localOpenFile: localOpenFile,
  syncToLocal: syncToLocal,
  syncToOnedrive: syncToOnedrive,  
  Storage: Storage,
  LocalRemote: LocalRemote,
  NullRemote: NullRemote,
  File: File,
  unpersistStorage: unpersistStorage,
}
});