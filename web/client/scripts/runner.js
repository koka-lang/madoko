/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/util","webmain"],
        function(util,madoko) {

var Runner = (function() {

  function Runner() {
    var self = this;
    
    //self.files = new util.Map();
    self.sendFiles = [];
    self.storage = null;

    self.options = madoko.initialOptions();
    self.options.mathEmbedLimit = 256 * 1024;
    self.madokoWorker = new util.ContWorker("madoko-worker.js"); 
  }

  Runner.prototype.setStorage = function( storage ) {
    var self = this;
    if (self.storage) {
      self.storage.clearEventListener(self);
    }
    self.storage = storage;
    if (self.storage) {
      self.storage.addEventListener("update",self);
      self.storage.forEachTextFile( function(path,content) {
        self.sendFiles.push( { name: path, content: content });
      });
    }
  }

  Runner.prototype.handleEvent = function(ev) {
    if (!ev || !ev.type) return;
    var self = this;
    if (ev.type === "update") {
      self.sendFiles.push( { name: ev.path, content: ev.content });
    }
  }

  Runner.prototype.onMadokoComplete = function(res,ctx,cont) 
  {
    var self = this;
    //console.log( "  update done.");
    if (res.message) {
      util.message(res.message, util.Msg.Tool );
    }
    
    //if (res.runOnServer) {
    //  self.serverRun(ctx);
    //}
    if (res.time) {
      util.message("update: " + ctx.round + "\n  time: " + res.time + "ms", util.Msg.Info );
    }
    
    res.filesRead.forEach( function(file) {
      if (hasTextExt(file)) {
        self.loadText(file);
      }        
    });
    res.filesReferred.forEach( function(file) {
      if (hasImageExt(file)) {
        self.loadImage(file);
      }
    });

    if (cont) cont(null,ctx,res.content,res.runOnServer);
  }

  Runner.prototype.runMadoko = function(text,ctx,cont) 
  {
    var self = this;
    util.message( "update " + ctx.round + " start", util.Msg.Trace );
    self.madokoWorker.postMessage( {
      content: text,
      name   : ctx.docname,
      options: self.options,
      files  : self.sendFiles      
    }, function(res) {
      self.onMadokoComplete(res,ctx,cont);
    });
    self.sendFiles = [];
  }

    
  var imageExts = ["",".jpg",".png",".gif",".svg"].join(";");
  function hasImageExt(fname) {
    var ext = util.extname(fname);
    if (!ext) return false;
    return util.contains(imageExts,ext);
  }

  var textExts = ["",".bib",".mdk",".md",".txt"].join(";");
  function hasTextExt(fname) {
    var ext = util.extname(fname);
    if (!ext) return false;
    return util.contains(textExts,ext);
  }

  Runner.prototype.loadImage = function( fname ) {
    var self = this;
    if (!self.storage) return;
    self.storage.getImageUrl( fname, function(err,url) {
      if (err) return util.message(err);
      util.message("storage provided reference: " + fname, util.Msg.Trace);      
      self.options.imginfos = madoko.addImage(self.options.imginfos,fname,url);
    });
  }

  Runner.prototype.loadText = function(fname ) {
    var self = this;
    if (!self.storage) return;
    self.storage.readTextFile( fname, true, function(err,content) {
      if (err) return util.message(err);
      util.message("storage sent: " + fname, util.Msg.Trace);      
      //self.files.set(fname,content);
      //self.sendFiles.push({ name: fname, content: content });
    });
  }

  // Called whenever the server needs to run madoko. The server can run:
  // - bibtex: generates a document.bbl file on the server with typeset bibliographies.
  //           for this to work, we need to send over a ".bib" file and potentially
  //           a bibliography style file ".bst".
  // - latex: formulas are typeset using latex. This generates a "document.dimx" file
  //           containing all typeset formulas. For this to work, we may need to 
  //           send extra style files (".sty") or class files (".cls"). 
  Runner.prototype.runMadokoServer = function(text,ctx,cont) {
    var self = this;
    
    // TODO: schedule run on server
    // send: document, and other files (like .bib and include files (but not images))    
    // receive back: document.dimx file (math content) and document.bbl (bibliography)
    var params = {};    
    params.docname = ctx.docname;
    params["/" + params.docname] = text;
    
    if (self.storage) {
      self.storage.forEachTextFile( function(fname,content) {
        params["/" + fname] = content;
      });
    }
    var t0 = Date.now();
    util.requestPOST( "/rest/run", params, function(err,data) {
      if (err) return cont(util.message(err),ctx);
      var time = (Date.now() - t0).toString() + "ms";
      util.message(data.stdout + data.stderr, util.Msg.Tool);
      util.properties(data).forEach(function(name) {
        if (name.substr(0,1) !== "/") return;
        //madoko.writeTextFile( name.substr(1), data[name] );
        var fname   = name.substr(1); 
        var content = data[name];
        util.message("server sent: " + fname, util.Msg.Trace );
        if (self.storage) {
          self.storage.writeTextFile(fname,content);
        }
        else {
          // happens when there is no connection to onedrive etc.
          //self.files.set(fname,content);
          self.sendFiles.push({name:fname, content: content})
        }
      })
      util.message( "server update: " + ctx.round + "\n  time: " + time, util.Msg.Info );
      cont(null,ctx);
    });
  }  

  return Runner;
})();

// module:
return Runner;
});