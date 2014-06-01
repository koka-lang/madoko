/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

function setCookie( name, value, maxAge ) {
  var date = new Date( Date.now() + maxAge * 1000 );
  document.cookie = name + "=" + encodeURIComponent(value) + ";path=/;secure;expires=" + date.toGMTString();
}

function getCookie(name) {
  var rx  = RegExp("\\b" + name + "=([^;&]*)");
  var cap = rx.exec(document.cookie);
  return (cap ? decodeURIComponent(cap[1]) : null);
}


function decodeParams(hash) {
  if (!hash) return {};
  if (hash[0]==="#") hash = hash.substr(1);
  var obj = {};
  hash.split("&").forEach( function(part) {
    var i = part.indexOf("=");
    var key = decodeURIComponent(i < 0 ? part : part.substr(0,i));
    var val = decodeURIComponent(i < 0 ? "" : part.substr(i+1));
    obj[key] = val;
  });
  return obj;
}

var success = false;
var script = document.getElementById("auth");
var remote = (script ? script.getAttribute("data-remote") : "");

if (remote && window && window.location && window.location.hash) {
  var params = decodeParams(window.location.hash);
  //document.body.innerHTML = JSON.stringify(params);

  var state = getCookie("oauth-state");
  if (state && state === params.state) {  // protect against CSRF attack
    if (params.access_token) {
      var year = 60*60*24*365;
      setCookie( "auth_" + remote, params.access_token, year );
      var success = true;
    }
    else {
      document.body.innerHTML = "The access_token was not present in the reponse.";
    }
  }
  else {
    document.body.innerHTML = "The state parameter does not match; this might indicate a CSRF attack?";
  }
}

if (success) {
  window.close();
}

