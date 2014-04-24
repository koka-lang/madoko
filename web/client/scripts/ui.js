/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/merge","../scripts/promise","../scripts/util","../scripts/storage","../scripts/madokoMode"],
        function(merge,Promise,util,storage,madokoMode) {

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
  if (ext===".mdk") return "mdk";
  else if (ext===".md") return "text/x-web-markdown";
  else if (ext===".js") return "text/javascript";
  else if (ext===".css") return "text/css";
  else if (ext===".html") return "text/html";
  else return "text/plain";
}

var UI = (function() {

  function UI( runner )
  {
    var self = this;
    self.editor  = null;
    
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
    self.text0 = "";
    self.docText = "";
    self.htmlText = "";

    Monaco.Editor.createCustomMode(madokoMode.mode);
    window.onbeforeunload = function(ev) { 
      if (self.storage.isSynced()) return;
      if (self.localSave()) return; 
      var message = "Changes to current document have not been saved yet!\n\nIf you leave this page, any unsaved work will be lost.";
      (ev || window.event).returnValue = message;
      return message;
    };

    self.initUIElements("");
    
    self.localLoad().then( function() {
      // Initialize madoko and madoko-server runner    
      self.initRunners();
    }).then( function() { }, function(err) {
      util.message(err, util.Msg.Error);          
    });
  }

  UI.prototype.onError  = function(err) {
    var self = this;
    util.message( err, util.Msg.Error );
  }

  UI.prototype.event = function( status, action ) {
    var self = this;
    try {
      var res = action();
      if (res && res.then) {
        res.then( function() {
          if (status) util.message( message, util.Msg.Status);
        }, function(err) {
          self.onError(err);
        });
      }
    }
    catch(exn) {
      self.onError(exn);
    }
  }

  UI.prototype.initUIElements = function(content) {
    var self = this;

    // common elements
    self.spinner = document.getElementById("view-spinner");    
    self.syncer  = document.getElementById("sync-spinner");  
    self.syncer.spinDelay = 1;  
    self.view    = document.getElementById("view");
    self.editSelectHeader = document.getElementById("edit-select-header");
    self.remoteLogo = document.getElementById("remote-logo");
    self.inputRename = document.getElementById("rename");

    // start editor
    var checkLineNumbers = document.getElementById('checkLineNumbers');
    self.editor = Monaco.Editor.create(document.getElementById("editor"), {
      value: content,
      mode: "mdk",
      theme: "vs",
      lineNumbers: (checkLineNumbers ? checkLineNumbers.checked : false),
      //mode: madokoMode.mode,
      tabSize: 4,
      insertSpaces: true,
      //wrappingColumn: 80,
      automaticLayout: true,
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
        var scrolled = self.syncView(); 
        if (!scrolled) {
          clearInterval(self.syncInterval);
          self.syncInterval = 0;
        }      
      }

      // use interval since the editor is asynchronous, this way  the start line number can stabilize.
      if (!self.syncInterval) {
        self.syncInterval = setInterval(scroll, 25);
        //scroll();
      }
    });
     
    // Buttons and checkboxes
    checkLineNumbers.onchange = function(ev) { 
      if (self.editor) {
        self.editor.updateOptions( { lineNumbers: ev.target.checked } ); 
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

    view.ondblclick = function(ev) {
      self.syncEditor(ev.target);
    }

    document.getElementById("load-onedrive").onclick = function(ev) {
      self.checkSynced().then( function() {
        return storage.onedriveOpenFile();        
      }).then( function(res) { 
        return self.openFile(res.storage,res.docName); 
      }).then( function() {
        util.message("loaded: " + self.docName, util.Msg.Status);
      }, function(err){ 
        self.onError(err); 
      });
    };

    document.getElementById("sync-onedrive").onclick = function(ev) {
      self.syncTo( storage.syncToOnedrive );
    }

    document.getElementById("new-document").onclick = function(ev) {
      self.checkSynced().then( function() {
        return self.openFile(null,null);
      }).then( function() {
        util.message("created new local document: " + self.docName, util.Msg.Status);
      }, function(err){ 
        self.onError(err); 
      });
    }

    document.getElementById("export-html").onclick = function(ev) {
      self.event( "HTML exported", function() { return self.generateHtml(); } );

//      util.downloadText(util.changeExt(util.basename(self.docName),".html"), self.htmlText);
    }

    document.getElementById("export-pdf").onclick = function(ev) {
      self.event( "PDF exported", function() { return self.generatePdf(); } );
    }

    /* document.getElementById("load-local").onclick = function(ev) {
      storage.localOpenFile().then( function(res) { return self.openFile(res.storage,res.docName); } )
        .then( undefined, function(err){ self.onError(err); } );
    };

    document.getElementById("sync-local").onclick = function(ev) {
      self.syncTo( storage.syncToLocal );
    }
    */
    document.getElementById("clear-local").onclick = function(ev) {
      if (localStorage) {
        localStorage.clear();
        util.message("local storage cleared", util.Msg.Status);
      }
    };

    document.getElementById("edit-select").onmouseenter = function(ev) {
      self.editSelect();
    };   
       
    document.getElementById("edit-select-content").onclick = function(ev) {
      self.event( null, function() {
        var elem = ev.target;
        while(elem && elem.nodeName !== "DIV") {
          elem = elem.parentNode;
        }
        if (elem && elem.dataset && elem.dataset.file) {
          var path = elem.dataset.file;
          self.editFile(path).then(undefined, function(err){ self.onError(err); });
        }
      });
    };   
   
    document.getElementById("sync").onclick = function(ev) 
    {      
      if (self.storage) {
        var cursors = {};        
        var pos = self.editor.getPosition();
        cursors["/" + self.docName] = pos.lineNumber;
        self.showSpinner(true,self.syncer);    
        self.storage.sync( diff, cursors ).then( function() {
          pos.lineNumber = cursors["/" + self.docName];
          self.editor.setPosition(pos);
          self.localSave();
        }).then( function() {          
          self.showSpinner(false,self.syncer);    
          util.message("synced", util.Msg.Status);
        }, function(err){ 
          self.showSpinner(false,self.syncer);    
          self.onError(err); 
        });
      }
    };

    
    // narrow and wide editor panes
    var editpane = document.getElementById("editorpane");
    var viewpane = document.getElementById("viewpane");
    var buttonEditorNarrow = document.getElementById("button-editor-narrow");
    var buttonEditorWide   = document.getElementById("button-editor-wide");

    viewpane.addEventListener('transitionend', function( event ) { 
      self.syncView(); 
    }, false);
    
    var wideness = 0; // < 0 = editor narrow, > 0 = editor wide
    buttonEditorWide.onclick = function(ev) {
      if (wideness < 0) {
        util.removeClassName(viewpane,"wide");
        util.removeClassName(editpane,"narrow");
        util.removeClassName(buttonEditorNarrow,"hide");
        wideness = 0;
      }
      else {
        util.addClassName(viewpane,"narrow");
        util.addClassName(editpane,"wide");
        util.addClassName(buttonEditorWide,"hide");      
        wideness = 1;
      }
      if (!supportTransitions) setTimeout( function() { self.syncView(); }, 100 );
    }
    buttonEditorNarrow.onclick = function(ev) {
      if (wideness > 0) {
        util.removeClassName(viewpane,"narrow");
        util.removeClassName(editpane,"wide");
        util.removeClassName(buttonEditorWide,"hide");
        wideness = 0;
      }
      else {
        util.addClassName(viewpane,"wide");
        util.addClassName(editpane,"narrow");
        util.addClassName(buttonEditorNarrow,"hide");      
        wideness = -1;
      }
      if (!supportTransitions) setTimeout( function() { self.syncView(); }, 100 );
    }

  }

  UI.prototype.setEditText = function( text, mode ) {
    var self = this;
    self.editor.model.setValue(text,mode);    
    self.text0 = text;
    self.text  = text;
    self.setStale();
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
    return {
      start: i,
      end0: end0,
      end1: end1,
      text0: text0.substring(i,end0),
      text1: text1.substring(i,end1),
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

  UI.prototype.viewHTML = function( html, time0 ) {
    var self = this;
    
    function updateFull() {
      self.html0 = html;
      self.view.innerHTML = html;
      self.syncView();
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
      var elem = findTextNode( self.view, oldSpan.textContent );
      if (!elem) return updateFull();
      // yes!
      //util.message("  quick view update", util.Msg.Info);
      elem.textContent = newSpan.textContent;
      self.html0 = html;      
      return true;
    }
    else {
      updateFull();
    }  

  }

  UI.prototype.showSpinner = function(enable, elem) {
    var self = this;
    if (!elem) elem = self.spinner; // default spinner
    if (elem.spinners == null) elem.spinners = 0;
    if (elem.spinDelay == null) elem.spinDelay = self.refreshRate * 1.5;

    if (enable && elem.spinners === 0) {      
      setTimeout( function() {
        if (elem.spinners >= 1) util.addClassName(elem,"spin");
      }, elem.spinDelay );
    }
    else if (!enable && elem.spinners === 1) {
      util.removeClassName(elem,"spin");
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
        var text = self.getEditText();
        
        if (text != self.text0) {   
          self.stale = true;
          self.text0 = text;
          if (!self.refreshContinuous) return false; // set stale, but wait until the user stops typing..
        }

        return self.stale;
      },
      function(round) {
        self.localSave(true); // minimal save
        self.stale = false;
        if (!self.runner) return cont();
        if (self.editName === self.docName) {
          self.docText = self.text0;
        }
        return self.runner.runMadoko(self.docText, {docname: self.docName, round: round, time0: Date.now() })
          .then(
            function(res) {
              self.htmlText = res.content; 
              var quick = self.viewHTML(res.content, res.ctx.time0);
              if (res.runAgain) {
                self.stale=true;              
              }
              if (res.runOnServer && self.allowServer && self.asyncServer) {
                self.asyncServer.setStale();
              }
              
              /*
              if (res.avgTime > 1000 && self.refreshRate < 1000) {
                self.refreshRate = 1000;
                self.asyncMadoko.resume(self.refreshRate);
              }
              else if (res.avgTime < 750 && self.refreshRate >= 1000) {
                self.refreshRate = 500;
                self.asyncMadoko.resume(self.refreshRate);
              }
              */
              
              if (res.avgTime > 300) {
                self.refreshContinuous = false;
                self.checkDelayedUpdate.checked = true;
              }
              else if (res.avgTime < 200) {
                self.refreshContinuous = true;
                self.checkDelayedUpdate.checked = false;
              }
              

              return ("update: " + res.ctx.round + (quick ? "  (quick view update)" : "") + "\n  avg: " + res.avgTime.toFixed(0) + "ms");                                                        
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
        return self.runner.runMadokoServer(self.text0, {docname: self.docName, round:round}).then( 
          function(ctx) {
            self.asyncServer.clearStale(); // stale is usually set by intermediate madoko runs
            self.allowServer = false; // TODO: hack to prevent continuous updates in case the server output it not as it should (say a latex error)
            // run madoko locally again using our generated files
            return self.asyncMadoko.run(true).always( function(){
              self.allowServer = !self.checkDisableServer.checked;
            });               
          },
          function(err) {
            self.onError(err);            
          }
        );
      }
    );
  }

  UI.prototype.localSave = function(minimal) {
    var self = this;
    var text = self.getEditText();
    var pos  = self.editor.getPosition();
    self.storage.writeFile( self.editName, text );
    var json = { docName: self.docName, editName: self.editName, pos: pos, storage: self.storage.persist(minimal) };
    return localStorageSave("local", json, 
      (minimal ? undefined : function() {
        json.storage = self.storage.persist(true); // persist minimally
        return json;
      }));
  }

  UI.prototype.setStorage = function( stg, docName ) {
    var self = this;
    if (stg == null) {
      // initialize fresh
      docName = "document.mdk";
      stg = new storage.Storage(new storage.NullRemote());
      var content = document.getElementById("initial").textContent;
      stg.writeFile(docName, content);
    }
    self.showSpinner(true);    
    return stg.readFile(docName, false).then( function(file) { 
      self.showSpinner(false );    
        
      if (self.storage) {
        self.storage.clearEventListener(self);
      }
      self.storage = stg;
      self.docName = docName;
      self.editName = docName;
      self.docText = file.content;
      self.inputRename.value = self.docName; 
    
      self.storage.addEventListener("update",self);
      return self.runner.setStorage(self.storage).then( function() {            
        self.setEditText(self.docText);
        self.onFileUpdate(file); 
        var remoteLogo = self.storage.remote.logo();
        var remoteType = self.storage.remote.type();
        var remoteMsg = (remoteType==="local" ? "browser local" : remoteType);
        self.remoteLogo.src = "images/" + remoteLogo;
        self.remoteLogo.title = "Connected to " + remoteMsg + " storage";        
      });
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
    if (fpath===self.editName) loadEditor = Promise.resolved() 
     else loadEditor = self.spinWhile(self.syncer, self.storage.readFile(fpath, false)).then( function(file) {       
            if (self.editName === self.docName) {
              self.docText = self.getEditText();
            }
            self.editName = file.path;
            var mime = getModeFromExt(util.extname(file.path));
            var options = {
              readOnly: file.kind !== storage.File.Text,
              mode: mime,
              //wrappingColumn: (util.extname(file.path)===".mdk" ? 80 : 0)
            };
            self.setEditText(file.content, Monaco.Editor.getOrCreateMode(options.mode));
            self.editor.updateOptions(options);
            
            self.onFileUpdate(file); 
            self.editSelect();
      });
    return loadEditor.then( function() {      
      if (pos) {
        self.editor.setPosition(pos);
        self.editor.revealPosition( pos, true, true );
      }
    });    
  }

  UI.prototype.localLoad = function() {
    var self = this;
    var json = localStorageLoad("local");
    if (json!=null) {
      // we ran before
      var docName = json.docName;
      var stg = storage.unpersistStorage(json.storage);
      return self.setStorage( stg, docName ).then( function() {
        return self.editFile( json.editName, json.pos );
      });
    }
    else {
      return self.setStorage( null, null );
    }
  }

  UI.prototype.checkSynced = function() {
    var self = this;
    if (!self.storage || self.storage.isSynced()) return Promise.resolved();
    var ok = window.confirm( "The current document has not been saved yet!\n\nDo you want to discard these changes?");
    if (!ok) return Promise.rejected("the operation was cancelled");
    return Promise.resolved();
  }

  UI.prototype.openFile = function(storage,fname) {
    var self = this;
    if (fname && !util.endsWith(fname,".mdk")) return util.message("only .mdk files can be selected",util.Msg.Error);      
    return self.setStorage( storage, fname );
  }


  UI.prototype.displayFile = function(file) {
    var icon = "<span class='icon'>" + (file.written ? "&bull;" : "") + "</span>";
    var span = "<span class='file " + file.kind + "'>" + util.escape(file.path) + icon + "</span>";
    return span;
  }

  UI.prototype.editSelect = function() {
    var self = this;
    var files = [];
    var images = [];
    var generated = [];
    var div = document.getElementById("edit-select-content");
      
    self.storage.forEachFile( function(file) {
      if (file) {
        var disable = (file.kind === storage.File.Text ? "" : " disable");
        var main    = (file.path === self.docName ? " main" : "");
        var hide    = (util.extname(file.path) === ".dimx" ? " hide" : "");
        var line = "<div data-file='" + util.escape(file.path) + "' " +
                      "class='button item file" + disable + main + hide + "'>" + 
                          self.displayFile(file) + "</div>";
        if (file.kind === storage.File.Image) images.push(line); 
        else if (file.kind === storage.File.Text) files.push(line);
        else generated.push(line)
      }
    });
    div.innerHTML = 
      files.sort().join("\n") + 
      (images.length > 0 || generated.length > 0 ? 
          "<div class='binaries'>" + images.sort().join("\n") + generated.sort().join("\n") + "</div>" : "");
  }

  UI.prototype.generatePdf = function() {
    var self = this;
    var ctx = { round: 0, docname: self.docName, pdf: true, includeImages: true };
    return self.spinWhile( self.viewSpinner, 
      self.runner.runMadokoServer( self.docText, ctx ).then( function() {
        return util.downloadFile("/rest/download/" + util.changeExt(self.docName,".pdf"));
      }));
  }

  UI.prototype.generateHtml = function() {
    var self = this;
    var ctx = { round: 0, docname: self.docName, pdf: false, includeImages: true };
    return self.spinWhile( self.viewSpinner, 
      self.runner.runMadokoServer( self.docText, ctx ).then( function() {
        return util.downloadFile("/rest/download/" + util.changeExt(self.docName,".html"));
      }));
  }

  /*
    // Insert some text in the document 
    function documentInsert( txt ) {
      var pos = editor.viewModel.cursors.lastCursorPositionChangedEvent.position;
      editor.model._insertText([],pos,txt);
    }

    // Called when a user selects an image to insert.
    function insertImages(evt) {
      var files = evt.target.files; // FileList object

      // files is a FileList of File objects. List some properties.
      for (var i = 0, f; f = files[i]; i++) {
          // Only process image files.
          if (!f.type.match('image.*')) {
            continue;
          }
      
          var reader = new FileReader();

          // Closure to capture the file information.
          reader.onload = (function(file) {
            return function(loadEvt) {
              var content  = loadEvt.target.result;
              var fileName = imgDir + "/" + file.name;
              var name     = stdpath.stemname(file.name); 
              //stdcore.println("image: " + fileName);
              options.imginfos = madoko.addImage(options.imginfos,fileName,content);
              documentInsert( "![" + name + "]\n\n[" + name + "]: " + fileName + ' "' + name + '"\n' );
              //madoko.writeTextFile(file.name,content);
            };
          })(f);

          // Read in the image file as a data URL.
          reader.readAsDataURL(f);
      }
    }
  */

  function findElemAtLine( elem, line, fname ) 
  {
    if (!elem || !line || line < 0) return null;

    var children = elem.children; 
    if (!children || children.length <= 0) return null;

    var current  = 0;
    var currentLine = 0;
    var next     = children.length-1;
    var nextLine = line;
    var found    = false;
    
    for(var i = 0; i < children.length; i++) {
      var child = children[i];
      var dataline = child.getAttribute("data-line");
      if (dataline && !util.contains(child.style.display,"inline")) {
        if (fname) {
          var idx = dataline.indexOf(fname + ":");
          if (idx >= 0) {
            dataline = dataline.substr(idx + fname.length + 1)
          }
          else {
            dataline = ""  // gives NaN to cline
          }
        }
        var cline = parseInt(dataline);
        if (!isNaN(cline)) {
          if (cline <= line) {
            found = true;
            currentLine = cline;
            current = i;
          }
          if (cline > line) {
            found = true;
            nextLine = cline;
            next = i;
            break;
          }
        }
      }
    }

    // go through all children of our found range
    var res = { elem: children[current], elemLine: currentLine, next: children[next], nextLine: nextLine };
    for(var i = current; i <= next; i++) {
      var child = children[i];
      if (child.children && child.children.length > 0) {
        var cres = findElemAtLine(child,line,fname);
        if (cres) {
          found = true;
          res.elem = cres.elem;
          res.elemLine = cres.elemLine;
          if (cres.nextLine > line) { // && cres.nextLine <= res.nextLine) {
            res.next = cres.next;
            res.nextLine = cres.nextLine;
          }
          break; 
        }
      }
    }

    if (!found) return null; // no data-line at all.
    return res;
  }

  function offsetOuterTop(elem) {
    var delta = 0;
    if (window.getComputedStyle) {
      var style = window.getComputedStyle(elem);
      if (style) {
        delta = util.px(style.marginTop) + util.px(style.paddingTop) + util.px(style.borderTopWidth);
      }   
    }
    return (elem.offsetTop - delta);
  }

  UI.prototype.syncView = function( startLine, endLine ) 
  {
    var self = this;
    if (self.lastScrollTop===undefined) self.lastScrollTop = null;

    if (startLine==null) {
      var view  = self.editor.getView();
      var lines = view.viewLines;
      var rng = lines._currentVisibleRange;
      startLine = rng.startLineNumber;
      endLine = rng.endLineNumber;
      //console.log("scroll: start: " + startLine)
    }

    var res = findElemAtLine( self.view, startLine, self.editName === self.docName ? null : self.editName );
    if (!res) return false;
    
    var scrollTop = offsetOuterTop(res.elem) - self.view.offsetTop;
    
    // adjust for line offset
    if (res.elemLine < startLine && res.elemLine < res.nextLine) {
      var scrollTopNext = offsetOuterTop(res.next) - self.view.offsetTop;
      if (scrollTopNext > scrollTop) {
        var delta = (startLine - res.elemLine) / (res.nextLine - res.elemLine);
        scrollTop += ((scrollTopNext - scrollTop) * delta);
      }
    }

    if (scrollTop === self.lastScrollTop) return false;

    self.lastScrollTop = scrollTop;
    util.animate( self.view, { scrollTop: scrollTop }, 500 ); // multiple calls will cancel previous animation

    //util.animate( self.view, { scrollTop: scrollTop }, 500 ); // multiple calls will cancel previous animation
    return true;
  }

  function findLocation( root, elem ) {
    while (elem && elem !== root) {
      var dataline = elem.getAttribute("data-line");
      if (dataline) {
        cap = /(?:^|;)(?:([^:;]+):)?(\d+)$/.exec(dataline);
        if (cap) {
          var line = parseInt(cap[2]);
          if (line && line !== NaN) {
            return { path: cap[1], line: line };
          }
        }
      }
      elem = elem.parentNode;
    }
    return null;
  }

  UI.prototype.syncEditor = function(elem) {
    var self = this;
    var res = findLocation(self.view, elem);
    if (!res) return;
    return self.editFile( res.path ? res.path : self.docName, { lineNumber: res.line, column: 0 } );
  }

  UI.prototype.handleEvent = function(ev) {
    var self = this;
    if (!ev || !ev.type) return;
    if (ev.type === "update" && ev.file) {
      self.onFileUpdate(ev.file);
    }
  }

  UI.prototype.onFileUpdate = function(file) {
    var self = this;
    if (file.path===self.editName) {
      self.editSelectHeader.innerHTML = self.displayFile(file);
    }
    self.editSelect();
  }

  UI.prototype.syncTo = function( storageSyncTo ) {
    var self = this;
    self.showSpinner(true,self.syncer);
    storageSyncTo(self.storage,util.stemname(self.docName),util.stemname(self.inputRename.value))
    .then( function(res){ 
      return self.setStorage(res.storage,res.docName).then( function() {
        return res.docName;
      }); 
    })
    .then( function(newDocName) {
      self.showSpinner(false,self.syncer);    
      util.message("saved: " + newDocName, util.Msg.Status);
    }, function(err){ 
      self.showSpinner(false,self.syncer);    
      self.onError(err); 
    });
  }

  // object    
  return UI;
})();

// module
return UI;
});