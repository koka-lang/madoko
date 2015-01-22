/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/map","../scripts/util","../scripts/promise"],
        function(Map,Util,Promise) {

var SpellChecker = (function() {

  function SpellChecker() {
    var self = this;    
    self.scWorker = new Util.ContWorker("spellcheck-worker.js", true); 
    self.dictionaries = new Map();
    self.storage = null;
    self.ignores = null;
  }

  SpellChecker.prototype.setStorage = function(stg) {
    var self = this;
    self.storage = stg;
    if (self.storage) {
      self.storage.addEventListener("update",self);
      self.storage.readFile("ignores.dic",false).then( function(file) {
        self.ignores = file.content;
      });
    }
  }

  SpellChecker.prototype.handleEvent = function(ev) {
    if (!ev || !ev.type) return;
    var self = this;
    if (ev.type === "update" && ev.file && ev.file.path === "ignores.dic") { 
      self.ignores = ev.file.content;
      self.scWorker.postMessage({
        type: "ignores",
        ignores: self.ignores,
      })
    }
    else if (ev.type==="destroy") {
      //self.scWorker.postMessage( { type: "clear" } );
      self.storage = null;
      return;
    }
  }

  SpellChecker.prototype.addDictionary = function(lang) {
    var self = this;
    if (!lang) lang = "en_US";
    if (self.dictionaries.contains(lang)) return Promise.resolved();
    var dicPath = "dictionaries/" + lang + "/" + lang;
    return Util.requestGET( dicPath + ".aff" ).then( function(affData) {
      return Util.requestGET( dicPath + ".dic" ).then( function(dicData) {
        return Util.requestGET( { url: dicPath + "_extra.dic", defaultContent: "" } ).then( function(dicExtraData) {
          return Util.requestGET( { url: "dictionaries/generic.dic", defaultContent: "" } ).then( function(dicGeneric) {
            return self.scWorker.postMessage( { 
              type: "dictionary",
              lang: lang,
              affData: affData,
              dicData: dicData + "\n" + dicExtraData + "\n" + dicGeneric,
              ignores: self.ignores,
            }).then( function() {
              self.dictionaries.set(lang,true);
            });
          });
        });
      });
    });
  }

  
  SpellChecker.prototype.check = function(text,ctx,options) 
  {
    var self = this;
    return self.addDictionary().then( function() {
      Util.message( "spell check " + ctx.round + " start", Util.Msg.Trace );
      var msg = {
        type   : "check",
        text   : text,
        options: options,
      };
      return self.scWorker.postMessage( msg, 30000 ).then( function(res) {
        if (res.timedOut) {
          throw new Error("spell checker time-out");
        }
        return self.onCheckComplete(res,ctx);
      });
    });
  }

  SpellChecker.prototype.onCheckComplete = function(res,ctx) {
    var self = this;
    if (res.message) Util.message(res.message, Util.Msg.Tool);

    if (res.errors != null && res.errors.length > 0 && ctx.show) {
      var errors = [];
      res.errors.forEach( function(err) {
        errors.push({
          type: "spellcheck",
          range: {
            startLineNumber: err.line,
            endLineNumber: err.line,
            startColumn: err.column,
            endColumn: err.column + err.length,
            fileName: ctx.fileName,
          },
          message: "possibly invalid word",
        });
      });
      ctx.show(errors);
    }
  }  


  return SpellChecker;
})();

// module:
return SpellChecker;
});