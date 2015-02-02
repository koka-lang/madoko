/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/map","../scripts/util","../scripts/promise"],
        function(Map,Util,Promise) {

var SpellCheckMenu = (function() {
  function SpellCheckMenu(checker,findDecoration,replacer,remover,gotoNext) {
    var self = this;
    self.findDecoration = findDecoration;
    self.checker = checker;
    self.replacer = replacer;
    self.remover  = remover;
    self.gotoNext = gotoNext;
    self.text = null;
  }

  SpellCheckMenu.prototype.getClassName = function() {
    return "menu hover spellcheck";
  }  

  SpellCheckMenu.prototype.triggerOn = function( elem, range, text, info ) {
    return (elem==null || Util.hasClassName(elem,"spellerror"));
  }
  
  SpellCheckMenu.prototype.setContext = function( elem, range, text, info ) {
    var self = this;
    self.range = range;
    self.text = text;
    self.info = info; 
  }

  SpellCheckMenu.prototype.getContent = function() {
    var self = this;
    return ("<div class='button' data-cmd='ignore'><span class='info'>Ignore: </span>" +
                "<span class='word'>" + Util.escape(self.text) + "</span><span class='shortcut info'>(Alt-I)</span></div>" +
            "<div class='button' data-cmd='next'><span class='shortcut info'>(Alt-N)</span><span class='info'>Jump to next error</span></div>");
  }

  SpellCheckMenu.prototype.asyncGetContent = function() {
    var self = this;
    return self.checker.suggest(self.text,{}).then( function(res) {
      self.suggestions = res.suggestions;
      var buttons = res.suggestions.map( function(suggest, idx) {
        return "<div class='button' data-replace='" + idx.toString() + "'><span class='word'>" +Util.escape(suggest) + "</span>" +
                     "<span class='shortcut info'>(Alt-" + (idx+1).toString() + ")</span></div>";
      });
      return (buttons.length === 0 ? "<div><span class='info'>No suggestions found</span></div><hr>" : buttons.join("") + (res.suggestions.length > 0 ? "<hr>" : ""));
    });
  }

  SpellCheckMenu.prototype.onClick = function(ev) {
    var self = this;
    var target = ev.target;
    while( target && target.nodeName !== "DIV" ) target = target.parentNode;
    if (!target || !Util.hasClassName(target,"button")) return;

    var replace = parseInt(target.getAttribute("data-replace"));
    if (self.replacer && !isNaN(replace)) {
      self.replaceWith(replace);
    }
    var cmd = target.getAttribute("data-cmd");
    if (cmd==="ignore") {
      self.ignore(ev);
    }
    else if (cmd==="next" && self.gotoNext) {      
      self.gotoNext(self.range.getStartPosition());
    }
  }

  SpellCheckMenu.prototype.ignore = function(ev) {
    var self = this;
    ev.preventDefault();
    ev.stopPropagation();
    if (self.checker)  self.checker.ignore( self.text );
    if (self.remover)  self.remover(null,self.text); // remove decoration   
    if (self.gotoNext) self.gotoNext(self.range.getEndPosition());
  }

  SpellCheckMenu.prototype.replaceWith = function(i) {
    var self = this;
    var replace = self.suggestions[i];
    if (replace && self.replacer) {
      self.replacer( self.range, replace );
      if (self.remover && self.info && self.info.id) self.remover(self.info.id); // remove decoration    
      if (self.gotoNext) {
        setTimeout( function() {
          var pos = self.range.getStartPosition();
          pos.column = pos.column + replace.length;
          self.gotoNext(pos);
        }, 100 );
      }
    }
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
      self.files = new Map();
      /*
      self.scWorker.postMessage({
        type: "ignores",
        ignores: ev.file.content,
      });
      */
    }
    else if (ev.type==="delete") {
      self.files.remove(ev.file.path);
      if (ev.file.path==="ignores.dic") self.files = new Map();
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
            return self.scWorker.postMessage( { 
              type: "dictionary",
              lang: lang,
              affData: affData,
              dicData: dicData + "\n" + dicExtraData + "\n" + dicGeneric,
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
      return self._readIgnores().then( function(ignores) {
        var files = [];
        if (ctx.path && text) {
          var mime = Util.mimeFromExt(ctx.path);
          if (mime==="text/markdown" || mime==="text/madoko") {
            var info = self.files.getOrCreate(ctx.path, { text: text, errors: [] });
            info.text = text;
            info.errors = [];
            files.push( { path: ctx.path, text: info.text } );
          }
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
        if (files.length===0) {
          Util.message("(spell check: nothing to do)", Util.Msg.Trace);
          return Promise.resolved();
        }
        Util.message( "spell check " + ctx.round + " start", Util.Msg.Trace );
        var msg = {
          type   : "check",
          files  : files,
          options: options,
          ignores: ignores,
        };
        return self.scWorker.postMessage( msg, 30000 ).then( function(res) {
          if (res.timedOut) {
            throw new Error("spell checker time-out");
          }
          else if (res.err) {
            throw res.err;
          }
          else return self.onCheckComplete(res,ctx);
        });
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
      return self.scWorker.postMessage( msg, 10000 ).then( function(res) {
        if (res.timedOut) {
          throw new Error("spell checker suggest time-out");
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
            path: file.path,
            range: {
              startLineNumber: err.line,
              endLineNumber: err.line,
              startColumn: err.column,
              endColumn: err.column + err.length,
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