/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/util","../scripts/onedrive","../scripts/madokoMode"],
        function(util,onedrive,madokoMode) {

function UI( runner )
{
  var self = this;
  self.editor  = null;
  self.docName = "document.mdk";
  self.docInfo = {};

  self.refreshContinuous = true;
  self.refreshRate = 250;
  self.allowServer = true;
  self.runner = runner;

  self.stale = true;
  self.staleTime = Date.now();
  self.round = 0;
  self.lastRound = 0;
  self.text0 = "";
  
  self.editor = Monaco.Editor.create(document.getElementById("editor"), {
    value: document.getElementById("initial").textContent,
    mode: "text/x-web-markdown",
    theme: "vs",
    lineNumbers: false,
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

  self.editor.addListener("scroll", function (e) {
    var view  = self.editor.getView();
    var lines = view.viewLines;
    var rng = lines._currentVisibleRange;
    self.syncView(rng.startLineNumber, rng.endLineNumber);    
  });

  onedrive.init({
    client_id   : "000000004C113E9D",
    redirect_uri: "http://madoko.cloudapp.net:8080/redirect", //"https://login.live.com/oauth20_desktop.srf",                     
    scope       : ["wl.signin","wl.skydrive"],
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

  self.view    = document.getElementById("view");
  var cons     = document.getElementById("koka-console-out");
  var editpane = document.getElementById("editorpane");
  var viewpane = document.getElementById("viewpane");
  var buttonEditorNarrow = document.getElementById("button-editor-narrow");
  var buttonEditorWide   = document.getElementById("button-editor-wide");
  var buttonUpDown       = document.getElementById("button-updown");

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
    }
    else {
      util.removeClassName(viewpane,"wide");
      util.removeClassName(editpane,"narrow");
      util.removeClassName(buttonEditorWide,"hide");
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

UI.prototype.update = function() {
  var self = this;
  if (!self.runner) return;

  var text = self.getEditText();
  if (text != self.text0) {   // set stale but do not update yet (as long as the user types)
    self.stale     = true;      
    self.staleTime = Date.now();
    self.text0     = text;
    if (!self.refreshContinuous) return;
  }
  if (self.stale && (self.round === self.lastRound || Date.now() > self.staleTime + 5000)) {
    self.stale = false;
    self.round++;
    if (self.runner) self.runner(text,{ round: self.round, docName: self.docName, docInfo: self.docInfo })
  }
}

UI.prototype.completed = function( ctx ) {
  this.lastRound = ctx.round;
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

function findLine( elem, line ) 
{
  var current = null;
  var children = elem.children; 
  for(var i = 0; i < children.length; i++) {
    var child = children[i];
    var dataline = child.getAttribute("data-line");
    if (dataline && !util.contains(child.style.display,"inline")) {
      var cline = parseInt(dataline);
      if (!isNaN(cline)) {
        if (cline <= line) {
          current = child;
        }
        if (cline > line) {
          break;
        }
      }
    }
  }
  if (current && current.children && current.children.length>0) {
    var ccurrent = findLine(current,line);
    if (ccurrent) current = ccurrent;
  }
  return current;
}

UI.prototype.syncView = function( startLine, endLine ) 
{
  var self = this;
  if (self.lastScroll===undefined) self.lastScroll = null;

  var elem = findLine( self.view, startLine );
  if (!elem) {
    elem = self.view.firstChild;
    if (!elem) return;
  }
  if (elem === self.lastScroll) return;
  
  self.lastScroll = elem;
  var topMargins = (!elem.style ? 0 : util.px(elem.style.paddingTop) + util.px(elem.style.marginTop) + util.px(elem.style.borderTopWidth));
  var ofs = elem.offsetTop - view.offsetTop - topMargins;
  util.animate( view, { scrollTop: ofs }, 500 );

  /*
  var elem = $('#view').children(':first');
  $('#view *[data-line]').each( function() {
    var line = parseInt($(this).attr("data-line"));
    if ((line && !isNaN(line) && line <= startLine)) {
      elem=$(this);
    }
    if (line >= startLine) {
      return false;      
    } 
  });
  if (elem && elem[0] !== self.lastScroll) {
    self.lastScroll = elem[0];
    var topMargins = (elem.outerHeight(true) - elem.height())/2;
    var ofs = elem.offset().top - $("#view").offset().top - topMargins;
    var viewtop = $("#view").scrollTop();
    var newtop = ofs + viewtop;
    $("#view").animate({
      scrollTop: newtop
    }, 50 );
    console.log("scroll: " + startLine + ": " + ofs + "px : " + viewtop + "px : " + newtop + "px : " + elem[0].tagName + ": " + elem.text().substr(0,40));
  }
  */
}

UI.prototype.onedrivePickFile = function() {
  var self = this;
  onedrive.fileDialog( function(fname,info) {
    if (!util.endsWith(fname,".mdk")) return util.message("only .mdk files can be selected");
    onedrive.readFile(info, function(text) { 
      self.setEditText(text);
      self.docName = fname;
      self.docInfo = info;
    });
  });
}

  
return UI;

});