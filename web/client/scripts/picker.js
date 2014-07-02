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


var fade = document.getElementById("fade");
var app     = document.getElementById("picker");
var listing = document.getElementById("listing");
var templates = document.getElementById("templates");  
var headerLogo = document.getElementById("header-logo");
var remotes = {
  dropbox: { remote: new Dropbox.Dropbox(), folder: "" },
  onedrive: { remote: new Onedrive.Onedrive(), folder: "" },
  local: { remote: new NullRemote.NullRemote(), folder: "" },
};
var current  = remotes.dropbox;

function capitalize(s) {
  if (!s) return "";
  return s[0].toUpperCase() + s.substr(1);
}

// options:
//  command: open | new | connect | save | push
//  alert: false | true  // discard changes?
//  extensions: ".mdk .md"
//  remote: dropbox | onedrive | local
//  folder: <initial folder> (relative to root)
//  file: <initial file name>
//  root: <cannot select upward here>
//  header-logo: <img path>
function run( options, end ) {
  //document.title = capitalize(options.command) + " document";
  if (fade) fade.style.display = "block";

  if (!options.extensions) options.extensions = "";
  if (!options.file) options.file = "document";

  var data = JSON.parse( Util.getCookie("picker-data") || "null");
  if (data) {
    if (!options.remote) options.remote = data.remote;
    remotes.dropbox.folder  = data.dropbox || "";
    remotes.onedrive.folder = data.onedrive || "";
  }

  document.getElementById("button-cancel").innerHTML  = (options.command==="connect" || options.command==="message") ? "Close" : "Cancel";
  
  if (options.remote && remotes[options.remote] && options.remote !== "local") {
    if (options.folder) remotes[options.remote].folder = options.folder;
    setCurrent( options, remotes[options.remote] );
  }

  if (options.file) {
    setFileName( options.file );
  }

  document.getElementById("remote-dropbox").onclick = function(ev) {
    if (current.remote.type === remotes.dropbox.remote.type()) return;
    setCurrent( options, remotes.dropbox );
  }


  document.getElementById("remote-onedrive").onclick = function(ev) {
    if (current.remote.type === remotes.onedrive.remote.type()) return;
    setCurrent( options, remotes.onedrive );
  }

  document.getElementById("remote-local").onclick = function(ev) {
    if (current.remote.type === remotes.local.remote.type()) return;
    setCurrent( options, remotes.local );
  }
  
  document.getElementById("button-login").onclick = function(ev) {
    if (current.remote.connected()) return;
    current.remote.login().then( function(userName) {
      display(options,current);
    });
  }

  document.getElementById("button-logout").onclick = function(ev) {
    if (!current.remote.connected()) return;
    current.remote.logout();
    display(options,current);
  }

  document.getElementById("button-choose").onclick = function(ev) {
    var path = itemGetSelected(listing);
    if (path) {
      end(current,path);
    }
  }

  document.getElementById("button-save").onclick = function(ev) {
    var fileName = getFileName();
    if (fileName) {
      var path = Util.combine(current.folder,fileName);
      end(current,path);
    }
  }

  document.getElementById("button-push").onclick = function(ev) {
    var fileName = getFileName();
    if (fileName) {
      var path = Util.combine(current.folder,fileName);
      end(current,path);
    }
  }

  document.getElementById("button-new").onclick = function(ev) {
    if (options.command == "new") {
      var fileName = getFileName();
      if (fileName) {
        options.path = Util.combine(current.folder,fileName);
        options.command = "template";
        display(options,current);
        //end(current,path);
      }
    }
    else {
      var template = itemGetSelected(templates) || "default";
      options.command = "new";
      end(current,options.path,template);
    }
  }

  document.getElementById("button-cancel").onclick = function(ev) {
    end(current);
  }

  document.getElementById("button-discard").onclick = function(ev) {
    options.alert = ""; // stop alert
    display(options,current);
  }
  
  listing.onclick = onItemSelect(listing);
  templates.onclick = onItemSelect(templates);

  document.getElementById("folder-name").onclick = function(ev) {
    var elem = ev.target;
    while (elem && elem.nodeName !== "DIV" && !Util.hasClassName(elem,"dir")) {
      elem = elem.parentNode;
    }
    if (Util.hasClassName(elem,"dir")) {
      var path = elem.getAttribute("data-path");
      itemEnterFolder(options, current,path);
    }
  };

  //Util.enablePopupClickHovering();

  display( options,current  );
  app.style.display= "block";
}

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

function onItemSelect(parent) {
  return function(ev) {
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
      itemEnterFolder(options, current,path);
    }
  };
};

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

function itemEnterFolder(options, current,path) {
  current.folder = path;
  display( options, current );
}

function setFileName( fname ) {
  document.getElementById("file-name").value = fname;
}
function getFileName( ) {
  return document.getElementById("file-name").value;
}

function setCurrent( options, newCurrent ) {
  current = newCurrent;
  display( options, current );
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
  

function display( options, current ) {
  app.className = "modal";
  listing.innerHTML = "";
  if (options.headerLogo) {
    headerLogo.src = options.headerLogo;
    headerLogo.style.display = "inline";
  }
  else {
    headerLogo.style.display = "none";
  }

  if (options.alert) {
    // alert message
    if (options.alert!=="true") {
      document.getElementById("message-alert").innerHTML = Util.escape(options.alert);
    }
    Util.addClassName(app,"command-alert");
    return Promise.resolved();
  }
  else if (options.command==="message") {
    document.getElementById("message-message").innerHTML = options.message;
    document.getElementById("folder-name").innerHTML = options.header || "";
    Util.addClassName(app,"command-message");
    return Promise.resolved();
  }
  else if (options.command==="template") {
    Util.addClassName(app,"command-template");
    return Promise.resolved();
  }
  else {
    // set correct logo
    document.getElementById("remote-logo").src = "images/dark/" + current.remote.logo();
    
    // check connection
    return checkConnected(current.remote).then( function(isConnected) {
      if (!isConnected) {
        Util.addClassName(app,"command-login");
        Util.addClassName(app,"command-login-" + options.command );
        return Promise.resolved();
      }
      else {
        Util.addClassName(app,"command-" + options.command );
        current.remote.getUserName().then( function(userName) {
          document.getElementById("remote-username").innerHTML = Util.escape( userName );
          return displayFolder(options,current);
        });
      }
    });
  }
}

function displayFolder( options, current ) {
  displayFolderName(options,current);
  listing.innerHTML = "Loading...";
  return current.remote.listing(current.folder).then( function(items) {
    //console.log(items);
    var html = items.map( function(item) {
      var disable = canSelect(item.path,item.type,options.extensions) ? "" : " disabled";
      return "<div class='item item-" + item.type + disable + "' data-type='" + item.type + "' data-path='" + Util.escape(item.path) + "'>" + 
                //"<input type='checkbox' class='item-select'></input>" +
                "<img class='item-icon' src='images/icon-" + item.type + (item.isShared ? "-shared" : "") + ".png'/>" +
                "<span class='item-name'>" + Util.escape(Util.basename(item.path)) + "</span>" +
             "</div>";

    });
    listing.innerHTML = html.join("");
  });
}

function displayFolderName(options,current) {
  var folder = current.folder;
  var root = options.root || "";
  if (root) {
    if (Util.startsWith(folder,root)) {
      folder = folder.substr(root.length);
    }
    else {
      root = "";
    }
  }
  var parts = folder.split("/");
  var html = "<span class='dir' data-path='" + root + "'>" + Util.escape(root ? Util.combine(current.remote.type(),root) : current.remote.type()) + "</span><span class='dirsep'>/</span>";
  var partial = root;
  parts.forEach( function(part) {
    if (part) {
      partial = Util.combine(partial,part);
      html = html + "<span class='dir' data-path='" + Util.escape(partial) + "'>" + Util.escape(part) + "</span><span class='dirsep'>/</span>";
    }
  });
  document.getElementById("folder-name").innerHTML = html;
}

function onEnd( current, path, template ) {  
  template = template || "default";
  app.style.display = "none";
  if (fade) fade.style.display = "none";

  // save state
  if (current) {
    var data = {
      remote: current.remote.type(),
      onedrive: remotes.onedrive.folder,
      dropbox: remotes.dropbox.folder,
    }
  }
  Util.setCookie("picker-data", JSON.stringify(data), 60*60*24*30 );

  return {
    path: path,  // null is canceled.
    remote: (current ? current.remote.type() : null),
    template: template,
  }
}

function show( options0 ) {
  var options = Util.copy(options0);
  return new Promise( function(cont) {
    try {
      run(options, function(current,path,template) {
        var res = onEnd(current,path,template);
        cont(null,res);
      });    
    }
    catch(exn) {
      cont(exn,null);
    }
  }).then( function(res) { 
    return res; 
  }, function(err) {
    app.style.display = "none";
    if (fade) fade.style.display = "none";
    throw err;
  });
}

return {
  show: show,
}

});