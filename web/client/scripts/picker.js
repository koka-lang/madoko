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


var options = {
  command: "open", // open, connect, save, new
  extensions: "",
  file: "document",
  alert: "",
  // remote: initial remote
  // folder: initial folder for the remote
};

var app     = document.getElementById("app");
var listing = document.getElementById("listing");
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

function run() {
  var hash = window.location.hash || "";
  if (hash[0]==="#") hash = hash.substr(1);
  hash.split("&").forEach( function(param) {
    var keyval = param.split("=");
    var key = keyval[0] ? decodeURIComponent(keyval[0]) : "";
    var val = keyval[1] ? decodeURIComponent(keyval[1]) : "";
    if (key) options[key] = val;
  });

  document.title = capitalize(options.command) + " document";

  var data = JSON.parse( Util.getCookie("picker-data") || "null");
  if (data) {
    if (!options.remote) options.remote = data.remote;
    remotes.dropbox.folder  = data.dropbox || "";
    remotes.onedrive.folder = data.onedrive || "";
  }

  if (options.command==="connect") {
    document.getElementById("button-cancel").innerHTML = "Close";
  }

  if (options.remote && remotes[options.remote] && options.remote !== "local") {
    if (options.folder) remotes[options.remote].folder = options.folder;
    setCurrent( remotes[options.remote] );
  }

  if (options.file) {
    setFileName( options.file );
  }

  document.getElementById("remote-dropbox").onclick = function(ev) {
    if (current.remote.type === remotes.dropbox.remote.type()) return;
    setCurrent( remotes.dropbox );
  }


  document.getElementById("remote-onedrive").onclick = function(ev) {
    if (current.remote.type === remotes.onedrive.remote.type()) return;
    setCurrent( remotes.onedrive );
  }

  document.getElementById("remote-local").onclick = function(ev) {
    if (current.remote.type === remotes.local.remote.type()) return;
    setCurrent( remotes.local );
  }
  
  document.getElementById("button-login").onclick = function(ev) {
    if (current.remote.connected()) return;
    current.remote.login().then( function(userName) {
      display(current);
    });
  }

  document.getElementById("button-logout").onclick = function(ev) {
    if (!current.remote.connected()) return;
    current.remote.logout();
    display(current);
  }

  document.getElementById("button-choose").onclick = function(ev) {
    var path = itemGetSelected();
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

  document.getElementById("button-new").onclick = function(ev) {
    var fileName = getFileName();
    if (fileName) {
      var path = Util.combine(current.folder,fileName);
      end(current,path);
    }
  }

  document.getElementById("button-cancel").onclick = function(ev) {
    end(current);
  }

  document.getElementById("button-discard").onclick = function(ev) {
    options.alert = ""; // stop alert
    display(current);
  }

  listing.onclick = function(ev) {
    var elem = ev.target;
    while (elem && elem.nodeName !== "DIV" && !Util.hasClassName(elem,"item")) {
      elem = elem.parentNode;
    }

    var type = elem.getAttribute("data-type");
    var path = elem.getAttribute("data-path");
    if (ev.target.nodeName === "INPUT" || type!=="folder") {
      itemSelect(elem);
    }
    else {
      itemEnterFolder(current,path);
    }
  };

  document.getElementById("folder-name").onclick = function(ev) {
    var elem = ev.target;
    while (elem && elem.nodeName !== "DIV" && !Util.hasClassName(elem,"dir")) {
      elem = elem.parentNode;
    }
    if (Util.hasClassName(elem,"dir")) {
      var path = elem.getAttribute("data-path");
      itemEnterFolder(current,path);
    }
  };

  Util.enablePopupClickHovering();

  display( current  );
}

function canSelect(path,type) {
  var allowed = options.extensions.split(/\s+/);
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

function itemGetSelected() {
  var items = listing.children;
  for(var i = 0; i < items.length; i++) {
    if (Util.hasClassName(items[i],"selected")) {
      return items[i].getAttribute("data-path");
    }
  }
  return null;
}

function itemSelect(elem) {
  if (Util.hasClassName(elem,"disabled")) return;
  var select = !Util.hasClassName(elem,"selected");
  var items = listing.children;
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

function itemEnterFolder(current,path) {
  current.folder = path;
  display( current );
}

function setFileName( fname ) {
  document.getElementById("file-name").value = fname;
}
function getFileName( ) {
  return document.getElementById("file-name").value;
}

function setCurrent( newCurrent ) {
  current = newCurrent;
  display( current );
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
  

function display( current ) {
  app.className = "";
  listing.innerHTML = "";

  if (options.alert) {
    // alert message
    if (options.alert!=="true") {
      document.getElementById("message-alert").innerHTML = Util.escape(options.alert);
    }
    Util.addClassName(app,"command-alert");
    return Promise.resolved();
  }
  else {
    // set correct logo
    document.getElementById("remote-logo").src = "images/dark/" + current.remote.logo();
    
    // check connection
    return checkConnected(current.remote).then( function(isConnected) {
      if (!isConnected) {
        Util.addClassName(app,"command-login");
        return Promise.resolved();
      }
      else {
        Util.addClassName(app,"command-" + options.command );
        current.remote.getUserName().then( function(userName) {
          document.getElementById("remote-username").innerHTML = Util.escape( userName );
          return displayFolder(current);
        });
      }
    });
  }
}

function displayFolder( current ) {
  displayFolderName(current);
  listing.innerHTML = "Loading...";
  return current.remote.listing(current.folder).then( function(items) {
    //console.log(items);
    var html = items.map( function(item) {
      var disable = canSelect(item.path,item.type) ? "" : " disabled";
      return "<div class='item item-" + item.type + disable + "' data-type='" + item.type + "' data-path='" + Util.escape(item.path) + "'>" + 
                //"<input type='checkbox' class='item-select'></input>" +
                "<img class='item-icon' src='images/icon-" + item.type + (item.isShared ? "-shared" : "") + ".png'/>" +
                "<span class='item-name'>" + Util.escape(Util.basename(item.path)) + "</span>" +
             "</div>";

    });
    listing.innerHTML = html.join("");
  });
}

function displayFolderName(current) {
  var parts = current.folder.split("/");
  var html = "<span class='dir' data-path=''>" + current.remote.type() + "</span><span class='dirsep'>/</span>";
  var partial = "";
  parts.forEach( function(part) {
    if (part) {
      partial = Util.combine(partial,part);
      html = html + "<span class='dir' data-path='" + Util.escape(partial) + "'>" + Util.escape(part) + "</span><span class='dirsep'>/</span>";
    }
  });
  document.getElementById("folder-name").innerHTML = html;
}

function end( current, path ) {
  // return result
  if (current && path) {
    var result = current.remote.type() + "://" + path;
    console.log(result);
    Util.setCookie("picker-path", result, 10 );

  }
  // save state
  if (current) {
    var data = {
      remote: current.remote.type(),
      onedrive: remotes.onedrive.folder,
      dropbox: remotes.dropbox.folder,
    }
  }
  Util.setCookie("picker-data", JSON.stringify(data), 60*60*24*30 );

  window.close();
}

return {
  run: run,
}

});