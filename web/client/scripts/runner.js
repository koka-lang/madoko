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
    
    self.sendFiles = new util.Map();
    self.storage = null;

    self.options = madoko.initialOptions();
    self.madokoWorker = new util.ContWorker("madoko-worker.js"); 

    self.times = [];
    self.timesSamples = 10;
  }

  Runner.prototype.setStorage = function( stg ) {
    var self = this;

    self.times = [200]; // clear previous run-time statistics
    self.storage = stg;
    if (self.storage) {
      self.storage.addEventListener("update",self);
      self.storage.forEachFile( function(file) {
        if (file.mime !== "application/pdf") {
          self.sendFiles.set( file.path, { 
            path: file.path,
            encoding: file.encoding,
            mime: file.mime,
            content: file.content, //(file.kind === File.Image ? file.url : file.content) 
          });
        }
      });
    }
  }

  Runner.prototype.handleEvent = function(ev) {
    if (!ev || !ev.type) return;
    var self = this;
    if (ev.type === "update") {
      self.sendFiles.set( ev.file.path, { 
        path: ev.file.path, 
        content: ev.file.content,
        encoding: ev.file.encoding,
        mime: ev.file.mime,
      });
    }
    else if (ev.type === "destroy") {
      self.madokoWorker.postMessage( { type: "clear" } );
      self.storage = null;
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
    var filesReferred = res.filesReferred.concat( [
                          util.combine("out", util.changeExt(res.name, ".html")),
                          util.combine("out", util.changeExt(res.name, ".pdf")) 
                        ]);
    var referred = filesReferred.map( function(file) {
      return self.loadFile(ctx.round, file, true);
      /*      
      if (util.hasImageExt(file)) {
        return self.loadFile(ctx.round, file, true);
      }
      else if (util.hasEmbedExt(file)) {
        return self.loadFile(ctx.round, file, true);
      }
      else return Promise.resolved(0);
      */
    });
    
    var texts = res.filesRead.map( function(file) {
      return self.loadFile(ctx.round, file, false);
    });

    // collect empty files no longer referred to
    if (self.storage) self.storage.collect( [res.name].concat(res.filesReferred,res.filesRead) );

    // when we get all files from remote storage..
    return Promise.when([].concat(referred,texts)).then( function(filesRead) {
      var readCount = 0;
      if (filesRead) filesRead.forEach( function(n) { readCount += n; });

      var runAgain    = readCount > 0;
      var runOnServer = res.runOnServer && !runAgain 

      if (!runAgain) {
        res.filesWritten.forEach( function(file) {
          if (util.extname(file.path) !== ".aux") { // never write aux or otherwise we may suppress needed server runs for bibtex
            util.message(ctx.round.toString() + ": worker generated: " + file.path, util.Msg.Trace );
            if (self.storage) self.storage.writeFile(file.path, file.content );
            runAgain = true;
            runOnServer = false;
          }
        });
      }

      var avg = self.times.reduce( function(prev,t) { return prev+t; }, 0 ) / self.times.length;
      return { content: res.content, ctx: ctx, avgTime: avg, runAgain: runAgain, runOnServer: runOnServer };      
    });
  }

  Runner.prototype.runMadoko = function(text,ctx,options) 
  {
    var self = this;
    util.message( "update " + ctx.round + " start", util.Msg.Trace );
    var msg = {
      type   : "run",
      content: text,
      name   : ctx.docname,
      options: options || self.options,
      files  : self.sendFiles.elems(),      
    };
    self.sendFiles.clear();
    return self.madokoWorker.postMessage( msg ).then( function(res) {
      return self.onMadokoComplete(res,ctx);
    });
  }

  Runner.prototype.runMadokoLocal = function(docName,text) 
  {
    var self = this;
    var ctx = { round: -1, includeImages: true, docname: docName };
    var options = util.copy(self.options);
    options.lineNo = 0;
    return self.runMadoko( text, ctx, options ).then( function(res) {
      if (res.runAgain) {
        ctx.round = -2;
        return self.runMadoko( text, ctx, options ). then( function(res2) {
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
    return self.storage.readFile( fname, !referred, { searchDirs: ["out"] } )
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
    if (ctx.round) params.round = ctx.round;
    params.files = [];
    params.files.push( { 
      path: params.docname,
      mime: util.mimeFromExt(ctx.docname), 
      encoding: storage.Encoding.fromExt(ctx.docname),
      content: text, 
    });
    
    if (self.storage) {
      self.storage.forEachFile(function(file) {
        if (file.path === params.docname) return; // use the latest version
        if (util.startsWith(file.mime, "text/") || (util.startsWith(file.mime, "image/") && ctx.includeImages)) {
          params.files.push( { 
            path: file.path,
            mime: file.mime, 
            content: file.content, 
            encoding: file.encoding 
          });
        }
      });
    }
    var t0 = Date.now();
    return util.requestPOST( "/rest/run", params).then( function(data) {
      var time = (Date.now() - t0).toString() + "ms";
      util.message(data.stdout + data.stderr, util.Msg.Tool);
      data.files.forEach( function(file) {
        util.message("server sent: " + file.path, util.Msg.Trace );
        if (self.storage) {
          self.storage.writeFile( file.path, file.content, {
            encoding: file.encoding,
            mime: file.mime,
          });
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