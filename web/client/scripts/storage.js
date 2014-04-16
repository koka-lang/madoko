/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/util"], function(util) {

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


function onedriveCont( call, cont, premsg ) {
  call.then( 
    function(res) {
      cont(null,res);
    },
    function(resFail) {
      cont(onedriveError(resFail,premsg),resFail)
    }
  );
}


function onedriveGet( path, cont, errmsg ) {
  if (typeof WL === "undefined" || !WL) return cont( onedriveError("no connection",errmsg), {} );
  onedriveCont( WL.api( { path: path, method: "GET" }), cont, errmsg );
}


function onedriveGetFileInfoFromId( file_id, cont ) {
  onedriveGet( file_id, cont );
}

function unpersistOnedrive( obj ) {
  return new Onedrive(obj.folderId);
}

var Onedrive = (function() {

  function Onedrive( folderId ) {
    var self = this;
    self.folderId = folderId;
  }

  Onedrive.prototype.persist = function() {
    var self = this;
    return { remoteType: "Onedrive", folderId: self.folderId };
  }

    // todo: abstract WL.getSession(). implement subdirectories.
  Onedrive.prototype.getFileInfo = function( path, cont ) {  
    var self = this;
    onedriveGet( self.folderId + "/files", function(err, res) {
      if (err) cont(err,res);
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
      cont( null, file);
    }, "get files");
  }


  Onedrive.prototype.getWriteAccess = function( cont ) {
    if (!WL) return cont( onedriveError("no connection"), {} );
    onedriveCont( WL.login({ scope: ["wl.signin","wl.skydrive","wl.skydrive_update"]}), cont );  
  }

  function onedriveAccessToken() {
    if (!WL) return "";
    var session = WL.getSession();
    if (!session || !session.access_token) return "";
    return "access_token=" + session.access_token;
  }

  var onedriveDomain = "https://apis.live.net/v5.0/"
  
  Onedrive.prototype.writeFile = function( file, cont ) {
    // TODO: resolve sub-directories
    var self = this;
    var url = onedriveDomain + self.folderId + "/files/" + file.path + "?" +
                (file.info != null ? "" : "overwrite=false&") + onedriveAccessToken();
    util.requestPUT( {url:url,contentType:";" }, content, cont );
  }

  Onedrive.prototype.pushFile = function( file, cont ) {
    var self = this;
    self.writeFile( file, function(errPut,resp) {
      if (errPut) return cont(errPut,file.path);
      onedriveGetFileInfoFromId( resp.id, function(errInfo,info) {
        if (errInfo) return cont(errInfo,file.path);
        var newFile = util.copy(file);
        newFile.info = info; // update id and time
        newFile.createdTime = info.updated_time;
        cont(null,newFile);
      });
    });
  }

  Onedrive.prototype.pullTextFile = function( fpath, kind, cont ) {
    var self = this;
    self.getFileInfo( fpath, function(errInfo, info) {
      if (errInfo) return cont(errInfo,null);      
      util.requestGET( "onedrive", { url: info.source }, function(errGet,content) {
        if (errGet) return cont(errGet,null);
        var file = {
          info: info,
          kind: kind || File.Text,
          path: fpath,
          content: content,
          url: "",
          createdTime: info.updated_time,                    
          written: false,
        };
        cont(null,file);
      });
    }); 
  }

  Onedrive.prototype.getRemoteTime = function( fpath, cont ) {    
    var self = this;
    self.getFileInfo( fpath, function(err,info) {
      if (err) return cont(err,null);
      if (!info) return cont(null,null);
      cont(null,info.updated_time);
    });
  }

  Onedrive.prototype.getImageUrl = function( fpath, cont ) {    
    var self = this;
    self.getFileInfo( fpath, function(err,info) {
      if (err)   return cont(err,"");
      if (!info) return cont("image not found","");
      //if (!WL)   return cont("no connection");
      var url = onedriveDomain + info.id + "/picture?type=full&" + onedriveAccessToken();
      var file = {
        info: info,
        path: fpath,
        kind: File.Image,
        url : url,
        content: "",
        createdTime: info.updated_time,
        written: false,
      };
      cont(null,file);
    });
  }

  return Onedrive;
})();   


function onedriveOpenFile(cont) {
  if (!WL) return cont( onedriveError("no connection"), null, "" );
  onedriveCont( WL.fileDialog( {
    mode: "open",
    select: "single",
  }), 
  function(err,res) {
    if (err) cont(err);
    if (!(res.data && res.data.files && res.data.files.length==1)) {
      return cont(onedriveError("no file selected"));
    }
    var file = res.data.files[0];
    onedriveGetFileInfoFromId( file.id, function(err2,info) {
      if (err2) cont(err2);
      //var storage = new Storage(info.parent_id);
      var onedrive = new Onedrive(info.parent_id);
      cont( null, new Storage(onedrive), file.name );
    });
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


var NullRemote = (function() {
  function NullRemote(folder) {    
    var self = this;
    self.folder = folder || "remote/";
  }

  NullRemote.prototype.persist = function() {
    var self = this;
    return { remoteType: "NullRemote", folder: self.folder };
  }

  NullRemote.prototype.getWriteAccess = function( cont ) {
    cont(null);
  }

  NullRemote.prototype.pushFile = function( file, cont ) {
    var self = this;
    var obj  = { modifiedTime: new Date().toISOString(), content: file.content, kind: file.kind }
    if (!localStorage) return cont("no local storage: " + file.path, null);
    localStorage.setItem( self.folder + file.path, JSON.stringify(obj) );
    var newFile = util.copy(file);
    newFile.createdTime = obj.modifiedTime;
    cont(null,newFile);
  }

  NullRemote.prototype.pullTextFile = function( fpath, kind, cont ) {
    var self = this;
    if (!localStorage) return cont("no local storage",null);
    try { 
      var json = localStorage.getItem(self.folder + fpath);
      var obj = JSON.parse(json);
      if (!obj || !obj.modifiedTime) return cont("local storage: unable to read: " + fpath, null);
      var file = {
        path: fpath,
        kind: obj.kind || kind,
        content: obj.content,
        createdTime: obj.modifiedTime,
        written: false,
        url: "",
      };
      cont(null,file);
    }
    catch(exn) {
      util.message(exn.toString(), util.Msg.Trace);
      cont("local storage unavailable: " + fpath,null);
    }
  }

  NullRemote.prototype.getImageUrl = function( fpath, cont ) {
    cont("local storage cannot store images",null);
  }

  NullRemote.prototype.getRemoteTime = function( fpath, cont ) {
    var self = this;
    if (!localStorage) return cont("no local storage",null);
    try { 
      var json = localStorage.getItem(self.folder + fpath);
      var obj = JSON.parse(json);
      if (!obj || !obj.modifiedTime) return cont(null, null);
      cont(null,obj.modifiedTime);
    }
    catch(exn) {
      cont(null,null);
    }    
  }

  return NullRemote;
})();


function localOpenFile(cont) {
  if (!localStorage) return cont( "no local storage available, upgrade your browser", null, "");
  var local = new NullRemote();
  cont(null, new Storage(local), "document.mdk" );
}


function unpersistRemote(obj) {
  if (obj && obj.remoteType) {
    if (obj.remoteType==="Onedrive") {
      return unpersistOnedrive(obj);
    }
    else if (obj.remoteType=="NullRemote") {
      return new NullRemote(obj.folder);
    }
  }
  return new NullRemote();
}
  
function unpersistStorage( obj ) {
  var remote = unpersistRemote( obj.remote );
  var storage = new Storage(remote);
  storage.files = util.unpersistMap( obj.files );
  return storage;
}

function syncToLocal( storage, cont ) {
  var local = new Storage(new NullRemote());
  storage.forEachFile( function(file0) {
    var file = util.copy(file0);
    file.info = null;
    local.files.set( file.path, file );
  });
  local.sync( function(err) {
    cont(err,local);
  });
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
      files: self.files.persist() 
    };
  };

  /* Generic */
  Storage.prototype.createTextFile = function(fpath,content,kind) {
    var self = this;
    kind = kind || File.Text;
    self.writeTextFile(fpath,content);
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
      action(file);
    });
  }

  Storage.prototype.writeTextFile = function( fpath, content, kind) {
    var self = this;
    kind = kind || File.Text;
    var file = self.files.get(fpath);

    if (file) {
      file.kind = kind;
      file.written = file.written || (content != file.content);
      file.content = content;
      self.updateFile(file);
    }
    else {
      self.updateFile( {
        path     : fpath,
        kind     : kind,
        info     : null,
        content  : content,
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
  Storage.prototype.updateFile = function( finfo ) {
    var self = this;
    util.assert(typeof finfo==="object");
    finfo.path    = finfo.path || "unknown.mdk";
    finfo.url     = finfo.url || "";
    finfo.content = finfo.content || "";
    finfo.info    = finfo.info || null;
    finfo.kind    = finfo.kind || File.Text;
    finfo.createdTime = finfo.createdTime || new Date().toISOString();
      
    
    // check same content
    // var file = self.files.get(fpath);
    // if (file && file.content === finfo.content) return;

    // update
    self.files.set(finfo.path,finfo);
    self.fireEvent("update", { path: finfo.path, content: finfo.content });
  }

  Storage.prototype.fireEvent = function( type, obj ) {
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
  Storage.prototype.readTextFile = function( fpath, createOnErrKind, cont ) {
    var self = this;
    var file = self.files.get(fpath);
    if (file) return cont(null, file.content);

    self.remote.pullTextFile( fpath, createOnErrKind, function(err,file) {
      if (err) {
        if (createOnErrKind) {
          self.createTextFile(fpath,"",createOnErrKind);
          cont(null,"");
        }
        else {
          cont(err,"");
        }
      }
      else {
        self.updateFile( file );
        cont(null,file.content);
      }
    });    
  }

  Storage.prototype.getImageUrl = function( fpath, cont ) {
    var self = this;
    var file = self.files.get(fpath);
    if (file) {
      if (file.kind === File.Image) return cont("not an image: " + fpath, ""); 
      cont(null,file.url);
    }
    else {
      self.remote.getImageUrl( fpath, function(err, file) {
        if (err) return cont(err,"")  
        self.updateFile( file );
        cont(null,file.url);
      });
    }
  }

  Storage.prototype.sync = function( cont ) {
    var self = this;
    var remotes = new util.Map();

    self.remote.getWriteAccess( function(errAccess) {
      if (errAccess) return cont("cannot get write permission.",[]);

      util.asyncForEach( self.files.elems(), function(file, xfcont) {
        function fcont(err,action) {
          action = file.path + (action ? ": " + action : "");
          xfcont( (err ? file.path + ": " + err.toString() : null), action);
        }

        // only text files
        if (file.kind === File.Image) return fcont(null,"skip");

        self.remote.getRemoteTime( file.path, function(errInfo,remoteTime) {
          if (errInfo) return fcont(errInfo,"<unknown>");

          if (!remoteTime) {
            // file is deleted on server?
            file.info = null; // clear stale info, so we do not overwrite
            remoteTime = file.createdTime;
          }

          if (file.written) {
            if (file.kind !== File.Generated && file.createdTime !== remoteTime) {
              // modified on client and server
              fcont( "modified on server!", "merge from server" );
            }
            else {
              // write back the client changes
              self.remote.pushFile( file, file.kind, function(errPush, newFile) {
                if (errPush) return fcont(errPush,"save to server");
                newFile.written = false;
                self.updateFile(newFile);
                fcont(null,"save to server"); 
              });
            }
          }
          else if (file.createdTime !== remoteTime) {
            // update from server
            self.files.delete(file.path);
            self.readTextFile(file.path, false, function(errRead,content) {
              if (errRead) {
                self.files.set(file.path,file); // restore
              }
              fcont(errRead,"update from server");
            });
          }
          else {
            // nothing to do
            fcont(null,"up-to-date");
          }
        });
      },
      function(err,xs) {
        xs.forEach( function(msg) {
          if (msg) util.message(msg, util.Msg.Trace);
        })
        if (cont) cont(err);
      });
    });
  }

  return Storage;
})();
  

return {
  onedriveInit: onedriveInit,
  onedriveOpenFile: onedriveOpenFile,
  localOpenFile: localOpenFile,
  syncToLocal: syncToLocal,
  Onedrive: Onedrive,
  NullRemote: NullRemote,
  Storage: Storage,
  File: File,
  unpersistStorage: unpersistStorage,
}
});