/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/util"], function(util) {

  function onedriveFail(res) {
    res = (res.error && res.error.message ? res.error.message : res);
    util.message("onedrive error: " + res);
  }

  function onedriveGet( path, cont, errmsg ) {
    WL.api( { path: path, method: "GET" }).then(cont, function(resFail) {
      var msg = resFail;
      if (resFail.error && resFail.error.message) {
        msg = resFail.error.message + (resFail.error.code ? " (" + resFail.error.code + ")" : "");
      }
      onedriveFail( (errmsg ? errmsg + ": " : "") + msg );
    });
  }

    // todo: abstract WL.getSession(). implement subdirectories.
  function onedriveGetFileInfo( folderId, path, cont ) {  
    onedriveGet( folderId + "/files", function(res) {
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
      if (!file) return onedriveFail("unable to find: " + path);
      cont(file);
    }, "/files");
  }

  function onedriveGetFileInfoFromId( file_id, cont ) {
    WL.api( { path: file_id, method: "GET" } ).then(
      function(res) {
        cont(res);
      },
      function(resFail) { 
        onedriveFail(resFail); 
      } 
    );
  }

  var onedriveDomain = "https://apis.live.net/v5.0/"

  function fileDialog(cont) {
    WL.fileDialog( {
      mode: "open",
      select: "single",
    }).then( function(res) 
    {
      if (!(res.data && res.data.files && res.data.files.length==1)) return onedriveFail("no file selected");
      var file = res.data.files[0];
      onedriveGetFileInfoFromId( file.id, function(info) {
        var storage = new Storage(info.parent_id);
        cont( storage, file.name );
      });
    }, onedriveFail );
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

    Storage.prototype.readTextFile = function( fpath, cont ) {
      var self = this;
      var file = self.files.get(fpath);
      if (file) return cont(file.content);
      
      self.getFileInfo( fpath, function(info) {
        $.get( "onedrive", { url: info.source }, function(content) {
          self.files.set( fpath, { info: info, content: content });
          cont( content );
        });
      });
    }

    Storage.prototype.getImageUrl = function( fpath, cont ) {
      var self = this;
      self.getFileInfo( fpath, function(info) {
        var url = onedriveDomain + info.id + "/picture?type=full&access_token=" + WL.getSession().access_token;
        cont(url);
      });
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