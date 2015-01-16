/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/map","../scripts/util", 
        "../scripts/remote-local",
        "../scripts/remote-dropbox",
        "../scripts/remote-onedrive",
        "../scripts/remote-github",
        ], function(Promise,Map,Util,LocalRemote,Dropbox,Onedrive,Github) {



function capitalize(s) {
  if (!s) return "";
  return s[0].toUpperCase() + s.substr(1);
}

var Picker = (function() {
  var fade      = document.getElementById("fade");
  var app       = document.getElementById("picker");
  var listing   = document.getElementById("listing");
  var templates = document.getElementById("templates");  
  var headerLogo = document.getElementById("header-logo");
  var buttonCancel  = document.getElementById("button-cancel");
  var buttonDiscard = document.getElementById("button-discard");
  var commandName   = document.getElementById("command-name");
  var commitMessage = document.getElementById("commit-message");
  var commitModified = document.getElementById("commit-modified");
  var commitAll      = document.getElementById("commit-all");
  var snapshotMessage  = document.getElementById("snapshot-message");
    
  var buttons = [];
  var child = document.getElementById("picker-buttons").firstChild;
  while (child) {
    if (Util.hasClassName(child,"button")) {
      buttons.push(child);
    }
    child = child.nextSibling;
  }

  
  var remotes = {
    dropbox: { remote: new Dropbox.Dropbox(), folder: "" },
    onedrive: { remote: new Onedrive.Onedrive(), folder: "" },
    github: { remote: new Github.Github(), folder: "" },
    local: { remote: new LocalRemote.LocalRemote(), folder: "" },
    me: { remote: new LocalRemote.LocalRemote(), folder: "//" },
  };
  remotes.me.remote.logo = function() { return "icon-me.png"; };
  remotes.me.remote.type = function() { return "me"; };
  remotes.me.remote.readonly = true;
  var picker = null;

    

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
    self.current = remotes.me;
    self.options = Util.copy(opts);
    self.endCont = end;
    self.buttonActive = null;

    // fade and normalize
    if (fade) fade.style.display = "block";
    if (!self.options.extensions) self.options.extensions = "";
    if (!self.options.file) self.options.file = "document";

    // update persistent remotes
    var data = window.tabStorage.getItem("picker");
    if (data && self.options.command !== "new") {
      if (!self.options.remote) self.options.remote = data.remote;
      remotes.dropbox.folder  = data.dropbox || "";
      remotes.onedrive.folder = data.onedrive || "";
    }

    // init UI
    buttonCancel.textContent  = (self.options.command==="connect" || self.options.command==="message") ? "Close" : "Cancel";
    commandName.textContent   = (self.options.commandDisplay || Util.capitalize(self.options.command));
    
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
    if (self.options.command==="commit") commitMessage.focus();
    else if (self.options.command==="snapshot") snapshotMessage.focus();
  }


  Picker.prototype.onEnd = function( res ) {
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
        github: remotes.github.folder,
        created: new Date().toISOString(),
      };
      window.tabStorage.setItem("picker",data);
    }

    // focus back to editor
    document.getElementById("editor").focus();

    if (!res) {
      res = {
        canceled: true,
      }
    }
    if (self.current) res.remote = self.current.remote.type();

    // call end continuation
    if (self.endCont) self.endCont(res);
  }


  // ------------------------------------------------------------------------------------
  // Event handlers: installed once on initialization and refer the current picker object
  // through the picker variable.
  // ------------------------------------------------------------------------------------

  buttonCancel.onclick = function(ev) { if (picker) picker.onEnd(); }


  // Set remotes
  Picker.prototype.onRemote = function(remote) {
    var self = this;
    if (self.current.remote.type === remote.remote.type()) return;
    if (remote.remote.type()==="local" && self.options.command==="new") {
      self.setFileName("document");
      self.current = remote;
      self.onNew();
    }
    else {
      self.setCurrent( remote );    
    }
  }  

  // login/logout
  document.getElementById("button-signin").onclick = function(ev) { if (picker) picker.onSignin(); }
  document.getElementById("button-signout").onclick = function(ev) { if (picker) picker.onSignout(); }
    
  Picker.prototype.onSignin = function() {
    var self = this;
    return self.current.remote.login().then( function() {
      if (self.options.command === "signin") {
        return self.onEnd({});
      }
      else {
        return self.current.remote.getUserName().then( function(userName) {
          self.display();
        });
      }
    }, function(err) {
      self.onLoginBlocked(err);
    });
  }

  Picker.prototype.onSignout = function() {
    var self = this;
    //if (!self.current.remote.connected()) return;
    return self.current.remote.logout(true).then( function() {   // true does full logout
      self.display();
    }, function(err) { //popup blocked
      self.display();
    });
  }

  document.getElementById("button-open").onclick = function(ev) { if (picker) picker.onOpen(); }

  Picker.prototype.onOpen = function() {
    var self = this;
    var path = itemGetSelected(listing);
    if (path) self.onEnd({path:path}); 
  }

  document.getElementById("button-save").onclick = function(ev) { if (picker) picker.onSave(); }
  document.getElementById("button-push").onclick = function(ev) { if (picker) picker.onSave(); }

  Picker.prototype.onSave = function() {
    var self = this;
    if (self.current.remote.readonly) return;

    var fileName = self.getFileName();
    if (fileName) {
      var path = Util.combine(self.current.folder,fileName);
      self.onEnd({path:path});
    }
  }

  document.getElementById("button-new").onclick = function(ev) { 
    if (picker && isEnabled(ev.target)) picker.onNew(); 
  }

  Picker.prototype.onNew = function() {
    var self = this;
    if (!self.options.page) {
      if (self.current.remote.readonly) return;

      var fileName = self.getFileName();
      if (fileName) {
        if (Util.extname(fileName) == "") { // directory
          fileName = Util.combine(fileName,Util.stemname(fileName) + ".mdk"); 
          self.setFileName(fileName);
        }
        self.options.path = Util.combine(self.current.folder,fileName);
        self.options.page = "template";
        self.options.headerLogo = "images/dark/" + self.current.remote.logo();            
        //self.current.folder = Util.dirname(self.options.path);
        self.display();
        //end(self.current,path);
      }
    }
    else {
      var template = itemGetSelected(templates) || "default";
      //self.options.command = "new";
      self.onEnd({path:self.options.path,template:template});
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
      self.onEnd({});
    }
    else {
      self.options.page = ""; // stop alert
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
      var path = decodeURIComponent(elem.getAttribute("data-path"));
      self.itemEnterFolder(path);
    }
  };    

  // ------------------------------------------------------------------------------------
  // Commit
  // ------------------------------------------------------------------------------------
  document.getElementById("button-commit").onclick = function(ev) { if (picker) picker.onCommit(); };

  Picker.prototype.onCommit = function() {
    var self = this;
    var selected = new Map();
    var inputs = commitModified.querySelectorAll("li>input");
    [].forEach.call( inputs, function(input) {
      if (input.checked) selected.set( decodeURIComponent(input.getAttribute("data-path")), true );
    });
    var newChanges = self.options.changes.filter( function(change) { return selected.contains(change.path); } ); 
    picker.onEnd({message: commitMessage.value, changes: newChanges });
  }

  commitAll.onchange = function(ev) { if (picker) picker.onCommitCheckAll(); };

  Picker.prototype.onCommitCheckAll = function() {
    var self = this;
    var inputs = commitModified.querySelectorAll("li>input");
    [].forEach.call(inputs,function(input) {
      input.checked = commitAll.checked;
    });
  }

  // ------------------------------------------------------------------------------------
  // Snapshot
  // ------------------------------------------------------------------------------------
  document.getElementById("button-snapshot").onclick = function(ev) { if (picker) picker.onSnapshot(); };

  Picker.prototype.onSnapshot = function() {
    var self = this;
    picker.onEnd({message: snapshotMessage.value });
  }

  // ------------------------------------------------------------------------------------
  // Upload
  // ------------------------------------------------------------------------------------

  var dropzone = document.getElementById("dropzone");
  dropzone.addEventListener("dragover", function(ev) {
    ev.stopPropagation();
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy'; 
  });

  dropzone.addEventListener("drop", function(ev) {
    ev.stopPropagation();
    ev.preventDefault();
    picker.onEnd({files:ev.dataTransfer.files});
  });

  document.getElementById("pickfiles").addEventListener("change", function(ev) {
    ev.stopPropagation;
    ev.preventDefault();
    var files = ev.target.files;
    ev.target.files = null;
    picker.onEnd({files:files});
  });

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
        return decodeURIComponent(items[i].getAttribute("data-path"));
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

    var cmd = picker.options.command;
    if (cmd==="template") cmd = "new";
    var button = document.getElementById("button-" + cmd);
    if (button) {
      Util.dispatchEvent(button,"click");
    }
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
        if (elem.nodeName==="A") return; // don't react on link clicks
        elem = elem.parentNode;
      }

      var type = elem.getAttribute("data-type");
      var path = decodeURIComponent(elem.getAttribute("data-path"));
      if (ev.target.nodeName === "INPUT") {
        itemSelect(parent,elem);
      }
      else if (Util.startsWith(type,"folder")) {
        picker.itemEnterFolder(path);
      }
      else if (type==="remote") {
        picker.itemEnterRemote(path,elem.getAttribute("data-connected") === "true");
      }
      else {
        itemSelect(parent,elem);
      }
    };
  };

  Picker.prototype.itemEnterFolder = function(path) {
    var self = this;
    self.options.page = ""; // navigate away from templates
    if (path === "//") {
      remotes.me.folder = path;
      self.setCurrent(remotes.me);
    }
    else {
      self.current.folder = path;
      self.display();
    }
  }

  Picker.prototype.itemEnterRemote = function(remoteName,connected) {
    var self = this;
    var remote = remotes[remoteName];
    if (connected) {
      return self.onRemote(remote);
    }
    else {
      return remote.remote.login().then( function() {
        return self.onRemote(remote);
      }, function(err) {
        self.onLoginBlocked(err);
      });
    }
  }

  Picker.prototype.onLoginBlocked = function(err) {
    var self = this;
    if (err==null || err.url==null) throw err;
    self.options.page = "page-alert";
    self.options.message = "Popup was blocked: login through this <a href='" + err.url + "'>link</a> instead.";
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

    app.className = "modal command-" + self.options.command;    
    listing.innerHTML = "";
      
    if (self.options.page==="template") {
      document.getElementById("file-name").setAttribute("readonly","readonly");
    }
    else {
      document.getElementById("file-name").removeAttribute("readonly"); 
    }

    var page = self.options.page;
    if (page) {
      Util.addClassName(app,"page-" + page);
    }

    /*
    if (self.options.headerLogo) {
      headerLogo.src = self.options.headerLogo;
      headerLogo.style.display = "inline";
    }
    else {
      headerLogo.style.display = "none";
    }
    */
    if (self.options.headerLogo) {
      headerLogo.src = self.options.headerLogo;
    }
    document.getElementById("header-text").textContent = self.options.header || "";    

    if (self.options.message) {
      document.getElementById("message-message").innerHTML = self.options.message;
      //document.getElementById("folder-name").innerHTML = self.options.header || "";
      Util.addClassName(app,"command-message");
    }

    if (page === "alert") {
      // alert message
      // document.getElementById("folder-name").innerHTML = self.options.header || "";
      headerLogo.src = "images/dark/icon-warning.png";
      self.setActive();
      return Promise.resolved();
    }
    else if (/message|upload/.test(self.options.command)) {
      self.setActive();
      return Promise.resolved();
    }
    else if (self.options.command === "commit") {
      self.setActive();
      commitModified.innerHTML = self.options.changes.map( function(change) { 
        return "<li class='change-" + change.change + "'>" + 
               "<input type='checkbox' data-path='" + encodeURIComponent(change.path) + "' " + 
               (change.change===Github.Change.Add && Util.startsWith(change.path,"out/") ? "" : "checked") + "></input>" +
                Util.escape(change.path) + "</li>"; 
      }).join(""); 
      commitMessage.value = "";
      commitMessage.focus();
      return Promise.resolved();
    }
    else if (self.options.command === "snapshot") {
      self.setActive();
      //snapshotStem.textContent = (self.options.stem ? self.options.stem + " " : "");
      snapshotMessage.value = "";
      snapshotMessage.focus();
      return Promise.resolved();
    }
    else if (self.options.page==="template") {
      document.getElementById("folder-name").innerHTML = self.options.path || "";
      self.displayFolderName();
      self.setActive();
      return Promise.resolved();
    }

    else {
      // set correct logo
      headerLogo.src = "images/dark/" + self.current.remote.logo();
      // on forced signin, don't try connection
      if (self.options.command==="signin") {
        self.setActive();
        return Promise.resolved();
      }
      else {
        // check connection
        return self.current.remote.connect(true /* verify */).then( function(status) {
          if (status===401) {
            self.setCurrent(remotes.me);
          }
          self.displayFolderName();
          var spinner = "<img class='spinner spin' style='height:1em' src='images/icon-spinner.gif'></img>";
          listing.innerHTML = spinner + " Loading...";
          return self.current.remote.getUserName().then( function(userName) {
            document.getElementById("remote-username").innerHTML = Util.escape( userName );
            return self.displayFolder();
          });
        }).then( function() {
          self.setActive();            
        }, function(err) {
          listing.textContent = "Error: " + (err.message ? err.message : err.toString());
        });
      };
    }
  }

  function isVisible(elem) {
    return (elem.offsetParent !== null);
  }
  function isEnabled(elem) {
    if (!isVisible(elem)) return false;
    var style = window.getComputedStyle(elem);
    return (Util.startsWith(style.color,"rgb(255"));
  }

  Picker.prototype.setActive = function() {
    var self = this;
    if (self.buttonActive === null || !isVisible(self.buttonActive)) {
      self.buttonActive = null;
      // Set active button (after making the app appear)
      setTimeout( function() { 
        buttons.every( function(button) {
          if (button !== buttonDiscard && isVisible(button)) {
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
    if (!self.buttonActive || !isVisible(self.buttonActive)) return;
    var next = self.buttonActive;
    do {
      next = (next.nextSibling ? next.nextSibling : next.parentNode.firstChild);
      if (Util.hasClassName(next,"button") && isVisible(next)) {
        Util.removeClassName(self.buttonActive,"active");
        self.buttonActive = next;
        Util.addClassName(self.buttonActive,"active");
        return;
      }
    }
    while( next && next !== self.buttonActive)
  }

  Picker.prototype.clickActive = function() {
    var self = this;
    if (!self.buttonActive || !isEnabled(self.buttonActive)) return;
    Util.dispatchEvent( self.buttonActive, "click" );
  }

  Picker.prototype.displayFolder = function() {
    var self = this;
    var folder = self.current.folder;
    var getListing = (folder==="//" ? self.getRoots() : self.current.remote.listing(folder));
    return getListing.then( function(items) {
      //console.log(items);
      var html = items.map( function(item) {
        var types = item.type.split(".");
        var type  = types[0];
        var disable = (!item.disabled && canSelect(item.path,type,self.options.extensions)) ? "" : " disabled";
        return "<div class='item " + types.map(function(tp) { return "item-" + tp; }).join(" ") + disable + 
                      "' data-type='" + item.type + 
                      "' data-path='" + encodeURIComponent(item.path) + 
                      "' data-connected='" + (item.connected ? "true" : "false") + 
                      "'>" + 
                  //"<input type='checkbox' class='item-select'></input>" +
                  "<img class='item-icon' src='images/" + (item.iconName || ("icon-" + item.type.replace(/\./g,"-") + (item.isShared ? "-shared" : "") + ".png")) + "'/>" +
                  (item.connected===false ?  "<img class='item-icon item-disconnect' src='images/icon-disconnect.png' />" : "") +
                  "<span class='item-name'>" + Util.escape(item.display || Util.basename(item.path)) + "</span>" +
               "</div>";

      });
      listing.innerHTML = html.join("");
    }, function(err) {
      listing.innerHTML = "<p>Error: Could not retrieve directory listing.</p>";
      throw err;
    });
  }

  Picker.prototype.getRoots = function() {
    var self = this;
    Util.addClassName(app,"page-me");
    var items = Util.properties(remotes).map( function(remoteName) {
      var remote = remotes[remoteName].remote;
      return remote.connect().then( function(status) {
        return { 
          path: remote.type(), 
          display: Util.capitalize(remote.type()), 
          iconName: remote.logo(), 
          type: "remote", 
          isShared: false,
          disabled: (remote.type()==="me" || (self.options.command!=="new" && remote.type()==="local")),
          connected: (status===0),
        };
      });      
    });
    return Promise.when(items);
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
    var parts = (self.options.command==="connect" ? [] : folder.split("/"));
    var html = "<span class='dir' data-path='%2F%2F'>me</span><span class='dirsep'>/</span>";
    if (folder!=="//") {
      html = html + "<span class='dir' data-path='" + encodeURIComponent(root) + "'>" + Util.escape(root ? Util.combine(self.current.remote.type(),root) : self.current.remote.type()) + "</span><span class='dirsep'>/</span>";
      var partial = root;
      parts.forEach( function(part) {
        if (part) {
          partial = Util.combine(partial,part);
          html = html + "<span class='dir' data-path='" + encodeURIComponent(partial) + "'>" + Util.escape(decodeURIComponent(part)) + "</span><span class='dirsep'>/</span>";
        }
      });
    }
    document.getElementById("folder-name").innerHTML = html;
    if (self.current.remote.canCommit && parts.length < 2) {
      Util.addClassName(app,"page-repo");
    }
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
      picker = new Picker(options, function(res) {
        cont(null,res);
      });    
    }
    catch(exn) {
      if (picker) {
        picker.onEnd();
      }
      else {
        app.style.display = "none";
        if (fade) fade.style.display = "none";
      }
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