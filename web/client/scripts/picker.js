/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util", 
        "../scripts/remote-null",
        "../scripts/remote-dropbox",
        "../scripts/remote-onedrive2",
        ], function(Promise,Util,NullRemote,Dropbox,Onedrive) {



function capitalize(s) {
  if (!s) return "";
  return s[0].toUpperCase() + s.substr(1);
}

function checkConnected(remote) {
  if (!remote.connected()) return Promise.resolved(false);
  return remote.getUserName().then( function(userName) {
    return (userName != null);
  }, function(err) {
    if (err.httpCode === 401) { // access token expired
      remote.logout();
      return false;
    }
    else {
      return true;
    }
  });
}  



var Picker = (function() {
  var fade      = document.getElementById("fade");
  var app       = document.getElementById("picker");
  var listing   = document.getElementById("listing");
  var templates = document.getElementById("templates");  
  var headerLogo = document.getElementById("header-logo");
  var buttonCancel  = document.getElementById("button-cancel");
  var buttonDiscard = document.getElementById("button-discard");

  var buttons = [];
  var child = document.getElementById("picker-footer").firstChild;
  while (child) {
    if (Util.hasClassName(child,"button")) {
      buttons.push(child);
    }
    child = child.nextSibling;
  }

  
  var remotes = {
    dropbox: { remote: new Dropbox.Dropbox(), folder: "" },
    onedrive: { remote: new Onedrive.Onedrive(), folder: "" },
    local: { remote: new NullRemote.NullRemote(), folder: "" },
  };

  var picker    = null;

    

  // options:
  //  command: open | new | connect | save | push  (| template) | alert
  //  alert: false | true  // discard changes?
  //  extensions: ".mdk .md"
  //  remote: dropbox | onedrive | local
  //  folder: <initial folder> (relative to root)
  //  file: <initial file name>
  //  root: <cannot select upward here>
  //  header-logo: <img path>
  function Picker( opts, end ) {
    var self = this;
    self.current = remotes.dropbox;
    self.options = Util.copy(opts);
    self.endCont = end;
    self.buttonActive = null;

    // fade and normalize
    if (fade) fade.style.display = "block";
    if (!self.options.extensions) self.options.extensions = "";
    if (!self.options.file) self.options.file = "document";

    // update persistent remotes
    var data = JSON.parse( Util.getCookie("picker-data") || "null");
    if (data) {
      if (!self.options.remote) self.options.remote = data.remote;
      remotes.dropbox.folder  = data.dropbox || "";
      remotes.onedrive.folder = data.onedrive || "";
    }

    // init UI
    buttonCancel.innerHTML  = (self.options.command==="connect" || self.options.command==="message") ? "Close" : "Cancel";
    
    if (self.options.remote && remotes[self.options.remote] && self.options.remote !== "local") {
      if (self.options.folder) remotes[self.options.remote].folder = self.options.folder;
      self.setCurrent( remotes[self.options.remote] );
    }

    if (self.options.file) {
      self.setFileName( self.options.file );
    }

    //Util.enablePopupClickHovering();
    picker = self; // enable all event handlers
    self.buttonActive = null;          
    self.display();
    app.style.display= "block";
    app.focus();
  }


  Picker.prototype.onEnd = function( path, template ) {
    var self = this;
    picker = null;

    if (self.buttonActive) Util.removeClassName(self.buttonActive,"active");
    self.buttonActive = null;
    app.style.display = "none";
    if (fade) fade.style.display = "none";

    // save persistent state
    if (self.current) {
      var data = {
        remote: self.current.remote.type(),
        onedrive: remotes.onedrive.folder,
        dropbox: remotes.dropbox.folder,
      };
      Util.setCookie("picker-data", JSON.stringify(data), 60*60*24*30 );
    }

    // focus back to editor
    document.getElementById("editor").focus();
    
    // call end continuation
    if (self.endCont) self.endCont(self.current,path,template);
  }


  // ------------------------------------------------------------------------------------
  // Event handlers: installed once on initialization and refer the current picker object
  // through the picker variable.
  // ------------------------------------------------------------------------------------

  buttonCancel.onclick = function(ev) { if (picker) picker.onEnd(); }


  // Set remotes
  document.getElementById("remote-dropbox").onclick = function(ev) { if (picker) picker.onRemote( remotes.dropbox ); }
  document.getElementById("remote-onedrive").onclick = function(ev) { if (picker) picker.onRemote( remotes.onedrive ); }
  document.getElementById("remote-local").onclick = function(ev) { if (picker) picker.onRemote( remotes.local ); }

  Picker.prototype.onRemote = function(remote) {
    var self = this;
    if (self.current.remote.type === remote.remote.type()) return;
    self.setCurrent( remote );
  }  

  // login/logout
  document.getElementById("button-login").onclick = function(ev) { if (picker) picker.onLogin(); }
  document.getElementById("button-logout").onclick = function(ev) { if (picker) picker.onLogout(); }
    
  Picker.prototype.onLogin = function() {
    var self = this;
    if (self.current.remote.connected()) return;
    self.current.remote.login().then( function(userName) {
      self.display();
    });
  }

  Picker.prototype.onLogout = function() {
    var self = this;
    if (!self.current.remote.connected()) return;
    self.current.remote.logout();
    self.display();
  }

  document.getElementById("button-open").onclick = function(ev) { if (picker) picker.onOpen(); }

  Picker.prototype.onOpen = function() {
    var self = this;
    var path = itemGetSelected(listing);
    if (path) self.onEnd(path); 
  }

  document.getElementById("button-save").onclick = function(ev) { if (picker) picker.onSave(); }
  document.getElementById("button-push").onclick = function(ev) { if (picker) picker.onSave(); }

  Picker.prototype.onSave = function() {
    var self = this;
    var fileName = self.getFileName();
    if (fileName) {
      var path = Util.combine(self.current.folder,fileName);
      self.onEnd(path);
    }
  }

  document.getElementById("button-new").onclick = function(ev) { if (picker) picker.onNew(); }

  Picker.prototype.onNew = function() {
    var self = this;
    if (self.options.command == "new") {
      var fileName = self.getFileName();
      if (fileName) {
        if (Util.extname(fileName) == "") { // directory
          fileName = Util.combine(fileName,Util.stemname(fileName) + ".mdk"); 
        }
        self.options.path = Util.combine(self.current.folder,fileName);
        self.options.command = "template";
        self.options.headerLogo = "images/dark/" + self.current.remote.logo();    
        self.display();
        //end(self.current,path);
      }
    }
    else {
      var template = itemGetSelected(templates) || "default";
      self.options.command = "new";
      self.onEnd(self.options.path,template);
    }
  }


  document.addEventListener( "keydown", function(ev) {   
    if (!picker) return;
    if (app.style.display !== "block") return;
    if (!ev) ev = event;    
    if (ev.keyCode == 27) { // escape key on picker
      picker.onEnd();      
    }
    else if (ev.keyCode == 9) { // tab
      picker.nextActive();
    }
    else if (ev.keyCode == 13) { // enter
      picker.clickActive();
    }
    else {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    ev.keyCode = 0; // for IE    
  });

  buttonDiscard.onclick = function(ev) { if (picker) picker.onDiscard(); };

  Picker.prototype.onDiscard = function() {
    var self = this;
    if (self.options.command==="alert") {
      self.onEnd("discard");
    }
    else {
      self.options.alert = ""; // stop alert
      self.display();
    }
  }
      
  document.getElementById("folder-name").onclick = function(ev) { if (picker) picker.onFolderName(ev); };

  Picker.prototype.onFolderName = function(ev) {
    var self = this;
    var elem = ev.target;
    while (elem && elem.nodeName !== "DIV" && !Util.hasClassName(elem,"dir")) {
      elem = elem.parentNode;
    }
    if (Util.hasClassName(elem,"dir")) {
      var path = elem.getAttribute("data-path");
      self.itemEnterFolder(path);
    }
  };    

  // ------------------------------------------------------------------------------------
  // Item selection
  // ------------------------------------------------------------------------------------

  listing.onclick      = onItemSelect(listing);
  listing.ondblclick   = onItemSelectDbl(listing);
  templates.onclick    = onItemSelect(templates);
  templates.ondblclick = onItemSelectDbl(templates,"new");
    
  function canSelect(path,type,extensions) {
    var allowed = extensions.split(/\s+/);
    if (!allowed || allowed.length===0 || allowed[0]==="") return true;
    var ext = Util.extname(path);
    for( var i = 0; i < allowed.length; i++) {
      var filter = allowed[i];
      if (filter[0] === "." && filter === ext) {
        return true;
      }
      else if (filter === type) {
        return true;
      }
    };
    return false;
  }

  function itemGetSelected(parent) {
    var items = parent.children;
    for(var i = 0; i < items.length; i++) {
      if (Util.hasClassName(items[i],"selected")) {
        return items[i].getAttribute("data-path");
      }
    }
    return null;
  }
  function itemSelect(parent,elem) {
    if (Util.hasClassName(elem,"disabled")) return;
    var select = !Util.hasClassName(elem,"selected");
    var items = parent.children;
    for(var i = 0; i < items.length; i++) {
      itemSelectX(items[i],false);
    }
    itemSelectX(elem,select);
  }

  function itemSelectX(elem,select) {
    var child = elem.children[0];
    if (child && child.nodeName === "INPUT") {
      child.checked = select;    
    }
    if (select) Util.addClassName(elem,"selected");
           else Util.removeClassName(elem,"selected");
  }

  function onItemSelectDbl(parent,cmd) {
    var selectHandler = onItemSelect(parent);
    return function(ev) {
      if (!picker) return;
      selectHandler(ev);
      if (itemGetSelected(parent)) {
        var button = document.getElementById("button-" + (cmd || picker.options.command));
        if (button) {
          Util.dispatchEvent(button,"click");
        }
      }
    };
  }

  function onItemSelect(parent) {
    return function(ev) {
      if (!picker) return;
      var elem = ev.target;
      while (elem && elem.nodeName !== "DIV" && !Util.hasClassName(elem,"item") && elem != parent) {
        elem = elem.parentNode;
      }

      var type = elem.getAttribute("data-type");
      var path = elem.getAttribute("data-path");
      if (ev.target.nodeName === "INPUT" || type!=="folder") {
        itemSelect(parent,elem);
      }
      else {
        picker.itemEnterFolder(path);
      }
    };
  };

  Picker.prototype.itemEnterFolder = function(path) {
    var self = this;
    self.current.folder = path;
    self.display();
  }

  
  // ------------------------------------------------------------------------------------
  // State update
  // ------------------------------------------------------------------------------------


  Picker.prototype.setFileName = function( fname ) {
    document.getElementById("file-name").value = fname;
  }

  Picker.prototype.getFileName = function() {
    return document.getElementById("file-name").value;
  }

  Picker.prototype.setCurrent = function( newCurrent ) {
    var self = this;
    self.current = newCurrent;
    self.display();
  }
  
  // ------------------------------------------------------------------------------------
  // Display
  // ------------------------------------------------------------------------------------

  Picker.prototype.display = function() {
    var self = this;

    app.className = "modal";
    listing.innerHTML = "";
    if (self.options.headerLogo) {
      headerLogo.src = self.options.headerLogo;
      headerLogo.style.display = "inline";
    }
    else {
      headerLogo.style.display = "none";
    }

    if (self.options.alert) {
      // alert message
      if (self.options.alert!=="true") {
        document.getElementById("message-alert").innerHTML = Util.escape(self.options.alert);
      }
      document.getElementById("folder-name").innerHTML = self.options.header || "";
      Util.addClassName(app,"command-alert");
      self.setActive();
      return Promise.resolved();
    }
    else if (self.options.command==="message") {
      document.getElementById("message-message").innerHTML = self.options.message;
      document.getElementById("folder-name").innerHTML = self.options.header || "";
      Util.addClassName(app,"command-message");
      self.setActive();
      return Promise.resolved();
    }
    else if (self.options.command==="template") {
      document.getElementById("folder-name").innerHTML = self.options.path || "";
      Util.addClassName(app,"command-template");
      self.setActive();
      return Promise.resolved();
    }
    else {
      // set correct logo
      document.getElementById("remote-logo").src = "images/dark/" + self.current.remote.logo();
      
      // check connection
      return checkConnected(self.current.remote).then( function(isConnected) {
        if (!isConnected) {
          Util.addClassName(app,"command-login");
          Util.addClassName(app,"command-login-" + self.options.command );
          self.setActive();
        }
        else {
          Util.addClassName(app,"command-" + self.options.command );
          self.setActive();            
          self.current.remote.getUserName().then( function(userName) {
            document.getElementById("remote-username").innerHTML = Util.escape( userName );
            return self.displayFolder();
          });
        }
      });
    }
  }

  Picker.prototype.setActive = function() {
    var self = this;
    if (self.buttonActive === null || self.buttonActive.offsetParent === null) {
      self.buttonActive = null;
      // Set active button (after making the app appear)
      setTimeout( function() { 
        buttons.every( function(button) {
          if (button !== buttonDiscard && button.offsetParent !== null) {
            self.buttonActive = button;
            Util.addClassName(button,"active");
            return false; // break
          }
          return true;
        });
      }, 0 );
    }
  }

  Picker.prototype.nextActive = function() {
    var self = this;
    if (!self.buttonActive || self.buttonActive.offsetParent === null) return;
    var next = self.buttonActive;
    do {
      next = (next.nextSibling ? next.nextSibling : next.parentNode.firstChild);
      if (Util.hasClassName(next,"button") && next.offsetParent !== null) {
        Util.removeClassName(self.buttonActive,"active");
        self.buttonActive = next;
        Util.addClassName(self.buttonActive,"active");        
      }
    }
    while( next && next !== self.buttonActive)
  }

  Picker.prototype.clickActive = function() {
    var self = this;
    if (!self.buttonActive || self.buttonActive.offsetParent === null) return;
    Util.dispatchEvent( self.buttonActive, "click" );
  }

  Picker.prototype.displayFolder = function() {
    var self = this;
    self.displayFolderName();
    listing.innerHTML = "Loading...";
    return self.current.remote.listing(self.current.folder).then( function(items) {
      //console.log(items);
      var html = items.map( function(item) {
        var disable = canSelect(item.path,item.type,self.options.extensions) ? "" : " disabled";
        return "<div class='item item-" + item.type + disable + "' data-type='" + item.type + "' data-path='" + Util.escape(item.path) + "'>" + 
                  //"<input type='checkbox' class='item-select'></input>" +
                  "<img class='item-icon' src='images/icon-" + item.type + (item.isShared ? "-shared" : "") + ".png'/>" +
                  "<span class='item-name'>" + Util.escape(Util.basename(item.path)) + "</span>" +
               "</div>";

      });
      listing.innerHTML = html.join("");
    });
  }

  Picker.prototype.displayFolderName = function() {
    var self = this;
    var folder = self.current.folder;
    var root = self.options.root || "";
    if (root) {
      if (Util.startsWith(folder,root)) {
        folder = folder.substr(root.length);
      }
      else {
        root = "";
      }
    }
    var parts = folder.split("/");
    var html = "<span class='dir' data-path='" + root + "'>" + Util.escape(root ? Util.combine(self.current.remote.type(),root) : self.current.remote.type()) + "</span><span class='dirsep'>/</span>";
    var partial = root;
    parts.forEach( function(part) {
      if (part) {
        partial = Util.combine(partial,part);
        html = html + "<span class='dir' data-path='" + Util.escape(partial) + "'>" + Util.escape(part) + "</span><span class='dirsep'>/</span>";
      }
    });
    document.getElementById("folder-name").innerHTML = html;
  }

  return Picker;
})();
  

// ------------------------------------------------------------------------------------
// Entry
// ------------------------------------------------------------------------------------

function show( options0 ) {
  var options = Util.copy(options0);
  var picker = null;
  return new Promise( function(cont) {
    try {
      picker = new Picker(options, function(current,path,template) {
        var res = {
          path: path,  // null is canceled.
          remote: (current ? current.remote.type() : null),
          template: template || "default",
        }
        cont(null,res);
      });    
    }
    catch(exn) {
      if (picker) picker.onEnd();
      cont(exn,null);
    }
  }).then( function(res) { 
    return res; 
  }, function(err) {
    if (picker) picker.onEnd();
    throw err;
  });
}

return {
  show: show,
}

});