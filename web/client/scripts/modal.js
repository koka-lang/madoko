/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], 
        function(Promise,Util) {

var fade = document.getElementById("fade");

var modal = document.getElementById("alert");
var header = document.getElementById("alert-header");
var footer = document.getElementById("alert-footer");
var content = document.getElementById("alert-content");
var headerContent = document.getElementById("alert-header-message");

function close() {
  if (fade) fade.style.display = "none";
  modal.style.display = "none";
}

//fade.onclick = function(ev) { close(); };

document.getElementById("alert-ok").onclick = function(ev) {
  close();
};

function open() {  
  if (fade) fade.style.display = "block";
  modal.style.display = "block";
}

function show( init ) {
  content.innerHTML = "";
  headerContent.innerHTML = "";
  var res = init(close,modal,header,footer,content);
  open();
  return res;
}

function showMessage( hdr, msg ) {
  return show( function(close,modal,header,footer,content) {
    if (hdr) headerContent.innerHTML = hdr;
    if (msg) content.innerHTML = msg;
  });
}

return {
  show : show,  
  close: close,
  showMessage: showMessage,
}

});