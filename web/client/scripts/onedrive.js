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
    console.log(msg);
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
    onedriveCont( WL.api( { path: path, method: "GET" }), cont, errmsg );
  }

    // todo: abstract WL.getSession(). implement subdirectories.
  function onedriveGetFileInfo( folderId, path, cont ) {  
    onedriveGet( folderId + "/files", function(err, res) {
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

  function onedriveGetFileInfoFromId( file_id, cont ) {
    onedriveGet( file_id, cont );
  }

  function onedriveGetWriteAccess( cont ) {
    onedriveCont( WL.login({ scope: ["wl.signin","wl.skydrive","wl.skydrive_update"]}), cont );  
  }

  function onedriveWriteFile( folderId, path, content, overwrite, cont ) {
    // TODO: resolve sub-directories
    var url = onedriveDomain + folderId + "/files/" + path + "?" +
                (overwrite ? "" : "overwrite=false&") +
                "access_token=" + WL.getSession().access_token;
    util.requestPUT( {url:url,contentType:";" }, content, cont );
  }

  var onedriveDomain = "https://apis.live.net/v5.0/"

  function fileDialog(cont) {
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
        var storage = new Storage(info.parent_id);
        cont( null, storage, file.name );
      });
    });
  }      
    
  var Storage = (function() {
    function Storage( folderId ) {
      var self = this;
      self.folderId = folderId;
      self.files = new util.Map();
      self.listeners = [];
      self.unique = 1;
    }

    /* Generic */
    Storage.prototype.createTextFile = function(fpath,content) {
      var self = this;
      self.writeTextFile(fpath,content,true);
    }

    Storage.prototype.forEachTextFile = function( action ) {
      var self = this;
      self.files.forEach( function(file) {
        if (!file.url) {
          action(file.path, file.content);
        }
      });
    }

    Storage.prototype.writeTextFile = function( fpath, content, localOnly ) {
      var self = this;
      var file = self.files.get(fpath);

      self.updateFile( fpath, {
        info     : (file ? file.info : null),
        content  : content,
        localOnly: (file ? file.localOnly : (localOnly != null)),
        written  : (content !== "")
      });
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
    Storage.prototype.updateFile = function( fpath, info ) {
      var self = this;
      
      // finish info with path and created 
      info.path = fpath;
      if (!info.created) {
        if (info.info) {
          info.created = info.info.updated_time;
        }
        else {
          info.created = Date.now(); 
        }
      }
      
      // check same content
      var file = self.files.get(fpath);
      if (file && file.content === info.content) return;

      // update
      self.files.set(fpath,info);
      self.fireEvent("update", { path: fpath, content: info.content });
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

    /* Specific for Onedrive */
    // private
    Storage.prototype.getFileInfo = function( fpath, cont ) {  
      var self = this;
      onedriveGetFileInfo( self.folderId, fpath, cont );
    }

    Storage.prototype.pushFile = function( file, cont ) {
      var self = this;
      onedriveWriteFile( self.folderId, file.path, file.content, file.info != null, function(errPut,resp) {
        if (errPut) return cont(errPut,file.path);
        onedriveGetFileInfoFromId( resp.id, function(errInfo,info) {
          if (errInfo) return cont(errInfo,file.path);
          file.info = info; // update id and time
          cont(null,file.path);
        });
      });
    }

    /* Interface */
    Storage.prototype.readTextFile = function( fpath, cont ) {
      var self = this;
      var file = self.files.get(fpath);
      if (file) return cont(null, file.content);
      
      self.getFileInfo( fpath, function(err,info) {
        if (err || info==null) {
          self.createLocalFile(fpath,"");  
          cont(err,"");
        }
        else {
          //var urlpath = info.id + "/content"; //self.folderId + "/files/" + fpath; // + "?access_token=" + WL.getSession().access_token;
          //var url = onedriveDomain + urlpath + "?access_token=" + WL.getSession().access_token;
          //onedriveGet(  urlpath,
          //var url = info.source + "&access_token=" + WL.getSession().access_token;
          //util.requestGET( url, {}, 
          util.requestGET( "onedrive", { url: info.source }, function(errGet,content) {
            if (errGet) return cont(errGet,content);
            self.updateFile( fpath, { 
              info     : info, 
              content  : content,
              localOnly: false,
              written  : false            
            });
            cont( null, content );
          });
        }
      });
    }

    Storage.prototype.getImageUrl = function( fpath, cont ) {
      var self = this;
      var file = self.files.get(fpath);
      if (file) {
        if (!file.url) return cont("not an image: " + fpath, ""); 
        cont(null,file.url);
      }
      else {
        self.getFileInfo( fpath, function(err,info) {
          if (err) return cont(err,"");
          var url = onedriveDomain + info.id + "/picture?type=full&access_token=" + WL.getSession().access_token;
          self.updateFile( fpath, {
            info     : info,
            content  : "",
            url      : url,
            localOnly: false,
            written  : false,
          });
          cont(null,url);
        });
      }
    }

    Storage.prototype.sync = function( cont ) {
      var self = this;
      var remotes = new util.Map();

      onedriveGetWriteAccess( function(errAccess) {
        if (errAccess) return util.message("cannot get write permission. sync failed.");

        util.asyncForEach( self.files.elems(), function(file, xfcont) {
          function fcont(err,action) {
            action = file.path + (action ? ": " + action : "");
            xfcont( (err ? file.path + ": " + err.toString() : null), action);
          }

          // only text files
          if (file.url || (file.localOnly && !file.content)) return fcont(null,"skip");

          self.getFileInfo( file.path, function(errInfo,info) {
            if (errInfo) {
              // file is deleted on server, or just not there
              file.info = null; // clear info, so we do not overwrite
              info = null;  
            }

            var modifiedTime = (info ? info.updated_time : file.created);
            if (file.written) {
              if (file.created !== modifiedTime) {
                // modified on client and server
                fcont( "modified on server!", "merge from server" );
              }
              else {
                // write back the client changes
                self.pushFile( file, function(errPush,resp) {
                  fcont(errPush,"save to server");  
                });
              }
            }
            else if (file.created !== modifiedTime) {
              // update from sever
              self.files.delete(file.path);
              self.readTextFile(file.path, function(errRead,content) {
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
            util.message(msg);
          })
          if (err) {
            util.message(err);
            util.message("unable to sync!!")
          }
          cont(err);
        });
      });
    }

    return Storage;
  })();
  
  function init(options) {
    if (!options.response_type) options.response_type = "token";
    if (!options.scope) options.scope = ["wl.signin","wl.skydrive"];
    WL.init(options).then( function(res) {
      console.log("success");
    }, function(resFail) {
      console.log("failure");
    });
  }

  return {
    init: init,
    fileDialog: fileDialog,
  }
});