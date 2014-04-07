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
      if (!file) return cont( onedriveError("unable to find: " + path), file )
      cont( null, file);
    }, "get files");
  }

  function onedriveGetFileInfoFromId( file_id, cont ) {
    onedriveGet( file_id, cont );
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
    }

    Storage.prototype.getFileInfo = function( fpath, cont ) {  
      var self = this;
      onedriveGetFileInfo( self.folderId, fpath, cont );
    }

    Storage.prototype.createLocalFile = function(fpath,content) {
      var self = this;
      self.files.set(fpath,{
        info     : null,
        content  : content,
        localOnly: true,
        written  : false,
      });
    }

    Storage.prototype.readTextFile = function( fpath, cont ) {
      var self = this;
      var file = self.files.get(fpath);
      if (file) return cont(file.content);
      
      self.getFileInfo( fpath, function(err,info) {
        if (err) {
          self.createLocalFile(fpath,"");  
          cont(err,"");
        }
        else {
          $.get( "onedrive", { url: info.source }, function(content) {
            self.files.set( fpath, { 
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
          self.files.set( fpath, {
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

    return Storage;
  })();
  
  function init(options) {
    if (!options.response_type) options.response_type = "token";
    if (!options.scope) options.scope = ["wl.signin","wl.skydrive"];
    WL.init(options);
  }

  return {
    init: init,
    fileDialog: fileDialog,
  }
});