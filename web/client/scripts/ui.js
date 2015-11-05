/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/map","../scripts/promise","../scripts/date","../scripts/util","../scripts/tabStorage",
        "../scripts/storage","../scripts/spellcheck","../scripts/errorMenu","../scripts/remote-localhost",
        "vs/editor/common/core/range", "vs/editor/common/core/selection","vs/editor/common/commands/replaceCommand",
        "../scripts/editor","../scripts/customHover"],
        function(Map,Promise,StdDate,Util,TabStorage,Storage,SpellCheck,ErrorMenu,Localhost,Range,Selection,ReplaceCommand,Editor,CustomHover) {


// Constants
var rxTable = /^[ \t]{0,3}[\|\+]($|.*[\|\+][ \t]*$)/m;

var isFirefox = /\bfirefox/i.test(navigator.userAgent);
var isIE      = Object.hasOwnProperty.call(window, "ActiveXObject");

// Key binding
var KeyMask = { ctrlKey: 0x1000, altKey: 0x2000, shiftKey: 0x4000, metaKey: 0x8000 }
var keyHandlers = [];

document.addEventListener( "keydown", function(ev) {
  var code = ev.keyCode;
  if (ev.ctrlKey)  code |= KeyMask.ctrlKey;
  if (ev.altKey)   code |= KeyMask.altKey;
  if (ev.metaKey)  code |= KeyMask.metaKey;
  if (ev.shiftKey) code |= KeyMask.shiftKey;       
  keyHandlers.forEach( function(handler) {
    if (handler.code === code) {
      if (handler.stop) {
        ev.stopPropagation();
        ev.preventDefault();
      }
      handler.action(ev);
    }
  });
});

function bindKey( key, action ) {
  if (typeof key === "string") key = { key: key, stop: true };
  var code = key.code || 0;
  if (code===0) {
    var cap = /^(ALT[\+\-])?(CTRL[\+\-])?(META[\+\-])?(SHIFT[\+\-])?([A-Z0-9])$/.exec(key.key.toUpperCase());
    if (cap) {
      code = cap[5].charCodeAt(0);
      if (cap[1]) code |= KeyMask.altKey;
      if (cap[2]) code |= KeyMask.ctrlKey;
      if (cap[3]) code |= KeyMask.metaKey;
      if (cap[4]) code |= KeyMask.shiftKey;
    }
  }
  keyHandlers.push( { code: code, action: action, stop: key.stop || false } );
}

var localStorageLimit = 5000000; // (~5mb)

function localStorageSave( fname, obj, createMinimalObj ) {
  var key = "local/" + fname;
  if (!localStorage) {
    Util.message("cannot make local backup: upgrade your browser.", Util.Msg.Error ); 
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
        Util.message("full local backup is too large; using minimal backup instead", Util.Msg.Info);
        return true;
      }
      catch(e2) {};
    }
    Util.message("failed to make local backup: " + e.toString(), Util.Msg.Error );
    return false;
  }
}

function localStorageLoad( fname ) {
 if (!localStorage) {
    Util.message("cannot load locally: " + fname + "\n  upgrade your browser." );
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
  return Util.mimeFromExt("doc" + ext);
}

var origin = window.location.origin ? window.location.origin : window.location.protocol + "//" + window.location.host;

var State = { Normal:"normal", 
              Loading:"loading", 
              Init:"initializing", 
              Syncing:"synchronizing",
              Exporting:"exporting" }

var UI = (function() {

  function UI( runner, tabDb )
  {
    var self = this;
    self.state  = State.Init;
    self.editor = null;
    self.app  = document.getElementById("main");
            
    self.refreshRate = 500;
    self.serverRefreshRate = 2500;
    self.runner = runner;
    self.tabDb = tabDb;
    self.spellChecker = new SpellCheck.SpellChecker();
    //self.runner.setStorage(self.storage);

    self.stale = true;
    self.staleTime = Date.now();
    self.round = 0;
    self.lastRound = 0;
    self.docText = "";
    self.htmlText = "";

    self.stat = {
      editLast: 0,
      editDelta: 30*1000,
      editTotal: 0,
      viewStart: Date.now(),
    };

    //Monaco.Editor.createCustomMode(MadokoMode.mode);
    window.onbeforeunload = function(ev) { 
      //if (self.storage.isSynced()) return;
      localStorage.removeItem("viewer-html");
      localStorage.removeItem("viewer-scroll");
      self.saveSettings();
      if (self.localSave()) return; 
      var message = "Changes to current document have not been saved yet!\n\nIf you leave this page, any unsaved work will be lost.";
      (ev || window.event).returnValue = message;
      return message;
    };

    var firstTime = localStorage.settings === undefined;  
    self.loadSettings();
    self.initUIElements("",firstTime);
  
    self.loadFromHash().then( function() {
      // Initialize madoko and madoko-server runner    
      self.initRunners();      
    }).then( function() { }, function(err) {
      Util.message(err, Util.Msg.Error);          
    }).always( function() {
      self.state = State.Normal;
    });
  }

  UI.prototype.reload = function(force) {
    var self = this; 
    if (Localhost.localhost.hosted) {
      Localhost.localhost.reload(force);
    }
    else {
      window.location.reload( force );
    }
  }

  UI.prototype.setTitle = function(title) {
    var self = this;
    if (Localhost.localhost.hosted) {
      Localhost.localhost.setTitle(title);
    }
    document.title = title;
  }

  UI.prototype.onError  = function(err) {
    var self = this;
    Util.message( err, Util.Msg.Error );
  }

  UI.prototype.event = function( status, pre, state, action, okStates ) {
    var self = this;
    if (state) {
      if (self.state !== State.Normal && !Util.contains(okStates,self.state)) {
        Util.message( "sorry, cannot perform action while " + self.state, Util.Msg.Status );
        return;
      }
      else if (state) {
        self.state = state;      
      }
    }
    try {
      if (state===State.Exporting) Util.messageClear();
      if (pre) Util.message( pre, Util.Msg.Status);
      var res = action();
      if (res && res.then) {
        return res.then( function() {
          if (state) self.state = State.Normal;
          if (status) Util.message( status, Util.Msg.Status);
        }, function(err) {
          if (state) self.state = State.Normal;
          self.onError(err);
        });
      }
      else {
        if (state) self.state = State.Normal;
        if (status) Util.message( status, Util.Msg.Status);
        return res;
      }        
    }
    catch(exn) {
      if (state) self.state = State.Normal;
      self.onError(exn);
    }
  }

  UI.prototype.loadSettings = function() {
    var self = this;

    var defaultCheckBoxes = {
      disableAutoUpdate: false,
      disableServer    : false,
      lineNumbers      : false,
      wrapLines        : false,
      delayedUpdate    : false,
      autoSync         : true,
      spellCheck       : true,
    };
    var defaultSettings = Util.extend( Util.copy(defaultCheckBoxes), {
      viewFull         : false,
    });

    if (!self.checkBoxes) {
      self.checkBoxes = new Map();
      function initCheckbox( name, checked ) {
        var elem = document.getElementById("check" + Util.capitalize(name));
        self.checkBoxes.set(name,elem);
        elem.checked = checked;
        elem.addEventListener( "change", function(ev) {
          var upd = {};
          upd[name] = elem.checked;
          self.updateSettings( upd );
        });
      }
      Util.forEachProperty(defaultCheckBoxes, function(name,checked) {
        initCheckbox(name,checked);        
      });
    }

    // read first, before calling updateSettings (as that saves right away)
    var lsettings = window.tabStorage.getItem("settings");
    if (!lsettings) lsettings = window.tabStorage.getItemFrom(1, "settings"); // take for the first tab as default
    if (!lsettings) {
      // legacy
      var json = localStorage.getItem("settings");
      if (!json) { 
        json = localStorage.getItem("local/local");
      }
      if (json) lsettings = Util.jsonParse(json,{});
      localStorage.removeItem("settings")
    }

    self.settings = Util.copy(defaultSettings);
    self.updateSettings( {
      theme            : "vs",
      fontScale        : "medium"
    });
    
    if (lsettings) {
      self.updateSettings( lsettings );
    }

    // read from hash
    var cap = /[#&\?]options=([^=&#;]+)/.exec(window.location.hash);
    if (cap) {
      var json = decodeURIComponent(cap[1]);
      self.updateSettings( Util.jsonParse(json,{}) );
    }    
  }

  UI.prototype.updateSettings = function(obj) {
    var self = this;
    if (!obj) return;

    Util.forEachProperty(obj, function(name,value) {
      if (name==="showLineNumbers") name = "lineNumbers"; // legacy
      self.updateSetting(name,value);
    });
  }

  UI.prototype.getCurrentTheme = function() {
    var self = this;
    return self.settings.theme + " font-" + self.settings.fontScale;
  }

  UI.prototype.updateSetting = function(name,value) {
    var self = this;

    // update check boxes (may recurse!)
    var checkBox = self.checkBoxes.get(name);
    if (checkBox && checkBox.checked !== value) {
      checkBox.checked = value;
    }
    // return if no change
    var oldValue = self.settings[name];
    if (oldValue === value) return;

    // ignore legacy
    if (name==="viewMode") return;

    // set value
    self.settings[name] = value;
    self.saveSettings();
        
    // special actions
    if (name==="theme") {
      if (self.editor) self.editor.updateOptions( { theme: self.getCurrentTheme() });
      self.app.setAttribute("data-theme",value);
    }
    else if (name==="wrapLines") {
      if (self.editor) self.editor.updateOptions( { wrappingColumn: (value ? 0 : -1 ) } ); 
    }
    else if (name==="lineNumbers") {
      if (self.editor) self.editor.updateOptions( { lineNumbers: value } );  
    }
    else if (name==="disableAutoUpdate" && self.asyncMadoko) {
      if (value) {
        self.asyncMadoko.pause();
      } 
      else {
        self.asyncMadoko.resume();
      }
    }
    else if (name=="spellCheck") {
      if (value) {
        self.spellCheck();
      }
      else {
        self.removeDecorations(true,"spellerror");
      }
    }
    else if (name==="fontScale") {
      if (self.editor) {
        var editView  = self.editor.getView();      
        var lines     = editView.viewLines;
        var rng       = lines._currentVisibleRange;
        var midLine   = Math.round(rng.startLineNumber + ((rng.endLineNumber - rng.startLineNumber + 1)/2));
        self.editor.updateOptions( { theme: self.getCurrentTheme() });
        self.editor.revealPosition( { lineNumber: midLine, column: 1 }, true, false );
      }
      self.app.setAttribute("data-fontscale",value);
    }
    else if (name==="viewFull") {
      var view = value ? "full" : "normal";
      self.app.setAttribute("data-view",view);
      self.dispatchViewEvent( { eventType: "view", view: view } );      
      setTimeout( function(ev) { Util.dispatchEvent(window,"resize"); }, 100 );
    }
  }

  UI.prototype.saveSettings = function() {
    var self = this;
    if (self.settings) {
      var toSave = Util.copy(self.settings);
      delete toSave.viewFull;
      window.tabStorage.setItem("settings", toSave);
    }
  }


  UI.prototype.anonEvent = function( action, okStates ) {
    var self = this;
    self.event( "","",null, action, okStates );
  }

  UI.prototype.initUIElements = function(content, firstTime) {
    var self = this;

    // common elements
    self.usersStatus = document.getElementById("users-status");
    self.usersPanel  = document.getElementById("users-panel");
    self.spinner = document.getElementById("view-spinner");    
    self.spinner.spinDelay = 750;
    self.syncer  = document.getElementById("sync-spinner");  
    self.syncer.spinDelay = 100;  
    self.exportSpinner = document.getElementById("export-spinner");    
    self.exportSpinner.spinDelay = 1000;
    self.view    = document.getElementById("view");
    self.editSelectHeader = document.getElementById("edit-select-header");

    self.connectionLogo = document.getElementById("connection-logo");
    self.connectionMessage = document.getElementById("connection-message");

    self.lastRenderWasSlow = false;
    self.lastViewRenderWasSlow = false;

    // listen to application cache    
    self.appUpdateReady = false; 
    if (window.applicationCache.status === window.applicationCache.UPDATEREADY) { 
      // reload immediately if an update is ready 
      self.reload(true);
    }
    else {
      window.applicationCache.addEventListener( "updateready", function(ev) {
        if (window.applicationCache.status === window.applicationCache.UPDATEREADY) { 
          if (!self.appUpdateReady) {
            window.applicationCache.swapCache();
            self.appUpdateReady = true;
          } 
        }           
      });
    }

    // resizable panels
    self.panels = Util.enablePanels();

    // start editor
    self.editor = Editor.create(document.getElementById("editor"), {
      value: content,
      mode: "text/madoko",
      roundedSelection: false,
      lineNumbers: self.settings.lineNumbers,
      //mode: MadokoMode.mode,
      theme: self.getCurrentTheme(),
      tabSize: 2,
      insertSpaces: true,
      wrappingColumn: (self.settings.wrapLines ? 0 : -1),
      //automaticLayout: true,
      glyphMargin: true,
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        //verticalHasArrows: true,
        //horizontalHasArrows: true,
        //arrowSize: 10,
      },
      quickSuggestions: true,
    });    


    self.lastActivity = 0;

    window.addEventListener("click",function(ev) {
      self.lastActivity = ev.timeStamp || Date.now();
    });
    
    Util.onResize( function() {
      self.editor.layout();      
      self.syncView({force: true});
      self.lastActivity = Date.now();
    });



    // synchronize on scrolling
    self.syncInterval = 0;
    self.editor.addListener("scroll", function (ev) {    
      function scroll() { 
        self.anonEvent( function() {
          var scrolled = self.syncView(); 
          if (!scrolled) {
            clearInterval(self.syncInterval);
            self.syncInterval = 0;
          }      
        }, [State.Syncing]);
      }

      self.lastActivity = ev.timeStamp || Date.now();
      // use interval since the editor is asynchronous, this way  the start line number can stabilize.
      if (!self.syncInterval) {
        self.syncInterval = setInterval(scroll, 100);
        //scroll();
      }
    });  

    self.changed = false;
    self.lastEditChange = 0;
    self.editor.addListener("change", function (ev) {  
      self.changed = true;
      self.lastEditChange = ev.timeStamp || Date.now();
      self.lastActivity = self.lastEditChange;
    });
    self.editor.addListener("keydown", function (ev) { 
      self.lastActivity = ev.timeStamp || Date.now();   
      if (self.stale || self.changed) self.lastEditChange = self.lastActivity; // so delayed refresh keeps being delayed even on cursor keys.
    });
    
    self.editor.addCommand({ key: 'Alt-Q' }, function(ev) { 
      self.anonEvent( function() { self.onFormatPara(ev); }, [State.Syncing] );
    });
    self.editor.addListener("keydown", function (ev) { 
      if (ev.key === "Enter" && !ev.altKey && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey) {
        var line = self.editor.getModel().getLineContent(self.editor.getPosition().lineNumber);
        if (rxTable.test(line)) {
          ev.stopPropagation();
          ev.preventDefault();
          self.addTableRow();            
        }
      }
    });
    
    
    // Key bindings

    bindKey( "Alt-S",  function()   { self.synchronize(); } );
    bindKey( "Ctrl-S", function()   { self.synchronize(); } );
    bindKey( "Alt-O",  function(ev) { openEvent(ev); });
    bindKey( "Alt-P",  function()   { self.pull(); } );
    // bindKey( "Alt-N",  function(ev) { newEvent(ev); });
    bindKey( "Ctrl-Z", function()   { self.commandUndo(); } );
    bindKey( "Ctrl-Y", function()   { self.commandRedo(); } );
    bindKey( "Alt-C",  function()   { self.spellCheck(); } );
    bindKey( "Alt-N",  function()   { self.gotoNextError(); } );
    bindKey( "Alt-H",  function()   { self.generateHtml(); } );
    bindKey( "Alt-L",  function()   { self.generatePdf(); } );
    bindKey( { key: "Alt-I", stop: true },  function(ev)   { 
      if (self.spellCheckMenu && self.spellCheckMenu.isVisible()) {
        self.spellCheckMenu.menu.ignore(ev);
        self.spellCheckMenu.hide();
      }
    });
    for(var i = 1; i <= 8; i++) {
      (function(idx) { 
        bindKey( "Alt-" + idx.toString(),  function(ev)   { 
          if (self.spellCheckMenu && self.spellCheckMenu.isVisible()) {
            ev.preventDefault();
            ev.stopPropagation();
            self.spellCheckMenu.menu.replaceWith(idx-1);
            self.spellCheckMenu.hide();
          }
          else if (idx===3) {
            self.insertText( "#", null, true ); // move to end
          }
        });
      })(i);
    };

    // --- save links
    var saveLink = function(ev) {
      var elem = ev.target;
      while( elem && elem.nodeName !== "DIV" && !Util.hasClassName(elem, "save-link")) {
        elem = elem.parentNode;
      }

      if (Util.hasClassName(elem,"save-link")) {
        ev.cancelBubble = true;
        var path = decodeURIComponent(elem.getAttribute("data-path")); 
        var mime = decodeURIComponent(elem.getAttribute("data-mime"));
        if (path) {
          self.saveUserContent(path,mime);
        }
      }
    };
    //document.body.addEventListener("click", saveLink);
    document.body.addEventListener("click",saveLink);



    // ----
    
    document.getElementById("sync-now").onclick = function(ev) {
      self.synchronize();
    };

    document.getElementById("pull").onclick = function(ev) {
      self.pull();
    };

    document.getElementById("commit").onclick = function(ev) {
      self.commit();
    };

    self.lastMouseUp = 0;
    self.editor.addListener("mouseup", function(ev) {
      var now = Date.now();
      var delta = now - self.lastMouseUp;
      self.lastMouseUp = now;
      if (delta <= 200) { // check for double click
        self.anonEvent( function() {        
          if (ev.target.type === 6) { // on text
            var lineNo = ev.target.position.lineNumber; 
            var line   = self.editor.getModel().getLineContent(lineNo);
            // match include?
            var cap = /^\s*\[\s*INCLUDE\s*=["']?([^"'\]\n\r\t:]+)["']?\s*(:\s*\w+\s*)?\]\s*$/.exec(line)
            if (cap) {
              var fileName = cap[1]; // TODO use file
              if (Util.extname(fileName)==="") fileName = fileName + ".mdk";
              self.editFile( fileName );
            }
            else {
              // match some filename that is part of the document?
              var col = ev.target.position.column;
              var pre = line.substr(0,col);
              var post = line.substr(col);
              var cap1 = /[\w\-\.\/\\]*$/.exec(pre);
              var cap2 = /^[\w\-\.\/\\]*/.exec(post);
              if (cap1 && cap2) {
                var matched = cap1[0] + cap2[0];
                if (matched && matched.length > 0 && self.storage && self.storage.existsLocal(matched)) {
                  self.editFile(matched);  
                }
              }
            }
          }
        }, [State.Syncing,State.Exporting]);
      }
    });

    self.decorations = [];
    self.dropFiles = null;
    self.editor.addListener("mousemove", function(ev) {
      self.anonEvent( function() {
        if (self.dropFiles) {
          var files = self.dropFiles;
          self.dropFiles = null;
          var pos = {
            column: 1,
            lineNumber: ev.target.position.lineNumber+1,
          };
          self.insertFiles(files,pos);
        }
        else if ((ev.target.type === 4 /* line-decorations */ || ev.target.type === 2 /* glyph_margin */ )
                 && ev.target.position && ev.target.element) 
        {
          var msg = self.getDecorationMessage(self.editName,ev.target.position.lineNumber, ev.target.type===2);
          if (msg) {
            ev.target.element.title = msg;
          }
        }
      }, [State.Syncing]);
    });

    self.editor.addListener("")
    
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
      }, [State.Syncing]);
    }, false);

    self.editorPane.addEventListener("dragover", function(ev) {
      ev.stopPropagation();
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
    }, false);
    
    self.spellCheckMenu = CustomHover.create("spellcheck.content.hover.menu",self.editor, 
      new SpellCheck.SpellCheckMenu(self.spellChecker, 
        function(id) {
          return self.findDecorationById(id);
        },
        function(range,replacement) {
          var command = new ReplaceCommand.ReplaceCommand( range, replacement );
          self.editor.executeCommand("madoko",command);
        }, 
        function(id,tag) {
          self.removeDecorationsOn(id,tag);
        }, 
        function(pos) {
          self.gotoNextError(pos);
        }
      )
    );

    self.errorMenu = CustomHover.create("error.glyph.hover.menu",self.editor, 
      new ErrorMenu.ErrorMenu( 
        function(pos) {
          self.gotoNextError(pos);
        }
      )
    );


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
        // console.log("preview event: " + ev.data);
        var info = JSON.parse(ev.data);
        if (!info || !info.eventType) return;        
        if (info.eventType === "previewContentLoaded") {
          return self.viewLoaded();
        }
        else if (info.eventType === "previewSyncEditor" && typeof info.line === "number") {
          return self.editFile( info.path ? info.path : self.docName, { lineNumber: info.line, column: 0 } );
        }
        else if (info.eventType === "contentLoaded") {
          if (!self.viewTimes) self.viewTimes = [];
          self.viewTimes.push(info.time);
          if (self.viewTimes.length > 5) self.viewTimes.shift();
          var avgTime = self.viewTimes.reduce( function(prev,t) { return prev+t; }, 0 ) / (self.viewTimes.length || 1);
          Util.message("preview loaded in " + info.time.toString() + "ms, avg. time " + avgTime.toString() + "ms", Util.Msg.Trace);
          self.lastViewRenderWasSlow = (avgTime > 300);
        }
      }, [State.Syncing,State.Exporting]);
    }, false);

    // Buttons and checkboxes

    self.lastSave = 0;
    self.lastSync = 0;
    self.lastConUsersCheck = 0;
    self.iconDisconnect = document.getElementById("icon-disconnect");
    self.lastVersionCheck = 0;

    // request cached version; so it corresponds to the cache-manifest version  
    self.version = null;
    Util.getAppVersionInfoFull().then( function(version) {
      if (version) {
        self.version = version;
        var shortDigest = "(" + self.version.digest.substr(0,6) + ")";
        var shortDate   = self.version.date.substr(0,10);
        var elem = document.getElementById("madokoWebVersion");
        if (elem) elem.textContent = self.version.version || "?";       
        elem = document.getElementById("madokoVersion");
        if (elem) elem.textContent = self.version.madokoVersion || "?";
        elem = document.getElementById("madokoDigest");
        if (elem) {
          elem.textContent = ", " + shortDate + " " + shortDigest;
          elem.setAttribute("title","digest: " + self.version.digest);
        }
      
        // check if we just updated
        var localVersion = Util.jsonParse(localStorage.getItem("version"));
        if (localVersion==null || localVersion.digest !== version.digest) {
          localStorage.setItem("version", JSON.stringify(version));
          self.showUpdateMessage();
        }
      } 
    });
    document.getElementById("showversion").onclick = function() {
      self.showUpdateMessage();
    };
    
    var autoSync = function() {
      var now = Date.now();

      // do a full save?
      if (self.lastSave===0 || (now - self.lastSave >= 20000)) {
        self.localFullSave(); // async
      }

      // update connection status and synchronize
      self.updateConnectionStatus().then( function(status) {        
        if (self.storage.remote.canSync) {
          if (status===0) {
            if (now - self.lastConUsersCheck >= 5000) {
              self.showConcurrentUsers( now - self.lastConUsersCheck < 30000 );
            }
          }
          
          if (status===400) {
            Util.message("Could not synchronize because the Madoko server could not be reached (offline?)", Util.Msg.Info);
          }
          else { // force login if not connected
            if (self.settings.autoSync && self.state === State.Normal) { 
              if (self.lastSync === 0 || (now - self.lastSync >= 30000 && now - self.lastEditChange > 5000)) {
                self.lastSync = Date.now(); // set last sync so we won't popup too many dialogs..
                self.synchronize(self.storage.remote.canCommit); // pull only?
              }
            }
          }
        }
      });

      // check if an app update happened 
      if (self.state === State.Normal && self.appUpdateReady) {
        self.appUpdateReady = false;        
        Util.message("Madoko has been updated. Please reload.", Util.Msg.Status);     
        self.reload(true);
      }

      // check the version number on the server every minute
      if (now - self.lastVersionCheck >= 60000) {  
        self.lastVersionCheck = now;
        // first post stats
        self.postStat();
        // request lastest appversion from the server 
        Util.getAppVersionInfo(true).then( function(version) {
          if (!version) return;
          if (self.appUpdateReady || !self.version) return;
          if (self.version.digest === version.digest) return;
          if (self.version.updateDigest === version.digest) { // are we updating right now to this version?
            // firefox doesn't reliably send a update ready event, check here also. 
            if (window.applicationCache.status === window.applicationCache.UPDATEREADY)
                //|| window.applicationCache.status === window.applicationCache.IDLE)  // this is for Firefox which doesn't update the status correctly
            {
              window.applicationCache.swapCache();
              self.appUpdateReady = true;              
            }
            else if (isFirefox && window.applicationCache.status === window.applicationCache.IDLE) {
              self.version.digest = version.digest; // prevent further alerts 
              alert("Madoko has updated but Firefox has a bug (830588) preventing it to update automatically." +
                    "\nClear your history (in particular the 'Offline website data') -- and reload." +
                    "\n\nA quick way to clear the Madoko application cache is to press 'Shift+F2' and" +
                    "\nissue the command 'appcache clear' (and reload after that)");
            }
          }
          else { 
            self.version.updateDigest = version.digest; // remember we update to this version
            window.applicationCache.update(); // update the cache -- will trigger a reload later on.                     
            Util.message("Downloading updates...", Util.Msg.Status);
          }
        });
      }
    };

    setTimeout( autoSync, 1000 ); // run early on on startup
    setInterval( autoSync, 5000 );

    document.getElementById("menu-settings-content").onclick = function(ev) {
      if (ev.target && Util.contains(ev.target.className,"button")) {
        var child = ev.target.children[0];
        if (child && child.nodeName === "INPUT") {
          child.checked = !child.checked;
          Util.dispatchEvent( child, "change" );
        }
      }
    };

    var openEvent = function(ev) {
      self.event( "loaded", "loading...", State.Loading, function() {
        return Storage.openFile(self.storage).then( function(res) { 
          return self.updateConnectionStatus().then( function() {
            if (!res) return Promise.resolved(); // canceled
            return self.openFile(res.storage,res.docName); 
          });
        }, function(err) {
          self.updateConnectionStatus();
          throw err;
        });
      });
    };
    document.getElementById("open").onclick = openEvent;

    document.getElementById("import-tex").onclick = function(ev) {
      self.event( "imported", "importing...", State.Loading, function() {
        return self.importTex().always( function() { 
          return self.updateConnectionStatus();
        });
      });
    };
    
    document.getElementById("signin").onclick = function(ev) {
      if (self.storage && self.storage.remote.needSignin) {        
        return self.anonEvent( function() {
          return self.login(" ");
        });      
      }
    };
    
    document.getElementById("signout").onclick = function(ev) {
      if (self.storage && self.storage.remote.needSignin) {        
        return self.anonEvent( function() {
          return self.storage.remote.logout(true).then( function() {
            return self.updateConnectionStatus();
          });
        });      
      }
    };
    
    var newEvent = function(ev) {
      self.event( "created", "creating...", State.Loading, function() {
        return Storage.createFile(self.storage).then( function(res) { 
          if (!res) return Promise.resolved(); // canceled
          return self.openFile(res.storage,res.docName); 
        });
      });
    };
    document.getElementById("new").onclick = newEvent;

    window.addEventListener("hashchanged", function(ev) {
      self.loadFromHash();
    });

    document.getElementById("save").onclick = function(ev) {
      self.event( "saved","saving...", State.Syncing, function() {
        return self.saveTo();
      });
    }
    
    document.getElementById("export-html").onclick = function(ev) {
      self.generateHtml(); 
    }

    document.getElementById("azure").onclick = function(ev) {
      self.generateSite(); 
    }

    document.getElementById("export-pdf").onclick = function(ev) {
      return self.generatePdf(); 
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
      }, [State.Syncing]);
    };   
       
    document.getElementById("edit-select-files").onclick = function(ev) {
      self.anonEvent( function() {
        var elem = ev.target;
        while(elem && elem.nodeName !== "DIV") {
          if (elem.nodeName === "A") return; //don't proceed if clicking on explicit link
          elem = elem.parentNode;          
        }
        if (elem && elem.getAttribute) {  // IE10 doesn't support data-set so we use getAttribute
          var path = decodeURIComponent(elem.getAttribute("data-file"));
          if (path) {
            var mime = Util.mimeFromExt(path);
            return self.event( "loaded: " + path, "loading...", State.Loading, function() {
              if (mime==="application/pdf" || mime==="text/html" || Util.startsWith(mime,"image/")) {
                return self.saveUserContent( path, mime );
              }
              else {
                return self.editFile(path);            
              }
            }, [State.Syncing,State.Exporting]);
          }
        }
      });
    };

    self.usersPanel.onclick = function(ev) {
      self.anonEvent( function() {
        var elem = ev.target;
        while(elem && elem.nodeName !== "DIV") {
          elem = elem.parentNode;          
        }
        if (!elem) return;
        var epath = elem.getAttribute("data-path");
        var eline = elem.getAttribute("data-line");
        if (!epath || !eline) return;
        var path = decodeURIComponent(epath);
        var line = parseInt(decodeURIComponent(eline));
        if (!path || isNaN(line)) return;
        return self.editFile(path, (line > 0 ? { lineNumber: line, column: 0 } : null));
      }, [State.Syncing,State.Exporting]);
    };


    function messageDblClick(ev) {
      self.anonEvent( function() {
        var elem = ev.target;
        while(elem && elem.nodeName !== "DIV" && elem.className !== "msg-line") {
          elem = elem.parentNode;
        }
        if (elem && (elem.id === "status" || elem.className==="msg-line" || elem.className==="msg-section")) {
          var line = elem.textContent;
          var cap = /\bline(?:\s|&nbsp;)*:(?:\s|&nbsp;)*(\d+)/i.exec(line);
          var pos = null;
          var path = null;
          if (cap) {
            var lineNo = parseInt(cap[1]);
            if (!isNaN(lineNo)) {
              //self.gotoPosition( { lineNumber: lineNo, column: 1 } );
              pos = { lineNumber: lineNo, column: 1 };
              path = self.editName;
            }
          }
          else {
            cap = /\b(?:warning|error|line):(?:\s|&nbsp;)*((?:[\w\\\/\.\- \u00A0]|&nbsp;)*)(?:\s|&nbsp;)*:?\(?(\d+)(?:-\d+)?\)?/i.exec(line)
            if (cap) {
              var lineNo = parseInt(cap[2]);
              var path = cap[1].replace(/[\u00A0]|&nbsp;/g, " "); // TODO use file
              if (!isNaN(lineNo)) {
                // self.editFile( fileName, { lineNumber: lineNo, column: 1 }, true );
                pos = { lineNumber: lineNo, column: 1 };
              }
            }
          }
          if (pos && path) {
            var dec = self.findErrorDecoration(path,pos);
            if (dec) {
              self.gotoDecoration(dec);
            }
            else {
              self.editFile(path,pos,true);
            }
          }
        }
      }, [State.Syncing,State.Exporting]);
    }

    document.getElementById("console-out").ondblclick = messageDblClick;
    document.getElementById("status").ondblclick = messageDblClick;
   
    self.syncer.onclick = function(ev) {      
      self.synchronize();
    }

    document.getElementById("view-sync").onclick = function(ev) {
      self.anonEvent( function() {
        self.dispatchViewEvent( { eventType: "viewSync" });
      });
    }

    
    // narrow and wide editor panes
    //viewpane.addEventListener('transitionend', function( event ) { 
    //  self.syncView(); 
    //}, false);

    function toggleFullView() {
      /*
      if (!self.settings.viewFull) {
        fullHeaderStart();
      }
      */
      self.updateSettings({viewFull: !self.settings.viewFull });
    }

    function closeFullView() {
      if (self.settings.viewFull) toggleFullView();
    }
//      self.app.setAttribute("data-view",view);
//      self.dispatchViewEvent( { eventType: "view", view: view } );

    bindKey("Alt-V", toggleFullView );
    bindKey({code:27,stop:true}, closeFullView );

    document.getElementById("close-fullview").onclick = function(ev) {
      closeFullView();
    }
    
    document.getElementById("view-full").onclick = function(ev) {
      toggleFullView();
    }
    
    // font size
    document.getElementById("font-small").onclick = function(ev) {
      self.updateSettings ({fontScale:"small"});
    }
    document.getElementById("font-medium").onclick = function(ev) {
      self.updateSettings({fontScale:"medium"});
    }
    document.getElementById("font-large").onclick = function(ev) {
      self.updateSettings({fontScale:"large"});
    }
    document.getElementById("font-x-large").onclick = function(ev) {
      self.updateSettings({fontScale:"x-large"});
    }
    
    // Theme
    document.getElementById("theme-ivory").onclick = function(ev) {
      self.updateSettings({theme:"ivory"})
    }
    document.getElementById("theme-midnight").onclick = function(ev) {
      self.updateSettings({theme:"vs-dark"})
    }
    document.getElementById("theme-zen").onclick = function(ev) {
      self.updateSettings({theme:"vs"})
    }

    // toolbox
    self.initTools();

    // emulate hovering by clicks for touch devices
    Util.enablePopupClickHovering();    
    
    // pinned menus
    var pin = Util.enablePinned();

    /*
    // if first time, pin the tool menu
    if (firstTime) {
      pin("toolbox-content",1000,0,"editor");
    }
    */

    return;
  }

  UI.prototype.login = function(message) {
    var self = this;
    if (!self.storage) return Promise.resolved(false);
    return self.storage.login(false,message).always( function() {
      return self.updateConnectionStatus();
    });
  }

  UI.prototype.updateRemoteLogo = function(stg,isConnected) {
    var self = this;
    if (!stg) stg = self.storage;
    if (isConnected==null) isConnected = self.isConnected;
    self.app.className = self.app.className.replace(/(^|\s+)remote-\w+\b/g,"") + " remote-" + stg.remote.type;
    if (!stg.remote.needSignin) {
      Util.removeClassName(self.app,"connected");
      Util.removeClassName(self.app,"disconnected");
    }
    else if (isConnected) {
      Util.removeClassName(self.app,"disconnected");
      Util.addClassName(self.app,"connected");      
    }
    else {
      Util.removeClassName(self.app,"connected");      
      Util.addClassName(self.app,"disconnected");
    }

    if (self.connectionMessage) {
      self.connectionMessage.textContent = stg.remote.displayName;
      self.connectionMessage.title       = stg.remote.title;
    }
    
    var inviteUrl = "";
    if (stg && stg.remote) {
      var remoteLogo = "images/dark/" + stg.remote.logo;
      if (self.connectionLogo.src !== remoteLogo) self.connectionLogo.src = remoteLogo;
      inviteUrl = stg.getInviteUrl(self.docName);

      /*
      if (stg.remote.needSignin && isConnected) {
        stg.remote.getUserName().then( function(userName) {
          document.getElementById("connection-content").setAttribute("title", "As " + userName);
        });
      }
      */    
    }
    document.getElementById("invite-link").href = inviteUrl;
  }

  UI.prototype.updateConnectionStatus = function (stg) {
    var self = this;
    if (!stg) stg = self.storage;
    if (!stg) return Promise.resolved(false);
    return stg.connect().then( function(status) {
      self.isConnected = (status === 0); 
      self.updateRemoteLogo(stg,self.isConnected);
      return status;
    });
  }

  UI.prototype.setEditText = function( text, options, mode ) {
    var self = this;
    self.editor.editFile(self.editName,text,options,mode)    
    self.lastSpellCheck = 0;
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

    // update working stats.
    var now = Date.now();
    if (self.stat.editLast + self.stat.editDelta > self.lastEditChange) {
      self.stat.editTotal = self.stat.editTotal + (self.lastEditChange - self.stat.editLast);
    }
    self.stat.editLast = self.lastEditChange;
    
    
    function updateFull() {
      update();
      // for separate viewer
      // localStorage.setItem("viewer-html",html);
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

  function stripMarkup(s) {
    var attrs    = /\{:?((?:[^\\'""\}\n]|\\[.\n]|'[^']*'|""[^""]*"")*)\}/;
    var linkhref = /\s*<?([^\s>)]*)>?(?:\s+['""](.*?)['""])?\s*/;
    var xlinkid  = /((?:[^\[\]\n]|\[[^\]\n]*\])*)/;
    var linktxt  = /\[(?!\^)((?:\[(?:[^\[\]]|\[[^\]]*\])*\]|\\.|[^\\\]]|\](?=[^\[{]*\]))*)\]/
    var linkreg  = new RegExp( linktxt.source + "((?:\\(" + linkhref.source + "\\)|\\s*\\[" + xlinkid.source + "\\])?(?:" + attrs.source + ")?)", "g" );
    var s1 = s.replace(linkreg, "$1").replace(linkreg, "$1");
    return s1.replace(/&#(\d+);/g, function(matched,num) {
      var n = parseInt(num);
      if (isNaN(n)) return "";
      return String.fromCharCode(n);
    });
  }

  UI.prototype.updateCitations = function( path, bib ) {
    var self = this;
    var menu = document.getElementById("tool-cite-content");
    if (!menu) return;

    var noCitations = "No entries (need to include a .bib file)";

    if (!self.citations) self.citations = new Map();
    if (path==null || bib==null) {
      // clear
      self.citations = null;
      if (self.editor) self.editor.setSuggestCitations([]);
      menu.innerHTML = noCitations;    
      return;  
    }

    // parse citations from this bib file
    var cites = [];
    var rxEntry = /^[ \t]*@(\w+)\s*\{\s*([\w:;\-\.]+)\s*,([\s\S]*?)\n(?=[ \t]*(?:[@\}]|\r?\n))/gm;
    var cap;
    while (cap = rxEntry.exec(bib)) {
      var name = cap[2];
      var entry = cap[3];
      var rxTitle = /(?:^|,)\s*title\s*=\s*(?:\{((?:[^\\\}]|\}(?!\s*,)|\\.)*)\}|"((?:[^\\"]|\\.)*)")\s*,/;
      var capTitle = rxTitle.exec(entry + ",");
      var title = capTitle ? capTitle[1] || capTitle[2] : name;
      cites.push( { name: name, title: stripMarkup(title) });
    }
    self.citations.set(path,cites);


    // collect all citations
    cites = [];
    self.citations.forEach( function(path,cs) {
      cites = cites.concat(cs);
    });
    cites = cites.sort(function(c1,c2) {
      var s1 = c1.name.toLowerCase();
      var s2 = c2.name.toLowerCase();
      return (s1 < s2 ? -1 : (s1 > s2 ? 1 : 0)); 
    });

    if (self.editor) self.editor.setSuggestCitations(cites);

    var html = noCitations;
    if (cites.length > 0) {
      html = cites.map( function(cite) {
        return "<span class='button cite' data-value='" + encodeURIComponent(cite.name) + "' title='" + Util.escape(cite.title) + "'>@" + Util.escape(cite.name) + "</span>";
      }).join("<br/>");
    }

    menu.innerHTML = html;
  }

  function jsonParseLineArray(txt,keyName) {
    if (!txt) return [];
    if (!keyName) keyName = "name";
    var json = "["+ txt.split("\n").filter(function(line){ return (line.length>0); }).join(",\n") + "]";
    var items = Util.jsonParse(json,[]);
    var itemMap = new Map();
    items.forEach( function(item) { 
      var key = item[keyName];
      if (!itemMap.contains(key)) itemMap.set( key, item );
    });
    return itemMap.sortedKeyElems().map( function(kv) { return kv.value; });
  }
  
  var customSnippets = new Map([
    { key: "equation", value: "Equation { #eq-{{name}} }" },
    { key: "figure", value: "Figure { #fig-{{name}} caption=\"{{caption}}\" }\n{{content}}" },
    { key: "tablefigure", value: "TableFigure { #fig-{{name}} caption=\"{{caption}}\" }\n{{content}}" },
    { key: "bibitem", value: "BibItem { #{{citelabel}} caption=\"{{caption}}\" }\n{{content}}" },
  ]);

  UI.prototype.updateLabels = function( labelsTxt, linksTxt, customsTxt, entitiesTxt ) {
    var self = this;
    var noLabels = "None";

    // parse customs
    var customs = jsonParseLineArray(customsTxt).map( function(custom) {
      custom.snippet = customSnippets.get(custom.name.toLowerCase) || (custom.display + "\n{{content}}");
      custom.name = stripMarkup(custom.display);
      return custom;
    });
    if (self.editor) self.editor.setSuggestCustoms(customs);

    // parse entities
    var entities = jsonParseLineArray(entitiesTxt).map( function(entity) {
      entity.label = entity.name + " " + (entity.code ? "(" + String.fromCharCode(entity.code) + ")" : "");
      entity.snippet = entity.name + ";"
      return entity;
    });
    if (self.editor) self.editor.setSuggestEntities(entities);

    // parse labels
    var cites = new Map();
    var labels = jsonParseLineArray(labelsTxt).filter( function(item) { 
      if (Util.startsWith(item.name, "fn-")) {
        return false;
      }
      else if (Util.startsWith(item.name, "@")) {
        cites.set(item.name, item.caption || item.text);
        return false;
      }
      else return true;
    }).filter( function(item) {
      return  !cites.contains("@" + item.name);
    }).map( function(label) {
      label.title = stripMarkup(label.caption || label.text);
      return label;
    });
    
    // update suggestions
    if (self.editor) self.editor.setSuggestLabels(labels);


    // parse links
    var links = jsonParseLineArray(linksTxt).map(function(link) {
      link.title = stripMarkup(link.title);
      link.description = link.href + (link.title ? " \"" + link.title + "\"" : "");
      return link;
    });
    // add labels too
    labels.forEach( function(label) {
      links.push( {
        name: "#" + label.name,
        title: label.title,
      });
    });
    if (self.editor) self.editor.setSuggestLinks(links);

    

    // render labels
    var menuLabels = document.getElementById("tool-reference-content");
    if (menuLabels) {
      var labelHtml = noLabels;
      if (labels.length > 0) {
        labelHtml = labels.map( function(label) {
          var name = label.name;
          return "<span class='button label' data-value='" + encodeURIComponent(name) + "' title='" + Util.escape(label.title) + "'>#" + Util.escape(name) + "</span>";
        }).join("<br/>");
      }
      menuLabels.innerHTML = labelHtml;
    }
  }

  UI.prototype.showSpinner = function(enable, elem) {
    var self = this;
    if (!elem) elem = self.spinner; // default spinner
    if (elem.spinners == null) elem.spinners = 0;
    if (elem.spinDelay == null) elem.spinDelay = self.refreshRate * 2;
    if (elem.spinners < 0) elem.spinners = 0;

    if (enable && elem.spinners === 0) {      
      setTimeout( function() {
        if (elem.spinners >= 1) Util.addClassName(elem,"spin");
      }, elem.spinDelay );
    }
    else if (!enable && elem.spinners <= 1) {
      Util.removeClassName(elem,"spin");
      // for IE
      var vis = elem.style.visibility;
      elem.style.visibility="hidden";
      elem.style.visibility=vis;
    }
    if (enable) elem.spinners++;
           else elem.spinners--;
  }

  UI.prototype.initRunners = function() {
    var self = this;
    function showSpinner(enable) {
      self.showSpinner(enable);
    }

    self.asyncMadoko = new Util.AsyncRunner( self.refreshRate, showSpinner, 
      function() {
        var changed = self.changed;
        self.changed = false;
        self.stale = self.stale || changed;
        self.storage.setEditPosition( self.editName, self.editor.getPosition() );
        if (!self.stale) return false;

        if (self.lastEditChange) {
          var now = Date.now();
          var diff = (self.lastRenderWasSlow || self.lastViewRenderWasSlow || self.settings.delayedUpdate) ? 1000 : 50;
          if (Date.now() - self.lastEditChange < diff) {
            return false;
          }
        }
        return true;
      },
      function(round) {
        self.localSave(); // minimal save
        self.stale = false;
        if (!self.runner) return cont();
        if (self.editName === self.docName) {
          self.docText = self.getEditText();
        }
        return self.runner.runMadoko(self.docText, {
                  docname: self.docName, 
                  round: round, 
                  time0: Date.now(),
                  showErrors: function(errs) { self.showErrors(errs,false,"warning"); }
                }).then( function(res) {
              self.htmlText = res.content; 
              self.fileOrder = res.fileOrder || []; // used for gotoNextError
              var quick = self.viewHTML(res.content, res.ctx.time0);
              self.updateLabels(res.labels,res.links,res.customs,res.entities);
              if (res.runAgain) {
                self.stale=true;
                self.localFullSave(); // async full save as probably files are added
              }
              if (res.runOnServer && !self.settings.disableServer && self.asyncServer 
                    && self.lastMathDoc !== res.mathDoc) { // prevents infinite math rerun on latex error
                self.lastMathDoc = res.mathDoc;
                self.asyncServer.setStale();
              }
              if (!res.runAgain && !res.runOnServer && !self.stale) {
                // Util.message("ready", Util.Msg.Info);
                self.removeDecorations(false,"error");
              }
              self.removeDecorations(false,"merge");
              self.showConcurrentUsers( true );

              // adjust delayed view?
              self.lastRenderWasSlow = (res.avgTime > 400);
              
              
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
                        (!self.settings.delayedUpdate ? " (continuous)" : "") +
                        //"\n  refresh rate: " + self.refreshRate.toFixed(0) + "ms" +
                        ", avg. time: " + res.avgTime.toFixed(0) + "ms" +
                        " (" + (self.lastRenderWasSlow ? "slow" : (self.lastViewRenderWasSlow ? "slow-view" : "quick")) + ")");                                                        
            },
            function(err) {
              self.onError(err);              
            }
          );
      }
    );

    self.asyncServer = new Util.AsyncRunner( self.serverRefreshRate, function(enable) { self.showSpinner(enable, self.exportSpinner) }, 
      function() { return false; },
      function(round) {
        //self.lastMathDoc = self.getMathDoc();
        var ctx = {
          docname: self.docName, 
          round:round,
          showErrors: function(errs) { self.showErrors(errs,false); },
        };
        var msgid = Util.message("Rendering math...", Util.Msg.Status );
        return self.runner.runMadokoServer(self.docText, ctx ).then( 
          function(ctx) {
            // self.asyncServer.clearStale(); // stale is usually set by intermediate madoko runs
            // run madoko locally again using our generated files (and force a run)
            Util.messageClear(msgid);
            return self.asyncMadoko.run(true);
          },
          function(err) {
            self.onError(err);            
          }
        );     
      }
    );

    self.lastSpellCheck = 0;
    self.asyncSpellCheck = new Util.AsyncRunner( 2000, null, 
      function() {
        var now = Date.now();
        return (self.settings.spellCheck && self.lastEditChange > self.lastSpellCheck && ((now - self.lastEditChange) > 1000));
      },
      function(round) {
        var ctx = {
          path: self.editName,
          round: round,
          show: function(errs) { self.showSpellErrors(errs); },
        };
        return self.spellChecker.check( self.editor.getValue(), ctx ).then( function(res) {
          self.lastSpellCheck = Date.now();
          return "Spell check done.";
        });
      }
    );
  }

  UI.prototype.getMathDoc = function() {
    var self = this;
    var mathExt = ".tex";
    var mathStem = "out/" + Util.stemname(self.docName) + "-math-"
    return self.storage.readLocalContent(mathStem + "dvi" + mathExt) + self.storage.readLocalContent( mathStem + "pdf" + mathExt, "" );
  }


  // Save editor text to storage
  UI.prototype.flush = function(path) {
    var self = this;
    if (path && path !== self.editName) return;

    var pos  = self.editor.getPosition();
    var text = self.getEditText();
    self.editContent = text;
    if (self.storage)  self.storage.writeFile( self.editName, text, { position: pos } ); // todo: not for readOnly     
  }

  // synchronous save state to local disk
  UI.prototype.localSave = function() {
    var self = this;
    self.saveSettings();
    if (!self.storage || !self.editName) return {};
    
    self.flush();    
    var pos  = self.editor.getPosition();    
    var doc = { 
      docName: self.docName, 
      editName: self.editName, 
      pos: pos,
      storage: self.storage.persist(self.tabDb.limit()),      
    };
    try {
      window.tabStorage.setItem( "document", doc );
      window.tabStorage.setItem( "editContent", self.editContent ); // updated by flush    
      return doc;
    }
    catch(exn) {
      Util.message("Unable to save document state to local storage: " + exn.toString(), Util.Msg.Warning);
      return doc;
    };    
  }

  // Asynchonous full save
  UI.prototype.localFullSave = function() {
    var self = this;
    var doc = self.localSave();
    if (!self.storage || !doc || !doc.storage) return Promise.resolved();
    return Promise.map( doc.storage.files, function(fname) {
      var key = "/" + fname;
      var info = self.storage.persistFile(fname);
      if (!info) return;
      return self.tabDb.setItem(key, info);
    }).then( function() {
      // remove deleted files
      return self.tabDb.keys().then( function(keys) {
        var rkeys = [];
        keys.forEach( function(key) {
          if (Util.startsWith(key,"/") && !self.storage.existsLocal(key.substr(1))) {
            rkeys.push(key);
          }
        });
        return Promise.map( rkeys, function(rkey) {
          return self.tabDb.removeItem(rkey);
        });
      });
    }).then( function() {
      self.lastSave = Date.now();
      return true;
    }, function(err) {
      Util.message("Unable to save document to persistent storage: " + err.toString(), Util.Msg.Error);
      return false;
    });
  }

  UI.prototype.importTex = function() {
    var self = this;
    return self.checkSynced().then( function(yes) {
      if (!yes) throw new Error("operation cancelled");
      return Storage.upload( null, "Please select the main LaTeX file (.tex)<br>(After importing, you can drag&drop further includes, style files, bibliographies, etc. right into the editor)", "Import LaTeX file", "images/dark/icon-upload.png").then( function(files) {
        var fname = (files && files[0]) ? files[0].name : null;
        if (!fname || Util.extname(fname) !== ".tex") throw new Error("Sorry, can only import .tex files.");
        var docName = Storage.sanitizeFileName(Util.stemname(fname)) + ".mdk";
        var stg = Storage.createNullStorage();        
        stg.writeFile(docName,"")
        return self.setStorage(stg,docName).then( function() {
          self.insertFiles(files);
        });
      });
    });
  }

  UI.prototype.loadFromHash = function() {
    var self = this;
    var cap = /[#&\?]url=(https?:\/\/[^=&#;]+)/.exec(window.location.hash);
    if (cap) {
      var url = Util.dirname(cap[1]);
      var doc = Util.basename(cap[1]);
      return self.checkSynced().then( function(yes) {
        if (!yes) throw new Error("operation cancelled");
        return Storage.httpOpenFile(url,doc);
      }).then( function(res) {
        return self.openFile(res.storage,res.docName); 
      }).then( function() {
        return true;
      }, function(err) {
        Util.message(err, Util.Msg.Error);
        Util.message("failed to load hash url: " + cap[1], Util.Msg.Error);
        return self.localLoad();
      });
    }
    else {
      return self.localLoad();
    }
  }

  UI.prototype.setStorage = function( stg0, docName0 ) {
    var self = this;
    return self.initializeStorage(stg0,docName0, function(stg,docName,fresh) {
      return self.updateConnectionStatus(stg).then( function() {
        if (stg.remote.type==="local") {
          var tabNo = Number(stg.remote.getFolder());
          if (!isNaN(tabNo) && tabNo > 0) {
            return self.localLoad(tabNo);
          }
        }
        return self.withSyncSpinner( function() {
          return stg.readFile(docName, false);
        }).then( function(file) {           
          if (self.storage) {
            self.storage.destroy();     // clears all event listeners
            self.updateCitations(null); // clears citations
            self.updateLabels(null,null,null,null); // clears references
            self.dispatchViewEvent({eventType: "reload"});      
            //self.viewHTML( "<p>Rendering...</p>", Date.now() );
            //self.storage.clearEventListener(self);
          }
          self.storage = stg;
          self.docName = docName;
          self.docText = file.content;
          self.setTitle( "Madoko" + (window.tabStorage.tabNo > 1 ? "/" + window.tabStorage.tabNo.toString() : "") + " - " + Util.stemname(self.docName) );

          // initialize citations
          self.storage.forEachFile( function( file ) {
            if (Util.extname(file.path) === ".bib") self.updateCitations( file.path, file.content );
          });
          
          self.storage.addEventListener("update",self);
          self.runner.setStorage(self.storage);
          self.spellChecker.setStorage(self.storage);
          /*
          var remoteLogo = self.storage.remote.logo;
          var remoteType = self.storage.remote.type;
          var remoteMsg = (remoteType==="local" ? "browser local" : remoteType);
          self.remoteLogo.src = "images/dark/" + remoteLogo;
          self.remoteLogo.title = "Connected to " + remoteMsg + " storage";        
          */
          self.editor.clearEditState();
          self.editName = "";
          return self.editFile(self.docName).always( function() { self.setStale(); } ).then( function() { 
            return self.updateConnectionStatus().then( function() {
              return fresh; 
            });
          });
        });
      });
    });
  }

  UI.prototype.initializeStorage = function(stg,docName,cont) {
    var self = this;
    docName = docName || "document.mdk";        
    var cap = /[#&]template=([^=&#;]+)/.exec(window.location.hash);
    if (cap) window.location.hash = "";
    if (cap || !stg) {
      return (stg && !stg.isSynced() ? Storage.discard(stg,docName) : Promise.resolved(true)).then( function(discard) {
        if (!discard) return cont(stg,docName);

        // initialize fresh from template
        stg = Storage.createNullStorage();
        var template = (cap ? cap[1] : "default");
        return Storage.createFromTemplate(stg,docName,template).then( function() {
          return cont(stg,docName,true);
        });
      });
    } 
    else {
      return cont(stg,docName,false);
    }
  }

  UI.prototype.spinWhile = function( elem, promise ) {
    var self = this;
    self.showSpinner(true,elem);
    return promise.always( function() {
      self.showSpinner(false,elem);
    });
  }

  UI.prototype.editFile = function(fpath,pos,reveal) {
    var self = this;
    var loadEditor;
    if (self.editName) {
      self.flush(self.editName);
    }
    //self.state = State.Loading;            
    if (fpath===self.editName) loadEditor = Promise.resolved(null) 
     else loadEditor = self.spinWhile(self.syncer, self.storage.readFile(fpath, false)).then( function(file) {       
            self.hideDecorations();
            self.showConcurrentUsers(false,"none");
            if (self.editName === self.docName) {
              self.docText = self.getEditText();
            }
            
            var options = {
              readOnly: !Storage.isEditable(file),
              theme: self.getCurrentTheme(),
              //mode: file.mime,
              //mode: mode, // don't set the mode here or Monaco runs out-of-stack
              lineNumbers: self.settings.lineNumbers,
              wrappingColumn: self.settings.wrapLines ? 0 : -1,
            };
            self.editName = file.path;
            self.setEditText(file.content, options, file.mime);
            self.onFileUpdate(file); // update display etc.
            return Storage.getEditPosition(file);
      });
    return loadEditor.then( function(posx) {      
      if (!pos) pos = posx;
      if (pos) {
        self.gotoPosition(pos, reveal );
      }
      self.showDecorations();
      self.showConcurrentUsers(false);
      self.localFullSave();
    }); 
    // .always( function() { 
    //   self.state = State.Normal; 
    // });    
  }

  UI.prototype.onContentChanged = function(ev) {
    console.log(ev);
  }

  UI.prototype.gotoPosition = function( pos, reveal ) {
    var self = this;
    self.editor.setPosition(pos,true,true);
    if (reveal) {
      self.editor.revealPosition( pos, true, true );    

    }               

  }

  UI.prototype.localLoad = function(tabNo) {
    var self = this;
    if (tabNo==null) tabNo = window.tabStorage.tabNo;

    // legacy local storage
    var json = localStorage.getItem("local/local");
    if (json) {
      var obj = JSON.parse(json);
      localStorage.removeItem("local/local"); // and remove it.
      var stg = Storage.unpersistStorage(obj.storage);
      return self.setStorage( stg, obj.docName ).then( function(fresh) {
        if (fresh) return; // loaded template instead of local document
        return self.editFile( obj.editName, obj.pos );
      });
    }

    // load from page storage
    if (!TabStorage.claim(tabNo)) throw new Error("Cannot open document: it is already opened in another tab");
    var obj = window.tabStorage.getItemFrom(tabNo,"document");
    if (obj==null || obj.storage == null) return self.setStorage(null,null);
             
    // read needed files
    return Promise.map( obj.storage.files, function(fname) {
      var key = "/" + fname;
      return self.tabDb.getItemFrom(tabNo,key).then( function(info) {
        if (info!=null) obj.storage[key] = info;
      });
    }).then( function() {
      var stg = Storage.unpersistStorage(obj.storage);
      var editContent = window.tabStorage.getItemFrom(tabNo,"editContent");
      if (editContent!=null) {
        stg.writeFile( obj.editName, editContent, { position: obj.pos })
      }
      return self.setStorage( stg, obj.docName ).then( function(fresh) {
        if (fresh) return; // loaded template instead of local document
        return self.editFile( obj.editName, obj.pos );
      });
    }).then( function() {
      if (tabNo === window.tabStorage.tabNo) return;
      window.tabStorage.clear(tabNo);
      return self.tabDb.clear(tabNo);
    }).always( function() {
       TabStorage.unClaim(tabNo);
    });
  }


  UI.prototype.checkSynced = function() {
    var self = this;
    return Promise.do( function() { 
      if (self.storage) 
        return self.storage;
      else 
        return self.localLoad().then( function() { return self.localStorage; });
    }).then( function(stg) {
      if (stg && !stg.isSynced()) {
        //var ok = window.confirm( "The current local document has changes that not been saved yet to cloud storage!\n\nDo you want to discard these changes?");
        //if (!ok) return Promise.rejected("the operation was cancelled");
        return Storage.discard(stg);
      }
      else {
        return true;
      }
    });
  }

  UI.prototype.openFile = function(storage,fname) {
    var self = this;
    var mime = Util.mimeFromExt(fname);
    if (fname && !(mime === "text/madoko" || mime==="text/markdown") ) return Util.message("only markdown (.mdk) files can be selected",Util.Msg.Error);      
    return self.setStorage( storage, fname );
  }


  UI.prototype.displayFile = function(file,extensive) {
    var self = this;
    var disable = (Storage.isEditable(file) ? "" : " disable");
    var sym  = // ((self.storage.remote.canCommit && file.sha==null) ? "<span title='Changes not yet committed'>&#x2217;</span>" : "") + 
                (file.modified || (self.storage.remote.canCommit && file.sha===null) ? "<span title='Changes not yet synchronized'>&#9679;</span>" : "");
    var icon = "<span class='file-status'>" + sym + "</span>";
    var span = "<span class='file " + file.mime.replace(/[^\w]+/g,"-") + disable + "'>" + Util.escape(file.path) + icon + "</span>";
    var extra = "";
    if (extensive) {
      var len = file.content.length;        
      if (Storage.isEditable(file)) {
        var matches = file.content.replace(/<!--[\s\S]*?-->/,"").match(/[^\d\s~`!@#$%^&\*\(\)\[\]\{\}\|\\\/<>,\.\+=:;'"\?]+/g);
        var words   = matches ? matches.length : 0;
        if (words >= 0) {
          extra = "<span class='file-size'>" + words.toFixed(0) + " words</span>";
        }
      }
      else {
        if (file.encoding === Storage.Encoding.Base64) len = (len/4)*3;
        var kb = (len + 1023)/1024; // round up..
        if (kb >= 0) {
          extra = "<span class='file-size'>" + kb.toFixed(0) + " kb</span>";
        }
      }
      if (file.shareUrl) {
        var linkText = "share" // <span style=\"font-family:'Segoe UI Symbol',Symbola\">&#x1F517;</span>
        extra = extra + "<a class='external file-share' target='_blank' title='Shared link to the online document' href='" + file.shareUrl + "'>" + linkText + "</a>"
      }
      if (Util.startsWith(file.mime,"image/") && Util.extname(file.path) !== ".eps" && len < 128*1024) {
        extra = extra + "<div class='hoverbox-content'><img src='data:" + file.mime + ";base64," + file.content + "'/></div>"
      }
    }
    return span + extra;
  }

  UI.prototype.editSelect = function() {
    var self = this;
    var files = [];
    var images = [];
    var generated = [];
    var finals = [];
    var div = document.getElementById("edit-select-files");
    if (self.storage) {
      self.storage.forEachFile( function(file) {
        if (file) {
          var ext = Util.extname(file.path)
          var disable = (Storage.isEditable(file) && ext !== ".dic" ? "": " disable");
          var main    = (file.path === self.docName ? " main" : "");
          var hide    = ""; // (Util.extname(file.path) === ".dimx" ? " hide" : "");
          var line = "<div data-file='" + encodeURIComponent(file.path) + "' " +
                        "class='button file hoverbox" + disable + main + hide + "'>" + 
                            self.displayFile(file,true) + "</div>";
          var info = { line: line, path: file.path }                            
          if (Util.startsWith(file.mime,"image/")) images.push(info); 
          else if (!disable) files.push(info);
          else if (Util.stemname(self.docName) === Util.stemname(file.path) && (ext===".pdf" || ext===".html")) finals.push(info)
          else generated.push(info)
        }
      });
    };
    
    /*
    var dir = document.getElementById("edit-select-directory");
    if (dir) {
      dir.innerHTML = "<img src='images/" + self.storage.remote.logo + "'/> " + 
                        Util.escape( self.storage.folder() ) + "<hr/>";
    }
    */
    function fcmp(info1,info2) {
      var d1 = Util.dirname(info1.path);
      var d2 = Util.dirname(info2.path);
      var b1 = Util.basename(info1.path);
      var b2 = Util.basename(info2.path);
      if (d1 < d2) return -1;
      if (d1 > d2) return 1;
      if (b1 < b2) return -1;
      if (b1 > b2) return 1;
      return 0;
    }

    function joinLines(infos) {
      return infos.sort(fcmp).map(function(info) { return info.line; }).join("\n");
    }

    div.innerHTML = 
      (finals.length > 0 ? "<div class='exported'>" + joinLines(finals) + "</div><hr/>" : "") +
      joinLines(files) + 
      (images.length > 0 || generated.length > 0 ? 
          "<hr/><div class='binaries'>" + joinLines(images) + joinLines(generated) + "</div>" : "");
  }


  /*---------------------------------------------------
    Concurrent users
  -------------------------------------------------- */
  UI.prototype.showConcurrentUsers = function(quick, edit) {
    var self = this;
    var now = Date.now();

    if (!self.storage.remote.canSync || self.settings.disableServer) {  // unconnected storage (null or http)
      self.usersStatus.className = "";
      return; 
    }
    else if (quick && (self.usersStatus.className === "" || self.usersStatus.className === "users-open" )) {  // don't do a get request for a quick check
      return;
    }
    else if (edit==="none") {
      self.usersStatus.className = "";
    }
    else if (!edit) {
      if (self.storage && self.storage.isModified(self.editName)) 
        edit = "write";
      else if (now > self.lastActivity + 120000)  // after 2 minutes of non-activity, become open which reduces get requests to server
        edit = "open";
      else 
        edit = "read";
    }
    var editInfo = {
      kind: edit,
      line: 0,
    };

    var files = {};
    var docFile = self.storage.getSharedPath(self.docName);
    var editFile = self.storage.getSharedPath(self.editName);
    if (!editFile || !docFile) return;
    docFile = docFile + "*"; // special name for overall document
    files[docFile] = { kind: edit, line: 0 };
    files[editFile] = { kind: edit, line: self.editor.getPosition().lineNumber };
    
    self.lastConUsersCheck = Date.now();
    self.storage.remote.getUserName().then( function(name) {
      var body = {
        files: files,
        name: name,
        remote: self.storage.remote.type,
      };
      Util.requestPOST( "/rest/edit", {}, body ).then( function(data) {
        var users = new Map();
        Util.forEachProperty( data, function(fileName,file) {
          if (file.users) {
            var fname = Util.basename(fileName);
            if (Util.endsWith(fname,"*")) fname = fname.substr(0, fname.length-1);
            file.users.forEach( function(user) {
              Util.extend(user,{ path: fname });
              if (typeof user.kind !== "string") user.kind = "open";
              if (typeof user.line !== "number") user.line = 0;
              var info = users.getOrCreate(user.name,user);
              if (user.kind==="write") {
                info.path = fname;
                info.kind = user.kind;           
                info.line = user.line;
              }
              else if (!Util.endsWith(fileName,"*")) {
                info.path = fname;
              }
            });
          }
        });

        // build panel
        var edits = [];
        var status = "";
        var readers = false;
        users.forEach( function(userName,user) {
          if (user.kind==="write") {
            user.message = user.name + " is editing here."
            edits.push(user);
          }
          else if (user.kind==="read") {
            readers = true;
          }
          status = status + "<div class='button user-" + user.kind + "' " +
                            "title='" + (user.kind==="write" ? "Editing document" : (user.kind==="read" ? "Viewing document" : "Opened document")) + 
                                      " " + Util.escape(Util.basename(user.path)) + 
                                      (user.line>0 ? ":" + Util.escape(user.line.toString()) : "") + 
                                      "' " +
                            "data-path='" + encodeURIComponent(user.path) + "' " + 
                            (user.line != null ? "data-line='" + encodeURIComponent(user.line.toString()) + "' " : "") +
                            ">" + 
                    "<span class='icon'><img src='images/icon-user-" + user.kind + ".png'></span>" +
                    Util.escape(user.name) + 
                    "</div>";
        });
        self.usersPanel.innerHTML = status;
      
        if (edits.length > 0) {
          self.usersStatus.className = "users-write";
        }
        else if (users.count() > 0) {
          self.usersStatus.className = (readers ? "users-read" : "users-open");        
        }
        else {
          self.usersStatus.className = "";
        }

        // decorations
        self.showConcurrentEdits(edits);
        
      });
    });
  }


  UI.prototype.postStat = function() {
    var self = this;
    if (self.settings.disableServer) return;

    var now = Date.now();
    var body = {
      editTime: self.stat.editTotal,
      viewTime: now - self.stat.viewStart, 
    };
    body.activeTime = (now < self.lastActivity + 60000 ? 60000 : 0); // any activity in the last minute?
     
    self.stat.editTotal = 0;
    self.stat.viewStart = now;

    Util.requestPUT( "/rest/stat", {}, body );
  }

  /*---------------------------------------------------
    Generating HTML & PDF
  -------------------------------------------------- */


  function _saveUserContent( path, mime, content, tryOpenFirst ) {
    // blob is created in our origin; 
    // so we should make sure a user can only save, not open a window in our domain
    // since a html page could read our local storage or do rest calls with our cookie.
    // (this could be problem if a user opens a document with 'evil' content)

    var name = Util.basename(path)
    var blob = new Blob([content], { type: mime });
    var url  = URL.createObjectURL(blob);
    setTimeout( function() { URL.revokeObjectURL(url); }, 1000 );

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
    // IE 'saveOrOpen' is secure as it opens the blob in a null domain.
    var saveBlob = navigator.msSaveOrOpenBlob || navigator.msSaveBlob;
    var link = document.createElement("a");
    if ("download" in link) {  // safari, firefox, chrome
      link.setAttribute("href",url);
      link.setAttribute("download",name);
      //Util.dispatchEvent(link,"click");
      var event = document.createEvent('MouseEvents');
      event.initMouseEvent('click', true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
      link.dispatchEvent(event);
    }
    else if (saveBlob) {  // IE
      saveBlob.call(navigator, blob, name);
    }
    else {  // fallback
      try {
        window.open(url,name);
      }
      catch(exn) { // on mobile
        var link = self.getViewLink(path,mime);
        if (link) return Util.message( { message: "Document exported", link: link }, Util.Msg.Status );        
      }
    }
  }

  UI.prototype.getViewLink = function(path, mime) {
    var self = this;
    if (!mime) mime = Util.mimeFromExt(path);
    if (mime==="application/pdf") {
      var url = self.storage.getShareUrl(path); // for PDF share is best; dropbox preview is great
      if (!url && URL.createObjectURL && !navigator.msSaveOrOpenBlob) {  // don't use for IE
        // blob is created in our origin, so unsafe for html content but ok for PDF.
        var content = self.storage.readLocalRawContent(path);
        if (content) {
          var blob = new Blob([content], { type: mime });
          url = URL.createObjectURL(blob);
        }
      }
      if (url) {
        return (function(msg) { return "<a class='external' target='_blank' href='" + Util.escape(url) + "'>" + msg + "</a>"; });
      }
    }
    // probably html, cannot use blob url directly (since a user can right-click and open in our origin)
    // we create fake url's that call "saveUserContent" on click
    return (function(msg) {
      return "<span class='save-link' data-path='" + encodeURIComponent(path) + "' data-mime='" + encodeURIComponent(mime) + "'>" + msg + "</span>"; 
    });
  }

  UI.prototype.saveUserContent = function( path, mime ) {
    var self = this;
    if (!mime) mime = Util.mimeFromExt(path);
    var content = self.storage.readLocalRawContent( path );
    return Promise.resolved( _saveUserContent( path, mime, content ) );
  }

  UI.prototype._trySynchronize = function() {
    var self = this;
    if (!self.storage || self.storage.remote.canCommit) return Promise.rejected("Cannot automatically synchronize with this remote storage.");
    return self._synchronize();
  }

  UI.prototype.viewGenerated = function( name, mime ) {
    var self = this;
    if (!mime) mime = Util.mimeFromExt(name);
    var message = Util.basename(mime).toUpperCase() + " exported";

    function directView() {
      return self.saveUserContent( name, mime ).then( function() {
        Util.message( message, Util.Msg.Status );
      });
    }

    self._trySynchronize().then( function() {
      var link = self.getViewLink(name,mime);
      if (link) return Util.message( { message: message, link: link }, Util.Msg.Status );
      return directView();
    }, function(err) {
      return directView();
    });
  }

  UI.prototype.generatePdf = function() {
    var self = this;
    self.event( null, "exporting...", State.Exporting, function() { 
      self.localSave();
      var ctx = { 
        round: 0, 
        docname: self.docName, 
        pdf: true, 
        includeImages: true,
        showErrors: function(errs) { self.showErrors(errs,true); } 
      };
      if (self.settings.disableServer) {
        Util.message("Cannot generate PDF because the 'disable server' menu is checked", Util.Msg.Error);
        return;
      }
      return self.spinWhile( self.exportSpinner, 
        self.runner.runMadokoServer( self.docText, ctx ).then( function(errorCode) {
          if (errorCode !== 0) throw ("PDF generation failed: " + ctx.message);
          var name = "out/" + Util.changeExt(self.docName,".pdf");
          return self.viewGenerated(name,"application/pdf");
        })
      );
    });
  }

  UI.prototype.generateHtml = function() {
    var self = this;
    self.event( null, "exporting...", State.Exporting, function() { 
      self.localSave();
      return self.spinWhile( self.exportSpinner, 
        self.runner.runMadokoLocal( self.docName, self.docText ).then( function(content) {
          var name = "out/" + Util.changeExt(self.docName,".html");
          self.storage.writeFile( name, content );
          return self.viewGenerated(name,"text/html");
        })
      );
    });
  }


  UI.prototype.generateSite = function() {
    var self = this;
    self.event( "Saved website", "exporting...", State.Exporting, function() { 
      return self.spinWhile( self.exportSpinner, 
        self.runner.runMadokoLocal( self.docName, self.docText ).then( function(content) {
          var name = "out/" + Util.changeExt(self.docName,".html");
          self.storage.writeFile( name, content );
          return Storage.publishSite( self.storage, self.docName, name );
        })
      );
    });
  }


  /*---------------------------------------------------
    Editor operations
  -------------------------------------------------- */
  function reformatTable( lines, column ) {
    var rxCell = /((?:^ *(?:\||\+(?=[:=~-])))?)((?:[^\\|+]|\\.|\+ *(?!$|[:~=\-\r\n]))+)([|]+|[\+]+(?= *[:~=\-\r\n]| *$))/g;
    var rows = lines.map( function(line) {
       var cells = [];
       var cap;
       while( cap = rxCell.exec(line) ) {
        if (cap[1]) cells.push(cap[1]); // start separator
        cells.push( cap[2].replace(/^\s+|\s+$/g," ").replace(/(---)-+|(~~~)~+|(===)=+/g, "$1$2$3" ).replace(/^\s+$/,"") );
        cells.push( cap[3] ); // separator
       }
       if (!cells || cells.length===0) {
         return [line,"","|"]; 
       }
       return cells;
    });
    var mwidths = [];
    rows.forEach( function(row) {
      var r = 0;
      row.forEach( function(cell,i) {
        if (i%2 === 0) return; // skip columns
        var len = cell.length;
        var span = row[i+1].length || 1;
        if (span === 1) {
          if (mwidths.length <= r) {
            mwidths.push( len );
          }
          else if (mwidths[r] < len) {
            mwidths[r] = len;
          }
        }
        else {
          // spanning multipe columns
          var totalWidth = 0;
          for( var j = r; j < r+span; j++) totalWidth += (mwidths[j] || 0);
          if (totalWidth < len) {
            var clen = Math.ceil(len / span);
            for( var j = r; j < r+span; j++) {
              if (mwidths.length <= j) {
                mwidths.push(clen);
              }
              else if (mwidths[j] < clen) {
                mwidths[j] = clen;
              }
            }
          }
        }
        r = r + span;
      });
    });
    var newlines = rows.map( function(row) {
      var r = 0;
      var line = row.map( function(cell,i) {
        if (i%2===0) return cell; // return separator
        var len = cell.length;
        var newlen = mwidths[r];
        r++;
        var span = row[i+1].length || 1;
        newlen = newlen - (span-1);
        while (span > 1) {
          newlen = newlen + 1 + (mwidths[r] || 0);
          r++;
          span--;
        }
        // remove empty column
        if (newlen===0 && cell.length===0) {
          row[i+1] = ""; // clear separator
          return "";     // return empty
        }

        // extend cell (or line)
        var cap = /(.*)(--|~~|==)\s*(:)?$/.exec(cell);
        if (cap) {
          return Util.rpad( cap[1] + cap[2], newlen - (cap[3] ? cap[3].length : 0), cap[2][0] ) + (cap[3] || "");
        }
        else {
          return Util.rpad(cell,newlen," ");
        }
      }).join("");
      while( r < mwidths.length) {
        line += Util.replicate(" ",mwidths[r]) + "|";
        r++;
      }
      return line;
    });
    return newlines.join("\n");
  }

  function breakLines(text, maxCol, hang0, hang ) {
    var para    = hang0;
    var col     = hang0.length;
    var hangCol = col;
    text = text.substr(col);
    
    // split in non-breakable parts    
    var parts = []; // text.split(/\s(?!\s*\[)/);
    var rxpart = /(?:[^\s\\\$\{`]|\\[\s\S]|\$(?:[^\\\$]|\\.)*\$|\{(?:[^\\\}]|\\.)*\}|(`+)(?:[^`]|(?!\1)`)*\1|\s+\[|[\\\$\{`])+/;
    var rxspace = /\s+/;
    text = text.replace(/^\s+/,"");
    while (cap = rxpart.exec(text) ) {
      parts.push( cap[0] );
      text = text.substr(cap[0].length);
      if (text.length>0) {
        cap = rxspace.exec(text);
        if (!cap || !cap[0]) {
          // somehow our search was non-exhaustive...
          parts[parts.length-1] = parts[parts.length-1] + text[0];
          text = text.substr(1);
        }
        else {
          text = text.substr(cap[0].length); // skip whitespace
        }
      }
    }  

    // and put the parts together inside the column boundaries
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

  function reformatPara(text, column) {
    var para = (typeof text === "string" ? text.split("\n") : text);
    para = para.map( function(line) {
      return line.replace(/\t/g, "    ");
    });
    var indents = para.map( function(line) {
      var cap = /^(\s*)/.exec(line);
      return (cap ? cap[1].length : 0);
    });
    
    var listCap = /^[ \t]*(([\*\+\-]|\d\.)[ \t]+)/.exec(text);
    var listHang = listCap ? listCap[0].length : 0;
      
    var hang0  = new Array(indents[0]+1).join(" ");
    var indent = Math.max( Math.max(indents[0],listHang), (indents.length > 1 ? Math.min.apply( null, indents.slice(1) ) : 0) );
    var hang   = new Array(indent+1).join(" ");
    
    // reformat
    var paraText = para.join(" ");
    return breakLines(paraText, column || 72, hang0, hang);
  }

  function reformatText( lineNo, text, column ) {
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

    // set up range
    var start = lineNo;
    var end = lineNo;
    var content = "";

    // test reformat table or paragraph..
    if (rxTable.test(lines[start-1])) {
      // find table extent
      while ( start > 1 && rxTable.test(lines[start-2]) ) {
        start--;
      } 
      while (end < lines.length && rxTable.test(lines[end])) {
        end++;
      }
      var table = lines.slice(start-1,end);
      if (table.length <= 0) return null;
      content = reformatTable(table,column); 
    }
    else {
      // find paragraph extent
      while( start > 1 && !endPara(lines[start-2]) && !stopPara(lines[start-1])) {
        start--;
      }
      while( end < lines.length && !stopPara(lines[end]) ) {
        end++;
      }
      var para      = lines.slice(start-1,end);
      if (para.length <= 0) return null;

      content = reformatPara(para,column);
    }
    if (content === null) return null;

    var endColumn = lines[end-1].length+1;
    return { text: content, startLine: start, endLine: end, endColumn: endColumn };
  }

  UI.prototype.onFormatPara = function() {
    var self = this;
    var pos = self.editor.getPosition();
    var text = self.getEditText();
    var res = reformatText( pos.lineNumber, text );
    if (res) {
      var rng = new Range.Range( res.startLine, 1, res.endLine, res.endColumn );
      var command = new ReplaceCommand.ReplaceCommand( rng, res.text );
      self.editor.executeCommand("madoko",command);
      self.editor.setPosition(pos);
    }
  }

  UI.prototype.addTableRow = function() {
    var self = this;
    var pos = self.editor.getPosition();
    pos.lineNumber++;
    pos.column=1;
    self.insertText( "| |\n", pos );
    self.onFormatPara();
  }

  function findMetaPos( text ) {
    var lineNo = 1;
    var reMeta = /^(?:@(\w+)[ \t]+)?(\w[\w\-\.#~, \t]*?\*?)[ \t]*[:].*\r?\n(?![ \t])|^\[INCLUDE\b[^\]]*\][ \t]*\r?\n|^[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n/;
    var cap;
    while ((cap = reMeta.exec(text))) {
      text = text.substr(cap[0].length);
      lineNo += Util.lineCount(cap[0]); 
    }
    return lineNo;
  }

  /*---------------------------------------------------
    Edit toolbox
  -------------------------------------------------- */
    var symbolsBasic = [
    { entity: "quot", code: 34 },
    { entity: "hash", code: 35 },
    { entity: "dollar", code: 36 },
    { entity: "perc", code: 37 },
    { entity: "amp", code: 38 },
    { entity: "apos", code: 39 },
    { entity: "lpar", code: 40 },
    { entity: "rpar", code: 41 },
    { entity: "ast", code: 42 },
    { entity: "plus", code: 43 },
    { entity: "fslash", code: 47 },
    { entity: "lt", code: 60 },
    { entity: "gt", code: 62 },
    { entity: "bslash", code: 92 },
    { entity: "backslash", code: 92 },
    { entity: "caret", code: 94 },
    { entity: "underscore", code: 95 },
    { entity: "grave", code: 96 },
    { entity: "lcurly", code: 123 },
    { entity: "bar", code: 124 },
    { entity: "rcurly", code: 125 },
    { entity: "tilde", code: 126 },
    { entity: "iexcl", code: 161 },
    { entity: "cent", code: 162 },
    { entity: "pound", code: 163 },
    { entity: "curren", code: 164 },
    { entity: "yen", code: 165 },
    { entity: "brvbar", code: 166 },
    { entity: "sect", code: 167 },
    { entity: "uml", code: 168 },
    { entity: "copy", code: 169 },
    { entity: "ordf", code: 170 },
    { entity: "laquo", code: 171 },
    { entity: "not", code: 172 },
    { entity: "reg", code: 174 },
    { entity: "macr", code: 175 },
    { entity: "deg", code: 176 },
    { entity: "plusmn", code: 177 },
    { entity: "sup2", code: 178 },
    { entity: "sup3", code: 179 },
    { entity: "acute", code: 180 },
    { entity: "micro", code: 181 },
    { entity: "para", code: 182 },
    { entity: "middot", code: 183 },
    { entity: "cedil", code: 184 },
    { entity: "sup1", code: 185 },
    { entity: "ordm", code: 186 },
    { entity: "raquo", code: 187 },
    { entity: "frac14", code: 188 },
    { entity: "frac12", code: 189 },
    { entity: "frac34", code: 190 },
    { entity: "iquest", code: 191 },
    { entity: "fnof", code: 402 },
    { entity: "circ", code: 710 },
    { code: 732 },
    { entity: "ndash", code: 8211, title:"en-dash" },
    { entity: "mdash", code: 8212, title:"em-dash" },
  ];

var symbolsAccents = [
  { entity: "Agrave", code: 192 },
  { entity: "Aacute", code: 193 },
  { entity: "Acirc", code: 194 },
  { entity: "Atilde", code: 195 },
  { entity: "Auml", code: 196 },
  { entity: "Aring", code: 197 },
  { entity: "AElig", code: 198 },
  { entity: "Ccedil", code: 199 },
  { entity: "Egrave", code: 200 },
  { entity: "Eacute", code: 201 },
  { entity: "Ecirc", code: 202 },
  { entity: "Euml", code: 203 },
  { entity: "Igrave", code: 204 },
  { entity: "Iacute", code: 205 },
  { entity: "Icirc", code: 206 },
  { entity: "Iuml", code: 207 },
  { entity: "ETH", code: 208 },
  { entity: "Ntilde", code: 209 },
  { entity: "Ograve", code: 210 },
  { entity: "Oacute", code: 211 },
  { entity: "Ocirc", code: 212 },
  { entity: "Otilde", code: 213 },
  { entity: "Ouml", code: 214 },
  { entity: "times", code: 215 },
  { entity: "Oslash", code: 216 },
  { entity: "Ugrave", code: 217 },
  { entity: "Uacute", code: 218 },
  { entity: "Ucirc", code: 219 },
  { entity: "Uuml", code: 220 },
  { entity: "Yacute", code: 221 },
  { entity: "THORN", code: 222 },
  { entity: "szlig", code: 223 },
  { entity: "agrave", code: 224 },
  { entity: "aacute", code: 225 },
  { entity: "acirc", code: 226 },
  { entity: "atilde", code: 227 },
  { entity: "auml", code: 228 },
  { entity: "aring", code: 229 },
  { entity: "aelig", code: 230 },
  { entity: "ccedil", code: 231 },
  { entity: "egrave", code: 232 },
  { entity: "eacute", code: 233 },
  { entity: "ecirc", code: 234 },
  { entity: "euml", code: 235 },
  { entity: "igrave", code: 236 },
  { entity: "iacute", code: 237 },
  { entity: "icirc", code: 238 },
  { entity: "iuml", code: 239 },
  { entity: "eth", code: 240 },
  { entity: "ntilde", code: 241 },
  { entity: "ograve", code: 242 },
  { entity: "oacute", code: 243 },
  { entity: "ocirc", code: 244 },
  { entity: "otilde", code: 245 },
  { entity: "ouml", code: 246 },
  { entity: "divide", code: 247 },
  { entity: "oslash", code: 248 },
  { entity: "ugrave", code: 249 },
  { entity: "uacute", code: 250 },
  { entity: "ucirc", code: 251 },
  { entity: "uuml", code: 252 },
  { entity: "yacute", code: 253 },
  { entity: "thorn", code: 254 },
  { entity: "yuml", code: 255 },
  { entity: "Lstroke", code: 321 },
  { entity: "lstroke", code: 322 },
  { entity: "OElig", code: 338 },
  { entity: "oelig", code: 339 },
  { entity: "Scaron", code: 352 },
  { entity: "scaron", code: 353 },
  { entity: "Yuml", code: 376 },
];

var symbolsGreek = [
  { entity: "Alpha", code: 913 },
  { entity: "Beta", code: 914 },
  { entity: "Gamma", code: 915 },
  { entity: "Delta", code: 916 },
  { entity: "Epsilon", code: 917 },
  { entity: "Zeta", code: 918 },
  { entity: "Eta", code: 919 },
  { entity: "Theta", code: 920 },
  { entity: "Iota", code: 921 },
  { entity: "Kappa", code: 922 },
  { entity: "Lambda", code: 923 },
  { entity: "Mu", code: 924 },
  { entity: "Nu", code: 925 },
  { entity: "Xi", code: 926 },
  { entity: "Omicron", code: 927 },
  { entity: "Pi", code: 928 },
  { entity: "Rho", code: 929 },
  { entity: "Sigma", code: 931 },
  { entity: "Tau", code: 932 },
  { entity: "Upsilon", code: 933 },
  { entity: "Phi", code: 934 },
  { entity: "Chi", code: 935 },
  { entity: "Psi", code: 936 },
  { entity: "Omega", code: 937 },
  { entity: "alpha", code: 945 },
  { entity: "beta", code: 946 },
  { entity: "gamma", code: 947 },
  { entity: "delta", code: 948 },
  { entity: "epsilon", code: 949 },
  { entity: "zeta", code: 950 },
  { entity: "eta", code: 951 },
  { entity: "theta", code: 952 },
  { entity: "iota", code: 953 },
  { entity: "kappa", code: 954 },
  { entity: "lambda", code: 955 },
  { entity: "mu", code: 956 },
  { entity: "nu", code: 957 },
  { entity: "xi", code: 958 },
  { entity: "omicron", code: 959 },
  { entity: "pi", code: 960 },
  { entity: "rho", code: 961 },
  { entity: "sigmaf", code: 962 },
  { entity: "sigma", code: 963 },
  { entity: "tau", code: 964 },
  { entity: "upsilon", code: 965 },
  { entity: "phi", code: 966 },
  { entity: "chi", code: 967 },
  { entity: "psi", code: 968 },
  { entity: "omega", code: 969 },
  { entity: "thetasym", code: 977 },
  { entity: "upsih", code: 978 },
  { entity: "piv", code: 982 },
];

var symbolsSpacing = [
  { entity: "ensp", code: 8194, invisible:true, title:"en-space", display:"en" },
  { entity: "emsp", code: 8195, invisible:true, title:"em-space", display:"em" },
  { entity: "quad", code: 8195, invisible:true, title:"quad space", display:"quad" },
  { entity: "thicksp", code: 8196, invisible:true, title:"thick space", display:"thick" },
  { entity: "medsp", code: 8197, invisible:true, title:"medium space", display:"medium" },
  { entity: "thinsp", code: 8201, invisible:true, title:"thin space", display:"thin" },
  { entity: "nbsp", code: 160, invisible:true, title: "non-breakable space", display:"nbsp" },
  { entity: "strut", code: 8203, invisible:true, title:"strut (zero-width entity of line-height)", display: "strut" },
  { entity: "br", invisible:true, title:"entity hard line-break", display:"br" },
  { entity: "shy", code: 173, invisible:true, title:"soft hyphen", display:"shy" },
  { entity: "zwnj", code: 8204, invisible:true, title:"zero-width non-joiner", display:"zwnj" },
  { entity: "zwj", code: 8205, invisible:true, title:"zero-width joiner", display:"zwj" },
  { content: "\\\n", invisible:true, title:"hard line-break", display:"line-break" },
  { entity: "pagebreak", code: 12, invisible:true, title:"page break (in LaTeX)", display:"page-break" },
  { entity: "lrm", code: 8206, invisible:true, title:"left-to-right mode", display:"lrm" },
  { entity: "rlm", code: 8207, invisible:true, title:"right-to-left mode", display:"rlm" },
];

var symbolsOther = [
  { entity: "lsquo", code: 8216 },
  { entity: "rsquo", code: 8217 },
  { entity: "sbquo", code: 8218 },
  { entity: "ldquo", code: 8220 },
  { entity: "rdquo", code: 8221 },
  { entity: "bdquo", code: 8222 },
  { entity: "dagger", code: 8224 },
  { entity: "Dagger", code: 8225 },
  { entity: "bull", code: 8226 },
  { entity: "hellip", code: 8230 },
  { entity: "permil", code: 8240 },
  { entity: "prime", code: 8242 },
  { entity: "Prime", code: 8243 },
  { entity: "lsaquo", code: 8249 },
  { entity: "rsaquo", code: 8250 },
  { entity: "oline", code: 8254 },
  { entity: "frasl", code: 8260 },
  { entity: "euro", code: 8364 },
  { entity: "image", code: 8465 },
  { entity: "weierp", code: 8472 },
  { entity: "real", code: 8476 },
  { entity: "trade", code: 8482 },
  { entity: "alefsym", code: 8501 },
  { entity: "larr", code: 8592 },
  { entity: "uarr", code: 8593 },
  { entity: "rarr", code: 8594 },
  { entity: "darr", code: 8595 },
  { entity: "harr", code: 8596 },
  { entity: "crarr", code: 8629 },
  { entity: "lArr", code: 8656 },
  { entity: "uArr", code: 8657 },
  { entity: "rArr", code: 8658 },
  { entity: "dArr", code: 8659 },
  { entity: "hArr", code: 8660 },
  // unnamed entities
  { entity: "hooklarr", code: 8617 },
  { entity: "bbox", code: 8718 },
  { entity: "box", code: 9633 },
  { entity: "ballotbox", code: 9744 },
  { entity: "ballotc", code: 9745 },
  { entity: "ballotx", code: 9746 },
  { entity: "checkmark", code: 10003 },
  { entity: "bcheckmark", code: 10004 },
  { entity: "xmark", code: 10007 },
  { entity: "bxmark", code: 10008 },
  //{ entity: "mglass", code: 128270 },
  { entity: "date", invisible:true, title:"current date", display:"date" },
  { entity: "time", invisible:true, title:"current time", display:"time" },
  { entity: "madoko-version", invisible:true, title:"madoko version", display:"version" },
  { entity: "docname", invisible:true, title:"document name", display:"document" },
];

var symbolsMath = [
  { entity: "forall", code: 8704 },
  { entity: "part", code: 8706 },
  { entity: "exist", code: 8707 },
  { entity: "empty", code: 8709 },
  { entity: "nabla", code: 8711 },
  { entity: "isin", code: 8712 },
  { entity: "notin", code: 8713 },
  { entity: "ni", code: 8715 },
  { entity: "prod", code: 8719 },
  { entity: "sum", code: 8721 },
  { entity: "minus", code: 8722 },
  { entity: "lowast", code: 8727 },
  { entity: "radic", code: 8730 },
  { entity: "prop", code: 8733 },
  { entity: "infin", code: 8734 },
  { entity: "ang", code: 8736 },
  { entity: "and", code: 8743 },
  { entity: "or", code: 8744 },
  { entity: "cap", code: 8745 },
  { entity: "cup", code: 8746 },
  { entity: "int", code: 8747 },
  { entity: "there4", code: 8756 },
  { entity: "sim", code: 8764 },
  { entity: "cong", code: 8773 },
  { entity: "asymp", code: 8776 },
  { entity: "ne", code: 8800 },
  { entity: "equiv", code: 8801 },
  { entity: "le", code: 8804 },
  { entity: "ge", code: 8805 },
  { entity: "sub", code: 8834 },
  { entity: "sup", code: 8835 },
  { entity: "nsub", code: 8836 },
  { entity: "sube", code: 8838 },
  { entity: "supe", code: 8839 },
  { entity: "oplus", code: 8853 },
  { entity: "otimes", code: 8855 },
  { entity: "perp", code: 8869 },
  { entity: "sdot", code: 8901 },
  { entity: "vellip", code: 8942 },
  { entity: "lceil", code: 8968 },
  { entity: "rceil", code: 8969 },
  { entity: "lfloor", code: 8970 },
  { entity: "rfloor", code: 8971 },
  { entity: "lang", code: 9001 },
  { entity: "rang", code: 9002 },
  { entity: "loz", code: 9674 },
  { entity: "spades", code: 9824 },
  { entity: "clubs", code: 9827 },
  { entity: "hearts", code: 9829 },
  { entity: "diams", code: 9830 },
];

  var toolDefInclude = { 
    name: "include",
    title: "Include a local file",
    options: [
      { name    : "Image", 
        title   : "Insert an image",
        helpLink: "#sec-image",
        upload  : "Please select an image.",
        exts    : [".jpg",".png",".svg",".gif",".eps"],
      },
      { name    : "Markdown", 
        title   : "Include another markdown file",
        upload  : "Please select a markdown file.",
        exts    : [".mdk",".md",".mkdn",".markdown"],
      },
      { name    : "Bibliography", 
        helpLink: "#sec-bib",
        title   : "Include a BibTeX bibliography file",
        upload  : "Please select a BibTeX bibliography file",
        exts    : [".bib"],
      },
      { name    : "Bibliography style (.bst)", 
        helpLink: "#sec-bib",
        title   : "Use a specific bibliography style",
        upload  : "Please select a BibTeX bibliography style file",
        exts    : [".bst"],
      },
      { name    : "Language colorizer", 
        helpLink: "#syntax-highlighting",
        title   : "Include a language syntax highlighting specification",
        upload  : "Please select a syntax highlighting specification file",
        exts    : [".json"],
      },
      { name    : "CSS style", 
        helpLink: "#html-keys",
        title   : "Include a CSS style file (.css)",
        upload  : "Please select a CSS style file.",
        exts    : [".css"],
      },
      { name    : "LaTeX package", 
        helpLink: "#latex-keys",
        title   : "Include a LaTeX package, style, or TeX file",
        upload  : "Please select a LaTeX package file",
        exts    : [".sty",".tex"],
      },
      { name    : "LaTeX document class", 
        helpLink: "#latex-keys",
        title   : "Include a LaTeX document class",
        upload  : "Please select a LaTeX document class file",
        exts    : [".cls"],
      },
    ]
  };

  var tools = [
    toolInline("bold","**","**",{
      icon    : true,
      title   : "Strong emphasis (bold)",
      keys    : ["Ctrl-B"]
    }),
    toolInline("italic","_","_",{
      icon    : true,
      title   : "Emphasis (italic)",
      keys    : ["Ctrl-I"]
    }),
    toolInline("code","`","`",{  // TODO: make smart about quotes
      icon    : true,
      title   : "Inline code",
    }),
    { name    : "link", 
      icon    : true,
      title   : "Insert a link",
      content : "link",
      keys    : ["Ctrl-K"],
      replacer: function(txt,rng) { 
                  var self = this;
                  var name = txt.replace(/[^\w\- ]+/g,"").substr(0,16);
                  var url  = "http://" + name.replace(/\s+/g,"_") + ".com";
                  var def  = "\n[" + name + "]: " + url + " \"" + name + " title\"\n";
                  self.insertAfterPara(self.editor.getPosition().lineNumber, def);
                  return "[" + txt + "]" + (name===txt ? "" : "[" + name + "]");   
                },
    },
    toolInline("formula","$","$",{
      icon    : true,
      title   : "Inline formula",
      content : "e = mc^2",
      keys    : ["Alt-F"],      
    }), 
    toolInline("sub","~","~", {  
      icon     : true,
      title    : "Sub-script",
      transform: function(txt) { 
                  return txt.replace(/~/g,"\\~").replace(/ /g,"\\ "); 
                },
    }),
    toolInline("super","^","^", { 
      icon    : true,
      title   : "Super-script",
      transform: function(txt) { 
                  return txt.replace(/\^/g,"\\^").replace(/ /g,"\\ "); 
                },
    }),
    { name    : "font", 
      icon    : true,
      title   : "Change the font family",
      options : [
        toolFontFamily("serif"),
        toolFontFamily("sans-serif"),
        toolFontFamily("monospace"),
        toolFontFamily("normal"),
        toolCss("font-variant","small-caps"),
        { name: "strike-out",
          display: "strike-out",
          helpLink: "#sec-css",
          content: "text",
          replacer: function(txt,rng) { return "~~" + txt + "~~"; }
        },
        toolCss("text-decoration","underline","underline"),
        toolCss("font-family","'\"Segoe UI\" sans-serif'",""),
      ]
    },
    { name    : "fontsize", 
      icon    : true,
      title   : "Change the font size",
      options : [
        toolFontSize("larger"),
        toolFontSize("smaller"),
        toolFontSize("xx-small"),
        toolFontSize("x-small"),
        toolFontSize("small"),
        toolFontSize("medium"),
        toolFontSize("large"),
        toolFontSize("x-large"),
        toolFontSize("xx-large"),        
        toolFontSize("initial", "The initial font size"),
        toolFontSize("2ex","A specific font size (%|ex|em|pt|px)"),
      ]
    },    
    { name    : "color", 
      icon    : true,
      title   : "Change the font color",
      options : [
        toolColor("red"),
        toolColor("lime"),
        toolColor("blue"),
        toolColor("yellow"),
        toolColor("cyan"),
        toolColor("magenta"),
        toolColor("maroon"),
        toolColor("green"),
        toolColor("navy"),        
        toolColor("olive"),
        toolColor("teal"),
        toolColor("purple"),
        toolColor("orange"),
        toolColor("black"),
        toolColor("gray"),
        toolColor("lightgray"),
        toolColor("white"),
        toolColor("#335577"),  
      ]
    },    
    { name    : "heading", 
      icon    : true,
      title   : "Insert a heading",
      options: [
        heading("Heading 1","#"),
        heading("Heading 2","##"),
        heading("Heading 3","###"),
        heading("Heading 4","####"),
        heading("Heading 5","#####"),        
      ]
    },      
    {
      name: "symbol",
      icon: true,
      title: "", //"Insert a symbol",
      options: [
        { name: "basic", title:"",
          symbols: symbolsBasic.concat(symbolsOther),
        },
        { name: "accents", title:"",
          symbols: symbolsAccents,
        },
        { name: "greek", title:"",
          symbols: symbolsGreek,
        },
        { name: "math", title:"",
          symbols: symbolsMath,
        },
        { name: "spacing", title:"",
          symbols: symbolsSpacing,
        },
      ]
    },
    { name: "reference",
      icon: true,
      title: "Insert an in-document reference",
      style: "overflow:auto",
      dynamic: function(ref) {
        var self = this;
        self.toolCommand( {
          content: "",
          replacer: function(txt,rng) {
            return toolInsertReference(txt,rng,ref);
          }
        });
      },
    },
    { name: "cite",
      icon: true,
      title: "Insert a citation",
      initial: "None (include a .bib file)",
      style: "overflow:auto",
      dynamic: function(cite) {
        var self = this;
        self.toolCommand( {
          content: "",
          replacer: function(txt,rng) {
            return self.toolInsertCitation(txt,rng,cite);
          }
        });
      },
    },
    { element: "BR",
    },
    { name    : "pre", 
      icon    : true,
      title   : "Code block",
      content : "function hello() {\n  return \"world\";\n}",
      replacer: function(txt,rng) { 
                  return blockRange(rng,"``` javascript" + block(txt) + "```"); 
                },
    },
    { name    : "ul",
      icon    : true,
      title   : "Bulleted list",
      content : "Banana.\n* Bread.\n  A nested list:\n  - white\n  - whole grain\n* Basil.",
      replacer: function(txt,rng) {
        return blockRange(rng,paraPrefix("* ",txt));
      }
    },
    { name    : "ol",
      icon    : true,
      title   : "Numbered list",
      content : "Banana.\n2. Bread.\n   Indent to continue.\n3. Basil.",
      replacer: function(txt,rng) {
        return blockRange(rng,paraPrefix("1. ",txt));
      }
    },
    { name    : "dl",
      icon    : true,
      title   : "Definition list",
      content : "The conceptual structure is called the *abstract syntax* of the language.\n* Concrete syntax\n  : The particular details and rules for writing expressions as strings \n    of characters is called the concrete syntax.\n  : Perhaps some other meaning too?",
      replacer: function(txt,rng) {
        return blockRange(rng,paraPrefix("* Abstract syntax\n  : ",txt,"    "));
      }
    },
    { name    : "bquote",
      icon    : true,
      title   : "Block quote",
      content : "Of life's two chief prizes, beauty and truth,\nI found the first in a loving heart and the\nsecond in a laborer's hand.\\\n&emsp;&emsp; --- Khalil Gibran",
      replacer: function(txt,rng) {
        return blockRange(rng,linePrefix("> ",txt));
      }
    },
    { name    : "format",
      icon    : true,
      title   : "(Alt-Q) Format paragraph to fit in 70 columns.\nOr reformat table to align all columns, and add missing columns.",
      replacer: function(txt,rng) {
        if (txt) {
          return reformatPara( txt );
        }
        else {
          var self = this;
          self.onFormatPara();
          return null;
        }
      }
    },  
    { name    : "img", 
      icon    : true,
      title   : "Insert an image",
      content : "",
      upload  : "Please select an image.",
      exts    : [".jpg",".png",".svg",".gif"],
    },   
    { name    : "aligncenter",
      icon    : true,
      title   : "Text and block alignment",
      options : [
        toolBlock("alignleft", { 
          block   : "Align-Left",
          html    : "<img src='images/icon-tool-alignleft.png'/> Left",
          title   : "Left align text and blocks", 
          helpLink: "#special-attribute-classes",
          content : "Left aligned text.",
        }),
        toolBlock("aligncenter", { 
          block   : "Center",
          html    : "<img src='images/icon-tool-aligncenter.png'/> Center",
          title   : "Center text and blocks", 
          helpLink: "#special-attribute-classes",
          content : "Centered text.",
        }),
        toolBlock("alignright", { 
          block   : "Align-Right",
          html    : "<img src='images/icon-tool-alignright.png'/> Right",
          title   : "Right align text and blocks", 
          helpLink: "#special-attribute-classes",
          content : "Right aligned text.",
        }),
        toolBlock("justify", { 
          block   : "Justify",
          html    : "<img src='images/icon-tool-justify.png'/> Justify",
          title   : "Justify text", 
          helpLink: "#sec-css",
          content : "Justified text.",
        }),
      ]
    },
    { name    : "figure",
      icon    : true,
      title   : "Insert a figure",
      options : [
        toolBlock("normal", { 
          block   : "Figure",
          html    : "<img src='images/icon-tool-figurewide.png'/> Normal",
          title   : "Insert a regular figure", 
          helpLink: "#sec-figure",
          content : "Here is a normal figure.",
          attrs   : "#fig-myfigure caption=\"My caption.\"",
        }),
        toolBlock("left", { 
          block   : "Figure", 
          html    : "<img src='images/icon-tool-figure.png'/> Left",
          helpLink: "#sec-float",
          attrs   : "#fig-myfigure caption=\"My caption.\" float=left width=50% margin-right=1em",
          content : "Here is a left figure.",
          title   : "Insert a left-side figure with text wrap around", 
        }),
        toolBlock("right", { 
          block   : "Figure", 
          html    : "<img src='images/icon-tool-figureright.png'/> Right",
          helpLink: "#sec-float",
          content : "Here is a right figure.",
          attrs   : "#fig-myfigure caption=\"My caption.\" float=right width=50% margin-left=1em",
          title   : "Insert a right-side figure with text wrap around", 
        }),
        toolBlock("wide", { 
          block   : "Figure", 
          helpLink: "#sec-figure",
          html    : "<img src='images/icon-tool-figurewide2.png'/> Wide",          
          attrs   : "#fig-myfigure caption=\"My caption.\" .wide",
          content : "Here is a wide figure.",
          title   : "Insert a wide figure. In LaTeX such figure spans two columns (using the \\figure* command)", 
        }),
      ],
    },   
    { name    : "table",
      icon    : true,
      title   : "Table",
      options: [
        toolTable(2),
        toolTable(3),
        toolTable(4),
        toolTable(5),
        toolTable(6),
        toolTable(7),
        toolTable(8),
      ]
    }, 
    { name   : "undo",
      icon   : true,
      command: "undo", 
      title  : "(Ctrl-Z) Undo"
    },
    { name   : "redo",
      icon   : true,
      command: "redo",
      title  : "(Ctrl-Y) Redo" 
    },
    { element: "BR",
    },
    { name    : "custom",
      display: "Block",
      title  : "Insert a custom block",
      options: [
        { name    : "title",
          display : "Title page",
          title   : "Insert a title page.",
          helpLink: "#sec-special",
          replacer: function(txt,rng) {
            return txt + "\n[TITLE]\n";
          }
        },
        { name    : "toc",
          display : "Table of contents",
          title   : "Insert a table of contents",
          helpLink: "#sec-special",
          replacer: function(txt,rng) {
            return txt + "\n[TOC]\n";
          }
        },
        { name    : "bib",
          display : "References",
          title   : "Insert the bibiliography section",
          helpLink: "#sec-bib",
          replacer: function(txt,rng) {
            return txt + "\n## References   {-}\n[BIB]\n";
          }
        },
        toolFigure(false),
        { name: "footnote",
          title: "Insert a footnote",
          content: "The footnote text.\n    Indent to continue on the next line.",
          helpLink: "#sec-footnotes",
          replacer: function(txt,rng) {
            var self = this;
            self.insertAfterPara(self.editor.getPosition().lineNumber, paraPrefix("[^fn-footnote]: ", txt + "\n", "  "));
            return "[^fn-footnote]";
          }
        },
        { name: "hr",
          display: "Horizontal rule",
          title: "Insert a horizontal rule",
          replacer: function(txt,rng) {
            var content = "\n----------------------------- { width=50% }";
            return blockRange(rng, content);
          }
        },
        customBlock("note"),
        customBlock("remark"),
        customBlock("example"),        
        customBlock("abstract","", "The abstract."),
        customBlock("framed","","A block with a solid border."),
        customBlock("center","","A block with centered items."),
        customBlock("columns","","~~ Column { width=\"30%\" }\nThe first column\n~~\n~~ Column\nThe second column.\n~~"),
        { name: "comment",
          title: "(Shift-Alt-A) Comment out a section of your document",
          content: "  This is commented out.",
          replacer: function(txt,rng) {
            return blockRange(rng,"<!--\n" + txt + "\n-->");
          }
        },
        { element: "HR" },
        { name: "html",
          title: "Insert literal HTML (ignored for PDF output)",
          content: "  Some <i>HTLM</i> here.",
          replacer: function(txt,rng) {
            return blockRange(rng,"<div>\n" + txt + "\n</div>");
          }
        },
        customBlock("HtmlOnly","","This is only displayed in HTML","",null,"Insert markdown that is only used in HTML output"),
        customBlock("TexRaw","","% Raw LaTeX content","",null,"Insert raw LaTeX code (for PDF output only)"),
        customBlock("TexOnly","","This is only displayed in PDF","",null,"Insert markdown that is only used in PDF output"),        
      ]
    },
    { name: "math",
      title: "Insert a math block",
      style: "overflow-y: auto",
      options: [
        customBlock("equation", "{ #eq-euler }","e = \\lim_{n\\to\\infty} \\left( 1 + \\frac{1}{n} \\right)^n","","#sec-math"),
        customBlock("theorem",  "{ #th-euler }\n(_Euler's formula_)\\", "For any real number $x$, we have: $e^{ix} = \\cos x + i \\sin x$.", "#sec-math" ), 
        customBlock("proof", "", "Trivially by induction. [&box;]{float=right}" ),
        customBlock("lemma"),
        customBlock("proposition"), 
        customBlock("corollary"),
        customBlock("definition"),
        customBlock("MathPre","","@function sqr_\\pi( num :int ) \\{\n   @return (num {\\times} num \\times{} \\pi)\n\}","","#sec-mathpre","Math mode that respects whitespace and identifier names"),
        customBlock("MathDef","","\\newcommand{\\infer}[3]{#1 \\vdash #2\,:#3}", "We infer $\\infer{\\Gamma}{e}{\\tau}$.","#sec-mathdefs","Define math commands"),
        customBlock("Math","","e = mc^2","","#sec-math","A plain display math block (Equations are preferred)"),
        customBlock("Snippet","",
                        "%note: use metadata: 'Package: pgfplots' to compile this snippet.\n\\begin{tikzpicture}\n\\begin{axis}[\n  height=8cm,\n  width=8cm,\n  grid=major,\n]\n% math plot\n\\addplot {-x^5 - 242}; \n\\addlegendentry{model}\n% data plot\n\\addplot coordinates {\n(-4.77778,2027.60977)\n(-3.55556,347.84069)\n(-2.33333,22.58953)\n(-1.11111,-493.50066)\n(0.11111,46.66082)\n(1.33333,-205.56286)\n(2.55556,-341.40638)\n(3.77778,-1169.24780)\n(5.00000,-3269.56775)\n};\n\\addlegendentry{estimate}\n\\end{axis}\n\\end{tikzpicture}",
                        "","#sec-snippets","Insert an arbitrary LaTex snippet"),
      ]
    },
    { name: "styling",
      title: "Add CSS styling",
      style: "overflow-y: auto",
      options: [
        toolStyle("margin","=1ex","auto|<length>"),
        toolStyle("padding","=1ex","auto|<length>"),
        toolStyle("border","border-style=solid border-width=1px border-color=black","none|solid|dotted"),
        toolStyle("text-align","=center","center|right|left|justify"),
        toolStyle("text-indent","=1em","<length>"),
        toolStyle("color","=red","<color name>|#rrggbb"),
        toolStyle("background-color","=Gainsboro","<color name>|#rrggbb"),
        toolStyle("page-align","=here","top|bottom|here|forcehere","Used in LaTeX to place figures"),
        toolStyle("float","float=right width=50% margin-left=1em","left|right","Limited support in LaTeX, but works for figures"),
        toolStyle("line-height","=1.5em","<length>"),
        toolStyle("vertical-align","=middle","top|middle|bottom|baseline|<length>"),
        toolStyle("display","=inline","block|inline|inline-block|hidden"),        
        toolStyle("margin-left","=1ex"),
        toolStyle("margin-right","=1ex"),
        toolStyle("margin-top","=1ex"),
        toolStyle("margin-bottom","=1ex"),
        toolStyle("padding-left","=1ex"),
        toolStyle("padding-right","=1ex"),
        toolStyle("padding-top","=1ex"),
        toolStyle("padding-bottom","=1ex"),        
      ]
    },
    { name: "metadata",
      title: "Add document metadata",
      style: "overflow-y: auto",
      options: [
        toolMetadata("Title","My document title"),
        toolMetadata("Sub Title","The sub-title"),
        toolMetadata("Title Note", "&date; (version 1.0)"),
        toolMetadata("Author","Name\nAffiliation : Company name\nEmail       : name@foo.com\n"),
        toolMetadata("Toc Depth","3","Depth of the table of contents", "#sec-toc"),
        toolMetadata("Heading Depth","3","Maximum depth up to which headings are numbered. Set to 0 to disable numbering","#sec-numbering"),
        toolMetadata("Heading Base", "2", "Setting the heading base to 2 use H2 or \\section commands for level 1 headers"),
        toolMetadata("Bibliography", "example.bib", "Specify a bilbliography file. Use the 'Include' menu to include a local file.","#sec-bib"),
        toolMetadata("Bib Style", "plainnat", "Specify a bibliography style to use.","#sec-bibstyle"),
        toolMetadata("Cite Style", "natural", "Specify a citation style to use.","#sec-cite"),
        toolMetadata("Cite All", "true", "Include all entries in the bibliography"),
        toolMetadata("Bib Search Url", "www.google.com", "Add a search icon to bibliography references", "#bibliography-tooltips-and-searches"),
        toolMetadata("Comment","A comment.", "A meta-data comment"),
        { element: "HR" },
        toolMetadata("Css", "example.css", "Specify a style file or reference to include in the HTML output"),
        toolMetadata("Script", "example.js", "Specify a script file or reference to include in the HTML output"),
        toolMetadata("HTML Meta", "http-equiv=\"refresh\" content=\"30\"", "Specify a meta tag for HTML output"),
        toolMetadata("HTML Header", "", "This value is included literally in the <head> section of HTML output"),
        { element: "HR" },
        toolMetadata("Doc Class", "[9pt]article", "Specify the LaTeX document class. Use the 'Include' menu to include a specific local document class file."),
        toolMetadata("Package", "pgfplots", "Specify a standard LaTeX package to use. Use the 'Include' menu to include a specific local package file","#sec-math"),
        toolMetadata("Tex Header", "", "The value is included literally before \\begin{document}. in the LaTeX output"),
        /*
        { element: "HR" },
        toolMetadata("Math Dpi", "300", "Specify the resolution at which math is rendered."),
        toolMetadata("Math Scale", "108", "Specify the scale math is rendered."),
        toolMetadata("Math Embed", "512", "Specify up to which size (in Kb) math is rendered in-place (instead of a separate image)"),
        */
      ]

    },    
    toolDefInclude,
  ];

  


  UI.prototype.toolInsertCitation = function(txt,rng,cite) {
    var self = this;
    if (!rng.isEmpty()) {
      return txt + "[@" + cite + "]";   // TODO: make it insert citations into existing ones
    }
    else {
      rng = rng.clone();
      rng.startColumn--;
      rng.endColumn++;
      var postxt = self.editor.getModel().getValueInRange(rng);
      if (postxt[0] === "[" || postxt[0] === ";") {
        return "@" + cite + ";";
      }
      else if (postxt[1] === "]" || postxt[1] === ";") {
        return ";@" + cite;
      }
      else if (postxt[1] === "[") {
        rng.startColumn++;
        return {content: "[@" + cite + ";", range: rng };
      }
      else if (postxt[0] === "]") {
        rng.endColumn--;
        return {
          range: rng,
          content: ";@" + cite + "]",
        };
      }
      return "[@" + cite + "]";
    }
  }

  function toolInsertReference(txt,rng,ref) {
    var reftxt = "[#" + ref + "]";
    if (txt.length > 0) {
      return "[" + txt + "]" + reftxt;
    }
    else if (Util.startsWith(ref,"sec-")) {
      return "Section " + reftxt;
    }
    else if (Util.startsWith(ref,"fig-")) {
      return "Figure " + reftxt;
    }
    else if (Util.startsWith(ref,"eq-")) {
      return "Equation " + reftxt;
    }
    else if (Util.startsWith(ref,"th-")) {
      return "Theorem " + reftxt;
    }
    else if (Util.startsWith(ref,"lem-")) {
      return "Lemma " + reftxt;
    }
    else {
      return reftxt;
    }
  }

  function toolFontFamily(fam) {
    return toolCss("font-family",fam);
  }

  function toolFontSize(size,title) {
    var tool = toolCss("font-size",size);
    if (title != null) tool.title = title;
    return tool;
  }

  function toolColor(color) {
    var tool = toolCss("color",color);
    if (!Util.startsWith(color,"#")) {
      tool.html = "<span class='colorbox " + color + "'></span>";
      tool.className = "button icon";
      tool.helpLink = null;
    }
    else {
      tool.title="Hex color";
    }
    return tool;
  }


  function toolCss(attr,value,display,extra) {
    var tool = toolStyle(attr,"="+value);
    tool.name = value;
    tool.display = display||value;
    return Util.extend(tool,extra);
  }

  function toolStyle(attr,value,options,title) {
    if (options) {
      title = options + " " + (title || "");
    }
    if (Util.startsWith(value,"=")) value = attr + value;
    return {
      name: attr,
      display: attr,
      helpLink: "#sec-css",
      content: "text",
      title: title,
      replacer: function(txt,rng) {
        var self = this;
        return self.styleReplacer(txt,rng,value);
      }
    }
  }

  UI.prototype._styleReplaceInLine = function( rng, value ) {
    var self = this;
    var line = self.editor.getModel().getLineContent(rng.startLineNumber);
    var cap = /^([^\{]*)(\{[ \t]*)([^\}]*)(\}).*$/m.exec(line);
    if (cap) {
      var openCol  = 1 + cap[1].length;
      var closeCol = openCol + cap[2].length + cap[3].length + (cap[4].length - 1);
      if (rng.startColumn >= openCol && rng.startColumn <= closeCol+1) {
        var select = rng.clone();
        select.startColumn = openCol;
        select.endColumn = closeCol+1;
        select.selectionStartColumn = select.startColumn;
        select.selectionEndColumn = select.endColumn;
        select.endLineNumber = select.startLineNumber;
        return { range: select, content: cap[2] + cap[3] + " " + value + cap[4] };
      }
    }
    return null;
  }

  UI.prototype.styleReplacer = function(txt,rng,value) {    
    var self = this;
    var cap;

    // anything ending with attributes: just extend
    cap = /^(.*)([ \t]*\}\s*)$/.exec(txt);
    if (cap) {  
      return cap[1] + " " + value + cap[2];
    }

    // position in attributes
    if (rng.isEmpty()) {
      var res = self._styleReplaceInLine(rng,value);
      if (res) return res;
    }
    
    // custom block with attributes?
    cap = /^([ \t]*~.*?)([ \t]*\}[ \t]*$[\s\S]*)/m.exec(txt);
    if (cap) {  
      return cap[1] + " " + value + cap[2];
    }

    // custom block 
    cap = /^([ ]{0,3}~.*)([\s\S]*?\r?\n[ \t]*~+\s*(?:[ \t]*End\b.*\s*)?)/i.exec(txt);
    if (cap) {  
      return cap[1] + "  { " + value + " }" + cap[2];
    }

    // paragraph or list block?
    if (rng.startColumn===1 && rng.startLineNumber < rng.endLineNumber) { 
      if (rng.endColumn===1) { 
        return txt + "{ " + value + " }\n";
      }
      var maxEndColumn = self.editor.getModel().getLineMaxColumn(rng.endLineNumber);     
      if (maxEndColumn === rng.endColumn) {
        return txt + "\n{ " + value + " }\n";
      }
    }
    
    // default
    return "[" + txt + "]{ " + value + " }";    
  }

  function toolInline(name,pre,post,extra) {
    return Util.extend({
      name: name,
      helpLink: "#syntax-inline-elements",
      content: "text",
      replacer: function(txt,rng) {
        if (Util.startsWith(txt,pre) && Util.endsWith(txt,post)) {
          return txt.substr(0,txt.length-post.length).substr(pre.length);
        }
        else {
          return pre + (extra.transform ? extra.transform(txt) : txt) + post;
        }
      }
    },extra);
  }

  function toolFigure(icon) {
    return { 
      name    : "figure",
      icon    : icon,
      helpLink: "#sec-figure",
      title   : "Insert a figure",
      content : "  Figure contents.",
      replacer: function(txt,rng) {
        return wrapBlock(rng,"~ Figure { #fig-figure caption=\"My figure\"}", txt, "~")
      }
    }
  }

  function toolMetadata(name,value,title) {
    return {
      name: name,
      helpLink: "#sec-metadata",
      title: title,
      replacer: function(txt,rng) {
        var self = this;
        var lineNo = findMetaPos(self.getEditText());      
        if (lineNo > 0) {
          var pos = { lineNumber: lineNo, column: 1 };      
          self.insertText( pad(name,12," ") + ": " + value + "\n", pos );
        }
        return null;
      }
    }
  }


  function pad(s,n,c) {
    if (!c) c = " ";
    var p = Math.max(0,n - s.length);
    var padding = new Array(p+1).join(c);
    return (s + padding);
  }

  function toolTable(columns) {
    var cols = [];
    for( var i = 0; i < columns; i++) {
      cols.push(i+1);
    }
    var w = 14;
    var lline = pad("",w,"-"); 
    var cline = ":" + pad("",w-2,"-") + ":"
    var headline = "+" + lline + "|" + cline + "+" + (columns <= 2 ? "" : cols.slice(2).map( function(c) { return (c===2 ? cline : lline); } ).join("|") + "+");
    var head   = "|" + cols.map( function(c) { return pad( (c===2 ? " Centered " : " Heading ") + c.toString(), w, " "); } ).join("|") + "|";
    var rowline = "|" + cols.map( function(c) { return lline; } ).join("|") + "|";
    var row   = "|" + cols.map( function(c) { return pad(" Cell " + c.toString(), w, " "); } ).join("|") + "|";
    var content = [rowline,head,headline,row,row,rowline,"{  }"].join("\n");
    return {
      name: columns.toString() + " columns",
      helpLink: "#sec-table",
      content: content,
      replacer: function(txt,rng) {
        return (rng.isEmpty() ? "" : txt) + blockRange(rng,content);
      }
    }
  }

  function heading(name,pre) {
    return {
      name: name,
      helpLink: "#sec-heading",
      content: name + " { #heading }\n\nAnd refer to Section [#heading].",
      replacer: function(txt,rng) {
        return blockRange(rng,pre + " " + txt);
      }
    }
  }

  function customBlock(name,post,content,postContent,helpLink,title) {
    return { 
      name: name,
      content: content || "Here is a " + name + ".",
      helpLink: helpLink,
      title: title,
      replacer: function(txt,rng) { 
        return wrapBlock(rng,"~ " + Util.capitalize(name) + (post ? " " + post : ""), txt, "~" + (rng.isEmpty() && postContent ? "\n\n" + postContent : ""));
      }
    }
  }

  function toolBlock(name,extra) {
    var block = extra.block || Util.capitalize(name);
    return Util.extend({
      name: name,
      display: Util.capitalize(name),
      content: "Here is a " + name + ".",
      replacer: function(txt,rng) {
        return wrapBlock(rng,"~ " + block + (extra.attrs ? " { " + extra.attrs + "}" : ""), txt, "~");
      }
    }, extra);
  }

  function toolCustom(name,display,content,helpLink,title) {
    return { 
      name: name,
      display: display || Util.capitalize(name),
      content: content || "Here is a " + name + ".",
      helpLink: helpLink,
      title: title,
      replacer: function(txt,rng) { 
        return wrapBlock(rng,"~ " + Util.capitalize(name), txt, "~");
      }
    }    
  }

  function wrapBlock(rng,pre,txt,post) {
    return blockRange(rng, pre + block(txt) + post);
  }

  function paraPrefix(pre,txt,hang) {
    var paras = txt.split(/\n\n+/g);
    if (paras && paras.length > 1) {
      return paras.map(function(p) { return pre + hangIndent(hang || "  ",p); } ).join("\n");
    }
    else {
      return "\n" + pre + txt;
    }
  }

  function linePrefix(pre,txt) {
    var lines = txt.split("\n");
    return lines.map(function(l) { return pre + l; }).join("\n");
  }

  function hangIndent(pre,txt) {
    var lines = txt.split("\n");
    var hang = lines.slice(1);
    return (lines.slice(0,1).concat( hang.map(function(l) { return pre + l; }))).join("\n");
  }

  function blockRange(rng,txt) {
    return (rng.startColumn===1 ? "" : "\n") + txt + "\n";
  }

  function block(txt) {
    return "\n" + txt.replace(/^\n?([\s\S]*?)\n?$/,"$1") + "\n";
  }

  UI.prototype.initToolKeys = function(tool,elem) {
    var self = this;
    var handler = function() { self.toolCommand(tool); }        
    if (tool.keys) {
      tool.keys.forEach( function(key) {
        bindKey(key,handler);
      });
      elem.title = elem.title + " (" + tool.keys.join(",") + ")";
    }
  }

  UI.prototype.initDynamic = function( menu, dynamic, initial ) {
    var self = this;
    menu.innerHTML = initial || "None";
    menu.addEventListener("click", function(ev) {
      var elem = ev.target;
      while( elem && elem !== menu && !Util.hasClassName(elem,"button")) elem = elem.parentNode;
      if (!elem || elem === menu) return;
      var value = decodeURIComponent(elem.getAttribute("data-value"));
      if (!value) return;
      return dynamic.call(self,value);
    });
  }

  UI.prototype.initSymbols = function(menu,symbols) {
    var self = this;
    var html = symbols.map(function(symbol) {
      var entity = (symbol.content ? symbol.content : "&" + (symbol.entity ? symbol.entity : "#" + symbol.code.toString()) + ";");
      var classes = "symbol button" + (symbol.invisible ? " invisible" : "");
      var title = symbol.title || entity;
      return "<span class='" + classes + "' data-entity='" + encodeURIComponent(entity) + "' title='" + title + "'>"  +
              (symbol.display ? symbol.display : "&#" + symbol.code.toString() + ";") + "</span>";
    }).join("");
    menu.innerHTML = html;
    menu.addEventListener("click", function(ev) {
      var elem = ev.target;
      if (!elem) return;
      var entity = decodeURIComponent(elem.getAttribute("data-entity"));
      if (!entity) return;
      self.toolCommand( { 
        name: "symbol", 
        replacer: function(txt,rng) {
          return entity;
        }
      });      
    });
  }

  UI.prototype.initTool = function( tool, parent, parentName  ) {
    var self = this;
    if (tool.element) {
      var elem = document.createElement(tool.element);
      if (tool.name) elem.id = "tool-" + tool.name;
      if (tool.html) elem.innerHTML = tool.html;
      parent.appendChild(elem);
      return;
    }

    var item = document.getElementById(parentName + "-" + tool.name);
    if (!item) {
      item = document.createElement("DIV");
      item.id = parentName + "-" + tool.name;
      item.className = (tool.className != null ? tool.className :"button");
      if (tool.icon===true) tool.icon = "images/icon-tool-" + tool.name + ".png";
      if (!tool.display) tool.display = Util.capitalize(tool.name);
      if (tool.title==null) tool.title = tool.display;
      if (tool.exts) {
        tool.title = tool.title + " (" + tool.exts.join(",") + ")";
      }
      if (tool.title != null) item.title = tool.title;
      if (tool.html) {
        item.innerHTML = tool.html;
      }
      else if (tool.icon) {
        item.innerHTML = "<img src='" + tool.icon + "'/>";
      }
      else {
        item.textContent = tool.display;
      }
      if (tool.helpLink && !tool.icon) {
        if (Util.startsWith(tool.helpLink,"#")) tool.helpLink = "http://research.microsoft.com/en-us/um/people/daan/madoko/doc/reference.html" + tool.helpLink;
        var help = document.createElement("A");
        help.href = tool.helpLink;
        help.textContent = "?";
        help.className = "help";
        help.target = "_blank";
        help.title  = "Go to documentation"
        item.appendChild(help);
      }
      parent.appendChild(item);
    }
    if (tool.options || tool.symbols || tool.dynamic) {
      Util.addClassName(item,"popup");        
      Util.addClassName(item,tool.options ? "options":"symbols");        
      if (!tool.icon) Util.addClassName(item,"named");
      var menu = document.getElementById(item.id + "-content");
      if (!menu) {
        menu = document.createElement("DIV");
        menu.id = item.id + "-content";
        item.appendChild(menu);
      }
      Util.addClassName(menu,"menu");
      Util.addClassName(menu,"boxed");
      if (tool.style) menu.setAttribute("style",tool.style);      
      if (tool.options) {
        tool.options.forEach(function(subtool) {
          self.initTool(subtool,menu,parentName + "-" + tool.name);
        });
      }
      else if (tool.symbols) {
        self.initSymbols(menu,tool.symbols);
      }
      else if (tool.dynamic) {
        self.initDynamic(menu,tool.dynamic,tool.initial);
      }
    }
    else {
      item.addEventListener("click", function(ev) { 
        if (ev.target.nodeName !== "A") {
          self.toolCommand(tool); 
        }
      });
    }
    self.initToolKeys(tool,item);          
  }

  UI.prototype.initTools = function() {
    var self = this;
    var toolbox = document.getElementById("toolbox-content")
    tools.forEach(function(tool) {
      self.initTool(tool,toolbox,"tool");
    });
    var menuInclude = document.getElementById("document-content");
    self.initTool(toolDefInclude,menuInclude,"menu");
  }

  UI.prototype.toolCommand = function( tool ) {
    var self = this;
    if (!tool) return;
    self.event( "","", State.Loading, function() {
      if (tool.replacer) {
        //var pos = self.editor.getPosition();
        self.insertOrReplaceText( tool.replacer, tool.content || "" );
        self.editor.revealPosition( self.editor.getPosition(), true, true );
      }
      else if (tool.message) {
        return Storage.message(self.storage,tool.message,tool.header,tool.headerLogo);
      }
      else if (tool.upload) {
        var msg = tool.upload;
        if (tool.exts) msg = msg + " (" + tool.exts.join(",") + ")";
        return Storage.upload(self.storage, msg, tool.header || "", "images/dark/icon-upload.png").then( function(files) {
          return self.insertFiles(files);
        });
      }
      else if (tool.command) {
        var cmd = self["command" + Util.capitalize(tool.command)];
        if (cmd) return cmd.call(self);
      }
    }, [State.Syncing]);      
  }


  /*---------------------------------------------------
    File and text insertion
  -------------------------------------------------- */
  UI.prototype.commandUndo = function() {
    var self = this;
    return self.editor.getModel().undo();
  }

  UI.prototype.commandRedo = function() {
    var self = this;
    return self.editor.getModel().redo();
  }

  UI.prototype.insertAfterPara = function(lineNum,txt) {
    var self = this;
    var model = self.editor.getModel();
    var n = model.getLineCount();
    while( lineNum < n && (model.getLineContent(lineNum) !== "")) lineNum++;
    var pos = self.editor.getPosition();
    pos.lineNumber = lineNum;
    pos.column = 1;
    self.insertText(txt,pos);
    return;
  }

  // Insert or replace some text in the document 
  UI.prototype.insertOrReplaceText = function( replacer, defText ) {
    var self = this;
    var select = self.editor.getSelection();
    var preserve = !select.isEmpty();
    var model = self.editor.getModel();
    var txt = (select.isEmpty() ? defText : model.getValueInRange(select) );
    var res = replacer.call(self,txt,select);
    if (res != null) {
      var newText = res;
      if (res.range) {
        select = res.range;
        newText = res.content;
      }
      var command;
      if (!preserve || isFirefox) {
        // firefox has trouble with "WithSelection
        command = new ReplaceCommand.ReplaceCommandWithoutChangingPosition( select, newText );
      } else {
        command = new Editor.ReplaceCommandWithSelection(select,newText);
      } 
      self.editor.executeCommand("madoko",command);      
    }
  }


  // Insert some text in the document 
  UI.prototype.insertText = function( txt, pos, moveToEnd ) {
    var self = this;
    if (!pos) pos = self.editor.getPosition(); 
    var rng = new Range.Range( pos.lineNumber, pos.column, pos.lineNumber, pos.column );
    var command;
    if (moveToEnd)
      command = new ReplaceCommand.ReplaceCommand( rng, txt );
    else
      command = new ReplaceCommand.ReplaceCommandWithoutChangingPosition( rng, txt );
    self.editor.executeCommand("madoko",command);
  }

  UI.prototype.insertFile = function(file, content, encoding, mime, pos ) {
    var self = this;
    if (pos) pos.column = 0;
    var ext  = Util.extname(file.name);
    var stem = Util.stemname(file.name);
    var name = Storage.sanitizeFileName(Util.basename(file.name));

    if (Util.isImageMime(mime)) name = "images/" + name;    
    if (encoding===Storage.Encoding.Base64) {
      var cap = /^data:([\w\/\-]+);(base64),([\s\S]*)$/.exec(content);
      if (!cap) {
        Util.message("invalid base64 encoding", Util.Msg.Error );
        return;
      }
      content = cap[3];  
    }
    if (content.length >= 1.34*1024*1024) {
      throw new Error("file size is too large (maximum insertion size is about 1mb)");
    }
    else if (content.length >= 1.34*512*1024) {
      Util.message("file size is very large; consider resizing to keep it under 512kb", Util.Msg.Warning);
    }

    
    var text = "";
    var message = "inserted"; 
    if (Util.isImageMime(mime)) {
      var isNew = self.storage.writeFile( name, content, {encoding:encoding,mime:mime});
      if (isNew) {
        self.insertAfterPara(pos.lineNumber,"\n[" + stem + "]: " + name + ' "' + stem + '" { width=auto max-width=90% }\n');
      }
      else {
        message = "referred to";
      }
      text = "![" + stem + "]";
    }
    else if (ext===".mdk" || ext===".md") {
      var isNew = self.storage.writeAppendFile( name, content, {encoding:encoding,mime:mime});
      if (isNew) {
        text = "[INCLUDE=\"" + name + "\"]";
      }
      else {
        message = "appended";
      }
    }
    else if (ext===".tex" || ext==".latex") {
      message = "converting";
      var storage = self.storage;
      var mdkName = Util.changeExt(name,".mdk");
      if (!self.storage.existsLocal(mdkName)) {
        text = "[INCLUDE=\"" + mdkName + "\"]";
      }
      self.runner.runMadokoLocal( name, content, { convertTex: true } ).then( function(mdkContent) {
        var isNew = storage.writeAppendFile( mdkName, mdkContent, { encoding:Storage.Encoding.Utf8, mime:"text/madoko"} );
        Util.message("Converted and " + (isNew ? "inserted" : "appended") + " " + mdkName, Util.Msg.Status );
        self.setStale();
      }, function(err) {
        Util.message("Failed to convert " + name + ": " + err.toString(), Util.Msg.Error );
      });      
    }
    else {
      var isNew = self.storage.writeFile( name, content, {encoding:encoding,mime:mime});
      if (!isNew) {
        message = "overwrote"
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
          text="Bib Style   : " + name;
        }
        else if (ext===".cls") {
          text="Doc Class   : " + name;
        }
        else if (ext===".sty" || ext===".tex") {
          text="Package     : " + name;
        }
        else {
          Util.message( "unsupported drop file extension: " + ext, Util.Msg.Warning );
          return;
        }
        var lineNo = findMetaPos(self.getEditText());      
        if (lineNo > 0) pos = { lineNumber: lineNo, column: 1 };      
      }
    }
    if (text) {
      self.insertText( text + "\n", pos );
    }
    if (message) {
      Util.message( message + " " + name, Util.Msg.Status );
    }
  }

  UI.prototype.insertFiles = function(files,pos) {
    var self = this;
    if (!files) return;
    if (!pos) pos = self.editor.getPosition();
    for (var i = 0, f; f = files[i]; i++) {      
      var encoding = Storage.Encoding.fromExt(f.name);      
      var mime = f.type || Util.mimeFromExt(f.name);
      if (!(Util.isImageMime(mime) || Util.isTextMime(mime))) { // only images or text..
        continue;
      }
      
      var reader = new FileReader();
      reader.onload = (function(_file,_encoding,_mime) { 
        return function(loadEvt) {
          try {
            self.insertFile( _file, loadEvt.target.result, _encoding, _mime, pos );
          }
          catch(exn) {
            Util.message(exn,Util.Msg.Exn);
          }
        };
      })(f,encoding,mime);

      if (encoding===Storage.Encoding.Base64)
        reader.readAsDataURL(f);
      else 
        reader.readAsText(f);
    }
  }

  /*---------------------------------------------------
    Decorations 
  -------------------------------------------------- */

  UI.prototype.removeDecorations = function(discardSticky,type) {
    var self = this;
    var now = Date.now();
    if (!self.editor) return;
    var model = self.editor.getModel();
    self.editor.changeDecorations(function(changeAccessor) {
      var newdecs = [];
      self.decorations.forEach( function(decoration) {
        if (type && !Util.startsWith(decoration.type,type)) {
          // do nothing          
          newdecs.push(decoration);          
        }
        else if (discardSticky || !decoration.sticky ||
                  (decoration.expire && decoration.expire < now)) {
          if (decoration.id) {
            updateDecorationRange(decoration, model);
            changeAccessor.removeDecoration(decoration.id);
            decoration.id = null;          
          }
        }
        else {
          newdecs.push(decoration);
          decoration.outdated = true;
          if (decoration.id && decoration.path === self.editName) {
            var dec = decoration.options || { isWholeLine : true };
            if (decoration.glyphType) dec.glyphMarginClassName = 'glyph-' + decoration.glyphType + '.outdated';
            if (decoration.marginType) dec.linesDecorationsClassName = 'margin-' + decoration.marginType + '.outdated'; 
            changeAccessor.changeDecorationOptions(decoration.id, dec );
          }
          else if (decoration.id) {
            updateDecorationRange(decoration, model);
            changeAccessor.removeDecoration(decoration.id);
            decoration.id = null;          
          }
        }
      });
      self.decorations = newdecs;
    });    
  }

  UI.prototype.removeDecorationsOn = function(id,tag) {
    var self = this;
    if (id==null && tag==null) return;
    var model = self.editor.getModel();
    self.editor.changeDecorations( function(changeAccessor) {
      var newdecs = [];
      self.decorations.forEach( function(decoration) {
        if ((id && id === decoration.id) || (tag && tag === decoration.tag)) {
          updateDecorationRange(decoration, model);
          changeAccessor.removeDecoration( decoration.id );
          decoration.id = null;
        }
        else {
          newdecs.push(decoration);
        }
      });
      self.decorations = newdecs;
    });
  }

  UI.prototype.hideDecorations = function() {
    var self = this;
    var model = self.editor.getModel();
    self.editor.changeDecorations( function(changeAccessor) {
      self.decorations.forEach( function(decoration) {
        if (decoration.id) {
          updateDecorationRange(decoration, model);
          changeAccessor.removeDecoration( decoration.id );
          decoration.id = null;
        }
      });
    });
  }

  UI.prototype.showDecorations = function() {
    var self = this;
    var model = self.editor.getModel();
    self.editor.changeDecorations( function(changeAccessor) {
      self.decorations.forEach( function(decoration) {
        if (decoration.id) {
          updateDecorationRange(decoration, model);
          changeAccessor.removeDecoration( decoration.id );
          decoration.id = null;
        }
        if (decoration.path === self.editName) {
          var postfix = (decoration.outdated ? ".outdated" : "" );
          var dec = decoration.options || { isWholeLine: true };
          if (decoration.glyphType) dec.glyphMarginClassName = 'glyph-' + decoration.glyphType + postfix;
          if (decoration.marginType) dec.linesDecorationsClassName = 'margin-' + decoration.marginType + postfix;
          decoration.id = changeAccessor.addDecoration( decoration.range, dec );
        }
      });
    });
  }

  function newRange( rng ) {
    if (typeof rng === "number") { // a line number
      return new Range.Range( rng, 1, rng, 1 );
    }
    if (rng.endColumn != null) {
      return  new Range.Range( rng.startLineNumber, rng.startColumn, rng.endLineNumber, rng.endColumn );
    }
    else if (rng.lineNumber != null) { // it's a position 
      return new Range.Range( rng.lineNumber, rng.column, rng.lineNumber, rng.column );
    }
    else {
      return new Range.Range( 1, 0, 1, 0 );
    }
  }

  function updateDecorationRange( decoration, model ) {
    var range = model.getDecorationRange(decoration.id);
    if (range) decoration.range = newRange(range);
  }

  var rulerColorError      = 'rgba(255,18,18,0.7)';
  var rulerColorWarning    = 'rgba(18,136,18,0.7)';
  var rulerColorConcurrent = 'rgba(18,18,255,0.7)';
  var rulerColorMerge      = 'rgba(18,136,18,0.7)';
  
  UI.prototype.showErrors = function( errors, sticky, type ) {
    var self = this;
    if (!type) type = "error";

    var decs = [];
    errors.forEach( function(error) {
      if (!error.path) error.path = self.docName;
      decs.push( { 
        id: null, 
        type: error.type || type,
        glyphType: error.glyphType || error.type || type,
        sticky: sticky, 
        outdated: false, 
        // message: error.message, 
        menu: self.errorMenu,
        options: { 
          htmlMessage: Util.escape(error.message), 
          isWholeLine: true,
          overviewRuler: {
            color: error.type === "warning" ? rulerColorWarning : rulerColorError,
            position: 4 /* Right */
          },          
        },
        path: error.path,
        range: newRange(error.range),
        expire: 0, // does not expire
      });
      var msg = (error.type || type) + ": " + error.path + ":" + error.range.startLineNumber.toString() + ": " + error.message;
      Util.message( msg, error.type || type );
    });

    self.removeDecorations(true,type);
    self.addDecorations(decs);
  }

  UI.prototype.showMerges = function( merges ) {
    var self = this;
    var decs = [];
    var now = Date.now();
    merges.forEach( function(merge) {
      if (!merge.path) merge.path = self.editName;
      var dec = { 
        id: null, 
        type: "merge.merge-" + merge.type,
        sticky: true, 
        outdated: false, 
        expire: now + (60000), // expire merges after 1 minute?
        message: "Merged (" + merge.type + ")" + (merge.content ? ":\n\"" + merge.content + "\"": ""), 
        path: merge.path,
        range: newRange( merge.startLine ),
        options: {
          isWholeLine: true,
          overviewRuler: {
            color: rulerColorMerge,
            position: 4 /* Right */
          },
        }        
      };
      dec.marginType = dec.type;
      decs.push(dec);      
    });
    self.removeDecorations(false,"merge");
    self.addDecorations(decs);      
  }

  UI.prototype.showSpellErrors = function( errors ) {
    var self = this;
    var decs = [];
    var now = Date.now();
    errors.forEach( function(err) {
      if (!err.path) err.path = self.editName;
      var dec = { 
        id: null, 
        tag: err.tag,
        type: "spellerror",
        sticky: true, 
        outdated: false, 
        //glyphType: "spellcheck",
        //expire: now + (60000), // expire merges after 1 minute?
        // message: err.message, 
        menu: self.spellCheckMenu,
        path: err.path,
        range: newRange(err.range),
        options: { 
          isOverlay:true, 
          stickiness: 1, /* never grows at edges */
          inlineClassName: "spellerror",
          overviewRuler: {
            color: rulerColorError,
            position: 4 /* Right */
          },
        },
      };
      decs.push(dec);      
    });
    self.removeDecorations(true,"spellerror");
    self.addDecorations(decs);      
  }


  UI.prototype.showConcurrentEdits = function( edits ) {
    var self = this;
    var decs = [];
    var now = Date.now();
    edits.forEach( function(edit) {
      if (!edit.path) edit.path = self.editName;
      decs.push( {
        id: null,
        type: "edit",
        glyphType: "edit",
        sticky: true,
        outdated: false,
        expire: now + 20000,
        message: edit.message || "Being edited concurrently",
        path: edit.path,
        range: newRange( edit.line ),
        options: {
          isWholeLine: true,
          overviewRuler: {
            color: rulerColorConcurrent,
            position: 7 /* full */
          },
        }
      });
    });
    self.removeDecorations(false,"edit");
    self.addDecorations(decs);
  }

  UI.prototype.addDecorations = function( decs ) {
    var self = this;

    // add decorations
    self.decorations = self.decorations.concat(decs);

    // remove duplicates
    self.editor.changeDecorations( function(changeAccessor) {
      var newdecs = [];
      for( var i = 0; i < self.decorations.length; i++) {
        var dec = self.decorations[i];
        for (var j = i+1; j < self.decorations.length; j++) {
          var dec2 = self.decorations[j];
          // overlapping range?
          // todo: check column range, perhaps merge messages?
          if (dec.type == dec2.type && (dec.options==null || dec.options.isWholeLine===true) &&
              dec.path === dec2.path && 
                dec.range.startLineNumber <= dec2.range.endLineNumber && 
                 dec.range.endLineNumber >= dec2.range.startLineNumber) {
            if (!dec.outdated && dec2.outdated) {
              // swap, so we remove the outdated one
              self.decorations[j] = dec;
              dec = dec2;
              dec2 = self.decorations[j];
            }
   
            // update dec2 to merge
            if (dec.message !== dec2.message) dec2.message = dec2.message + "\n-----\n" + dec.message;
            if (dec.marginType && !dec2.marginType) dec2.marginType = dec.marginType;
            if (dec.glyphType && !dec2.glyphType)   dec2.glyphType = dec.glyphType;

            // remove dec
            if (dec.id) {
              changeAccessor.removeDecoration( dec.id );
              dec.id = null;
            }
            dec = null;
            break;
          }
        }
        if (dec) newdecs.push(dec);
      }
      self.decorations = newdecs;
    });

    self.showDecorations();
  }

  UI.prototype.getDecorationMessage = function( path, lineNo, isGlyph ) {
    var self = this;
    if (!path) path = self.editName;
    for (var i = 0; i < self.decorations.length; i++) {
      var dec = self.decorations[i];
      if (dec.path === path && 
            dec.range.startLineNumber <= lineNo && dec.range.endLineNumber >= lineNo &&
              (isGlyph ? dec.glyphType : dec.marginType) ) {
        return dec.message;
      }
    }    
    return "";
  }

  UI.prototype.documentFilesFrom = function(path) {
    var self = this;
    if (!path) path = self.editName;
    if (!self.fileOrder || self.fileOrder.length===0) return [];
    for(var i = 0; i < self.fileOrder.length; i++) {
      if (self.fileOrder[i] === path) {
        return self.fileOrder.slice(i+1).concat(self.fileOrder.slice(0,i+1));
      }
    }
    return self.fileOrder;
  }

  function isErrorType(dec) {
    var type = dec.type || dec.glyphMarginClassName || dec.linesDecorationsClassName || dec.inlineClassName;
    return (/\b(spellerror|error|warning)\b/.test(type));
  }

  UI.prototype.gotoNextError = function(position) {
    var self = this;
    self.anonEvent( function() {
      var found = null;
      var path = self.editName;
      if (!position) position = self.editor.getPosition();
      var decs = self.editor.getModel().getAllDecorations();
      decs.forEach( function(dec) {
        if (position.isBefore(dec.range.getStartPosition())) {
          if (found==null || dec.range.getStartPosition().isBefore(found.range.getStartPosition())) {
            var decoration = self.findDecorationById(dec.id, dec.range);
            if (decoration && isErrorType(decoration)) {
              found = decoration;
            }
          }
        }
      });
      if (!found) {
        self.documentFilesFrom(path).some( function(fpath) {
          self.decorations.forEach( function(dec) {
            if (isErrorType(dec) && dec.path === fpath) {
              if (found==null || (found.path===dec.path && dec.range.getStartPosition().isBefore(found.range.getStartPosition()))) {
                found = dec;
              }
            }
          });
          return (found!=null);
        });
      }
      if (!found) return;
      return self.gotoDecoration(found);
    });
  }

  UI.prototype.findDecorationById = function(id, newrange ) {
    var self = this;
    var found = null;
    self.decorations.some( function(dec) {
      if (dec.id === id) {
        if (newrange) dec.range = newRange(newrange);
        found = dec;
        return true;
      }
    });
    return found;
  }

  UI.prototype.findErrorDecoration = function(path,pos) {
    var self = this;
    var found = null;
    self.decorations.forEach( function(dec) {
      if (isErrorType(dec)) {
        if (dec.path === path) {
          if (dec.range.containsPosition(pos) || dec.range.getStartPosition().equals(pos)) {
            if (found==null || dec.range.getStartPosition().isBefore(found.range.getStartPosition())) {
              found = dec;
            }
          }
        }
      }
    });
    return found;
  }

  UI.prototype.gotoDecoration = function( dec ) {
    var self = this;
    var r = dec.range;
    return self.editFile(dec.path).then( function() {
      self.editor.focus();
      self.editor.setSelection(new Selection.Selection(r.endLineNumber,r.endColumn,r.startLineNumber,r.startColumn),true,true,true);
      var menu = dec.menu;
      if (menu) {
        var text = self.editor.getModel().getValueInRange(r);
        setTimeout( function() { 
          menu.startShowingAt(null, r, text, dec); 
        }, 50 );        
      }
    });
  }

  /* --------------------------------------------------------------
     View synchronization 
  -------------------------------------------------------------- */
  
  UI.prototype.dispatchViewEvent = function( ev ) {
    var self = this;
    // we use "*" since sandboxed iframes have a null origin
    if (self.view) {
      if (ev.eventType==="reload" && isIE && Localhost.localhost.hosted) {
        self.view.src = self.view.src; // IE reloads the iframe as top-window otherwise :-(
      }
      else {
        self.view.contentWindow.postMessage(JSON.stringify(ev),"*");
      }
    }
  }

  UI.prototype.viewToTextLine = function( lineNo ) {
    var self = this;
    // translate view line to text line (for when lines are wrapped)
    if (self.editor.getConfiguration().wrappingColumn >= 0) {
      var slines = self.editor.getView().context.model.lines;
      return slines.convertOutputPositionToInputPosition(lineNo,0).lineNumber|0;
    }
    else {
      return lineNo|0;
    }
  }

  UI.prototype.syncView = function( options, startLine, endLine, cursorLine ) 
  {
    var self = this;
    try {
      if (self.lastLineNo===undefined) self.lastLineNo = -1;
      if (!options) options = {};
      if (!self.view || self.state === State.Init || self.state === State.Loading) return false; // during loading of new content

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
      else { // if (cursorLine < startLine || cursorLine > endLine) {   // not a visible cursor?
        // use the middle of the viewed ranged
        lineNo = Math.round(startLine + ((endLine - startLine + 1)/2));
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
      
      // for separate viewer
      // localStorage.setItem("viewer-scroll",JSON.stringify(event)); 

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
      var fullFolder = self.storage.remote.getDisplayFolder();
      var folder = fullFolder;
      if (folder.length > 30) folder = "..." + folder.substr(folder.length-30);
      var prefix = "<span class='folder'>" + folder + (folder ? "/" : "") + "</span>";
      
      var postfix = self.displayFile(file);
      var fileDisplay = prefix + postfix;
      if (!self.fileDisplay || self.fileDisplay !== fileDisplay) { // prevent too many calls to setInnerHTML
        self.fileDisplay = fileDisplay;
        var title = "//" + self.storage.remote.displayType + "/" + fullFolder + (fullFolder ? "/" : "") + file.path;
        self.editSelectHeader.innerHTML = "<span title='" + Util.escape(title) + "'>" + fileDisplay + "</span>";
      }
      if (self.editContent !== file.content) { // only update edit text if content update 
        self.setEditText(file.content);
      }
    }
    self.editSelect();
    if (Util.extname(file.path) === ".bib") {
      self.updateCitations(file.path,file.content);
    }
    self.lastSpellCheck = 0;
  }

  UI.prototype.saveTo = function() {
    var self = this;    
    return Storage.saveAs(self.storage,self.docName).then( function(res) {
      if (!res || !res.storage) throw new Error("cancel"); 
      return self.withSyncSpinner( function() {
        return res.storage.syncOrCommit().then( function() { // ensure we can save the new storage object 
          return self.setStorage(res.storage,res.docName).then( function() { // .. before setting this as our new storage
            return res.docName;
          });           
        });
      });
    }); 
  } 

  UI.prototype.withSyncSpinner = function( makePromise) {
    var self = this;
    self.showSpinner(true,self.syncer);
    return makePromise().always( function() {
      self.showSpinner(false,self.syncer);
    });
  }

  UI.prototype.synchronize = function(pullOnly) {
    var self = this;
    return self.event( "", "", State.Syncing, function() {
      if (!self.isConnected) {
        return self.login().then( function() {  
          return self._synchronize(pullOnly); 
        });
      }
      else if (self.storage && self.storage.remote.readonly) {
        self.saveTo();
      }
      else {
        return self._synchronize(pullOnly);
      }
    });
  }

  UI.prototype.pull = function() {
    var self = this;
    return self.event( "", "", State.Syncing, function() {
      return self.login().then( function() {  
        return self._synchronize(true);
      });
    });
  }

  UI.prototype._synchronize = function(pullOnly) {
    var self = this;
    self.lastSync = Date.now();
    if (self.storage) {
      var cursors = {};        
      var line0 = self.editor.getPosition().lineNumber;
      cursors["/" + self.docName] = line0;
      self.showConcurrentUsers(false);
      if (!self.storage.remote.canSync) return Promise.resolved();

      return self.withSyncSpinner( function() {
        // var syncFun = self.storage.remote.canCommit ? self.storage.pull : self.storage.sync;
        return self.storage.syncOrCommit( Editor.diff, cursors, function(merges) { self.showMerges(merges); }, pullOnly ).then( function() {
          var line1 = cursors["/" + self.docName];
          var pos = self.editor.getPosition();
          if (pos.lineNumber >= line0) {
            pos.lineNumber += (line1 - line0);
            self.editor.setPosition(pos); // does not reveal the position, so no scrolling happens.
          }
        });
      });
    }
    else {
      return Promise.resolved();
    }
  }

  UI.prototype.spellCheck = function() {
    var self = this;
    return self.anonEvent( function() {
      var ctx = { 
        round: 0, 
        path: self.editName, 
        show: function(errors) { return self.showSpellErrors(errors); } 
      };
      return self.spellChecker.check( self.editor.getValue(), ctx ).then( function(res) {
        Util.message("Spell check done.", Util.Msg.Status);
      });
    });
  }

  UI.prototype.showUpdateMessage = function() {
    var self = this;
    function showUpdate( upd ) {
      return "<li>" + upd.version + (upd.date ? ",  " + upd.date : "") + "<ul>" +
                upd.updates.map( function(item) {
                  return "<li>" + Util.miniMarkdown(item) + "</li>";
                }).join("") + 
              "</ul></li>"; 
    }
    self.anonEvent( function() {        
      var shortDigest = "(" + self.version.digest.substr(0,6) + ")";
      var shortDate   = self.version.date.substr(0,10);
      var log = (self.version.log instanceof Array ? self.version.log : [self.version.log]);
      var logdiv = "<ul class='version-updates'>"
                      + log.map( showUpdate ).join("\n") + "</ul>"

      var htmlMessage = "<div class='version-display'>" + 
                    (!self.version.log[0].alert ? "" : "<div class='version-alert'>" + Util.miniMarkdown(self.version.log[0].alert) + "</div>") +
                    (!self.version.log[0].message ? "" : "<div class='version-message'>" + Util.miniMarkdown(self.version.log[0].message) + "</div>") +
                    (logdiv) +
                    "</div>";
      return Storage.message(self.storage,htmlMessage,"Madoko has been updated to " + self.version.version + ", " + shortDate + " " + shortDigest, "images/dark/icon-madoko.png");
    });
  }


  // object    
  return UI;
})();

// module
return UI;
}); 