/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/map","../scripts/util","../scripts/promise","../scripts/storage","webmain"],
        function(Map,Util,Promise,Storage,Madoko) {

var Runner = (function() {

  function Runner() {
    var self = this;
    
    self.sendFiles = new Map();
    self.storage = null;

    self.options = Madoko.initialOptions();
    self.madokoWorker = new Util.ContWorker("madoko-worker.js"); 

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
    else if (ev.type === "delete") {
      self.madokoWorker.postMessage( { 
        type: "delete", 
        files: [{ path: ev.file.path }],
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
      Util.message(res.message, Util.Msg.Tool );
    }
    if (res.err) return Promise.rejected( res.err );
    if (!self.storage || ctx.storageId !== self.storage.storageId) return Promise.rejected(new Error("stale request"));
    
    if (ctx.showErrors) {
      ctx.message = self.showLatexMessages(res.stdout, ctx.showErrors, ctx.docname);
    }

    
    //if (res.runOnServer) {
    //  self.serverRun(ctx);
    //}
    Util.message("update: " + ctx.round + " done", Util.Msg.Trace );
      
    if (res.time) {
      self.times.push(parseInt(res.time));
      if (self.times.length > self.timesSamples) self.times.shift();
    }

    // todo: should we wait for image url resolving?
    var filesReferred = res.filesReferred.concat( [
                          Util.combine("out", Util.changeExt(res.name, ".html")),
                          Util.combine("out", Util.changeExt(res.name, ".pdf")) 
                        ]);
    var referred = filesReferred.map( function(file) {
      return self.loadFile(ctx.round, file, !Util.hasEmbedExt(file));      
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
          if (Util.extname(file.path) !== ".aux") { // never write aux or otherwise we may suppress needed server runs for bibtex
            Util.message(ctx.round.toString() + ": worker generated: " + file.path, Util.Msg.Trace );
            if (self.storage) self.storage.writeFile(file.path, file.content );
            runAgain = true;
            runOnServer = false;
          }
        });
      }

      var avg = self.times.reduce( function(prev,t) { return prev+t; }, 0 ) / (self.times.length || 1);
      return { 
        content: res.content, 
        ctx: ctx, 
        avgTime: avg, 
        runAgain: runAgain, 
        runOnServer: runOnServer, 
        mathDoc: res.mathDoc,
        links: res.links,
        labels: res.labels
      };      
    });
  }

  Runner.prototype.runMadoko = function(text,ctx,options) 
  {
    var self = this;
    Util.message( "update " + ctx.round + " start", Util.Msg.Trace );
    var msg = {
      type   : "run",
      content: text,
      name   : ctx.docname,
      options: options || Util.copy(self.options),
      files  : self.sendFiles.elems(),      
    };
    if (ctx.round >= 0) msg.options.modes = "preview";
    ctx.storageId = self.storage.storageId;
    self.sendFiles.clear();
    return self.madokoWorker.postMessage( msg, 30000 ).then( function(res) {
      if (res.timedOut) {
        throw new Error("madoko worker time-out");
      }
      return self.onMadokoComplete(res,ctx);
    });
  }

  Runner.prototype.runMadokoLocal = function(docName,text,extraOptions) 
  {
    var self = this;
    var ctx = { round: -1, includeImages: true, docname: docName, storageId: self.storage.storageId };
    var options = Util.copy(self.options);
    options.lineNo = 0;
    Util.extend(options,extraOptions);
    return self.runMadoko( text, ctx, options ).then( function(res) {
      if (!self.storage || ctx.storageId !== self.storage.storageId) throw new Error("stale request");
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
        Util.message(round.toString() + ":storage sent: " + file.path, Util.Msg.Trace);      
        return 1;
      }, function(err) {
          Util.message("unable to read from storage: " + fname, Util.Msg.Info);
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
      mime: Util.mimeFromExt(ctx.docname), 
      encoding: Storage.Encoding.fromExt(ctx.docname),
      content: text, 
    });
    
    if (self.storage) {
      self.storage.forEachFile(function(file) {
        if (file.path === params.docname) return; // use the latest version
        if (Util.isTextMime(file.mime) || (ctx.includeImages && Util.isImageMime(file.mime) && ((Util.extname(file.path) != ".pdf") || (file.path != "out/" + Util.stemname(ctx.docname) + ".pdf")))) {
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
    var sid = self.storage.storageId;
    return Util.requestPOST( "/rest/run", {}, params).then( function(data) {
      if (!self.storage || self.storage.storageId !== sid) {
        ctx.errorCode = 1;
        ctx.message = "stale request";
      }
      else {
        var time = (Date.now() - t0).toString() + "ms";
        Util.message(data.stdout + data.stderr, Util.Msg.Tool);      
        data.files.forEach( function(file) {
          Util.message("server sent: " + file.path, Util.Msg.Trace );
          self.storage.writeFile( file.path, file.content, {
            encoding: file.encoding,
            mime: file.mime,
            nosync: (Util.extname(file.path) === ".log" ? true : false),
          });
        });
        if (ctx.showErrors) {
          ctx.message = self.showLatexMessages(data.stdout + data.stderr, ctx.showErrors, ctx.docname);
        }
        Util.message( "server update: " + ctx.round + "\n  time: " + time, Util.Msg.Info );
        if (/^[\t ]*error\b[\w \t]+:/m.test(data.stdout + data.stderr)) {
          ctx.errorCode = 1;
        }
        else {
          ctx.errorCode = 0;
        }
      }
      return ctx.errorCode;
    });
  }  

  Runner.prototype.showLatexMessages = function( output, show, docname) {
    var self = this;
    var errors = [];
    // location latex errors
    var rx = /(?:^|\n) *(error|warning) *: *(?:source +line *: *)?([\w\-\.;:\\\/]*)\s*([\s\S]*?)(?=\r?\n[ \t\r]*\n)/gi;
    var cap;
    while ((cap = rx.exec(output)) != null) {
      var location = cap[2];
      var message  = cap[3];
      var i = location.lastIndexOf(";");
      if (i >= 0) location = location.substr(i+1);
      var capl = /^\s*(?:([^:]*):)?(\d+)\s*$/.exec(location);
      if (capl) {
        var line = parseInt(capl[2]);
        var fileName = capl[1] || "";
        var range = {
          startLineNumber: line,
          endLineNumber: line,
          startColumn: 1,
          endColumn: 1,
          fileName: fileName,
        };
        errors.push( { type: cap[1].toLowerCase(), range: range, message: message } );  
      }
    }

    // madoko  errors
    var rx = /^ *(error|warning) *: *((?:[^:]|:\d+)+):(.*)$/gim;
    var cap;
    while ((cap = rx.exec(output)) != null) {
      var location = cap[2];
      var message  = cap[3];
      var i = location.lastIndexOf(";");
      if (i >= 0) location = location.substr(i+1);
      var capl = /^\s*(?:([^:]*):)?(\d+)\s*$/.exec(location);
      if (capl) {
        var line = parseInt(capl[2]);
        var fileName = capl[1] || "";
        var range = {
          startLineNumber: line,
          endLineNumber: line,
          startColumn: 1,
          endColumn: 1,
          fileName: fileName,
        };
        errors.push( { type: cap[1].toLowerCase(), glyphType: "error", range: range, message: message } );  
      }
    }

    // after bug fix in latex error regex in madoko this seems no longer necessary?
    // other errors
    rx = /^(.*)\r?\n[ \t]*![ \t]*LaTeX Error:(.+)/mgi;    
    while ((cap = rx.exec(output)) != null) {
      if (!(/^[ \t]*error:[ \t]*source line:/.test(cap[1]))) {
        var range = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1, fileName: docname};
        errors.unshift( { type: "error", range: range, message: cap[2] } ); 
      }
    }
    
    
    show(errors);
    if (errors.length > 0) {
      var err = errors[0]; 
      var msg = err.message.replace(/^\s*(.*)[\s\S]*/,"$1"); // just the first line    
      return (err.type + ": " + err.range.fileName + ":" + err.range.startLineNumber + ": " + msg);
    }
    else {
      var log = Util.basename(docname) + ".log";
      return "unknown error: see the " + log + " file for more info";
    }
  }

  return Runner;
})();

// module:
return Runner;
});