/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/util","../scripts/promise","../scripts/storage","webmain"],
        function(util,Promise,storage,madoko) {

var Runner = (function() {

  function Runner() {
    var self = this;
    
    //self.files = new util.Map();
    self.sendFiles = [];
    self.storage = null;

    self.options = madoko.initialOptions();
    self.madokoWorker = new util.ContWorker("madoko-worker.js"); 

    self.times = [];
    self.timesSamples = 10;
  }

  Runner.prototype.setStorage = function( stg ) {
    var self = this;
    var oldStorage = self.storage;

    self.times = [200]; // clear previous times

    self.storage = stg;
    if (self.storage) {
      self.storage.addEventListener("update",self);
      self.storage.forEachFile( function(file) {
        self.sendFiles.push( { 
          name: file.path,
          content: file.content, //(file.kind === File.Image ? file.url : file.content) 
        });
      });
    }

    if (oldStorage) {
      oldStorage.clearEventListener(self);
      return self.madokoWorker.postMessage( { type: "clear" } ).then( function(res) { 
        util.message("cleared storage: " + res, util.Msg.Trace);
      });
    }
    else {
      return Promise.resolved();
    }
  }

  Runner.prototype.handleEvent = function(ev) {
    if (!ev || !ev.type) return;
    var self = this;
    if (ev.type === "update") {
      self.sendFiles.push( { name: ev.file.path, content: ev.file.content });
    }
  }

  Runner.prototype.onMadokoComplete = function(res,ctx) 
  {
    var self = this;
    //console.log( "  update done.");
    if (res.message) {
      util.message(res.message, util.Msg.Tool );
    }
    if (res.err) return Promise.rejected( res.err );
    
    //if (res.runOnServer) {
    //  self.serverRun(ctx);
    //}
    util.message("update: " + ctx.round + " done", util.Msg.Trace );
      
    if (res.time) {
      self.times.push(parseInt(res.time));
      if (self.times.length > self.timesSamples) self.times.shift();
    }

    // todo: should we wait for image url resolving?
    var images = res.filesReferred.map( function(file) {
      if (util.hasImageExt(file)) {
        return self.loadFile(ctx.round, file, true);
      }
      else if (util.hasEmbedExt(file)) {
        return self.loadFile(ctx.round, file, true);
      }
      else return Promise.resolved(0);
    });
    
    var texts = res.filesRead.map( function(file) {
      return self.loadFile(ctx.round, file, false);
    });

    // collect empty files no longer referred to
    if (self.storage) self.storage.collect( res.filesReferred.concat(res.filesRead) );

    // when we get all files from remote storage..
    return Promise.when([].concat(images,texts)).then( function(filesRead) {
      var readCount = 0;
      if (filesRead) filesRead.forEach( function(n) { readCount += n; });

      var runAgain    = readCount > 0;
      var runOnServer = res.runOnServer && !runAgain 

      if (!runAgain) {
        res.filesWritten.forEach( function(file) {
          if (util.extname(file.path) !== ".aux") { // never write aux or otherwise we may suppress needed server runs for bibtex
            util.message(ctx.round.toString() + ": worker generated: " + file.path, util.Msg.Trace );
            self.storage.writeFile(file.path,file.content,storage.File.Generated);
            runAgain = true;
            runOnServer = false;
          }
        });
      }

      var avg = self.times.reduce( function(prev,t) { return prev+t; }, 0 ) / self.times.length;
      return { content: res.content, ctx: ctx, avgTime: avg, runAgain: runAgain, runOnServer: runOnServer };      
    });
  }

  Runner.prototype.runMadoko = function(text,ctx) 
  {
    var self = this;
    util.message( "update " + ctx.round + " start", util.Msg.Trace );
    var msg = {
      type   : "run",
      content: text,
      name   : ctx.docname,
      options: self.options,
      files  : self.sendFiles      
    };
    self.sendFiles = [];
    return self.madokoWorker.postMessage( msg ).then( function(res) {
      return self.onMadokoComplete(res,ctx);
    });
  }

  Runner.prototype.runMadokoLocal = function(docName,text) 
  {
    var self = this;
    var ctx = { round: -1, includeImages: true, docname: docName };
    return self.runMadoko( text, ctx ).then( function(res) {
      if (res.runAgain) {
        ctx.round = -2;
        return self.runMadoko( text, ctx ). then( function(res2) {
          return res2.content;
        });
      }
      else {
        return res.content;
      }
    });
  }
    
  Runner.prototype.loadFile = function(round,fname,referred) {
    var self = this;
    if (!self.storage || self.storage.existsLocal(fname) || self.storage.existsLocal("out/" + fname)) {
      return Promise.resolved(0);
    }
    return self.storage.readFile( fname, referred ? false : storage.File.fromPath(fname) )
      .then( function(file) {
        util.message(round.toString() + ":storage sent: " + file.path, util.Msg.Trace);      
        return 1;
      }, function(err) {
          util.message("unable to read from storage: " + fname, util.Msg.Info);
          return 0;
      });
  }

  // Called whenever the server needs to run madoko. The server can run:
  // - bibtex: generates a document.bbl file on the server with typeset bibliographies.
  //           for this to work, we need to send over a ".bib" file and potentially
  //           a bibliography style file ".bst".
  // - latex: formulas are typeset using latex. This generates a "document.dimx" file
  //           containing all typeset formulas. For this to work, we may need to 
  //           send extra style files (".sty") or class files (".cls"). 
  Runner.prototype.runMadokoServer = function(text,ctx) {
    var self = this;
    
    // TODO: schedule run on server
    // send: document, and other files (like .bib and include files (but not images))    
    // receive back: document.dimx file (math content) and document.bbl (bibliography)
    var params = {};    
    params.docname = ctx.docname;
    if (ctx.pdf) params.pdf = ctx.pdf;
    params["/" + params.docname] = { type: "text", content: text, encoding: "utf-8" };
    
    if (self.storage) {
      self.storage.forEachFile(function(file) {
        if (file.path === params.docname) return; // use the latest version
        if (file.kind === storage.File.Text) {
          params["/" + file.path] = { type: "text", content: file.content, encoding: "utf-8" };
        }
        else if (file.kind === storage.File.Image && ctx.includeImages) {
          params["/" + file.path] = { type: "image", content: file.content, encoding: "base64" };          
        }
      });
    }
    var t0 = Date.now();
    return util.requestPOST( "/rest/run", params).then( function(data) {
      var time = (Date.now() - t0).toString() + "ms";
      util.message(data.stdout + data.stderr, util.Msg.Tool);
      util.properties(data).forEach(function(name) {
        if (name.substr(0,1) !== "/") return;
        //madoko.writeTextFile( name.substr(1), data[name] );
        var fname   = name.substr(1); 
        var content = data[name];
        util.message("server sent: " + fname, util.Msg.Trace );
        if (self.storage) {
          self.storage.writeFile(fname,content,storage.File.Generated);
        }
        else {
          // happens when there is no connection to onedrive etc.
          //self.files.set(fname,content);
          self.sendFiles.push({name:fname, content: content})
        }
      })
      util.message( "server update: " + ctx.round + "\n  time: " + time, util.Msg.Info );
      return ctx;
    });
  }  

  return Runner;
})();

// module:
return Runner;
});