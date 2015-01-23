/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/map","../scripts/util","../scripts/promise"],
        function(Map,Util,Promise) {

var SpellCheckMenu = (function() {
  function SpellCheckMenu(checker,replacer,remover) {
    var self = this;
    self.checker = checker;
    self.replacer = replacer;
    self.remover  = remover;
    self.text = null;
  }
  
  SpellCheckMenu.prototype.triggerOn = function( elem, range, text, info ) {
    return Util.hasClassName(elem,"spellerror");
  }

  SpellCheckMenu.prototype.setWidget = function( widget ) {
    var self = this;
    self.widget = widget;
    widget._domNode.addEventListener("click", function(ev) {
      self.onClick(ev);
    });
  }
  
  SpellCheckMenu.prototype.setContext = function( elem, range, text, info ) {
    var self = this;
    self.range = range;
    self.text = text;
    self.info = info;
  }

  SpellCheckMenu.prototype.getContent = function() {
    var self = this;
    return "<div class='button' data-ignore='true'>Ignore " + Util.escape(self.text) + "</div>"
  }

  SpellCheckMenu.prototype.asyncGetContent = function() {
    var self = this;
    return self.checker.suggest(self.text,{}).then( function(res) {
      var buttons = res.suggestions.map( function(suggest) {
        return "<div class='button' data-replace='" + encodeURIComponent(suggest) + "'>" + Util.escape(suggest) + "</div>"
      });
      return buttons.join("") + (res.suggestions.length > 0 ? "<hr>" : "");
    });
  }

  SpellCheckMenu.prototype.onClick = function(ev) {
    var self = this;
    if (!ev.target || !Util.hasClassName(ev.target,"button")) return;
    var replace = ev.target.getAttribute("data-replace");
    if (self.replacer && replace) {
      self.replacer( self.range, decodeURIComponent(replace) );
      if (self.remover && self.info && self.info.id) self.remover(self.info.id); // remove decoration    
    }
    else if (ev.target.getAttribute("data-ignore")) {
      self.checker.ignore( self.text );
      if (self.remover) self.remover(null,self.text); // remove decoration   
    }
    self.widget.hide();
  }

  return SpellCheckMenu;
})();          

var SpellChecker = (function() {

  function SpellChecker() {
    var self = this;    
    self.scWorker = new Util.ContWorker("spellcheck-worker.js", true); 
    self.dictionaries = new Map();
    self.storage = null;
    self.files = new Map();
  }

  SpellChecker.prototype.setStorage = function(stg) {
    var self = this;
    self.storage = stg;
    self.files = new Map();
    if (self.storage) {
      self.storage.addEventListener("update",self);
    }
  }

  SpellChecker.prototype.handleEvent = function(ev) {
    if (!ev || !ev.type) return;
    var self = this;
    if (ev.type === "update" && ev.file && ev.file.path === "ignores.dic") { 
      self.scWorker.postMessage({
        type: "ignores",
        ignores: ev.file.content,
      })
    }
    else if (ev.type==="delete") {
      self.files.remove(ev.file.path);
    }
    else if (ev.type==="destroy") {
      //self.scWorker.postMessage( { type: "clear" } );
      self.storage = null;
      self.files = new Map();
      return;
    }
  }

  SpellChecker.prototype.ignore = function(word) {
    var self = this;
    if (!word || !self.storage) return Promise.resolved();
    return self._readIgnores().then( function(ignores) {
      var newignores = ignores + (ignores.length > 0 ? "\n" : "") + word.replace(/\s+/g,"");
      self.storage.writeFile("ignores.dic", newignores );
    });
  }

  SpellChecker.prototype._readIgnores = function() {
    var self = this;
    if (!self.storage) return Promise.resolved("");
    return self.storage.readFile( "ignores.dic", false ).then( function(file) { 
      return file.content;
    }, function(err) { 
      return ""; 
    });
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
            return self._readIgnores().then( function(ignores) {
              return self.scWorker.postMessage( { 
                type: "dictionary",
                lang: lang,
                affData: affData,
                dicData: dicData + "\n" + dicExtraData + "\n" + dicGeneric,
                ignores: ignores,
              }).then( function() {
                self.dictionaries.set(lang,true);
              });
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
      var files = [];
      if (ctx.path && text) {
        var info = self.files.getOrCreate(ctx.path, { text: text, errors: [] });
        files.push( { path: ctx.path, text: info.text } );
      }
      self.storage.forEachFile( function(file) {
        if (file.path !== ctx.path && (file.mime === "text/markdown" || file.mime === "text/madoko")) {
          var info = self.files.get(file.path);
          if (info) {
            if (info.text === file.content) return; // already done, skip
            info.text = file.content;
            info.errors = [];
          }
          else {
            self.files.set(file.path,{ text: file.content, errors: [] });
          }
          files.push({path: file.path, text: file.content});
        }
      });
      Util.message( "spell check " + ctx.round + " start", Util.Msg.Trace );
      var msg = {
        type   : "check",
        files  : files,
        options: options,
      };
      return self.scWorker.postMessage( msg, 30000 ).then( function(res) {
        if (res.timedOut) {
          throw new Error("spell checker time-out");
        }
        else if (res.err) {
          throw err;
        }
        else return self.onCheckComplete(res,ctx);
      });
    });
  }

  SpellChecker.prototype.suggest = function(word,options) 
  {
    var self = this;
    return self.addDictionary().then( function() {
      var msg = {
        type   : "suggest",
        word   : word,
        options: options,
      };
      return self.scWorker.postMessage( msg, 30000 ).then( function(res) {
        if (res.timedOut) {
          throw new Error("spell checker time-out");
        }
        return res;
      });
    });
  }

  SpellChecker.prototype.onCheckComplete = function(res,ctx) {
    var self = this;
    if (res.message) Util.message(res.message, Util.Msg.Tool);

    res.files.forEach( function(file) {
      var info = self.files.get(file.path);
      if (info) {
        info.errors = [];
        file.errors.forEach( function(err) {
          info.errors.push({
            type: "spellcheck",
            tag: err.word,
            range: {
              startLineNumber: err.line,
              endLineNumber: err.line,
              startColumn: err.column,
              endColumn: err.column + err.length,
              path: file.path,
            },
            message: "possibly invalid word",
          });
        });          
      }
    });

    var allErrors = [];
    self.files.elems().forEach( function(info) { 
      allErrors = allErrors.concat(info.errors); 
    });
    ctx.show(allErrors);
  } 


  return SpellChecker;
})();

// module:
return {
  SpellChecker: SpellChecker,
  SpellCheckMenu: SpellCheckMenu,
};

});