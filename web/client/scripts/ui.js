/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/map","../scripts/promise","../scripts/util",
        "../scripts/storage","../scripts/madokoMode",
        "vs/editor/core/range", "vs/editor/core/command/replaceCommand"],
        function(Map,Promise,Util,Storage,MadokoMode,Range,ReplaceCommand) {


function diff( original, modified ) {
  var originalModel = Monaco.Editor.createModel(original, "text/plain");
  var modifiedModel = Monaco.Editor.createModel(modified, "text/plain"); 
  var diffSupport   = modifiedModel.getMode().diffSupport;
  var diff = diffSupport.computeDiff( 
                originalModel.getAssociatedResource(), modifiedModel.getAssociatedResource() );
  return new Promise(diff); // wrap promise
}

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
  var cap = /(ALT[\+\-])?(CTRL[\+\-])?(META[\+\-])?(SHIFT[\+\-])?([A-Z])/.exec(key.key.toUpperCase());
  var code = 0;
  if (cap) {
    code = cap[5].charCodeAt(0);
    if (cap[1]) code |= KeyMask.altKey;
    if (cap[2]) code |= KeyMask.ctrlKey;
    if (cap[3]) code |= KeyMask.metaKey;
    if (cap[4]) code |= KeyMask.shiftKey;
  }
  keyHandlers.push( { code: code, action: action, stop: key.stop || false } );
}


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
        Util.message("full local backup is too large; using minimal backup instead", Util.Msg.Trace);
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

    Monaco.Editor.createCustomMode(MadokoMode.mode);
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
      Util.dispatchEvent( self.checkDisableAutoUpdate, "change" );
      Util.dispatchEvent( self.checkDisableServer, "change" );
      Util.dispatchEvent( self.checkLineNumbers, "change" );
      Util.dispatchEvent( self.checkWrapLines, "change" );      
      Util.dispatchEvent( self.checkDelayedUpdate, "change" );
    }).then( function() { }, function(err) {
      Util.message(err, Util.Msg.Error);          
    }).always( function() {
      self.state = State.Normal;
    });
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

  UI.prototype.anonEvent = function( action, okStates ) {
    var self = this;
    self.event( "","",null, action, okStates );
  }

  UI.prototype.initUIElements = function(content) {
    var self = this;

    // common elements
    self.usersStatus = document.getElementById("users-status");
    self.spinner = document.getElementById("view-spinner");    
    self.spinner.spinDelay = 750;
    self.syncer  = document.getElementById("sync-spinner");  
    self.syncer.spinDelay = 100;  
    self.exportSpinner = document.getElementById("export-spinner");    
    self.exportSpinner.spinDelay = 1000;
    self.view    = document.getElementById("view");
    self.editSelectHeader = document.getElementById("edit-select-header");

    self.app  = document.getElementById("main");
    self.connectionLogo = document.getElementById("connection-logo");
    self.connectionMessage = document.getElementById("connection-message");
    self.theme = "vs";

    // listen to application cache    
    self.appUpdateReady = false;
    if (window.applicationCache.status === window.applicationCache.UPDATEREADY) { 
      // reload immediately if an update is ready 
      window.location.reload();
    }
    else {
      window.applicationCache.addEventListener( "updateready", function(ev) {
        if (window.applicationCache.status === window.applicationCache.UPDATEREADY) { 
          window.applicationCache.swapCache();
          self.appUpdateReady = true;
        }           
      });
    }

    // start editor
    self.checkLineNumbers = document.getElementById('checkLineNumbers');
    self.editor = Monaco.Editor.create(document.getElementById("editor"), {
      value: content,
      mode: "text/madoko",
      theme: self.theme,
      roundedSelection: false,
      lineNumbers: (self.checkLineNumbers ? self.checkLineNumbers.checked : false),
      //mode: MadokoMode.mode,
      tabSize: 2,
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
        }, [State.Syncing]);
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
    self.editor.addListener("keydown", function (e) {    
      if (self.stale || self.changed) self.lastEditChange = Date.now(); // so delayed refresh keeps being delayed even on cursor keys.
    });
    
    self.editor.getHandlerService().bind({ key: 'Alt-Q' }, function(ev) { 
      self.anonEvent( function() { self.onFormatPara(ev); }, [State.Syncing] );
    });

    
    // Key bindings

    bindKey( "Alt-S",  function()   { self.synchronize(true); } );
    bindKey( "Ctrl-S", function()   { self.synchronize(true); } );
    bindKey( "Alt-O",  function(ev) { openEvent(ev); });
    bindKey( "Alt-N",  function(ev) { newEvent(ev); });

    // --- save links
    var saveLink = function(ev) {
      var elem = ev.target;
      while( elem && elem.nodeName !== "DIV" && !Util.hasClassName(elem, "save-link")) {
        elem = elem.parentNode;
      }

      if (Util.hasClassName(elem,"save-link")) {
        ev.cancelBubble = true;
        var path = elem.getAttribute("data-path"); 
        var mime = elem.getAttribute("data-mime");
        if (path) {
          self.saveUserContent(path,mime);
        }
      }
    };
    //document.body.addEventListener("click", saveLink);
    document.body.addEventListener("click",saveLink);



    // ----
    
    document.getElementById("sync-now").onclick = function(ev) {
      self.synchronize(true);
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
            var cap = /^\s*\[\s*INCLUDE\s*=?["']?([^"'\]\s]+)["']?\s*\]\s*$/.exec(line)
            if (cap) {
              var fileName = cap[1]; // TODO use file
              self.editFile( fileName );
            }
          }
        });
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
          var msg = self.getDecorationMessage(self.editName,ev.target.position.lineNumber);
          ev.target.element.title = msg;
        }
      }, [State.Syncing]);
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
      }, [State.Syncing]);
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
      }, [State.Syncing]);
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

    self.lastSync = 0;
    self.lastConUsersCheck = 0;
    self.iconDisconnect = document.getElementById("icon-disconnect");
    self.checkAutoSync = document.getElementById('checkAutoSync');
    self.lastVersionCheck = 0;

    // request cached version; so it corresponds to the cache-manifest version  
    self.version = null;
    Util.getAppVersionInfo(false).then( function(version) {
      if (version) {
        self.version = version;
        var elem = document.getElementById("madokoWebVersion");
        if (elem) elem.textContent = self.version.version || "?";       
        elem = document.getElementById("madokoVersion");
        if (elem) elem.textContent = self.version.madokoVersion || "?";
        elem = document.getElementById("madokoDigest");
        if (elem) {
          elem.textContent = "(" + self.version.digest.substr(0,6) + ")" || "";
          elem.setAttribute("title","digest: " + self.version.digest);
        }
      }
    });
    
    var autoSync = function() {
      var now = Date.now();
      self.updateConnectionStatus().then( function(status) {        
        if (self.storage.isRemote()) {
          if (status===0) {
            if (now - self.lastConUserCheck >= 10000) {
              self.showConcurrentUsers( now - self.lastConUsersCheck < 30000 );
            }
          }
          
          if (status===400) {
            Util.message("Could not synchronize because the Madoko server could not be reached (offline?)", Util.Msg.Info);
          }
          else { // force login if not connected
            if (self.checkAutoSync.checked && self.state === State.Normal) { 
              if (self.lastSync === 0 || (now - self.lastSync >= 30000 && now - self.lastEditChange > 5000)) {
                self.synchronize();
              }
            }
          }
        }
      });
      // check if an app update happened 
      if (self.state === State.Normal && self.appUpdateReady) {
        self.appUpdateReady = false;        
        Util.message("Madoko has been updated. Please reload.", Util.Msg.Status);     
        window.location.reload(true);        // force reload. TODO: ask the user? show a sticky status message?   
      }
      // check the version number on the server every minute
      if (now - self.lastVersionCheck >= 60000) {  
        self.lastVersionCheck = now;
        // request lastest appversion from the server 
        Util.getAppVersionInfo(true).then( function(version) {
          if (!version) return;
          if (self.appUpdateReady || !self.version) return;
          if (self.version.digest === version.digest) return;
          if (self.version.updateDigest === version.digest) { // are we updating right now to this version?
            // firefox doesn't reliably send a update ready event, check here also. 
            if (window.applicationCache.status === window.applicationCache.UPDATEREADY || 
                window.applicationCache.status === window.applicationCache.IDLE)  // this is for Firefox which doesn't update the status correctly
            {
              self.appUpdateReady = true;
              window.applicationCache.swapCache();
            }
            return;
          }
          
          Util.message("Downloading updates...", Util.Msg.Status);
          self.version.updateDigest = version.digest; // remember we update to this version
          window.applicationCache.update(); // update the cache -- will trigger a reload later on.                     
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
          self.updateConnectionStatus().then( function() {
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
    
    document.getElementById("signin").onclick = function(ev) {
      if (self.storage && self.storage.isRemote()) {        
        return self.anonEvent( function() {
          return self.storage.remote.login().then( function() {
            return self.updateConnectionStatus();
          });
        });      
      }
    };
    
    document.getElementById("signout").onclick = function(ev) {
      if (self.storage && self.storage.isRemote()) {        
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
      self.event( null, "exporting...", State.Exporting, function() { 
        return self.generateHtml(); 
      });
    }

    document.getElementById("azure").onclick = function(ev) {
      self.event( "Saved website", "exporting...", State.Exporting, function() { 
        return self.generateSite(); 
      });
    }

    document.getElementById("export-pdf").onclick = function(ev) {
      self.event( null, "exporting...",  State.Exporting, function() { 
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
          var path = elem.getAttribute("data-file");
          if (path) {
            var mime = Util.mimeFromExt(path);
            return self.event( "loaded: " + path, "loading...", State.Loading, function() {
              if (mime==="application/pdf" || mime==="text/html" || Util.startsWith(mime,"image/")) {
                return self.saveUserContent( path, mime );
              }
              else {
                return self.editFile(path);            
              }
            });
          }
        }
      }, [State.Syncing]);
    };

    function messageDblClick(ev) {
      self.anonEvent( function() {
        var elem = ev.target;
        while(elem && elem.nodeName !== "DIV" && elem.className !== "msg-line") {
          elem = elem.parentNode;
        }
        if (elem && (elem.id === "status" || elem.className==="msg-line" || elem.className==="msg-section")) {
          var line = elem.textContent;
          var cap = /\bline(?:\s|&nbsp;)*:(?:\s|&nbsp;)*(\d+)/.exec(line);
          if (cap) {
            var lineNo = parseInt(cap[1]);
            if (!isNaN(lineNo)) {
              self.editor.setPosition( { lineNumber: lineNo, column: 1 }, true, true );
            }
          }
          else {
            cap = /\b(?:warning|error|line):(?:\s|&nbsp;)*([\w\\\/\.\-]*)(?:\s|&nbsp;)*:?\(?(\d+)(?:-\d+)?\)?/.exec(line)
            if (cap) {
              var lineNo = parseInt(cap[2]);
              var fileName = cap[1]; // TODO use file
              if (!isNaN(lineNo)) {
                self.editFile( fileName, { lineNumber: lineNo, column: 1 } );
              }
            }
          }
        }
      }, [State.Syncing]);
    }

    document.getElementById("console-out").ondblclick = messageDblClick;
    document.getElementById("status").ondblclick = messageDblClick;
   
    self.syncer.onclick = function(ev) {      
      self.synchronize();
    }



    
    // narrow and wide editor panes
    var app = document.getElementById("main-body");
    
    //viewpane.addEventListener('transitionend', function( event ) { 
    //  self.syncView(); 
    //}, false);
    
    document.getElementById("view-narrow").onclick = function(ev) {
      Util.removeClassName(app,"view-wide");
      Util.removeClassName(app,"view-normal");
      Util.addClassName(app,"view-narrow");
    }
    document.getElementById("view-normal").onclick = function(ev) {
      Util.removeClassName(app,"view-wide");
      Util.removeClassName(app,"view-narrow");
      Util.addClassName(app,"view-normal");
    }
    document.getElementById("view-wide").onclick = function(ev) {
      Util.removeClassName(app,"view-narrow");
      Util.removeClassName(app,"view-normal");
      Util.addClassName(app,"view-wide");
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

    // toolbox
    self.initTools();

    // emulate hovering by clicks for touch devices
    Util.enablePopupClickHovering();    
  }

  UI.prototype.login = function() {
    var self = this;
    if (!self.storage) return Promise.resolved(false);
    return self.storage.login().always( function() {
      return self.updateConnectionStatus();
    });
  }

  UI.prototype.updateRemoteLogo = function(stg,isConnected) {
    var self = this;
    if (!stg) stg = self.storage;
    if (isConnected==null) isConnected = self.isConnected;
    self.app.className = self.app.className.replace(/(^|\s+)remote-\w+\b/g,"") + " remote-" + stg.remote.type();
    if (!stg.isRemote()) {
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
    
    if (stg && stg.remote) {
      var remoteLogo = "images/dark/" + stg.remote.logo();
      if (self.connectionLogo.src !== remoteLogo) self.connectionLogo.src = remoteLogo;
      if (stg.isRemote() && isConnected) {
        stg.remote.getUserName().then( function(userName) {
          // TODO: check for race?
          document.getElementByName("connection-content").setAttribute("title", "As " + userName);
        });
      }
    }
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
        if (elem.spinners >= 1) Util.addClassName(elem,"spin");
      }, elem.spinDelay );
    }
    else if (!enable && elem.spinners === 1) {
      Util.removeClassName(elem,"spin");
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

    self.asyncMadoko = new Util.AsyncRunner( self.refreshRate, showSpinner, 
      function() {
        var changed = self.changed;
        self.changed = false;
        self.stale = self.stale || changed;
        self.storage.setEditPosition( self.editName, self.editor.getPosition() );
        if (!self.stale) return false;

        if (!self.refreshContinuous && self.lastEditChange) {
          if (Date.now() - self.lastEditChange < 1000) {
            return false;
          }
        }
        return true;
      },
      function(round) {
        self.localSave(true); // minimal save
        self.stale = false;
        if (!self.runner) return cont();
        if (self.editName === self.docName) {
          self.docText = self.getEditText();
        }
        return self.runner.runMadoko(self.docText, {docname: self.docName, round: round, time0: Date.now() }).then( function(res) {
              self.htmlText = res.content; 
              var quick = self.viewHTML(res.content, res.ctx.time0);
              if (res.runAgain) {
                self.stale=true;              
              }
              if (res.runOnServer && self.allowServer && self.asyncServer 
                    && self.lastMathDoc !== res.mathDoc) { // prevents infinite math rerun on latex error
                self.lastMathDoc = res.mathDoc;
                self.asyncServer.setStale();
              }
              if (!res.runAgain && !res.runOnServer && !self.stale) {
                Util.message("ready", Util.Msg.Status);
                self.removeDecorations(false,"error");
              }
              self.removeDecorations(false,"merge");
              self.showConcurrentUsers( true );
              
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

    self.asyncServer = new Util.AsyncRunner( self.serverRefreshRate, function(enable) { self.showSpinner(enable, self.exportSpinner) }, 
      function() { return false; },
      function(round) {
        //self.lastMathDoc = self.getMathDoc();
        var ctx = {
          docname: self.docName, 
          round:round,
          showErrors: function(errs) { self.showErrors(errs,false); },
        };
        return self.runner.runMadokoServer(self.docText, ctx ).then( 
          function(ctx) {
            // self.asyncServer.clearStale(); // stale is usually set by intermediate madoko runs
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
    var cap = /[#&\?]url=(https?:\/\/[^=&#;]+)/.exec(window.location.hash);
    if (cap) {
      var url = Util.dirname(cap[1]);
      var doc = Util.basename(cap[1]);
      return self.checkSynced( function() {
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
        return self.withSyncSpinner( function() {
          return stg.readFile(docName, false);
        }).then( function(file) {           
          if (self.storage) {
            self.storage.destroy(); // clears all event listeners
            self.viewHTML( "<p>Rendering...</p>", Date.now() );
            //self.storage.clearEventListener(self);
          }
          self.storage = stg;
          self.docName = docName;
          self.docText = file.content;
          
          self.storage.addEventListener("update",self);
          self.runner.setStorage(self.storage);
          /*
          var remoteLogo = self.storage.remote.logo();
          var remoteType = self.storage.remote.type();
          var remoteMsg = (remoteType==="local" ? "browser local" : remoteType);
          self.remoteLogo.src = "images/dark/" + remoteLogo;
          self.remoteLogo.title = "Connected to " + remoteMsg + " storage";        
          */
          self.editName = "";
          return self.editFile(self.docName).always( function() { self.setStale(); } ).then( function() { return fresh; });
        });
      });
    });
  }

  UI.prototype.initializeStorage = function(stg,docName,cont) {
    var self = this;
    var cap = /[#&]template=([^=&#;]+)/.exec(window.location.hash);
    if (cap) window.location.hash = "";
    if (cap || !stg) {
      return (stg && !stg.isSynced() ? Storage.discard(stg,docName) : Promise.resolved(true)).then( function(discard) {
        if (!discard) return cont(stg,docName);

        // initialize fresh from template
        docName = "document.mdk";
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

  UI.prototype.editFile = function(fpath,pos) {
    var self = this;
    var loadEditor;
    self.state = State.Loading;            
    if (fpath===self.editName) loadEditor = Promise.resolved(null) 
     else loadEditor = self.spinWhile(self.syncer, self.storage.readFile(fpath, false)).then( function(file) {       
            self.hideDecorations();
            self.showConcurrentUsers(false,"none");
            if (self.editName === self.docName) {
              self.docText = self.getEditText();
            }
            var mode = Monaco.Editor.getOrCreateMode(file.mime).then( function(md) {
              if (md) return md;
              return Monaco.Editor.getOrCreateMode("text/plain");
            });
            var options = {
              readOnly: !Storage.isEditable(file),
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
            return Storage.getEditPosition(file);
      });
    return loadEditor.then( function(posx) {      
      if (!pos) pos = posx;
      if (pos) {
        self.editor.setPosition(pos, true, true );
        //self.editor.revealPosition( pos, true, true );
      }
      self.showDecorations();
      self.showConcurrentUsers(false);
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
      var stg = Storage.unpersistStorage(json.storage);
      return self.setStorage( stg, docName ).then( function(fresh) {
        if (fresh) return; // loaded template instead of local document
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
    var mime = Util.mimeFromExt(fname);
    if (fname && !(mime === "text/madoko" || mime==="text/markdown") ) return Util.message("only markdown (.mdk) files can be selected",Util.Msg.Error);      
    return self.setStorage( storage, fname );
  }


  UI.prototype.displayFile = function(file,extensive) {
    var disable = (Storage.isEditable(file) ? "" : " disable");
    var icon = "<span class='file-status'>" + (file.modified? "&bull;" : "") + "</span>";
    var span = "<span class='file " + file.mime.replace(/[^\w]+/g,"-") + disable + "'>" + Util.escape(file.path) + icon + "</span>";
    var extra = "";
    if (extensive) {
      if (Storage.isEditable(file)) {
        var matches = file.content.replace(/<!--[\s\S]*?-->/,"").match(/[^\d\s~`!@#$%^&\*\(\)\[\]\{\}\|\\\/<>,\.\+=:;'"\?]+/g);
        var words   = matches ? matches.length : 0;
        if (words >= 0) {
          extra = "<span class='file-size'>" + words.toFixed(0) + " words</span>";
        }
      }
      else {
        var len = file.content.length;
        if (file.encoding === Storage.Encoding.Base64) len = (len/4)*3;
        var kb = (len + 1023)/1024; // round up..
        if (kb >= 0) {
          extra = "<span class='file-size'>" + kb.toFixed(0) + " kb</span>";
        }
      }
      if (file.shareUrl) {
        var linkText = "share" // <span style=\"font-family:'Segoe UI Symbol',Symbola\">&#x1F517;</span>
        extra = extra + "<a class='external file-share' target='_blank' title='Shared link' href='" + file.shareUrl + "'>" + linkText + "</a>"
      }
      if (Util.startsWith(file.mime,"image/")) {
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
          var disable = (Storage.isEditable(file) ? "": " disable");
          var main    = (file.path === self.docName ? " main" : "");
          var hide    = ""; // (Util.extname(file.path) === ".dimx" ? " hide" : "");
          var line = "<div data-file='" + Util.escape(file.path) + "' " +
                        "class='button file hoverbox" + disable + main + hide + "'>" + 
                            self.displayFile(file,true) + "</div>";
          if (Util.startsWith(file.mime,"image/")) images.push(line); 
          else if (!disable) files.push(line);
          else if (Util.stemname(self.docName) === Util.stemname(file.path) && (ext===".pdf" || ext===".html")) finals.push(line)
          else generated.push(line)
        }
      });
    };
    
    /*
    var dir = document.getElementById("edit-select-directory");
    if (dir) {
      dir.innerHTML = "<img src='images/" + self.storage.remote.logo() + "'/> " + 
                        Util.escape( self.storage.folder() ) + "<hr/>";
    }
    */
    div.innerHTML = 
      files.sort().join("\n") + 
      (finals.length > 0 ? "<hr/><div class='exported'>" + finals.sort().join("\n") + "</div>" : "") +
      (images.length > 0 || generated.length > 0 ? 
          "<hr/><div class='binaries'>" + images.sort().join("\n") + generated.sort().join("\n") + "</div>" : "");
  }


  /*---------------------------------------------------
    Concurrent users
  -------------------------------------------------- */
  UI.prototype.showConcurrentUsers = function(quick, edit) {
    var self = this;
    if (!self.storage.isRemote() || !self.allowServer) {  // unconnected storage (null or http)
      self.usersStatus.className = "";
      return; 
    }
    else if (quick && self.usersStatus.className === "") {  // don't do a get request for a quick check
      return;
    }
    else if (edit==="none") {
      self.usersStatus.className = "";
    }
    else if (!edit) {
      edit = (self.storage && self.storage.isModified(self.editName)) ? "write" : "read";
    }

    var files = {};
    var docFile = self.storage.getSharedPath(self.docName);
    var editFile = self.storage.getSharedPath(self.editName);
    if (!editFile || !docFile) return;
    docFile = docFile + "*"; // special name for overall document
    files[docFile] = edit;
    files[editFile] = edit;
    var body = {
      files: files,
    };

    self.lastConUsersCheck = Date.now();
    Util.requestPOST( "/rest/edit", {}, body ).then( function(data) {
      var res = data[docFile];
      if (res && edit !== "none") {
        if (res && res.writers > 0) {
          self.usersStatus.className = "users-write";
        }
        else if (res && res.readers > 0) {
          self.usersStatus.className = "users-read";        
        }
        else {
          self.usersStatus.className = "";
        }
      }
    });
  }


  /*---------------------------------------------------
    Generating HTML & PDF
  -------------------------------------------------- */


  function _saveUserContent( name, mime, content, tryOpenFirst ) {
    // blob is created in our origin; 
    // so we should make sure a user can only save, not open a window in our domain
    // since a html page could read our local storage or do rest calls with our cookie.
    // (this could be problem if a user opens a document with 'evil' content)

    var blob = new Blob([content], { type: mime });
    var url  = URL.createObjectURL(blob);
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
      window.open(url,name);
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
      return "<span class='save-link' data-path='" + Util.escape(path) + "' data-mime='" + Util.escape(mime) + "'>" + msg + "</span>"; 
    });
  }

  UI.prototype.saveUserContent = function( path, mime ) {
    var self = this;
    if (!mime) mime = Util.mimeFromExt(path);
    var content = self.storage.readLocalRawContent( path );
    return Promise.resolved( _saveUserContent( Util.basename(path), mime, content ) );
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
    return self.spinWhile( self.exportSpinner, 
      self.runner.runMadokoServer( self.docText, ctx ).then( function(errorCode) {
        if (errorCode !== 0) throw ("PDF generation failed: " + ctx.message);
        var name = "out/" + Util.changeExt(self.docName,".pdf");
        return self._synchronize().then( function() {
          var link = self.getViewLink(name,"application/pdf");
          if (link) {
            Util.message( { message: "PDF exported", link: link }, Util.Msg.Status );
          }
          else { 
            return self.saveUserContent( name, "application/pdf" ).then( function() {
              Util.message( "PDF exported", Util.Msg.Status );
            });
          }
        });
      })
    );
  }


  UI.prototype.generateHtml = function() {
    var self = this;
    return self.spinWhile( self.exportSpinner, 
      self.runner.runMadokoLocal( self.docName, self.docText ).then( function(content) {
        var name = "out/" + Util.changeExt(self.docName,".html");
        self.storage.writeFile( name, content );
        return self._synchronize().then( function() {
          var link = self.getViewLink(name,"text/html");
          if (link) {
            Util.message( { message: "HTML exported", link: link }, Util.Msg.Status );
          }
          else {            
            return self.saveUserContent( name, "text/html" ).then( function() {
              Util.message( "HTML exported", Util.Msg.Status );
            });
          }
        });
      })
    );
  }


  UI.prototype.generateSite = function() {
    var self = this;
    return self.spinWhile( self.exportSpinner, 
      self.runner.runMadokoLocal( self.docName, self.docText ).then( function(content) {
        var name = "out/" + Util.changeExt(self.docName,".html");
        self.storage.writeFile( name, content );
        return Storage.publishSite( self.storage, self.docName, name );
      })
    );
  }


  /*---------------------------------------------------
    Editor operations
  -------------------------------------------------- */


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
      var rng = new Range.Range( res.startLine, 0, res.endLine, res.endColumn );
      var command = new ReplaceCommand.ReplaceCommandWithoutChangingPosition( rng, res.text );
      self.editor.executeCommand("madoko",command);
    }
  }

  function findMetaPos( text ) {
    var lineNo = 1;
    var reMeta = /^(?:@(\w+)[ \t]+)?((?:\w|([\.#~])(?=\S))[\w\-\.#~, \t]*?\*?)[ \t]*[:].*\r?\n(?![ \t])|\[INCLUDE\b[^\]]*\][ \t]*\r?\n/;
    var cap;
    while ((cap = reMeta.exec(text))) {
      text = text.substr(cap[0].length);
      lineNo++;
    }
    return lineNo;
  }

  /*---------------------------------------------------
    Edit toolbox
  -------------------------------------------------- */
  var tools = [
    { name    : "bold", 
      icon    : true,
      content : "bold text",
      keys    : ["Ctrl-B","Alt-B"],
      replacer: function(txt) { 
                  return "**" + txt + "**"; 
                },
    },
    { name    : "italic", 
      icon    : true,
      content : "italic text",
      keys    : ["Ctrl-I","Alt-I"],
      replacer: function(txt) { 
                  return "_" + txt + "_"; 
                },
    },
    { name    : "code", 
      icon    : true,
      title   : "Inline code",
      content : "code",
      keys    : ["Alt-C"],
      replacer: function(txt) { 
                  return "`" + txt + "`"; // TODO: make smart about quotes 
                },
    },
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
    { name    : "formula", 
      icon    : true,
      title   : "Inline formula",
      content : "e = mc^2",
      keys    : ["Alt-F"],
      replacer: function(txt) { 
                  return "$" + txt + "$"; 
                },
    },
    { name    : "sub", 
      icon    : true,
      title   : "Sub-script",
      content : "subscript",
      replacer: function(txt) { 
                  return "~" + txt.replace(/~/g,"\\~").replace(/ /g,"\\ ") + "~"; 
                },
    },
    { name    : "super", 
      icon    : true,
      title   : "Super-script",
      content : "super script",
      replacer: function(txt) { 
                  return "^" + txt.replace(/\^/g,"\\^").replace(/ /g,"\\ ") + "^"; 
                },
    },
    { name    : "font", 
      icon    : true,
      title   : "Change the font family",
      options : [
        toolFontFamily("serif"),
        toolFontFamily("sans-serif"),
        toolFontFamily("monospace"),
        toolFontFamily("normal"),
        toolCss("font-variant","small-caps"),
      ]
    },
    { name    : "fontsize", 
      icon    : true,
      title   : "Change the font size",
      options : [
        toolFontSize("xx-small"),
        toolFontSize("x-small"),
        toolFontSize("small"),
        toolFontSize("medium"),
        toolFontSize("large"),
        toolFontSize("x-large"),
        toolFontSize("xx-large"),
        toolFontSize("50%"),
        toolFontSize("2ex"),
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
      content : "The conceptual structure is called\n    the abstract syntax of the language.\nConcrete syntax\n  ~ The particular details and rules for writing expressions as strings \n    of characters is called the concrete syntax.\n  ~ Perhaps some other meaning too?",
      replacer: function(txt,rng) {
        return blockRange(rng,paraPrefix("Definition\n  ~ ",txt,"    "));
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
    { name    : "img", 
      icon    : true,
      title   : "Insert an image",
      content : "",
      upload  : "Please select an image.",
      exts    : [".jpg",".png",".svg",".gif"],
    },   
    toolFigure(true),
    { element: "BR",
    },
    { name    : "custom",
      display: "Custom",
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
          content: "The footnote text.\nIndent to continue on the next line.",
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
            return txt + blockRange(rng, content);
          }
        },
        customBlock("note"),
        customBlock("remark"),
        customBlock("example"),
        customBlock("abstract","", "The abstract."),
        customBlock("framed","","A block with a solid border."),
        customBlock("center","","A block with centered items."),
        customBlock("columns","","~~ Column { width=\"30%\" }\nThe first column\n~~\n~~ Column\nThe second column.\n~~"),
      ]
    },
    { name: "math",
      title: "Insert a math block",
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
    { name: "include",
      title: "Include a local file",
      options: [
        { name    : "Image", 
          title   : "Insert an image",
          helpLink: "#sec-image",
          upload  : "Please select an image.",
          exts    : [".jpg",".png",".svg",".gif"],
        },
        { name    : "Markdown", 
          title   : "Include another markdown file",
          upload  : "Please select a markdown file.",
          exts    : [".mdk",".md",".mkdn"],
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
          upload  : "Please select a CSS style file (.css).",
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
    },
    { name: "metadata",
      title: "Add document metadata",
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
        { element: "HR" },
        toolMetadata("Css", "example.css", "Specify a style file or reference to include in the HTML output"),
        toolMetadata("Script", "example.js", "Specify a script file or reference to include in the HTML output"),
        toolMetadata("HTML Meta", "http-equiv=\"refresh\" content=\"30\"", "Specify a meta tag for HTML output"),
        toolMetadata("HTML Header", "", "This value is included literally in the <head> section of HTML output"),
        { element: "HR" },
        toolMetadata("Doc Class", "[9pt]article", "Specify the LaTeX document class. Use the 'Include' menu to include a specific local document class file."),
        toolMetadata("Package", "pgfplots", "Specify a standard LaTeX package to use. Use the 'Include' menu to include a specific local package file","#sec-math"),
        toolMetadata("Tex Header", "", "The value is included literally before \\begin{document}. in the LaTeX output"),
        { element: "HR" },
        toolMetadata("Math Dpi", "300", "Specify the resolution at which math is rendered."),
        toolMetadata("Math Scale", "108", "Specify the scale math is rendered."),
        toolMetadata("Math Embed", "512", "Specify up to which size (in Kb) math is rendered in-place (instead of a separate image)"),
      ]

    }  

  ];

  function toolFontFamily(fam) {
    return toolCss("font-family",fam);
  }

  function toolFontSize(size) {
    return toolCss("font-size",size);
  }

  function toolCss(attr,value) {
    return {
      name: value,
      display: value,
      helpLink: "#sec-css",
      content: "text",
      replacer: function(txt,rng) {
        return "[" + txt + "]{" + attr + "=\"" + value + "\"}";
      }
    }
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
      item.className = "button";
      if (tool.icon===true) tool.icon = "images/icon-tool-" + tool.name + ".png";
      if (!tool.display) tool.display = Util.capitalize(tool.name);
      if (!tool.title) tool.title = tool.display;
      if (tool.exts) {
        tool.title = tool.title + " (" + tool.exts.join(",") + ")";
      }
      item.title = tool.title || tool.display;
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
    if (tool.options) {
      Util.addClassName(item,"popup");        
      Util.addClassName(item,"options");        
      if (!tool.icon) Util.addClassName(item,"named");
      var menu = document.getElementById(item.id + "-content");
      if (!menu) {
        menu = document.createElement("DIV");
        menu.id = item.id + "-content";
        item.appendChild(menu);
      }
      Util.addClassName(menu,"menu");
      Util.addClassName(menu,"boxed");
      tool.options.forEach(function(subtool) {
        self.initTool(subtool,menu,parentName + "-" + tool.name);
      });
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
  }

  UI.prototype.toolCommand = function( tool ) {
    var self = this;
    if (!tool) return;
    self.anonEvent( function() {
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
        return Storage.upload(self.storage, msg, tool.header || "Upload", "images/dark/icon-upload.png").then( function(files) {
          return self.insertFiles(files);
        });
      }
    }, [State.Syncing]);      
  }


  /*---------------------------------------------------
    File and text insertion
  -------------------------------------------------- */

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
    var model = self.editor.getModel();
    var txt = (select.isEmpty() ? defText : model.getValueInRange(select) );
    var newText = replacer.call(self,txt,select);
    if (newText != null) {
      var command = new ReplaceCommand.ReplaceCommandWithoutChangingPosition( select, newText );
      self.editor.executeCommand("madoko",command);
    }
  }


  // Insert some text in the document 
  UI.prototype.insertText = function( txt, pos ) {
    var self = this;
    if (!pos) pos = self.editor.getPosition(); 
    var rng = new Range.Range( pos.lineNumber, pos.column, pos.lineNumber, pos.column );
    var command = new ReplaceCommand.ReplaceCommandWithoutChangingPosition( rng, txt );
    self.editor.executeCommand("madoko",command);
  }

  UI.prototype.insertFile = function(file, content, encoding, mime, pos ) {
    var self = this;
    if (pos) pos.column = 0;
    var ext  = Util.extname(file.name);
    var stem = Util.stemname(file.name);
    var name = Util.basename(file.name);      
    if (Util.startsWith(mime,"image/")) name = "images/" + name;    
    if (encoding===Storage.Encoding.Base64) {
      var cap = /^data:([\w\/\-]+);(base64),([\s\S]*)$/.exec(content);
      if (!cap) {
        Util.message("invalid base64 encoding", Util.Msg.Error );
        return;
      }
      content = cap[3];  
    }
    if (content.length >= 500*1024) {
      throw new Error("file size is too large (maximum is about 384kb)");
    }

    self.storage.writeFile( name, content, {encoding:encoding,mime:mime});
    
    var text = "";
    if (Util.startsWith(mime,"image/")) {
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
        text="Bib Style   : " + Util.stemname(name);
      }
      else if (ext===".cls") {
        text="Doc Class   : " + Util.basename(name);
      }
      else if (ext===".sty" || ext===".tex") {
        text="Package     : " + Util.stemname(name);
      }
      else {
        Util.message( "unsupported drop file extension: " + ext, Util.Msg.Info );
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
    if (!pos) pos = self.editor.getPosition();
    for (var i = 0, f; f = files[i]; i++) {      
      var encoding = Storage.Encoding.fromExt(f.name);      
      var mime = f.type || Util.mimeFromExt(f.name);
      if (!(Util.startsWith(mime,"image/") || Util.isTextMime(mime))) { // only images or text..
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
            changeAccessor.removeDecoration(decoration.id);
            decoration.id = null;          
          }
        }
        else {
          newdecs.push(decoration);
          decoration.outdated = true;
          if (decoration.id && decoration.range.fileName === self.editName) {
            changeAccessor.changeDecorationOptions(decoration.id,{
              isWholeLine: true,
              glyphMarginClassName: 'glyph-' + decoration.type + '.outdated',
              linesDecorationsClassName: 'line-' + decoration.type + '.outdated',
            });
          }
          else if (decoration.id) {
            changeAccessor.removeDecoration(decoration.id);
            decoration.id = null;          
          }
        }
      });
      self.decorations = newdecs;
    });    
  }

  UI.prototype.hideDecorations = function() {
    var self = this;
    self.editor.changeDecorations( function(changeAccessor) {
      self.decorations.forEach( function(decoration) {
        if (decoration.id) {
          changeAccessor.removeDecoration( decoration.id );
          decoration.id = null;
        }
      });
    });
  }

  UI.prototype.showDecorations = function() {
    var self = this;
    self.editor.changeDecorations( function(changeAccessor) {
      self.decorations.forEach( function(decoration) {
        if (decoration.id) {
          changeAccessor.removeDecoration( decoration.id );
          decoration.id = null;
        }
        if (decoration.range.fileName === self.editName) {
          var postfix = decoration.type + (decoration.outdated ? ".outdated" : "" );
          decoration.id = changeAccessor.addDecoration( decoration.range, 
            { isWholeLine: true,
              glyphMarginClassName: 'glyph-' + postfix,
              linesDecorationsClassName: 'line-' + postfix
            }
          );            
        }
      });
    });
  }

  UI.prototype.showErrors = function( errors, sticky ) {
    var self = this;
    
    var decs = [];
    errors.forEach( function(error) {
      if (!error.range.fileName) error.range.fileName = self.editName;
      decs.push( { 
        id: null, 
        type: "error",
        sticky: sticky, 
        outdated: false, 
        message: error.message, 
        range: error.range,
        expire: 0, // does not expire
      });
      var msg = "error: " + error.range.fileName + ":" + error.range.startLineNumber.toString() + ": " + error.message;
      Util.message( msg, Util.Msg.Error );
    });

    self.removeDecorations(true,"error");
    self.addDecorations(decs);
  }

  UI.prototype.showMerges = function( merges ) {
    var self = this;
    var decs = [];
    var now = Date.now();
    merges.forEach( function(merge) {
      if (!merge.path) merge.path = self.editName;
      decs.push( { 
        id: null, 
        type: "merge.merge-" + merge.type,
        sticky: true, 
        outdated: false, 
        expire: now + (60000), // expire merges after 1 minute?
        message: "Merged (" + merge.type + ")" + (merge.content ? ":\n\"" + merge.content + "\"": ""), 
        range: {
          fileName: merge.path,
          startLineNumber: merge.startLine,
          endLineNumber: merge.endLine,
          startColumn: 1,
          endColumn: 1,
        } 
      });
      self.removeDecorations(false,"merge");
      self.addDecorations(decs);      
    });
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
          if (dec.range.fileName === dec2.range.fileName && dec.range.startLineNumber <= dec2.range.endLineNumber && dec.range.endLineNumber >= dec2.range.startLineNumber) {
            if (!dec.outdated && dec2.outdated) {
              // swap, so we remove the outdated one
              self.decorations[j] = dec;
              dec = dec2;
              dec2 = self.decorations[j];
            }
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

  UI.prototype.getDecorationMessage = function( fileName, lineNo ) {
    var self = this;
    if (!fileName) fileName = self.editName;
    for (var i = 0; i < self.decorations.length; i++) {
      var dec = self.decorations[i];
      if (dec.range.fileName === fileName && dec.range.startLineNumber <= lineNo && dec.range.endLineNumber >= lineNo) {
        return dec.message;
      }
    }    
    return "";
  }


  /* --------------------------------------------------------------
     View synchronization 
  -------------------------------------------------------------- */
  
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

  UI.prototype.saveTo = function() {
    var self = this;    
    return Storage.saveAs(self.storage,self.docName).then( function(res) {
      if (!res) throw new Error("cancel"); 
      return self.setStorage(res.storage,res.docName).then( function() {
        return res.docName;
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

  UI.prototype.synchronize = function(login) {
    var self = this;
    return self.event( "", "", State.Syncing, function() {
      if (!self.isConnected && login) {
        return self.login().then( function() {  
          return self._synchronize(); 
        });
      }
      else {
        return self._synchronize();
      }
    });
  }

  UI.prototype._synchronize = function() {
    var self = this;
    self.lastSync = Date.now();
    if (self.storage) {
      self.localSave();
      var cursors = {};        
      var line0 = self.editor.getPosition().lineNumber;
      cursors["/" + self.docName] = line0;
      self.showConcurrentUsers(false);
      return self.withSyncSpinner( function() {
        return self.storage.sync( diff, cursors, function(merges) { self.showMerges(merges); } ).then( function() {
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

  // object    
  return UI;
})();

// module
return UI;
}); 