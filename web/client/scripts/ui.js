/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/map","../scripts/merge","../scripts/promise","../scripts/util","../scripts/storage","../scripts/madokoMode",
        "vs/editor/core/range", "vs/editor/core/selection", "vs/editor/core/command/replaceCommand"],
        function(Map,merge,Promise,util,storage,madokoMode,range,selection,replaceCommand) {

/*

editor.revealPosition({
  lineNumber: 50,
  column: 120
}, shouldRevealLineInCenterOfViewport, shouldRevealColumn);
*/

var ie = (function(){
  var ua = window.navigator.userAgent;
  var msie = ua.indexOf('MSIE ');
  var trident = ua.indexOf('Trident/');
  return (msie > 0 || trident > 0);
})();

var supportTransitions = (function() {
  return (!ie && document.body.style.transition=="");
})();

function diff( original, modified ) {
  var originalModel = Monaco.Editor.createModel(original, "text/plain");
  var modifiedModel = Monaco.Editor.createModel(modified, "text/plain");
  var diffSupport   = modifiedModel.getMode().diffSupport;
  var diff = diffSupport.computeDiff( 
                originalModel.getAssociatedResource(), modifiedModel.getAssociatedResource() );
  return new Promise(diff); // wrap promise
}

function localStorageSave( fname, obj, createMinimalObj ) {
  var key = "local/" + fname;
  if (!localStorage) {
    util.message("cannot make local backup: upgrade your browser.", util.Msg.Error );
    return false;
  }
  try {    
    localStorage.setItem( key, JSON.stringify(obj) );
    return true;
  }
  catch(e) {
    if (createMinimalObj) {
      try {
        localStorage.setItem( key, JSON.stringify(createMinimalObj()) );
        util.message("full local backup is too large; using minimal backup instead", util.Msg.Trace);
        return true;
      }
      catch(e2) {};
    }
    util.message("failed to make local backup: " + e.toString(), util.Msg.Error );
    return false;
  }
}

function localStorageLoad( fname ) {
 if (!localStorage) {
    util.message("cannot load locally: " + fname + "\n  upgrade your browser." );
    return null;
  }
  try {
    var res = localStorage.getItem( "local/" + fname );
    return (res ? JSON.parse(res) : null);
  }
  catch(e) {
    return null;
  } 
}

function getModeFromExt(ext) {
  return util.mimeFromExt("doc" + ext);
}

var origin = window.location.origin ? window.location.origin : window.location.protocol + "//" + window.location.host;

var State = { Normal:"normal", 
              Loading:"loading", 
              Init:"initializing", 
              Syncing:"synchronizing",
              Exporting:"exporting" }

var UI = (function() {

  function UI( runner )
  {
    var self = this;
    self.state  = State.Init;
    self.editor = null;
    
    self.refreshContinuous = true;
    self.refreshRate = 500;
    self.serverRefreshRate = 2500;
    self.allowServer = true;
    self.runner = runner;
    //self.runner.setStorage(self.storage);

    self.stale = true;
    self.staleTime = Date.now();
    self.round = 0;
    self.lastRound = 0;
    self.docText = "";
    self.htmlText = "";

    Monaco.Editor.createCustomMode(madokoMode.mode);
    window.onbeforeunload = function(ev) { 
      //if (self.storage.isSynced()) return;
      if (self.localSave()) return; 
      var message = "Changes to current document have not been saved yet!\n\nIf you leave this page, any unsaved work will be lost.";
      (ev || window.event).returnValue = message;
      return message;
    };

    self.initUIElements("");
    
    self.loadFromHash().then( function() {
      // Initialize madoko and madoko-server runner    
      self.initRunners();
      // dispatch check box events so everything gets initialized
      util.dispatchEvent( self.checkDisableAutoUpdate, "change" );
      util.dispatchEvent( self.checkDisableServer, "change" );
      util.dispatchEvent( self.checkLineNumbers, "change" );
      util.dispatchEvent( self.checkWrapLines, "change" );      
      util.dispatchEvent( self.checkDelayedUpdate, "change" );
      util.dispatchEvent( self.checkAutoSync, "change" );
    }).then( function() { }, function(err) {
      util.message(err, util.Msg.Error);          
    }).always( function() {
      self.state = State.Normal;
    });
  }

  UI.prototype.onError  = function(err) {
    var self = this;
    util.message( err, util.Msg.Error );
  }

  UI.prototype.event = function( status, pre, state, action ) {
    var self = this;
    if (state) {
      if (self.state !== State.Normal) {
        util.message( "sorry, cannot perform action while " + self.state, util.Msg.Status );
        return;
      }
      else {
        self.state = state;      
      }
    }
    try {
      if (pre) util.message( pre, util.Msg.Status);
      var res = action();
      if (res && res.then) {
        return res.then( function() {
          if (state) self.state = State.Normal;
          if (status) util.message( status, util.Msg.Status);
        }, function(err) {
          if (state) self.state = State.Normal;
          self.onError(err);
        });
      }
      else {
        if (state) self.state = State.Normal;
        if (status) util.message( status, util.Msg.Status);
        return res;
      }        
    }
    catch(exn) {
      if (state) self.state = State.Normal;
      self.onError(exn);
    }
  }

  UI.prototype.anonEvent = function( action ) {
    var self = this;
    self.event( "","",null, action );
  }

  UI.prototype.initUIElements = function(content) {
    var self = this;

    // common elements
    self.spinner = document.getElementById("view-spinner");    
    self.spinner.spinDelay = 750;
    self.syncer  = document.getElementById("sync-spinner");  
    self.syncer.spinDelay = 1;  
    self.view    = document.getElementById("view");
    self.editSelectHeader = document.getElementById("edit-select-header");
    self.remoteLogo = document.getElementById("remote-logo");
    self.saveFolder = document.getElementById("save-folder");
    self.theme = "vs";

    // start editor
    self.checkLineNumbers = document.getElementById('checkLineNumbers');
    self.editor = Monaco.Editor.create(document.getElementById("editor"), {
      value: content,
      mode: "text/madoko",
      theme: self.theme,
      roundedSelection: false,
      lineNumbers: (self.checkLineNumbers ? self.checkLineNumbers.checked : false),
      //mode: madokoMode.mode,
      tabSize: 4,
      insertSpaces: true,
      //wrappingColumn: -1,
      automaticLayout: true,
      glyphMargin: true,
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        //verticalHasArrows: true,
        //horizontalHasArrows: true,
        //arrowSize: 10,
      }
    });    

    // synchronize on scrolling
    self.syncInterval = 0;
    self.editor.addListener("scroll", function (e) {    
      function scroll() { 
        self.anonEvent( function() {
          var scrolled = self.syncView(); 
          if (!scrolled) {
            clearInterval(self.syncInterval);
            self.syncInterval = 0;
          }      
        });
      }

      // use interval since the editor is asynchronous, this way  the start line number can stabilize.
      if (!self.syncInterval) {
        self.syncInterval = setInterval(scroll, 100);
        //scroll();
      }
    });
    
    self.changed = false;
    self.lastEditChange = 0;
    self.editor.addListener("change", function (e) {    
      self.changed = true;
      self.lastEditChange = Date.now();
    });

    self.keybinding = self.editor.getHandlerService().bind({
      key: 'Alt-Q'
    }, function(ev) { 
      self.anonEvent( function() { self.onFormatPara(ev); } );
    });

    self.decorations = new Map();
    self.dropFiles = null;
    self.editor.addListener("mousemove", function(ev) {
      self.anonEvent( function() {
        if (self.dropFiles) {
          var files = self.dropFiles;
          self.dropFiles = null;
          var pos = ev.target.position;
          pos.column = 1;
          pos.lineNumber++;
          self.insertFiles(files,pos);
        }
        else if ((ev.target.type === 4 /* line-decorations */ || ev.target.type === 2 /* glyph_margin */ )
                 && ev.target.position && ev.target.element) 
        {
          var msg = self.getDecorationMessage(self.docName,ev.target.position.lineNumber);
          ev.target.element.title = msg;
        }
      });
    });
    
    self.editorPane = document.getElementById("editor");
    self.editorPane.addEventListener("drop", function(ev) {      
      ev.stopPropagation();
      ev.preventDefault();
      self.anonEvent( function() {
        // try to figure out on which line the image was dropped.
        var viewLine = ev.target;
        while(viewLine && viewLine.nodeName !== "DIV" && !/\bview-line\b/.test(viewLine.className)) {
          viewLine = viewLine.parentNode;
        }
        if (viewLine) {
          var editView = self.editor.getView();      
          var lines    = editView.viewLines;        
          var posLine  = -1;
          for(var i = 0; i < lines._lines.length; i++) {
            if (lines._lines[i]._domNode === viewLine) {
              posLine = lines._rendLineNumberStart + i;
            }
          }
          if (posLine >= 0) {
            posLine = self.viewToTextLine(posLine);

            return self.insertFiles( ev.dataTransfer.files, { lineNumber: posLine+1, column: 1 });
          }
        }
        // rely on mousemove event instead...
        self.dropFiles = ev.dataTransfer.files;
      });
    }, false);

    self.editorPane.addEventListener("dragover", function(ev) {
      ev.stopPropagation();
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
    }, false);
    
    // synchronize on cursor position changes
    // disabled for now, scroll events seem to be enough
    /*
    self.editor.addListener("positionChanged", function (e) {    
      self.syncView();
    });
    */
    
    // listen to preview load messages
    window.addEventListener("message", function(ev) {
      self.anonEvent( function() {
        // check origin and source so no-one but our view can send messages
        if ((ev.origin !== "null" && ev.origin !== origin) || typeof ev.data !== "string") return;
        if (ev.source !== self.view.contentWindow) return;      
        var info = JSON.parse(ev.data);
        if (!info || !info.eventType) return;
        if (info.eventType === "previewContentLoaded") {
          return self.viewLoaded();
        }
        else if (info.eventType === "previewSyncEditor" && typeof info.line === "number") {
          return self.editFile( info.path ? info.path : self.docName, { lineNumber: info.line, column: 0 } );
        }
      });
    }, false);

    // Buttons and checkboxes
    self.checkLineNumbers.onchange = function(ev) { 
      if (self.editor) {
        self.editor.updateOptions( { lineNumbers: ev.target.checked } ); 
      }
    };
    
    self.checkWrapLines = document.getElementById("checkWrapLines");
    self.checkWrapLines.onchange = function(ev) { 
      if (self.editor) {
        self.editor.updateOptions( { wrappingColumn: (ev.target.checked ? 0 : -1 ) } ); 
      }
    };

    self.checkDelayedUpdate = document.getElementById("checkDelayedUpdate");
    self.checkDelayedUpdate.onchange = function(ev) { 
      self.refreshContinuous = !ev.target.checked; 
    };

    self.checkDisableServer = document.getElementById('checkDisableServer');
    self.checkDisableServer.onchange = function(ev) { 
      self.allowServer = !ev.target.checked; 
    };

    self.checkDisableAutoUpdate = document.getElementById('checkDisableAutoUpdate');
    self.checkDisableAutoUpdate.onchange = function(ev) { 
      if (ev.target.checked) {
        self.asyncMadoko.pause();
      } 
      else {
        self.asyncMadoko.resume();
      }
    };

    self.autoSyncIval = 0;
    self.checkAutoSync = document.getElementById('checkAutoSync');
    self.checkAutoSync.onchange = function(ev) {
      if (self.autoSyncIval) {
        clearInterval(self.autoSyncIval);
        self.autoSyncIval = 0;
      }
      if (ev.target.checked) {
        self.autoSyncIval = setInterval( function() {
          if (self.state === State.Normal && self.storage.isConnected()) { 
            if (Date.now() - self.lastEditChange > 5000) {
              self.synchronize();
            }
          }
        }, 30000 );
      }      
    }
    util.dispatchEvent( self.checkAutoSync, "change");


    document.getElementById("menu-settings-content").onclick = function(ev) {
      if (ev.target && util.contains(ev.target.className,"button")) {
        var child = ev.target.children[0];
        if (child && child.nodeName === "INPUT") {
          child.checked = !child.checked;
          util.dispatchEvent( child, "change" );
        }
      }
    };

    document.getElementById("load-onedrive").onclick = function(ev) {
      self.event( "loaded from remote storage", "loading...", State.Loading, function() {
        return self.checkSynced( function() {
          return storage.onedriveOpenFile().then( function(res) { 
            return self.openFile(res.storage,res.docName); 
          });
        });
      });
    };

    document.getElementById("load-dropbox").onclick = function(ev) {
      self.event( "loaded from remote storage", "loading...", State.Loading, function() {
        return self.checkSynced( function() {
          return storage.dropboxOpenFile().then( function(res) { 
            return self.openFile(res.storage,res.docName); 
          });
        });
      });
    };

    window.addEventListener("hashchanged", function(ev) {
      self.loadFromHash();
    });

    document.getElementById("save-onedrive").onclick = function(ev) {
      self.event( "","", State.Syncing, function() {
        return self.saveTo( storage.newOnedriveAt );
      });
    }

    document.getElementById("save-dropbox").onclick = function(ev) {
      self.event( "","", State.Syncing, function() {
        return self.saveTo( storage.newDropboxAt );
      });
    }

    document.getElementById("new-document").onclick = function(ev) {
      self.event( "created new local document", "creating...", State.Loading, function() {
        return self.checkSynced( function() {
          return self.openFile(null,null);
        });
      });
    }

    document.getElementById("export-html").onclick = function(ev) {
      self.event( "HTML exported", "exporting...", State.Exporting, function() { 
        return self.generateHtml(); 
      });
    }

    document.getElementById("export-pdf").onclick = function(ev) {
      self.event( "PDF exported", "exporting...",  State.Exporting, function() { 
        return self.generatePdf(); 
      });
    }

    document.getElementById("snapshot").onclick = function(ev) {
      self.event( "Snapshot created", "saving snapshot...",  State.Syncing, function() { 
        return self.withSyncSpinner( function() {
          return self.storage.createSnapshot(self.docName); 
        });
      });
    }

    document.getElementById("edit-select").onmouseenter = function(ev) {
      self.anonEvent( function() {
        self.editSelect();
      });
    };   
       
    document.getElementById("edit-select-files").onclick = function(ev) {
      self.anonEvent( function() {
        var elem = ev.target;
        while(elem && elem.nodeName !== "DIV") {
          elem = elem.parentNode;
        }
        if (elem && elem.getAttribute) {  // IE10 doesn't support data-set so we use getAttribute
          var path = elem.getAttribute("data-file");
          if (path) {
            var mime = util.mimeFromExt(path);
            return self.event( "loaded: " + path, "loading...", State.Loading, function() {
              if (mime==="application/pdf" || mime==="text/html" || util.startsWith(mime,"image/")) {
                return self.openInWindow( path, mime );
              }
              else {
                return self.editFile(path);            
              }
            });
          }
        }
      });
    };

    document.getElementById("console-out").ondblclick = function(ev) {
      self.anonEvent( function() {
        var elem = ev.target;
        while(elem && elem.nodeName !== "DIV" && elem.className !== "msg-line") {
          elem = elem.parentNode;
        }
        if (elem && elem.className==="msg-line") {
          var line = elem.textContent;
          var cap = /\bline(?:\s|&nbsp;)*:(?:\s|&nbsp;)*(\d+)/.exec(line);
          if (cap) {
            var lineNo = parseInt(cap[1]);
            if (!isNaN(lineNo)) {
              self.editor.setPosition( { lineNumber: lineNo, column: 1 }, true, true );
            }
          }
        }
      });
    }
   
    self.syncer.onclick = function(ev) {      
      self.synchronize();
    }



    
    // narrow and wide editor panes
    var app = document.getElementById("app");
    
    //viewpane.addEventListener('transitionend', function( event ) { 
    //  self.syncView(); 
    //}, false);
    
    document.getElementById("view-narrow").onclick = function(ev) {
      util.removeClassName(app,"view-wide");
      util.removeClassName(app,"view-normal");
      util.addClassName(app,"view-narrow");
    }
    document.getElementById("view-normal").onclick = function(ev) {
      util.removeClassName(app,"view-wide");
      util.removeClassName(app,"view-narrow");
      util.addClassName(app,"view-normal");
    }
    document.getElementById("view-wide").onclick = function(ev) {
      util.removeClassName(app,"view-narrow");
      util.removeClassName(app,"view-normal");
      util.addClassName(app,"view-wide");
      //if (!supportTransitions) setTimeout( function() { self.syncView(); }, 100 );
    }

    document.getElementById("theme-ivory").onclick = function(ev) {
      self.theme = "vs";
      self.editor.updateOptions( { theme: self.theme } );
    }
    document.getElementById("theme-midnight").onclick = function(ev) {
      self.theme = "vs-dark";
      self.editor.updateOptions( { theme: self.theme } );
    }

    // emulate hovering by clicks for touch devices
    self.hovering = null;
    document.body.onclick = function(ev) {
      if (self.hovering) {
        util.removeClassName(self.hovering,"hover");
        self.hovering = null;
      }
    }
    
    function isDivParent(parent,elem) {
      while( elem && elem !== parent && elem.nodeName !== "DIV") {
        elem = elem.parentNode;
      }
      return (elem === parent);
    }

    var hoverElems = document.getElementsByClassName("popup");
    for(var i = 0; i < hoverElems.length; i++) {
      var elem = hoverElems[i];
      elem.onclick = function(ev) {
        ev.cancelBubble = true;                 
        if (self.hovering) {
          util.removeClassName(self.hovering, "hover");
        }
        var thisElem = isDivParent(ev.currentTarget,ev.target);
        if ((self.hovering && self.hovering !== ev.currentTarget) ||
            (self.hovering && !thisElem) ||
            (!self.hovering && thisElem)) {          
          self.hovering = ev.currentTarget;
          util.addClassName(self.hovering,"hover");
        }
        else {
          self.hovering = null;
        }
      }
    }
  }

  UI.prototype.setEditText = function( text, mode ) {
    var self = this;
    var text0 = self.editor.getValue();
    if (text0 !== text) {
      var pos = self.editor.getPosition();
      self.editor.model.setValue(text,mode);    
      self.editContent = text;
      if (pos.lineNumber !== 1 && !mode) {
        // set by a merge
        self.editor.setPosition(pos,true,true);
      }
    }
    // self.setStale();
  }

  UI.prototype.getEditText = function() { 
    var self = this;
    return self.editor.getValue(); 
  }

  UI.prototype.setStale = function() {
    var self = this;
    self.stale = true;
    if (self.asyncMadoko) self.asyncMadoko.setStale();    
  }

  function findSpan( text, line0, col0, line1, col1 ) {
    var pos0 = 0;
    for( var line = 1; line < line0; line++) {
      var i = text.indexOf("\n", pos0);
      if (i >= 0) pos0 = i+1;
    }
    var pos1 = pos0;
    for( ; line < line1; line++) {
      var i = text.indexOf("\n", pos1 );
      if (i >= 0) pos1 = i+1;
    }
    pos0 += (col0-1);
    pos1 += (col1-1);
    return {
      pos0: pos0,
      pos1: pos1,
      text: text.substring(pos0,pos1),
    };
  }

  function simpleDiff( text0, text1 ) {
    if (!text0 || !text1) return null;
    var i;
    for(i = 0; i < text0.length; i++) {
      if (text0[i] !== text1[i]) break;
    }
    if (i >= text0.length) return null;
    var end1;
    var end0;
    if (text1.length >= text0.length ) {
      end1 = i+100;
      if (end1 >= text1.length) {
        end1 = text1.length-1;
        end0 = text0.length-1;
      }
      else {
        var s = text1.substr(end1);
        end0 = text0.indexOf(s,i);
        if (end0 < 0) return null;      
      }
      while( end0 > i ) {
        if (text0[end0] !== text1[end1]) break;
        end0--;
        end1--;
      }
    }
    else {
      return null;
    }

    var diff0 = text0.substring(i,end0);
    var diff1 = text1.substring(i,end1);
    if (/[<>]/g.test(diff0) || /[<>]/g.test(diff1)) return null;

    return {
      start: i,
      end0: end0,
      end1: end1,
      text0: diff0,
      text1: diff1,
    }
  }

  function expandSpan( text, span ) {
    while( span.pos0 > 0 ) {
      var c = text[span.pos0-1];
      if (c === ">") break;
      if (c === "<") return false;
      span.pos0--;
    }
    while( span.pos1 < text.length ) {
      span.pos1++;
      var c = text[span.pos1];
      if (c === "<") break;
      if (c === ">") return false;
    }
    span.text = text.substring(span.pos0, span.pos1);
    span.textContent = span.text.replace(/&#(\d+);/g, function(m, n) {
                          return String.fromCharCode(n);
                        });
    return true;
  }

  function findTextNode( elem, text ) {
    if (!elem || !text) return null;
    if (elem.nodeType===3) {
      if (elem.textContent === text) return elem;      
    }
    else {
      for( var child = elem.firstChild; child != null; child = child.nextSibling) {
        var res = findTextNode(child,text);
        if (res) return res;
      }
    }
    return null;  
  }

  UI.prototype.viewLoaded = function() {
    var self = this;
    self.syncView({ duration: 0, force: true });               
  }

  UI.prototype.viewHTML = function( html, time0 ) {
    var self = this;
    
    function updateFull() {
      update();
    }

    function update(oldText,newText) {
      self.html0 = html;
      var event = {
        eventType: "loadContent",
        content: html,
        oldText: oldText,
        newText: newText,
        lineCount: self.editor.getModel().getLineCount(),
      }
      self.dispatchViewEvent(event);
      return false;
    }

    if (self.html0) {      
      var dif = simpleDiff(self.html0,html);
      if (!dif || /[<>"]/.test(dif.text)) return updateFull();
      var newSpan = { pos0: dif.start, pos1: dif.end1, text: dif.text1 };
      var oldSpan = { pos0: dif.start, pos1: dif.end0, text: dif.text0 };
      if (!expandSpan(html,newSpan)) return updateFull();
      if (!expandSpan(self.html0,oldSpan)) return updateFull();
      var i = self.html0.indexOf(oldSpan.text);
      if (i !== oldSpan.pos0) return updateFull();
      // ok, we can identify a unique text node in the html
      update(oldSpan.textContent,newSpan.textContent);      
      return true;
    }
    else {
      return updateFull();
    }  
  }

  UI.prototype.showSpinner = function(enable, elem) {
    var self = this;
    if (!elem) elem = self.spinner; // default spinner
    if (elem.spinners == null) elem.spinners = 0;
    if (elem.spinDelay == null) elem.spinDelay = self.refreshRate * 2;

    if (enable && elem.spinners === 0) {      
      setTimeout( function() {
        if (elem.spinners >= 1) util.addClassName(elem,"spin");
      }, elem.spinDelay );
    }
    else if (!enable && elem.spinners === 1) {
      util.removeClassName(elem,"spin");
      // for IE
      var vis = elem.style.visibility;
      elem.style.visibility="hidden";
      elem.style.visibility=vis;
    }
    if (enable) elem.spinners++;
    else if (elem.spinners > 0) elem.spinners--;
  }

  UI.prototype.initRunners = function() {
    var self = this;
    function showSpinner(enable) {
      self.showSpinner(enable);
    }

    self.asyncMadoko = new util.AsyncRunner( self.refreshRate, showSpinner, 
      function() {
        var changed = self.changed;
        self.changed = false;
        self.stale = self.stale || changed;
        self.storage.setEditPosition( self.editName, self.editor.getPosition() );
        if (!self.refreshContinuous && self.lastEditChange) {
          if (Date.now() - self.lastEditChange < 1000) return false;
        }
        return self.stale;
      },
      function(round) {
        self.localSave(true); // minimal save
        self.stale = false;
        if (!self.runner) return cont();
        if (self.editName === self.docName) {
          self.docText = self.getEditText();
        }
        return self.runner.runMadoko(self.docText, {docname: self.docName, round: round, time0: Date.now() })
          .then(
            function(res) {
              self.htmlText = res.content; 
              var quick = self.viewHTML(res.content, res.ctx.time0);
              if (res.runAgain) {
                self.stale=true;              
              }
              if (res.runOnServer && self.allowServer && self.asyncServer 
                    && self.lastMathDoc !== self.docText) { // prevents infinite math rerun on latex error
                self.asyncServer.setStale();
              }
              if (!res.runAgain && !res.runOnServer && !self.stale) {
                util.message("ready", util.Msg.Status);
                self.removeDecorations(false);
              }
              
              /*
              // adjust refresh rate dynamically
              if (res.avgTime > 1000 && self.refreshRate < 1000) {
                self.refreshRate = 1000;
                self.asyncMadoko.resume(self.refreshRate);
              }
              else if (res.avgTime < 750 && self.refreshRate >= 1000) {
                self.refreshRate = 500;
                self.asyncMadoko.resume(self.refreshRate);
              }
              */
              
              /*
              // adjust delayed view update automatically
              if (res.avgTime > 300) {
                self.refreshContinuous = false;
                self.checkDelayedUpdate.checked = true;
              }
              else if (res.avgTime < 200) {
                self.refreshContinuous = true;
                self.checkDelayedUpdate.checked = false;
              }
              */
              
              return ("update: " + res.ctx.round + 
                        (quick ? "  (quick view update)" : "") + 
                        (self.refreshContinuous ? " (continuous)" : "") +
                        //"\n  refresh rate: " + self.refreshRate.toFixed(0) + "ms" +
                        "\n  avg: " + res.avgTime.toFixed(0) + "ms");                                                        
            },
            function(err) {
              self.onError(err);              
            }
          );
      }
    );

    self.asyncServer = new util.AsyncRunner( self.serverRefreshRate, showSpinner, 
      function() { return false; },
      function(round) {
        self.lastMathDoc = self.docText;
        var ctx = {
          docname: self.docName, 
          round:round,
          showErrors: function(errs) { self.showErrors(errs,false); },
        };
        return self.runner.runMadokoServer(self.docText, ctx ).then( 
          function(ctx) {
            self.asyncServer.clearStale(); // stale is usually set by intermediate madoko runs
            // run madoko locally again using our generated files (and force a run)
            return self.asyncMadoko.run(true);
          },
          function(err) {
            self.onError(err);            
          }
        );
      }
    );
  }

  // Save editor text to storage
  UI.prototype.flush = function(path) {
    var self = this;
    if (path && path !== self.editName) return;

    var pos  = self.editor.getPosition();
    var text = self.getEditText();
    self.editContent = text;
    self.storage.writeFile( self.editName, text, { position: pos } ); // todo: not for readOnly     
  }

  // save entire state to local disk
  UI.prototype.localSave = function(minimal) {
    var self = this;
    self.flush();
    var pos  = self.editor.getPosition();    
    var theme = self.editor.getConfiguration().theme;
    var json = { 
      docName: self.docName, 
      editName: self.editName, 
      pos: pos, 
      theme: theme,
      storage: self.storage.persist(minimal),
      showLineNumbers: self.checkLineNumbers.checked,
      wrapLines: self.checkWrapLines.checked,
      disableServer: self.checkDisableServer.checked,
      disableAutoUpdate: self.checkDisableAutoUpdate.checked,
      delayedUpdate : self.checkDelayedUpdate.checked,
      autoSync: self.checkAutoSync.checked,
    };
    return localStorageSave("local", json, 
      (//minimal ? undefined : 
       function() {
        json.storage = self.storage.persist(true); // persist minimally
        return json;
      }));
  }

  UI.prototype.loadFromHash = function() {
    var self = this;
    var cap = /[#&]url=(https?:\/\/[^=&#;]+)/.exec(window.location.hash);
    if (cap) {
      var url = util.dirname(cap[1]);
      var doc = util.basename(cap[1]);
      return self.checkSynced( function() {
        return storage.httpOpenFile(url,doc);        
      }).then( function(res) { 
        return self.openFile(res.storage,res.docName); 
      }).then( function() {
        return true;
      }, function(err) {
        util.message(err, util.Msg.Error);
        util.message("failed to load hash url: " + cap[1], util.Msg.Error);
        return self.localLoad();
      });
    }
    else {
      return self.localLoad();
    }
  }

  UI.prototype.setStorage = function( stg, docName ) {
    var self = this;
    if (stg == null) {
      // initialize fresh
      docName = "document.mdk";
      stg = storage.createNullStorage();
      var content = document.getElementById("initial").textContent;
      stg.writeFile(docName, content);
    }
    self.showSpinner(true);    
    return stg.readFile(docName, false).then( function(file) { 
      self.showSpinner(false );    
        
      if (self.storage) {
        self.storage.destroy(); // clears all event listeners
        self.viewHTML( "<p>Loading...</p>", Date.now() );
        //self.storage.clearEventListener(self);
      }
      self.storage = stg;
      self.docName = docName;
      self.docText = file.content;
      self.saveFolder.value = self.storage.folder(); 
    
      self.storage.addEventListener("update",self);
      self.runner.setStorage(self.storage);
      var remoteLogo = self.storage.remote.logo();
      var remoteType = self.storage.remote.type();
      var remoteMsg = (remoteType==="local" ? "browser local" : remoteType);
      self.remoteLogo.src = "images/dark/" + remoteLogo;
      self.remoteLogo.title = "Connected to " + remoteMsg + " storage";        
      self.editName = "";
      return self.editFile(self.docName).always( function() { self.setStale(); } );
    });
  }

  UI.prototype.spinWhile = function( elem, promise ) {
    var self = this;
    self.showSpinner(true,elem);
    return promise.always( function() {
      self.showSpinner(false,elem);
    });
  }

  UI.prototype.editFile = function(fpath,pos) {
    var self = this;
    var loadEditor;
    self.state = State.Loading;            
    if (fpath===self.editName) loadEditor = Promise.resolved(null) 
     else loadEditor = self.spinWhile(self.syncer, self.storage.readFile(fpath, false)).then( function(file) {       
            self.hideDecorations();
            if (self.editName === self.docName) {
              self.docText = self.getEditText();
            }
            var mode = Monaco.Editor.getOrCreateMode(file.mime).then( function(md) {
              if (md) return md;
              return Monaco.Editor.getOrCreateMode("text/plain");
            });
            var options = {
              readOnly: !storage.isEditable(file),
              theme: self.theme,
              //mode: file.mime,
              //mode: mode, // don't set the mode here or Monaco runs out-of-stack
              lineNumbers: self.checkLineNumbers.checked,
              wrappingColumn: self.checkWrapLines.checked ? 0 : -1,
            };
            self.editName = file.path;
            self.setEditText(file.content, mode);
            self.onFileUpdate(file); // update display etc.
            self.editor.updateOptions(options);            
            return storage.getEditPosition(file);
      });
    return loadEditor.then( function(posx) {      
      if (!pos) pos = posx;
      if (pos) {
        self.editor.setPosition(pos, true, true );
        //self.editor.revealPosition( pos, true, true );
      }
      self.showDecorations();
    }).always( function() { 
      self.state = State.Normal; 
    });    
  }

  UI.prototype.localLoad = function() {
    var self = this;
    var json = localStorageLoad("local");
    if (json!=null) {
      // we ran before
      var docName = json.docName;
      self.checkDisableAutoUpdate.checked = json.disableAutoUpdate;
      self.checkDisableServer.checked = json.disableServer;
      self.checkLineNumbers.checked = json.showLineNumbers;
      self.checkWrapLines.checked = json.wrapLines;
      self.checkDelayedUpdate.checked = json.delayedUpdate;
      self.checkAutoSync.checked = json.autoSync;
      self.theme = json.theme || "vs";
      var stg = storage.unpersistStorage(json.storage);      
      return self.setStorage( stg, docName ).then( function() {
        return self.editFile( json.editName, json.pos );
      });
    }
    else {
      return self.setStorage( null, null );
    }
  }

  UI.prototype.checkSynced = function( makePromise ) {
    var self = this;
    if (self.storage && !self.storage.isSynced()) {
      var ok = window.confirm( "The current document has not been saved yet!\n\nDo you want to discard these changes?");
      if (!ok) return Promise.rejected("the operation was cancelled");
    }
    return makePromise();
  }

  UI.prototype.openFile = function(storage,fname) {
    var self = this;
    var mime = util.mimeFromExt(fname);
    if (fname && !(mime === "text/madoko" || mime==="text/markdown") ) return util.message("only markdown (.mdk) files can be selected",util.Msg.Error);      
    return self.setStorage( storage, fname );
  }


  UI.prototype.displayFile = function(file,extensive) {
    var disable = (storage.isEditable(file) ? "" : " disable");
    var icon = "<span class='file-status'>" + (file.modified? "&bull;" : "") + "</span>";
    var span = "<span class='file " + file.mime.replace(/[^\w]+/g,"-") + disable + "'>" + util.escape(file.path) + icon + "</span>";
    var extra = "";
    if (extensive) {
      if (storage.isEditable(file)) {
        var matches = file.content.replace(/<!--[\s\S]*?-->/,"").match(/[^\d\s~`!@#$%^&\*\(\)\[\]\{\}\|\\\/<>,\.\+=:;'"\?]+/g);
        var words   = matches ? matches.length : 0;
        if (words > 0) {
          extra = "<span class='file-size'>" + words.toFixed(0) + " words</span>";
        }
      }
      else {
        var len = file.content.length;
        if (file.encoding === storage.Encoding.Base64) len = (len/4)*3;
        var kb = (len + 1023)/1024;
        if (kb > 100) {
          extra = "<span class='file-size'>" + kb.toFixed(0) + " kb</span>";
        }
      }
    }
    return span + extra;
  }

  UI.prototype.editSelect = function() {
    var self = this;
    var files = [];
    var images = [];
    var generated = [];
    var div = document.getElementById("edit-select-files");
      
    self.storage.forEachFile( function(file) {
      if (file) {
        var disable = (storage.isEditable(file) ? "": " disable");
        var main    = (file.path === self.docName ? " main" : "");
        var hide    = ""; // (util.extname(file.path) === ".dimx" ? " hide" : "");
        var line = "<div data-file='" + util.escape(file.path) + "' " +
                      "class='button item file" + disable + main + hide + "'>" + 
                          self.displayFile(file,true) + "</div>";
        if (util.startsWith(file.mime,"image/")) images.push(line); 
        else if (!disable) files.push(line);
        else generated.push(line)
      }
    });

    /*
    var dir = document.getElementById("edit-select-directory");
    if (dir) {
      dir.innerHTML = "<img src='images/" + self.storage.remote.logo() + "'/> " + 
                        util.escape( self.storage.folder() ) + "<hr/>";
    }
    */
    div.innerHTML = 
      files.sort().join("\n") + 
      (images.length > 0 || generated.length > 0 ? 
          "<hr/><div class='binaries'>" + images.sort().join("\n") + generated.sort().join("\n") + "</div>" : "");
  }

  function saveUserContent( name, mime, content, tryOpenFirst ) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    setTimeout( function() { URL.revokeObjectURL(url); }, 250 );

    if (tryOpenFirst) {
      // IE will throw an exception,
      // Chrome opens a window but does not allow the user to save the content
      // Firefox works
      try {
        window.open(url,name);
        return;
      }
      catch(exn) {}  
    }

    // The rest of the code handles all cases to allow saving the content locally
    var saveBlob = navigator.saveOrOpenBlob || navigator.msSaveOrOpenBlob || navigator.saveBlob || navigator.msSaveBlob;
    var link = document.createElement("a");
    if ("download" in link) {
      link.setAttribute("href",url);
      link.setAttribute("download",name);
      //util.dispatchEvent(link,"click");
      var event = document.createEvent('MouseEvents');
      event.initMouseEvent('click', true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
      link.dispatchEvent(event);
    }
    else if (window.saveAs) {
      window.saveAs(blob, name);
    }
    else if (saveBlob) {
      saveBlob.call(navigator, blob, name);
    }
    else {
      window.open(url,name);
    }
  }

  UI.prototype.openInWindow = function( path, mime ) {
    var self = this;
    if (!mime) mime = util.mimeFromExt(path);            
    return self.storage.readFile( path ).then( function(file) {
      var content = storage.Encoding.decode(file.encoding, file.content);
      saveUserContent( util.basename(path), mime, content );
    });
  }

  UI.prototype.generatePdf = function() {
    var self = this;
    var ctx = { 
      round: 0, 
      docname: self.docName, 
      pdf: true, 
      includeImages: true,
      showErrors: function(errs) { self.showErrors(errs,true); } 
    };
    return self.spinWhile( self.viewSpinner, 
      self.runner.runMadokoServer( self.docText, ctx ).then( function() {
        var name = "out/" + util.changeExt(self.docName,".pdf");
        return self.openInWindow( name, "application/pdf" );
      })
    );
  }


  UI.prototype.generateHtml = function() {
    var self = this;
    return self.spinWhile( self.viewSpinner, 
      self.runner.runMadokoLocal( self.docName, self.docText ).then( function(content) {
        var name = "out/" + util.changeExt(self.docName,".html");
        self.storage.writeFile( name, content );
        return self.openInWindow( name, "text/html" );
        //saveUserContent( name, "text/html", content );
      })
    );
  }

  function breakLines(text, maxCol, hang0, hang ) {
    var para    = hang0;
    var col     = hang0.length;
    var hangCol = col;
    text = text.substr(col);
        
    var parts = text.split(/\s(?!\s*\[)/);
    parts.forEach( function(part) {
      if (part && part !== "") {
        var n = part.length;
        if (col > 0 && col + n > maxCol) {
          para += "\n" + hang;
          col     = hang.length;
          hangCol = col;
        }
        else if (col > hangCol) {
          para += " ";
          col++;
        }
        para += part;
        col += n;
      }
    });

    return para;
  }

  function reformatPara( lineNo, text, column ) {
    function isBlank(line) {
      return /^\s*$/.test(line);
    }
    function endPara(line) {
      return isBlank(line) || /^[ \t]*(```|[>#~])|.*(\\|  )$/.test(line);
    }
    function stopPara(line) {
      return endPara(line) || /^[ \t]*(([\*\+\-]|\d\.)[ \t])/.test(line);
    }

    // split in lines
    var lines = text.split("\n");
    if (lineNo <= 0 || lineNo > lines.length || isBlank(lines[lineNo-1])) return null;

    // find paragraph extent
    var start = lineNo;
    while( start > 1 && !endPara(lines[start-2]) && !stopPara(lines[start-1])) {
      start--;
    }
    var end = lineNo;
    while( end < lines.length && !stopPara(lines[end]) ) {
      end++;
    }
    var endColumn = lines[end-1].length+1;
    var para      = lines.slice(start-1,end);
    if (para.length <= 0) return null;

    para = para.map( function(line) {
      return line.replace(/\t/g, "    ");
    });
    var indents = para.map( function(line) {
      var cap = /^(\s*)/.exec(line);
      return (cap ? cap[1].length : 0);
    });
      
    var hang0  = new Array(indents[0]+1).join(" ");
    var indent = Math.max( indents[0], (indents.length > 1 ? Math.min.apply( null, indents.slice(1) ) : 0) );
    var hang   = new Array(indent+1).join(" ");
    
    // reformat
    var paraText = para.join(" ");
    var paraBroken = breakLines(paraText, column || 70, hang0, hang);
    return { text: paraBroken, startLine: start, endLine: end, endColumn: endColumn };
  }

  UI.prototype.onFormatPara = function(ev) {
    var self = this;
    var pos = self.editor.getPosition();
    var text = self.getEditText();
    var res = reformatPara( pos.lineNumber, text );
    if (res) {
      var rng = new range.Range( res.startLine, 0, res.endLine, res.endColumn );
      var command = new replaceCommand.ReplaceCommandWithoutChangingPosition( rng, res.text );
      self.editor.executeCommand("madoko",command);
    }
  }

  function findMetaPos( text ) {
    var lineNo = 1;
    var reMeta = /^(?:@(\w+)[ \t]+)?((?:\w|([\.#~])(?=\S))[\w\-\.#~, \t]*?\*?)[ \t]*[:].*\r?\n(?![ \t])/;
    var cap;
    while ((cap = reMeta.exec(text))) {
      text = text.substr(cap[0].length);
      lineNo++;
    }
    return lineNo;
  }

  // Insert some text in the document 
  UI.prototype.insertText = function( txt, pos ) {
    var self = this;
    if (!pos) pos = self.editor.getPosition(); 
    var rng = new range.Range( pos.lineNumber, pos.column, pos.lineNumber, pos.column );
    var command = new replaceCommand.ReplaceCommandWithoutChangingPosition( rng, txt );
    self.editor.executeCommand("madoko",command);
  }

  UI.prototype.insertFile = function(file, content, encoding, mime, pos ) {
    var self = this;
    if (pos) pos.column = 0;
    var ext  = util.extname(file.name);
    var stem = util.stemname(file.name);
    var name = util.basename(file.name);      
    if (util.startsWith(mime,"image/")) name = "images/" + name;    
    if (encoding===storage.Encoding.Base64) {
      var cap = /^data:([\w\/\-]+);(base64),([\s\S]*)$/.exec(content);
      if (!cap) return;
      content = cap[3];  
    }
    self.storage.writeFile( name, content, {encoding:encoding,mime:mime});
    
    var text = "";
    if (util.startsWith(mime,"image/")) {
      text = "![" + stem + "]\n\n[" + stem + "]: " + name + ' "' + stem + '"';
    }
    else if (ext===".mdk" || ext===".md") {
      text = "[INCLUDE=\"" + name + "\"]";
    }
    else {
      if (ext===".json") {
        text="Colorizer   : " + name;
      }
      else if (ext===".css") {
        text="Css         : " + name;
      }
      else if (ext===".bib") {
        text="Bibliography: " + name;
      }
      else if (ext===".bst") {
        text="Bib Style   : " + util.stemname(name);
      }
      else if (ext===".cls") {
        text="Doc Class   : " + util.stemname(name);
      }
      else if (ext===".sty" || ext===".tex") {
        text="Package     : " + util.stemname(name);
      }
      else {
        util.message( "unsupported drop file extension: " + ext, util.Msg.Info );
        return;
      }
      var lineNo = findMetaPos(self.getEditText());      
      if (lineNo > 0) pos = { lineNumber: lineNo, column: 1 };      
    }
    self.insertText( text + "\n", pos );
  }

  UI.prototype.insertFiles = function(files,pos) {
    var self = this;
    if (!files) return;
    for (var i = 0, f; f = files[i]; i++) {      
      var encoding = storage.Encoding.fromExt(f.name);      
      var mime = f.type || util.mimeFromExt(f.name);
      if (!(util.startsWith(mime,"image/") || util.isTextMime(mime))) { // only images or text..
        continue;
      }
      
      var reader = new FileReader();
      reader.onload = (function(_file,_encoding,_mime) { 
        return function(loadEvt) {
          self.insertFile( _file, loadEvt.target.result, _encoding, _mime, pos );
        };
      })(f,encoding,mime);

      if (encoding===storage.Encoding.Base64)
        reader.readAsDataURL(f);
      else 
        reader.readAsText(f);
    }
  }

  UI.prototype.removeDecorations = function(discardSticky) {
    var self = this;
    self.editor.changeDecorations(function(changeAccessor) {
      self.decorations.forEach( function(fname,decorations) {
        var newdecs = [];
        decorations.forEach( function(decoration) {
          if (decoration.id) {
            decoration.outdated = true;
            if (discardSticky || !decoration.sticky) {
              changeAccessor.removeDecoration(decoration.id);
              decoration.id = null;
            }
            else {
              newdecs.push(decoration);
              decoration.id = changeAccessor.changeDecorationOptions(decoration.id,{
                isWholeLine: true,
                glyphMarginClassName: 'glyph-error.outdated',
                linesDecorationsClassName: 'latex-error.outdated',
              });
            }
          }
        });
        if (newdecs.length > 0) self.decorations.set(fname, newdecs);
                           else self.decorations.remove(fname);
      });
    });    
  }

  UI.prototype.hideDecorations = function() {
    var self = this;
    self.editor.changeDecorations( function(changeAccessor) {
      self.decorations.forEach( function(fname,decorations) {
        if (fname === self.editName) {
          decorations.forEach( function(decoration) {
            if (decoration.id) {
              changeAccessor.removeDecoration( decoration.id );
            }
          });
        }
      });
    });
  }

  UI.prototype.showDecorations = function() {
    var self = this;
    self.editor.changeDecorations( function(changeAccessor) {
      self.decorations.forEach( function(fname,decorations) {
        if (fname === self.editName) {
          decorations.forEach( function(decoration) {
            var postfix = (decoration.outdated ? ".outdated" : "" );
            decoration.id = changeAccessor.addDecoration( decoration.range, 
              { isWholeLine: true,
                glyphMarginClassName: 'glyph-error' + postfix,
                linesDecorationsClassName: 'latex-error' + postfix
              }
            );            
          });
        }
      });
    });
  }

  UI.prototype.showErrors = function( errors, sticky ) {
    var self = this;
    self.removeDecorations(true);
    //self.decorations = new Map();    
    errors.forEach( function(error) {
      var decs = self.decorations.getOrCreate(error.range.fileName || self.editName, []);
      decs.push( { id: null, sticky: sticky, outdated: false, message: error.message, range: error.range });
    });

    self.showDecorations();
  }

  UI.prototype.getDecorationMessage = function( fileName, lineNo ) {
    var self = this;
    if (!fileName) fileName = self.docName;
    var decs = self.decorations.get(fileName);
    if (decs) {
      for (var i = 0; i < decs.length; i++) {
        if (decs[i].range.startLineNumber <= lineNo && decs[i].range.endLineNumber >= lineNo) {
          return decs[i].message;
        }
      }
    }
    return "";
  }

  
  UI.prototype.dispatchViewEvent = function( ev ) {
    var self = this;
    // we use "*" since sandboxed iframes have a null origin
    if (self.view) {
      self.view.contentWindow.postMessage(JSON.stringify(ev),"*");
    }
  }

  UI.prototype.viewToTextLine = function( lineNo ) {
    var self = this;
    // translate view line to text line (for when lines are wrapped)
    if (self.editor.configuration.getWrappingColumn() >= 0) {
      var slines = self.editor.getView().context.model.lines;
      return slines.convertOutputPositionToInputPosition(lineNo,0).lineNumber;
    }
    else {
      return lineNo;
    }
  }

  UI.prototype.syncView = function( options, startLine, endLine, cursorLine ) 
  {
    var self = this;
    try {
      if (self.lastLineNo===undefined) self.lastLineNo = -1;
      if (!options) options = {};
      if (!self.view || self.state !== State.Normal) return; // during loading of new content

      if (cursorLine==null) {
        cursorLine = self.editor.getPosition().lineNumber;
      }
      if (startLine==null) {
        var editView  = self.editor.getView();      
        var lines = editView.viewLines;
        var rng = lines._currentVisibleRange;
        startLine = rng.startLineNumber;
        endLine = rng.endLineNumber;
        //console.log("scroll: start: " + startLine)
      }
      var lineCount = self.editor.getModel().getLineCount();
      var lineNo = cursorLine;
      if (startLine === 1) {
        lineNo = startLine;
      }
      else if (endLine === lineCount) {
        lineNo = endLine;
      }
      else if (cursorLine < startLine || cursorLine > endLine) {
        // not a visible cursor -- use the middle of the viewed ranged
        lineNo = startLine + ((endLine - startLine + 1)/2);
      }
      // exit quickly if same line
      if (lineNo === self.lastLineNo && !options.force) return false;
      self.lastLineNo = lineNo;

      // use physical textline; 
      // start-, end-, cursor-, and lineNo are all view lines.
      // if wrapping is enabled, this will not correspond to the actual text line
      var textLine = self.viewToTextLine(lineNo);
      var slines = null;
      
      // find the element in the view tree
      var event = options;
      event.eventType   = "scrollToLine";
      event.textLine    = textLine;
      event.viewLine    = lineNo;
      event.viewStartLine = startLine;
      event.viewEndLine = endLine;
      event.lineCount   = lineCount;
      event.sourceName  = self.editName === self.docName ? null : self.editName;
      event.height      = self.view.clientHeight;
      
      // post scroll message to view iframe
      self.dispatchViewEvent(event);
      return true;
    }
    catch(exn) {
      self.onError(exn);
      return false;
    }
  }

  UI.prototype.handleEvent = function(ev) {
    var self = this;
    if (!ev || !ev.type) return;
    if (ev.type === "update" && ev.file) {
      self.onFileUpdate(ev.file);
    }
    else if (ev.type === "flush") {
      self.flush( ev.path ); 
    }
  }

  UI.prototype.onFileUpdate = function(file) {
    var self = this;
    if (file.path===self.editName) {
      var folder = self.storage.folder();
      if (folder.length > 35) folder = "..." + folder.substr(folder.length-35);
      var prefix = "<span class='folder'>" + folder + (folder ? "/" : "") + "</span>";
      
      var fileDisplay = prefix + self.displayFile(file);
      if (!self.fileDisplay || self.fileDisplay !== fileDisplay) { // prevent too many calls to setInnerHTML
        self.fileDisplay = fileDisplay;
        self.editSelectHeader.innerHTML = fileDisplay;
      }
      if (self.editContent !== file.content) { // only update edit text if content update 
        self.setEditText(file.content);
      }
    }
    self.editSelect();
  }

  UI.prototype.saveTo = function( newStorageAt ) {
    var self = this;
    self.showSpinner(true,self.syncer);
    var folder = self.saveFolder.value.replace("\\","/");

    var newstem = (folder ? util.stemname(folder) : "document");
    return self.withSyncSpinner( function() { 
      return newStorageAt(folder).then( function(toStorage) {
        return storage.saveTo(self.storage, toStorage, util.stemname(self.docName), newstem);
      });
    }).then( function(res){ 
      return self.setStorage(res.storage,res.docName).then( function() {
        return res.docName;
      }); 
    }).then( function(newDocName) {
      self.showSpinner(false,self.syncer);    
      util.message("saved: " + newDocName, util.Msg.Status);
    }, function(err){ 
      self.showSpinner(false,self.syncer);    
      self.onError(err); 
    });
  }

  UI.prototype.withSyncSpinner = function( makePromise) {
    var self = this;
    self.showSpinner(true,self.syncer);
    return makePromise().always( function() {
      self.showSpinner(false,self.syncer);
    });
  }

  UI.prototype.synchronize = function() {
    var self = this;
    self.event( "", "", State.Syncing, function() {
      if (self.storage) {
        self.localSave();
        var cursors = {};        
        var line0 = self.editor.getPosition().lineNumber;
        cursors["/" + self.docName] = line0;
        return self.withSyncSpinner( function() {
          return self.storage.sync( diff, cursors ).then( function() {
            var line1 = cursors["/" + self.docName];
            var pos = self.editor.getPosition();
            if (pos.lineNumber >= line0) {
              pos.lineNumber += (line1 - line0);
              self.editor.setPosition(pos); // does not reveal the position, so no scrolling happens.
             }
          });
        });
      }
    });    
  }

  // object    
  return UI;
})();

// module
return UI;
}); 