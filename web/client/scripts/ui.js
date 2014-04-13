/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/merge","../scripts/util","../scripts/onedrive","../scripts/madokoMode"],
        function(merge,util,onedrive,madokoMode) {


var ie = (function(){
  var ua = window.navigator.userAgent;
  var msie = ua.indexOf('MSIE ');
  var trident = ua.indexOf('Trident/');
  return (msie > 0 || trident > 0);
})();

var supportTransitions = (function() {
  return (!ie && document.body.style.transition=="");
})();

var testO  = "line 1\nline2\nx3\nend4";
var testA  = "line 1\nline2c\nx3\nAddition\nend4";
var testB  = "line 1\nline 2b\nx3\nOther\nend4";

function createDiff( editor, original, modified, cont ) {
  var diffSupport = editor.getModel().getMode().diffSupport;
  var originalModel = Monaco.Editor.createModel(original, "text/plain");
  var modifiedModel = Monaco.Editor.createModel(modified, "text/plain");
  var diff = diffSupport.computeDiff( 
                originalModel.getAssociatedResource(), modifiedModel.getAssociatedResource() ).then( 
  function(res) {
    cont(0,res);
  }, 
  function(err) {
    cont("unable to create diff: " + err.toString(),[]);
  });
}

function localSave( fname, text ) {
  if (!localStorage) {
    util.message("cannot save locally: " + fname + "\n  upgrade your browser." );
    return;
  }
  try {
    localStorage.setItem( "local/" + fname, text );
  }
  catch(e) {
    util.message("failed to save locally: " + fname + "\n  " + e.toString());
  }
}

function localLoad( fname ) {
 if (!localStorage) {
    util.message("cannot load locally: " + fname + "\n  upgrade your browser." );
    return "";
  }
  try {
    var res = localStorage.getItem( "local/" + fname );
    return (res ? res : "");
  }
  catch(e) {
    return "";
  } 
}

var testO  = "line 1\nline2\nx3\nend4";
var testA  = "line 1\nline2c\nx3\nAddition\nend4";
var testB  = "line 1\nline 2b\nx3\nOther\nend4";

var UI = (function() {

  function UI( runner )
  {
    var self = this;
    self.editor  = null;
    self.docName = "document.mdk";
    self.storage = null;
    
    self.refreshContinuous = true;
    self.refreshRate = 250;
    self.serverRefreshRate = 1000;
    self.allowServer = true;
    self.runner = runner;

    self.stale = true;
    self.staleTime = Date.now();
    self.round = 0;
    self.lastRound = 0;
    self.text0 = "";
    
    self.spinners = 0;
    self.spinner = document.getElementById("view-spinner");
    
    self.checkLineNumbers = document.getElementById('checkLineNumbers');

    self.editor = Monaco.Editor.create(document.getElementById("editor"), {
      value: localLoad(self.docName) || document.getElementById("initial").textContent,
      mode: "text/x-web-markdown",
      theme: "vs",
      lineNumbers: (self.checkLineNumbers ? self.checkLineNumbers.checked : false),
      mode: madokoMode.mode,
      tabSize: 4,
      insertSpaces: false,
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
     
    document.getElementById('checkDelayedUpdate').onchange = function(ev) { 
      self.refreshContinuous = !ev.target.checked; 
    };

    document.getElementById('checkDisableServer').onchange = function(ev) { 
      self.allowServer = !ev.target.checked; 
    };

    document.getElementById('checkLineNumbers').onchange = function(ev) { 
      if (self.editor) {
        self.editor.updateOptions( { lineNumbers: ev.target.checked } ); 
      }
    };

    document.getElementById("onedrive-download").onclick = function(ev) {
      self.onedrivePickFile();
    };
   
    document.getElementById("sync").onclick = function(ev) 
    {      
      function diff(original,modified,cont) {
        createDiff(self.editor,original,modified,cont);
      };

      merge.merge3( diff, null, testO, testA, testB, function(err,merged) {
        console.log("merge:\n" + merged);
      });

      if (self.storage) {
        self.storage.sync( function(err,fs) {
          if (err) {
            util.message( err );
            util.message("sync failed!!!");
          }
          else {
            util.message("sync succeeded");
          }
        });
      }
    };

    self.view    = document.getElementById("view");
    self.viewSpinner = document.getElementById("view-spinner");
    var cons     = document.getElementById("koka-console-out");
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
    
    self.initRunners();
  }

  UI.prototype.setEditText = function( text ) {
    this.editor.model.setValue(text);
  }

  UI.prototype.getEditText = function() { 
    return this.editor.getValue(); 
  }

  UI.prototype.setStale = function() {
    var self = this;
    self.stale = true;
    self.asyncMadoko.setStale();    
  }

  UI.prototype.viewHTML = function( html ) {
    var self = this;
    self.view.innerHTML = html;
    self.syncView();
  }

  UI.prototype.showSpinner = function(enable) {
    if (enable && self.spinners === 0) {
      util.removeClassName(self.spinner,"hide")          
    }
    else if (!enable && self.spinners === 1) {
      util.addClassName(self.spinner,"hide");
    }
    if (enable) self.spinners++;
    else if (self.spinners > 0) self.spinners--;
  }

  UI.prototype.initRunners = function() {
    var self = this;
    self.asyncMadoko = new util.AsyncRunner( self.refreshRate, self.showSpinner, 
      function() {
        var text = self.getEditText();
        localSave(self.docName,text);
        if (self.storage) {
          self.storage.writeTextFile(self.docName,text);
        }

        if (text != self.text0) {   
          self.stale = true;
          self.text0 = text;
          if (!self.refreshContinuous) return false; // set stale, but wait until the user stops typing..
        }

        return self.stale;
      },
      function(round,cont) {
        self.stale = false;
        if (!self.runner) return cont();
        self.runner.runMadoko(self.text0, {docname: self.docName, round: round }, 
          function(err,ctx,content,needServerRun) {
          if (err) {
            util.message(err,util.Msg.Exn);
          }
          else {
            self.viewHTML(content);
            if (needServerRun && self.allowServer && self.asyncServer) {
              self.asyncServer.setStale();
            }
          }
          cont();
        });
      }
    );

    self.asyncServer = new util.AsyncRunner( self.serverRefreshRate, self.showSpinner, 
      function() { return false; },
      function(round,cont) {
        self.runner.runMadokoServer(self.text0, {docname: self.docName, round:round}, function(err,ctx) {
          if (err) {
            util.message(err,util.Msg.Exn);
          }
          self.asyncServer.clearStale(); // stale is usually set by intermediate madoko runs
          self.asyncMadoko.setStale();   // run madoko locally
          cont();
        });
      }
    );
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

  function findElemAtLine( elem, line ) 
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
        var cres = findElemAtLine(child,line);
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

    var res = findElemAtLine( self.view, startLine );
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
    return true;
  }

  UI.prototype.onedrivePickFile = function() {
    var self = this;
    onedrive.fileDialog( function(err,storage,fname) {
      if (err) return util.message(err);
      if (!util.endsWith(fname,".mdk")) return util.message("only .mdk files can be selected");
      self.storage = storage;
      if (self.runner) {
        self.runner.setStorage(self.storage);
      }
      self.storage.readTextFile(fname, function(err,text) { 
        if (err) return util.message(err);
        self.setEditText(text);
        self.docName = fname;
      });
    });
  }

  // object    
  return UI;
})();

// module
return UI;
});