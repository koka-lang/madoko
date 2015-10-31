/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/map","../scripts/util", 
        "../scripts/merge", 
        "../scripts/remote-local",
        "../scripts/remote-dropbox",
        "../scripts/remote-onedrive",
        "../scripts/remote-onedrive2",
        "../scripts/remote-http",
        "../scripts/remote-github",
        "../scripts/remote-localhost",
        "../scripts/picker",
        ], function(Promise,Map,Util,Merge,LocalRemote,Dropbox,Onedrive,Onedrive2,HttpRemote,Github,Localhost,Picker) {

var remotes = {
  dropbox: Dropbox,
  onedrive: Onedrive,
  onedrive2: Onedrive2,
  github: Github,
  http: HttpRemote,
  local: LocalRemote,
  localhost: Localhost
};

var Encoding = {
  Base64: "base64",
  Utf8: "utf-8",

  decode: function( enc, text ) {
    if (enc===Encoding.Base64) {
      return Util.decodeBase64(text);
    }
    else {
      return text;
    }
  },

  encode: function( enc, data ) {
    if (!data) return "";
    if (enc===Encoding.Base64) {
      if (data instanceof ArrayBuffer) 
        return Util.encodeBase64(data);
      else
        return window.btoa(unescape(encodeURIComponent(data))); // todo; see: https://developer.mozilla.org/en-US/docs/Web/API/WindowBase64/btoa
    }
    else if (typeof data === "object") {
      return JSON.stringify(data);
    }
    else {
      return data;
    }
  },

  fromExt: function(fpath) {
    var mime = Util.mimeFromExt(fpath);
    return (Util.isTextMime(mime) ? Encoding.Utf8 : Encoding.Base64);
  },
};

function sanitizeFileName( fname ) {
  return fname.replace(/\\/g,"/").replace(/[^\w\-\+%\\\/\.\(\)]+/g, "-");
}

function picker( storage, params ) {
  if (storage && !storage.isSynced() && 
       !(/save|connect|signin|push|upload|commit|snapshot|message/.test(params.command))) {
    params.page = "alert";
  }
  return Picker.show(params).then( function(res) {
    if (!res || res.canceled) throw new Error("canceled");
    if (!res.path) return res;

    var folder = Util.dirname(res.path);
    var fileName = Util.basename(res.path);
    if (Util.extname(res.path) == "" && (params.command === "save" || params.command === "new" || params.command==="push")) {
      folder = res.path;
      fileName = Util.basename(res.path) + ".mdk";
    }
    return remotes[res.remote].createAt( folder ).then( function(remote) {
      return { storage: new Storage(remote), docName: fileName, template: res.template }      
    })    
    //var remote = unpersistRemote( res.remote, { folder: folder } );
  });
}

function openFile(storage) {
  var params = {
    command: "open",   
    extensions: "remote folder .mdk .md .markdown .mkdn", 
  }
  if (storage && storage.remote.canSync) { 
    params.remote = storage.remote.type();
    params.folder = storage.remote.getFolder();
  }

  return picker( storage, params);
}

function createFile(storage) {
  var params = {
    command: "new", 
    extensions: "remote folder",
  }
  /* // always start at the root for a new file?
  if (storage && !storage.remote.readonly) {
    params.remote = storage.remote.type();
    params.folder = storage.remote.getFolder();
  }
  */
  return picker(storage, params).then( function(res) {
    if (!res) return null;
    return createFromTemplate( res.storage, res.docName, res.template || "default" ).then( function(content) {
      return res;
    });
  });
}

function createFromTemplate( storage, docName, template )
{
  if (!template) template = "default";
  var templates = template.split(";");
  return Promise.map( templates, function(temp) {
    var srcName = temp;
    var tgtName = temp;
    if (Util.extname(temp) === "") {
      srcName = temp + ".mdk";
      tgtName = docName;
    }
    return Util.requestGET( { url: "templates/" + srcName, binary:  Util.hasBinaryExt(srcName) } ).then( function(content) {
      storage.writeFile(tgtName, "");
      storage.writeFile(tgtName, Encoding.encode( Encoding.fromExt(srcName), content )); // ensure it is created as modified to prevent garbage collection
      return null;
    }, function(err) {
      return err;
    });
  }).then( function() {
    // ensure the main file exists
    if (!storage.existsLocal(docName)) {
      storage.writeFile(docName,"Title         : Welcome to Madoko\nHeading Base  : 2\nAuthor        : You\n\n[TITLE]\n\n# Madoko\n\nEnjoy!\n");
    }
    return;
  });
}

function login(storage, message, header) {
  if (!storage || !storage.remote.needSignin) return Promise.resolved();
  var params = {
    command: "signin",
  }
  params.remote  = storage.remote.type();
  if (message) params.message = message;
  if (header) params.header = header;

  return picker(storage,params).then( function(res) {
    return;
  }, function(err) {
    return;
  });
}

function message(storage,message,header,headerLogo) {
  var params = {
    command: "message",    
    message: message,
    header: header,
    headerLogo: headerLogo,
    commandDisplay: "",
  };
  return picker(storage,params);
}

function uploadLocal(storage,message,header,headerLogo) {
  var params = {
    command: "upload",    
    message: message,
    header: header,
    headerLogo: headerLogo,
  };
  return picker(storage,params).then( function(res) {
    return res.files;
  });
}

function commitMessage(storage,changes,header,headerLogo) {
  var params = {
    command: "commit",    
    changes: changes,
    header: header,
    headerLogo: headerLogo,
  };
  return picker(storage,params).then( function(res) {
    return res;
  });
}

function snapshotMessage(storage,stem) {
  var params = {
    command: "snapshot",    
    header: stem,
  };
  return picker(storage,params).then( function(res) {
    return res.message;
  });
}


function discard(storage,docName) {
  var params = {
    command: "alert",
    alert: "true",
    header: Util.escape(Util.combine(storage.remote.getDisplayFolder(),docName || ""))
  };
  params.remote = storage.remote.type();
  params.headerLogo = "images/dark/" + storage.remote.logo();
  
  return picker(storage,params).then( function(res) {
    return true;
  }, function(err) {
    return false;
  });
}

function httpOpenFile(url,doc) {  
  return HttpRemote.createAt(url).then( function(remote) {
    return { storage: new Storage(remote), docName: doc };
  });
}

function createNullStorage() {
  return new Storage( new LocalRemote.LocalRemote("") );
}

function serverGetInitialContent(fpath) {
  if (!Util.extname(fpath)) fpath = fpath + ".mdk";
  if (!Util.isRelative(fpath)) throw new Error("can only get initial content for relative paths");
  return Util.requestGET( { url: fpath,  binary: Util.hasBinaryExt(fpath) } );
}

function unpersistRemote(obj,remoteType) {
  if (remoteType==null) remoteType = obj.type;
  if (obj && remoteType) {
    var rs = Util.properties(remotes);
    for (var i = 0; i < rs.length; i++) {
      var remote = remotes[rs[i]];
      if (remoteType == remote.type()) {
        return remote.unpersist(obj);
      }
    }
  }
  return LocalRemote.unpersist();
}

function makeDefaultGlobalPath(remoteType,path) {
  return "//" + remoteType + "/unshared/0/" + path;  // default guess
}
  
function unpersistStorage( obj ) {
  // legacy support
  if (obj.remoteType) {
    var remote = unpersistRemote( obj.remote, obj.remoteType );
    var storage = new Storage(remote);
    storage.files = Map.unpersist( obj.files );
    // be downward compatible with old storage..
    storage.files.forEach( function(fpath,file) {
      if (file.kind) {
        file.encoding = Encoding.fromExt(fpath);
        file.mime = Util.mimeFromExt(fpath);
        delete file.url;
      }
      if (typeof file.createdTime === "string") {
        file.createdTime = new Date(file.createdTime);
      }
      else if (!file.createdTime) {
        file.createdTime = new Date(1);
      }
      if (!file.globalPath) {
        file.globalPath = makeDefaultGlobalPath(remote.type(),file.path);
      }
      delete file.generated;
    });
  }
  else {
    // recent versions: 0.8.5+
    var remote  = unpersistRemote( obj.remote );
    var storage = new Storage(remote);
    obj.files.forEach( function(fname) {
      var info = obj["/" + fname];
      if (info) {
        if (info.original==null) info.original = info.content;
        if (typeof info.createdTime === "string") {
          info.createdTime = new Date(info.createdTime);
        }
        storage.files.set( fname, info );
      }
    });
  }
  return storage;
}


function newOnedriveAt( folder ) {
  return Onedrive.createAt( folder );
}

function newDropboxAt( folder ) {
  return Dropbox.createAt(folder);
}

function saveAs( storage, docName ) {
  var stem = Util.stemname(docName);
  var params = {
    command: "save",
    commandDisplay: "Save To Folder",
    file: (stem === Util.basename(Util.dirname(docName)) ? stem : Util.basename(docName)),
  }
  if (storage && !storage.remote.readonly) {
    params.remote = storage.remote.type();
    params.folder = Util.dirname(docName);
    params.file   = Util.stemname(docName);
  }
  return picker( storage, params).then( function(res) {
    if (!res) return null; // cancel
    return saveTo( storage, res.storage, stem, Util.stemname(res.docName) );
  });
}

function saveTo(  storage, toStorage, docStem, newStem ) 
{
  var newStem = (newStem === docStem ? "" : newStem);
  var newName = (newStem ? newStem : docStem) + ".mdk";
  return toStorage.readFile( newName, false ).then( 
    function(file) {
      throw new Error( "cannot save, document already exists: " + Util.combine(toStorage.remote.getDisplayFolder(), newName) );
    },
    function(err) {
      storage.forEachFile( function(file) {
        var opts = Util.copy(file);  
        opts.shareUrl   = null;
        opts.sharedPath = null;
        opts.globalPath = null;
        var path = file.path;
        if (newStem) {
          path = path.replace( 
                    new RegExp( "(^|[\\/\\\\])(" + docStem + ")((?:[\\.\\-][\\w\\-\\.]*)?$)" ), 
                      "$1" + newStem + "$3" );
        }        
        toStorage.writeFile( path, file.content, opts );
      });
      return toStorage.syncOrCommit().then( function(){ return {storage: toStorage, docName: newName }; } );
    }
  );
}  


function publishSite(  storage, docName, indexName )
{
  if (storage.remote.type() !== "dropbox") return Promise.rejected("Sorry, can only publish to Azure for documents on Dropbox.\nUse 'Save To' to save to Dropbox first.");

  var headerLogo = "images/dark/" + Dropbox.logo();
  var params = { 
      command: "push", 
      remote:"dropbox", 
      root:"/apps/Azure", 
      folder:"/apps/Azure/" + Util.stemname(docName), 
      file: "index.html",
      extensions: "remote folder .html .htm .aspx",
      headerLogo: headerLogo,
  };
  return storage.login().then( function() {
    return picker( storage, params ).then( function(res) {
      var toStorage = res.storage;
      storage.forEachFile( function(file) {
        var opts = Util.copy(file);  
        opts.shareUrl   = null;
        opts.sharedPath = null;
        opts.globalPath = null;
        var path = file.path;
        if (Util.startsWith(path, "out/") && (!Util.hasGeneratedExt(path) || Util.extname(path) === ".html")) {
          if (path === indexName) {
            path = res.docName;
          }
          else {
            path = path.substr(4);        
          }
          toStorage.writeFile( path, file.content, opts );
        }
      });
      return Promise.when( toStorage.files.elems().map( function(file) { 
        return toStorage.pushFile(file); 
      }) ).then( function() {
        var params = {
          command: "message",
          header: Util.escape(toStorage.remote.getDisplayFolder()),
          headerLogo: headerLogo,
          message: 
              ["<p>Website saved.</p>",
              ,"<p></p>"
              ,"<p>Visit the <a target='azure' href='http://manage.windowsazure.com'>Azure web manager</a> to synchronize your website.</p>",
              ,"<p></p>"
              ,"<p>Or view this <a target='webcast' href='http://www.youtube.com/watch?v=hC1xAjz6jHI&hd=1'>webcast</a> to learn more about Azure website deployment from Dropbox.</p>"
              ].join("\n")
        };
        return picker( storage, params ).then( function() {
          return toStorage.remote.getFolder();
        });
      });
    });
  });
}

function getSnapshotStem(docstem) {
  var now = new Date();
  var month = now.getMonth()+1;
  var day   = now.getDate();
          
  var stem = [docstem, 
              now.getFullYear().toString(),
              Util.lpad( month.toString(), 2, "0" ),
              Util.lpad( day.toString(), 2, "0" ),
             ].join("-");
  return stem;
}

function folderSafe(s) {
  return s.replace(/[^\w\-,\(\)\[\]\{\}]+/g,"-");
}

function getSnapshotFolder(stem,description,num) {             
  return "snapshots/" + folderSafe(stem + (num ? "-v" + num.toString() : "") + (description ? "-" + description : ""));  
}  

function createSnapshotFolder(remote, docstem, stem, description, num ) {
  if (!stem) stem = getSnapshotStem(docstem);
  var folder = getSnapshotFolder(stem,description,num);

  return remote.createSubFolder(folder).then( function(info) {
    if (info && info.created) return info.folder;
    if (num && num >= 100) throw new Error("too many snapshot verions");  // don't loop forever...
    return createSnapshotFolder(remote, docstem, stem, description, (num ? num+1 : 2));
  });
}

function createSnapshot( storage, docName ) {
  if (!storage.remote.canSync || storage.remote.canCommit) {
    return Promise.rejected( "Cannot create snapshot on local-, readonly, or repository storage. (Use 'Save To' to save to cloud storage first)");
  }
  var docstem =Util.stemname(docName);
  var stem = getSnapshotStem(docstem);

  return storage.login().then( function() {
    return snapshotMessage(storage, storage.remote.getDisplayFolder() + "/" + getSnapshotFolder(stem)).then( function(description) {
      return createSnapshotFolder( storage.remote, docstem, stem, description );
    });
  }).then( function(folder) {
      return storage.remote.createNewAt( folder );
  }).then( function(toRemote) {
    var toStorage = new Storage(toRemote);
    storage.forEachFile( function(file) {
      var opts = Util.copy(file);
      opts.shareUrl   = null;
      opts.sharedPath = null;
      opts.globalPath = null;
      toStorage.writeFile( file.path, file.content, opts );
    });
    return toStorage.syncOrCommit().then( function() {
      Util.message( "snapshot saved to: " + toStorage.remote.getDisplayFolder(), Util.Msg.Info );
    });
  });
}

function isEditable(file) {
  return (Util.isTextMime(file.mime) && !Util.hasGeneratedExt(file.path));
}

function getEditPosition(file) {
  return (file.position || { lineNumber: 1, column: 1 });
}

function pushAtomic( fpath, time, release ) {
  return Util.requestPOST( "rest/push-atomic", {}, { name: fpath, time: time.toISOString(), release: (release ? true : false)  } );
}

function createAlias( alias, name ) {
  return Util.requestPOST( "rest/edit-alias", {}, { name: name, alias: alias } );
}


var Storage = (function() {
  function Storage( remote ) {
    var self = this;
    self.remote    = remote;
    self.files     = new Map();
    self.listeners = [];
    self.unique    = 1;
    self.storageId = Util.randomHash8();
    // we only pull again from remote storage every minute or so..
    self.pullFails = new Map();
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

  Storage.prototype.persist = function(limit) {
    var self = this;
    
    // First sort in order of relevance and size
    var infos = [];
    var standardFiles = ["madoko.css"];
    var isShared = false;
    self.files.forEach( function(path,file) {
      // if (file.nosync) return;  // we want to keep these files in case of working off-line.
      if (file.sharedPath!=null) isShared = true;
      infos.push({
        path: path,
        mime: file.mime,
        len : file.content.length + file.original.length,
        vital: (Util.isTextMime(file.mime) && !Util.hasGeneratedExt(path)) || Util.contains(standardFiles,Util.basename(path)),
      });
    });
    function weight(info) {
      var w = info.len+1;
      if (info.vital) return (w / 1e10); // user text 
      if (!Util.hasGeneratedExt(info.path)) return w;  // images etc.
      return w * 10; // generated output
    }
    infos.sort( function(i1,i2) { return (weight(i1) - weight(i2)); });

    // Then add up to the limit
    var fnames = [];
    var total = 0;
    infos.forEach( function(info) {
      total = total + info.len;
      if (info.vital || total <= limit) {
        fnames.push(info.path);
      }
      else if (limit > 0) {
        Util.message("Over limit, not persisting: " + info.path, Util.Msg.Trace);
      }
    });

    return {
      synced: self.isSynced(),
      shared: isShared,
      remote: self.remote.persist(), 
      files: fnames,
    };
  };

  Storage.prototype.persistFile = function(fname) {
    var self = this;
    var file = self.files.get(fname);
    if (!file) return null;
    var pfile = Util.copy(file);
    if (pfile.content === pfile.original) delete pfile.original;
    pfile.createdTime = pfile.createdTime.toString();
    return pfile;
  }

  Storage.prototype.createSnapshot = function(docName) {
    var self = this;
    return createSnapshot(self,docName);
  }

  Storage.prototype.connect = function() {
    var self = this;
    return self.remote.connect();
  }

  Storage.prototype.login = function(dontForce,message) {
    var self = this;
    return self.remote.connect().then( function(status) {
      if (status===0) return;
      if (status!==401 || dontForce) throw new Error("Cannot connect to " + self.remote.type() );
      return login(self, message || "Cannot synchronize changes with " + Util.capitalize(self.remote.type()) + ". Please sign in to synchronize.").then( function() {
        return self.remote.connect().then( function(status2) {
          if (status2 === 0) return;
          throw new Error("Synchronization failed: cannot connect to " + self.remote.type() );
        })
      });
    });
  }


  /* Generic */
  Storage.prototype.forEachFile = function( action ) {
    var self = this;
    self.files.forEach( function(fname,file) {
      return action(file);
    });
  }

  Storage.prototype.isSynced = function(full) {
    var self = this;
    var synced = true;
    self.forEachFile( function(file) {
      if ((file.modified || (self.remote.canCommit && file.sha===null)) && (full || !Util.hasGeneratedExt(file.path))) {
        synced = false;
        return false; // break
      }
    });
    return synced;
  }

  Storage.prototype.writeAppendFile = function( fpath, content, opts ) {
    var self = this;    
    var file = self.files.get(fpath);
    return self.writeFile( fpath, (file ? file.content + content : content), opts )
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
      file.sha       = file.modified ? null : file.sha;
      file.content   = content;
      file.position  = opts.position || file.position;
      self._updateFile(file);
      return false;
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
        nosync    : opts.nosync,
      });
      return true;
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
    Util.assert(typeof finfo==="object");
    Util.assert(typeof finfo.path === "string" && finfo.path );
    finfo.path    = finfo.path || "unknown.mdk";
    finfo.content = finfo.content || "";
    finfo.encoding    = finfo.encoding || Encoding.fromExt(finfo.path);
    finfo.mime        = finfo.mime || Util.mimeFromExt(finfo.path);
    finfo.createdTime = finfo.createdTime || new Date();
    finfo.globalPath  = finfo.globalPath || makeDefaultGlobalPath(self.remote.type(),finfo.path);

    if (!finfo.shareUrl && (finfo.mime === "application/pdf" || finfo.mime === "text/html")) {
      // async set shareUrl
      self.remote.getShareUrl( finfo.path ).then( function(url) {
        finfo.shareUrl = url;  
      }, function(err) { } ); 
    }
    
    // check same content
    // var file = self.files.get(fpath);
    // if (file && file.content === finfo.content) return;

    // update
    self.files.set(finfo.path,finfo);
    self.pullFails.remove(finfo.path);
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
    if (!opts.mime) opts.mime = Util.mimeFromExt(fpath);
    if (opts.searchDirs==null) opts.searchDirs = [];
    return opts;
  }

  Storage.prototype.setEditPosition = function(fpath,pos) {
    var self = this;
    var file = self.files.get(fpath);
    if (!file || !pos) return;
    file.position = pos;    
  }

  Storage.prototype.getShareUrl = function(fpath,wait) {
    var self = this;
    var file = self.files.get(fpath);
    return (file && file.shareUrl ? file.shareUrl : "");
  }

  Storage.prototype.getInviteUrl = function() {
    var self = this;
    return self.remote.getInviteUrl();
  }

  Storage.prototype._pullFile = function( fpath, opts ) {
    var self = this;
    opts = self._initFileOptions(fpath,opts);
    return self.remote.pullFile(fpath,opts.encoding !== Encoding.Utf8).then( function(file) {
      file.path      = file.path || fpath;
      file.mime      = opts.mime;
      file.encoding  = opts.encoding;
      file.modified  = false;
      file.content   = Encoding.encode(opts.encoding,file.content);
      file.original  = file.content;
      file.position  = file.position || opts.position;
      file.globalPath= file.globalPath || makeDefaultGlobalPath(self.remote.type(),file.path);
      return file;
    });
  }

  /* Interface */
  Storage.prototype._pullFileSearch = function( fbase, opts, dirs ) {
    var self = this;
    if (!dirs || dirs.length===0) return Promise.resolved(null);
    var dir = dirs.shift();
    return self._pullFile( Util.combine(dir,fbase), opts ).then( function(file) {
        return file;
      }, function(err) {
        if (dirs.length===0) return null;
        if (err.httpCode && err.httpCode !== 404) throw err;
        return self._pullFileSearch( fbase, opts, dirs );
      });
  }

  Storage.prototype.isModified = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    return (file ? file.modified : false);
  }

  Storage.prototype.getSharedPath = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    return (file ? file.sharedPath : null);
  }


  Storage.prototype.readLocalFile = function( fpath ) {
    var self = this;
    return self.files.get(fpath);
  }

  Storage.prototype.readLocalContent = function( fpath ) {
    var self = this;
    var file = self.readLocalFile(fpath);
    return (file ? file.content : "");
  }

  Storage.prototype.readLocalRawContent = function( fpath ) {
    var self = this;
    var file = self.readLocalFile(fpath);
    return (file ? Encoding.decode( file.encoding, file.content ) : "");
  }

  Storage.prototype.readFile = function( fpath, createOnErr, opts ) {  // : Promise<file>
    var self = this;
    var file = self.files.get(fpath);
    if (file) return Promise.resolved(file);

    //if (!fpath) throw new Error("no path:" + fpath)

    // prevent too many calls to remote storage... 
    if (!createOnErr && self.pullFails.contains(fpath)) return Promise.rejected(new Error("cannot find file: " + fpath));

    opts = self._initFileOptions(fpath,opts);
    var dirs = [Util.dirname(fpath)].concat(opts.searchDirs);
    return self._pullFileSearch( Util.basename(fpath), opts, dirs ).then( function(file) {      
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
            throw new Error("Cannot find file: " + fpath);
          }
        }

        // only try standard style if necessary
        var mime = Util.mimeFromExt(fpath);
        if (!Util.hasEmbedExt(fpath) && !Util.isImageMime(mime)) {
          return noContent();
        }

        // try to find the file as a madoko standard style on the server..
        var spath = "styles/" + fpath;
        var opath = "out/" + fpath;
        if (Util.extname(fpath) === ".json" && !Util.dirname(fpath)) spath = "styles/lang/" + fpath;
        if (Util.isImageMime(mime)) opath = fpath;

        return serverGetInitialContent(spath).then( function(content,req) {
            if (!content) return noContent();
            if (Util.extname(fpath)===".json") content = req.responseText;
            opts.nosync = true;
            self.writeFile(opath,Encoding.encode(opts.encoding, content),opts);
            return self.files.get(opath);
          },
          function(err) {
            Util.message( err, Util.Msg.Info );
            return noContent();
          });
      }      
    });    
  }

  var rootExts = [".pdf",".dim",".dimx",".html",".tex",".dic"];
  function isRoot( fpath, roots ) {
    if (Util.contains(roots,fpath)) return true;
    if (Util.firstdirname(fpath) === "out") {  // so "out/madoko.css" is not collected
      if (Util.contains(roots,fpath.substr(4))) return true;
    }
    if (Util.contains(rootExts,Util.extname(fpath))) return true;
    return false;
  }

  function isWeakRoot(fpath) {
    return Util.extname(fpath)===".dic";
  }

  Storage.prototype.collect = function( roots ) {
    var self = this;
    var now = Date.now();
    self.forEachFile( function(file) {
      if ((!isRoot(file.path,roots) || (isWeakRoot(file.path) && !file.content)) && 
          (file.createdTime.getTime() + 60000 < now) && // at least one minute old
            (!file.content || !isEditable(file) || !file.modified) ) {  
        self._removeFile(file.path);
      }
    });
  }

  Storage.prototype._removeFile = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    if (file == null) return;
    self.files.remove(fpath);
    self._fireEvent("delete", { file: file }); 
  }

  Storage.prototype.existsLocal = function( fpath ) {
    var self = this;
    var file = self.files.get(fpath);
    return (file != null);
  }

  var rxConflicts = /^ *<!-- *begin +merge +.*?--> *$/im;

  Storage.prototype.sync = function( diff, cursors, showMerges, pullOnly ) {
    var self = this;
    var remotes = new Map();
    var merges = [];
    if (!self.remote.canSync) return Promise.resolved(true); // can happen during generateHTML/PDF

    return self.login(self.isSynced()).then( function() {      
      var syncs = self.files.elems().map( function(file) { 
        return (function() { 
          return self._syncFile(diff,cursors,merges,file,pullOnly); 
        }); 
      });
      return Promise.whenBatched( syncs, 5 ).then( function(res) {
        Util.message("Synchronized with " + self.remote.type() + " storage", Util.Msg.Info );
        return true;
      }, function(err) {
        //Util.message("Synchronization failed: " + (err.message || err.toString()), Util.Msg.Trace );
        if (err.message) err.message = "Synchronization failed: " + err.message; 
        throw err;
      }).always( function() {
        if (showMerges) showMerges(merges);
      });
    });
  }

  Storage.prototype._syncFile = function(diff,cursors,merges,file,pullOnly) {  // : Promise<string>
    var self = this;
    if (file.nosync) return Promise.resolved( self._syncMsg(file,"no sync") );
    return self.remote.getRemoteTime( file.path ).then( function(remoteTime) {
      if (!remoteTime) {
        remoteTime = new Date(0);
      }
      if (file.createdTime.getTime() < remoteTime.getTime()) {
        return self._pullFile(file.path, file).then( function(remoteFile) {
          return self._syncPull(diff,cursors,merges,file,remoteFile,pullOnly);
        });
      }
      else if (pullOnly) {
        return self._syncMsg(file,"no changes on server");
      }
      else {
        return self._syncPush(file,remoteTime);
      }
    }).then( function(res) {
      if (!file.shareUrl && (file.mime === "application/pdf" || file.mime === "text/html")) {
        return self.remote.getShareUrl( file.path ).then( function(url) {
          file.shareUrl = url;
          return res;
        });
      }
      else return res;
    });;
  }

  Storage.prototype._syncPush = function(file,remoteTime) {
    var self = this;
    // file.createdTime >= remoteTime
    if (file.createdTime.getTime() === remoteTime.getTime() && !file.modified) {
      // nothing to do
      return self._syncMsg(file,"up-to-date");
    }
    else if (remoteTime.getTime() === 0 && file.content === "") {  
      // deleted on server and no content: don't sync
      return self._syncMsg(file,"up-to-date (empty and removed on server)");
    }
    else if (Util.isTextMime(file.mime) && rxConflicts.test(file.content)) {
      // don't save files with merge conflicts
      throw new Error( self._syncMsg(file,"cannot save to server: resolve merge conflicts first!", "save to server") );
    }
    else {
      // write back the client changes
      return self._syncWriteBack(file,remoteTime,"save to server")
    }
  }

  Storage.prototype._syncPull = function(diff,cursors,merges,file,remoteFile,pullOnly) {
    var self = this;
    var canMerge = isEditable(file) && diff; // Util.isTextMime(file.mime);
    // file.createdTime < remoteFile.createdTime
    if (file.modified && canMerge) {
      if (rxConflicts.test(file.content)) {
        throw new Error( self._syncMsg(file, "cannot update from server: resolve merge conflicts first!", "update from server" ));
      }
      return self._syncMerge(diff,cursors,merges,file,remoteFile,pullOnly);
    }
    else {
      // overwrite with server content
      if (!canMerge && file.modified) {
        Util.message( "warning: binary- or generated file modified on server and client, overwrite local one: " + file.path, Util.Msg.Warning );
      }
      var original = (file.original != null ? file.original : file.content);
      var content = file.content;
      self._updateFile( remoteFile );
      if (!canMerge) {
        return self._syncMsg( remoteFile, "update from server");
      }
      else {
        // still do a merge for display of changes in the UI
        return Merge.merge3(diff, null, cursors["/" + file.path] || 1, 
                            original, remoteFile.content, content).then( 
          function(res) {
            // push merge fragments for display in UI
            res.merges.forEach( function(m) {
              m.path = file.path;
              merges.push(m);
            });
            if (res.merged !== remoteFile.content) {
              console.log("error in merge!");
            }
            return self._syncMsg( remoteFile, "update from server");
          }
        );
      }
    }
  }

  Storage.prototype._syncMerge = function(diff,cursors,merges,file,remoteFile,pullOnly) {
    var self = this;
    self._fireEvent("flush", { path: file.path }); // save editor state, changes file
    var original = (file.original != null ? file.original : file.content);
    var content  = file.content;
    if (!cursors) cursors = {};
    return Merge.merge3(diff, null, cursors["/" + file.path] || 1, 
                        original, remoteFile.content, file.content).then( 
      function(res) {
        // push merge fragments for display in UI
        res.merges.forEach( function(m) {
          m.path = file.path;
          merges.push(m);
        });

        if (content !== file.content) {
          // modified in the mean-time!
          throw new Error( self._syncMsg(file,"merged from server, but modified in the mean-time","merge from server"));
        }
        if (cursors["/" + file.path]) {
          cursors["/" + file.path] = res.cursorLine;
        }
        if (res.conflicts) {
          // don't save if there were real conflicts
          remoteFile.original = file.original; // so next merge does not get too confused
          remoteFile.content  = res.merged;
          remoteFile.modified = true;
          remoteFile.sha      = null;      
          self._updateFile(remoteFile);
          if (!pullOnly) throw new Error( self._syncMsg( file, "merged from server but cannot save: resolve merge conflicts first!", "merge from server") );
          return self._syncMsg( file, "merged from server but conflicts detected", "merge from server" );
        }
        else {
          // write back merged result
          var remoteTime = remoteFile.createdTime;
          var filex = Util.copy(remoteFile);
          filex.content  = res.merged;
          filex.modified = true;
          filex.sha      = null;
          self._updateFile(filex);
          if (pullOnly) 
            return self._syncMsg( file, "merged from server", "merge from server" );
          else 
            return self._syncWriteBack( filex, remoteTime, "merge to server" );          
        }
      }
    );
  }

  Storage.prototype._syncWriteBack = function( file, remoteTime, message ) {
    var self = this;
    return self.pushAtomic( file.globalPath, remoteTime ).then( function() {
      // note: if the remote file is deleted and the local one unmodified, we may choose to delete locally?
      var file0 = Util.copy(file);
      return self.pushFile( file0, remoteTime ).then( function(info) {
        //newFile.modified = false;
        var file1 = self.files.get(file.path);
        if (file1) { // could be deleted in the mean-time?
          file1.original    = file0.content;
          file1.modified    = (file1.content !== file0.content); // could be modified in the mean-time
          file1.sha         = file1.modified ? null : file1.sha;
          file1.createdTime = info.createdTime;
          // these can be updated for newly created files
          if (info.globalPath) file1.globalPath = info.globalPath;
          if (info.sharedPath) file1.sharedPath = info.sharedPath;
          self._updateFile(file1);
          Util.assert(file1.createdTime.getTime() === info.createdTime.getTime());
        }
        return Promise.guarded(file1.sharedPath !== file0.sharedPath, // support aliases for systems that do not have unique shared paths
          function() {
           return createAlias(file1.sharedPath,file0.sharedPath);
          },
          function() {
            var unmodified = (remoteTime.getTime() === info.createdTime.getTime());
            return Promise.guarded( unmodified,
              function() {  // this happens if the file equal and not updated on the server; release our lock in that case
                return self.pushAtomic( file0.globalPath, remoteTime, true );
              },
              function() {
                return self._syncMsg(file, message + (unmodified ? " (unmodified)" : ""));     
              }
            );
          }
        );
      });
    }, function(err) {
      if (err && err.httpCode == 409) 
        throw new Error( self._syncMsg(file,"cannot " + message + ": file was saved concurrently by another user!", "save to server") );
      else 
        throw err;
    });
  }

  Storage.prototype.pushAtomic = function( file, remoteTime, release ) {
    var self = this;
    if (self.remote.hasAtomicPush) 
      return Promise.resolved();
    else 
      return pushAtomic( file, remoteTime, release );
  }

  Storage.prototype.pushFile = function( file, remoteTime ) {
    var self = this;
    return self.remote.pushFile(file.path, Encoding.decode( file.encoding, file.content ), remoteTime );
  }

  Storage.prototype._syncMsg = function( file, msg, action ) {
    var self = this;
    var message = file.path + (action ? ": " + action : "") + (msg ? ": " + msg : "");
    if (!Util.startsWith(msg,"up-to-date")) Util.message(message,Util.Msg.Trace);
    return message;
  }

  Storage.prototype.pull = function(diff,cursors,showMerges) {
    var self = this;
    var merges = [];
    if (!self.remote.canCommit) return Promise.rejected("Can only pull from repositories");

    return self.login().then( function() {      
      return self.remote.pull( function(info) {
        if (!info) {
          Util.message( "Nothing to pull", Util.Msg.Info );
          return;
        }
        
        var pmsgs = info.commits.map( function(commit) {
          return (commit.author.name || commit.author.id) + ": " + commit.message;
        });
        Util.message( "Pulled:\n  " + pmsgs.join("\n  "), Util.Msg.Info );

        if (info.updates.length===0) {     
          Util.message( "Pulled from server, but no document changes", Util.Msg.Info );
        }
        else {
          var syncs = info.updates.map( function(item) {
                        return (function() {
                          return self._pullUpdate(diff,cursors,merges,item); 
                        });
                      });
          return Promise.whenBatched( syncs, 5 ).then( function(res) {
            Util.message("Pulled " + info.commits.length.toString() + " relevant update(s) from //" + self.remote.type() + "/" + self.remote.getDisplayFolder(), Util.Msg.Info );
            return true;
          }, function(err) {
            //Util.message("Synchronization failed: " + (err.message || err.toString()), Util.Msg.Trace );
            if (err.message) err.message = "Pull failed: " + err.message; 
            throw err;
          }).always( function() {
            if (showMerges) showMerges(merges);
          });
        }
      });
    });
  }

  Storage.prototype._pullUpdate = function(diff,cursors,merges,item) {
    var self = this;
    var file = self.files.get(item.path);
    if (!file) {
      // can happen if new files are added but not yet referenced locally, or generic updates by git under the document tree
      // return Promise.rejected("internal error: cannot pull " + item.path); // should never happen
      var msg = "pull ignore: " + item.path;
      Util.message(msg,Util.Msg.Trace);
      return Promise.resolved(msg);
    }
    else {
      var opts = Util.copy(file);
      return self._pullFile( file.path, opts ).then( function(remoteFile) {
        return self._syncPull(diff,cursors,merges,file,remoteFile,true);
      });
    }
  }

  Storage.prototype.commit = function() {
    var self = this;
    if (!self.remote.canCommit) return Promise.rejected("Can only commit to repositories");

    return self.login().then( function() {
      return self.remote.isAtHead().then( function(atHead) {
        var msgNotAtHead = "Commit failed: Please pull first, the document is not up-to-date with the repository";
        if (!atHead) throw new Error(msgNotAtHead);
        var fileInfos = self.files.elems().filter( function(finfo) { return (finfo.content && finfo.content.length > 0) } )
        return self.remote.getChanges( fileInfos ).then( function(changes) {
          /*
          // filter out additions to 'out/'
          var changes = changes0.filter( function(change) {
            if (change.change === Github.Change.Add && Util.startsWith(change.path,"out/")) return false;
            return true; 
          });
          */
          if (changes.length===0) {
            Util.message( "There are no changes to commit.", Util.Msg.Status );
            return;
          }

          // Sort in order of relevance
          function changeVal(c) {
            var hasDir= Util.dirname(c.path) ? "1" : "0";
            var isOut = Util.startsWith(c.path,"out/") ? "1" : "0";
            return (hasDir + isOut + c.path);
          }
          changes.sort( function(c1,c2) {
            var s1 = changeVal(c1);
            var s2 = changeVal(c2);
            return (s1 < s2 ? -1 : (s1 > s2 ? 1 : 0));
          });

          // Commit
          return commitMessage(self, changes, self.remote.getDisplayFolder(), 
                                "images/dark/icon-" + self.remote.type() + ".png").then( function(res) {
            if (res.changes) changes = res.changes;
            if (changes.length===0) {
              Util.message("Nothing was selected to commit.", Util.Msg.Status );
              return;
            }
            if (!res.message) {
              throw new Error("A commit message cannot be empty. (commit was aborted)");
            }
            return self.remote.commit( res.message, changes ).then( function(commit) {
              if (!commit.committed) {
                throw new Error(msgNotAtHead);
              }
              // update file sha & modified flag
              commit.blobs.forEach( function(blob) {
                var file = self.files.get(blob.path);
                if (file) {
                  file.original    = blob.content;
                  file.createdTime = commit.date;
                  file.modified    = (file.content !== blob.content);
                  file.sha         = (file.modified ? null : blob.sha);
                  self._updateFile(file);
                }
              });
              var paths = commit.blobs.map( function(blob) { return blob.path; });
              Util.message("Committed files:\n  " + paths.join("\n  "), Util.Msg.Info );
              Util.message("Committed: " + res.message, Util.Msg.Status );
            });
          });
        });
      });
    });
  }

  Storage.prototype.syncOrCommit = function(diff,cursors,showMerges,pullOnly) {
    var self = this;
    if (self.remote.canCommit) {
      return self.pull(diff,cursors,showMerges).then( function() {
        if (pullOnly) return;
        return self.commit();
      });
    }
    else {
      return self.sync(diff,cursors,showMerges,pullOnly);
    }
  }

  return Storage;
})();
  

return {
  openFile  : openFile,
  createFile: createFile,
  login     : login,
  discard   : discard,
  message   : message,
  upload    : uploadLocal,
  saveAs    : saveAs,

  httpOpenFile      : httpOpenFile,
  createNullStorage : createNullStorage,
  createFromTemplate: createFromTemplate,
  
  Storage         : Storage,
  unpersistStorage: unpersistStorage,  
  Encoding        : Encoding,
  isEditable      : isEditable,
  getEditPosition : getEditPosition,

  publishSite     : publishSite,
  sanitizeFileName: sanitizeFileName,  
}

});