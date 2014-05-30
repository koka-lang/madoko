/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util", 
        "../scripts/remote-dropbox",
        "../scripts/remote-onedrive2",
        ], function(Promise,Util,Dropbox,Onedrive) {


var options = {
  command: "open", // open, connect, save, new
  root: "",
  extensions: "",
  file: "document"  
};

var app     = document.getElementById("app");
var listing = document.getElementById("listing");
var remotes = {
  dropbox: { remote: new Dropbox.Dropbox(options.root), folder: "" },
  onedrive: { remote: new Onedrive.Onedrive(options.root), folder: "" },
};
var remote  = remotes.dropbox.remote;
var folder  = remotes.dropbox.folder;

function run() {
  var hash = window.location.hash || "";
  if (hash[0]==="#") hash = hash.substr(1);
  hash.split("&").forEach( function(param) {
    var keyval = param.split("=");
    var key = keyval[0] ? decodeURIComponent(keyval[0]) : "";
    var val = keyval[1] ? decodeURIComponent(keyval[1]) : "";
    if (key) options[key] = val;
  });

  if (options.remote && remotes[options.remote]) {
    setRemote( remotes[options.remote] );
  }

  if (options.file) {
    setFileName( options.file );
  }

  document.getElementById("remote-dropbox").onclick = function(ev) {
    if (remote.type === Dropbox.type()) return;
    setRemote( remotes.dropbox );
  }

  document.getElementById("remote-onedrive").onclick = function(ev) {
    if (remote.type === Onedrive.type()) return;
    setRemote( remotes.onedrive );
  }

  document.getElementById("button-login").onclick = function(ev) {
    if (!remote || remote.connected()) return;
    remote.login().then( function(userName) {
      display( remote, folder );
    });
  }

  document.getElementById("button-logout").onclick = function(ev) {
    if (!remote || !remote.connected()) return;
    remote.logout();
    display( remote, folder );
  }

  document.getElementById("button-choose").onclick = function(ev) {
    var path = itemGetSelected();
    if (path) {
      end(remote,path);
    }
  }

  document.getElementById("button-save").onclick = function(ev) {
    var fileName = getFileName();
    if (fileName) {
      var path = Util.combine(folder,fileName);
      end(remote,path);
    }
  }

  document.getElementById("button-new").onclick = function(ev) {
    var fileName = getFileName();
    if (fileName) {
      var path = Util.combine(folder,fileName);
      end(remote,path);
    }
  }

  document.getElementById("button-cancel").onclick = function(ev) {
    end();
  }

  document.getElementById("button-discard").onclick = function(ev) {
    options.alert = ""; // stop alert
    display(remote,folder);
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
      itemEnterFolder(remote,path);
    }
  };

  document.getElementById("folder-name").onclick = function(ev) {
    var elem = ev.target;
    while (elem && elem.nodeName !== "DIV" && !Util.hasClassName(elem,"dir")) {
      elem = elem.parentNode;
    }
    if (Util.hasClassName(elem,"dir")) {
      var path = elem.getAttribute("data-path");
      itemEnterFolder(remote,path);
    }
  };

  Util.enablePopupClickHovering();

  display( remote, folder );
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

function itemEnterFolder(remote,path) {
  folder = path;
  display( remote, folder );
}

function setFileName( fname ) {
  document.getElementById("file-name").value = fname;
}
function getFileName( ) {
  return document.getElementById("file-name").value;
}

function setRemote( newRemote ) {
  remote = newRemote.remote;
  folder = newRemote.folder;
  display( remote, folder );
}


function display( remote, folder ) {
  app.className = "";
  listing.innerHTML = "";

  if (options.alert) {
    // alert message
    if (options.alert!=="true") {
      document.getElementById("message-alert").innerHTML = Util.escape(options.alert);
    }
    Util.addClassName(app,"command-alert");
  }
  else {
    // set correct logo
    document.getElementById("remote-logo").src = "images/dark/" + remote.logo();
    remote.getUserName().then( function(userName) {
      document.getElementById("remote-username").innerHTML = Util.escape( userName );
    });

    // check connection
    if (!remote.connected()) {
      Util.addClassName(app,"command-login");
    }
    else {
      Util.addClassName(app,"command-" + options.command );
      displayFolder(remote, folder);
    }
  }
}

function displayFolder( remote, folder ) {
  displayFolderName(remote,folder);

  remote.listing(folder).then( function(items) {
    //console.log(items);
    var html = items.map( function(item) {
      var disable = canSelect(item.path,item.type) ? "" : " disabled";
      return "<div class='item item-" + item.type + disable + "' data-type='" + item.type + "' data-path='" + Util.escape(item.path) + "'>" + 
                //"<input type='checkbox' class='item-select'></input>" +
                "<img class='item-icon' src='images/icon-" + item.type + ".png'/>" +
                "<span class='item-name'>" + Util.escape(Util.basename(item.path)) + "</span>" +
             "</div>";

    });
    listing.innerHTML = html.join("");
  });
}

function displayFolderName(remote, folder ) {
  var parts = folder.split("/");
  var html = "<span class='dir' data-path=''>" + remote.type() + "</span><span class='dirsep'>/</span>";
  var partial = "";
  parts.forEach( function(part) {
    if (part) {
      partial = Util.combine(partial,part);
      html = html + "<span class='dir' data-path='" + Util.escape(partial) + "'>" + Util.escape(part) + "</span><span class='dirsep'>/</span>";
    }
  });
  document.getElementById("folder-name").innerHTML = html;
}

function end( remote, path ) {
  if (remote && path) {
    var result = remote.type() + "://" + path;
    console.log(result);
    Util.setCookie("picker-path", result, 30 );
  }
  window.close();
}

return {
  run: run,
}

});