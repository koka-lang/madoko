/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/util","../scripts/onedrive","../scripts/madokoMode"],
        function(util,onedrive,madokoMode) {


var ie = (function(){
  var ua = window.navigator.userAgent;
  var msie = ua.indexOf('MSIE ');
  var trident = ua.indexOf('Trident/');
  return (msie > 0 || trident > 0);
})();

var supportTransitions = (function() {
  return (!ie && document.body.style.transition=="");
})();


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

var UI = (function() {

  function UI()
  {
    var self = this;
    self.editor  = null;
    self.docName = "document.mdk";
    self.storage = null;
    
    self.refreshContinuous = true;
    self.refreshRate = 250;
    self.allowServer = true;
    self.runner = null;

    self.stale = true;
    self.staleTime = Date.now();
    self.round = 0;
    self.lastRound = 0;
    self.text0 = "";
    
    self.editor = Monaco.Editor.create(document.getElementById("editor"), {
      value: localLoad(self.docName) || document.getElementById("initial").textContent,
      mode: "text/x-web-markdown",
      theme: "vs",
      lineNumbers: true,
      mode: madokoMode.mode,
      tabSize: 4,
      insertSpaces: false,
      automaticLayout: true,
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
        //verticalHasArrows: true,
        //horizontalHasArrows: true,
        //arrowSize: 10,
      }
    });

    self.syncTimeout = 0;
    self.editor.addListener("scroll", function (e) {    
      // use timeout so the start line number is correct.
      if (!self.syncTimeout) {
        self.syncTimeout = setTimeout( function() { 
          self.syncView(); 
          self.syncTimeout = 0;        
        }, 10 );     
      }
    });
     
    document.getElementById('checkContinuous').onchange = function(ev) { 
      self.refreshContinuous = ev.target.checked; 
    };

    document.getElementById('checkAllowServer').onchange = function(ev) { 
      self.allowServer = ev.target.checked; 
    };

    document.getElementById("onedrive-download").onclick = function(ev) {
      self.onedrivePickFile();
    };
   
    document.getElementById("sync").onclick = function(ev) {
      if (self.storage) {
        self.storage.sync();
      }
    };

    self.view    = document.getElementById("view");
    var cons     = document.getElementById("koka-console-out");
    var editpane = document.getElementById("editorpane");
    var viewpane = document.getElementById("viewpane");
    var buttonEditorNarrow = document.getElementById("button-editor-narrow");
    var buttonEditorWide   = document.getElementById("button-editor-wide");
    var buttonUpDown       = document.getElementById("button-updown");

    //viewpane.addEventListener( 'webkitTransitionEnd', function( event ) {  self.syncView(); }, false );
    viewpane.addEventListener('transitionend', function( event ) { 
      self.syncView(); 
    }, false);
    

    var triLeft   = "<div class='tri-left'></div>";
    var triRight  = "<div class='tri-right'></div>";
    var triUp     = "<div class='tri-up'></div>";
    var triDown   = "<div class='tri-down'></div>";
   
    util.toggleButton( buttonUpDown, triUp, triDown, function(ev) {
      util.toggleClassName(cons,"short");
      util.toggleClassName(self.view,"short");       
    });

    util.toggleButton( buttonEditorNarrow, triLeft, triRight, function(ev,toggled) {
      if (toggled) {
        util.addClassName(viewpane,"wide");
        util.addClassName(editpane,"narrow");
        util.addClassName(buttonEditorWide,"hide");
        if (!supportTransitions) setTimeout( function() { self.syncView(); }, 100 );
      }
      else {
        util.removeClassName(viewpane,"wide");
        util.removeClassName(editpane,"narrow");
        util.removeClassName(buttonEditorWide,"hide");
        if (!supportTransitions) setTimeout( function() { self.syncView(); }, 100 );
      }
    });

    util.toggleButton( buttonEditorWide, triRight, triLeft, function(ev,toggled) {
      if (toggled) {
        util.addClassName(viewpane,"narrow");
        util.addClassName(editpane,"wide");
        util.addClassName(buttonEditorNarrow,"hide");
      }
      else {
        util.removeClassName(viewpane,"narrow");
        util.removeClassName(editpane,"wide");
        util.removeClassName(buttonEditorNarrow,"hide");
      }
    });

    setInterval( function() { self.update(); }, self.refreshRate );
  }

  UI.prototype.setEditText = function( text ) {
    this.editor.model.setValue(text);
  }

  UI.prototype.getEditText = function() { 
    return this.editor.getValue(); 
  }

  UI.prototype.setStale = function() {
    var self = this;
    if (!self.stale) {
      self.stale = true;
      self.staleTime = Date.now();
    }
  }

  UI.prototype.setRunner = function( runner ) {
    var self = this;
    if (self.runner) {
      self.runner.setStorage(null); // TODO: better clean up?
    }
    self.runner = runner;     
  }

  UI.prototype.update = function() {
    var self = this;
    if (!self.runner) return;

    var text = self.getEditText();
    localSave(self.docName,text);
    if (self.storage) {
      self.storage.writeTextFile(self.docName,text);
    }

    if (text != self.text0) {   // set stale but do not update yet (as long as the user types)
      self.stale     = true;      
      self.staleTime = Date.now();
      self.text0     = text;
      if (!self.refreshContinuous) return;
    }
    if (self.stale && (self.round === self.lastRound || Date.now() > self.staleTime + 5000)) {
      self.stale = false;
      self.round++;
      if (self.runner) {
        self.runner.runMadoko(text, {docname: self.docName, round: self.round }, function(ctx) {
          self.lastRound = ctx.round;
        });
      }
    }
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
      console.log("scroll: start: " + startLine)
    }

    var res = findElemAtLine( self.view, startLine );
    if (!res) return;
    
    var scrollTop = offsetOuterTop(res.elem) - self.view.offsetTop;
    
    // adjust for line offset
    if (res.elemLine < startLine && res.elemLine < res.nextLine) {
      var scrollTopNext = offsetOuterTop(res.next) - self.view.offsetTop;
      if (scrollTopNext > scrollTop) {
        var delta = (startLine - res.elemLine) / (res.nextLine - res.elemLine);
        scrollTop += ((scrollTopNext - scrollTop) * delta);
      }
    }

    if (scrollTop !== self.lastScrollTop) {
      self.lastScrollTop = scrollTop;
      util.animate( self.view, { scrollTop: scrollTop }, 500 );
    }
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