/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/util","webmain"],
        function(util,madoko) {

var Runner = (function() {

  function Runner(ui) {
    var self = this;
    self.ui    = ui;
    self.files = new util.Map();
    self.sendFiles = [];

    self.options = madoko.initialOptions();
    self.options.mathEmbedLimit = 256 * 1024;
    self.madokoWorker = new util.ContWorker("madoko-worker.js");  
  }

  Runner.prototype.onMadokoComplete = function(res,ctx,cont) 
  {
    var self = this;
    if (res.message) {
      util.message(" " + res.message);
    }
    if (res.content) {
      view.innerHTML = res.content;
      //MathJax.Hub.Queue(["Typeset",MathJax.Hub,"view"]); // schedule mathjax    
    }
    if (res.runOnServer) {
      self.serverRun(ctx);
    }
    if (res.time) {
      util.message(" time: " + res.time + "ms" );
    }
    if (ctx && ctx.storage) {
      //message("files read:\n  " + res.filesRead.join("\n  "));
      res.filesRead.forEach( function(file) {
        if (!(self.files.contains(file)) && hasTextExt(file)) {
          self.loadText(ctx.storage, file);
        }        
      });
      res.filesReferred.forEach( function(file) {
        if (hasImageExt(file)) {
          self.loadImage(ctx.storage, file);
        }
      });
    }
    if (cont) cont(ctx);
  }

  Runner.prototype.runMadoko = function(text,ctx,cont) 
  {
    var self = this;
    util.message( "update " + ctx.round.toString() + " ..." );
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

  Runner.prototype.loadImage = function( storage, fname ) {
    var self = this;
    storage.getImageUrl( fname, function(err,url) {
      if (err) return util.message(err);
      util.message("storage provided reference: " + fname);      
      self.options.imginfos = madoko.addImage(self.options.imginfos,fname,url);
    });
  }

  Runner.prototype.loadText = function( storage, fname ) {
    var self = this;
    storage.readTextFile( fname, function(err,data) {
      if (err) return util.message(err);
      util.message("storage sent: " + fname);      
      self.files.set(fname,data);
      self.sendFiles.push({ name: fname, content: data });
    });
  }

  // Called whenever the server needs to run madoko. The server can run:
  // - bibtex: generates a document.bbl file on the server with typeset bibliographies.
  //           for this to work, we need to send over a ".bib" file and potentially
  //           a bibliography style file ".bst".
  // - latex: formulas are typeset using latex. This generates a "document.dimx" file
  //           containing all typeset formulas. For this to work, we may need to 
  //           send extra style files (".sty") or class files (".cls"). 
  Runner.prototype.serverRun = function(ctx) {
    var self = this;
    if (!self.ui.allowServer) return;

    var text = self.ui.getEditText();

    // TODO: schedule run on server
    // send: document, and other files (like .bib and include files (but not images))    
    // receive back: document.dimx file (math content) and document.bbl (bibliography)
    var params = {};    
    params.docname = ctx.docname;
    params["/" + params.docname] = text;
    self.files.forEach( function(fname,content) {
      params["/" + fname] = content;
    });

    $.post( "/rest/run", params, function(data,status,jqXHR) {
      util.message(data.stdout + data.stderr);
      util.properties(data).forEach(function(name) {
        if (name.substr(0,1) !== "/") return;
        //madoko.writeTextFile( name.substr(1), data[name] );
        var fname = name.substr(1); 
        var content = data[name];
        util.message("server sent: " + fname );
        self.files.set(fname,content);
        self.sendFiles.push({name:fname, content: content})
      })
      //runMadoko(editor.getValue());
      self.ui.setStale();
    });
  }  

  return Runner;
})();

// module:
return Runner;
});