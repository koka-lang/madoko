/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

var script  = document.getElementById("auth");
var remote  = (script ? decodeURIComponent(script.getAttribute("data-remote")) : "");
var status  = (script ? decodeURIComponent(script.getAttribute("data-status")) : "unknown");
var isIE    = Object.hasOwnProperty.call(window, "ActiveXObject");

function windowClose() {
  if (isIE) window.open('','_parent',''); 
  window.close();  
}

document.getElementById("button-close").onclick = function() {
  windowClose();
};

if (status === "ok") {
  windowClose();
}
else if (status === "xlogin") {
  oauthXLogin();
}
else if (status === "flow") {
  oauthTokenFlow();
}


/* -----------------------------------------------------------------------
   Oauth Code flow with encrypted access_token
----------------------------------------------------------------------- */

function oauthXLogin() 
{
  var success = false;
  try {
    if (remote && window && window.localStorage 
         // && window.location && window.opener && window.opener.location 
         // && window.location.origin === window.opener.location.origin
       )
    {
      var xlogin = (script ? decodeURIComponent(script.getAttribute("data-xlogin")) : null);
      if (xlogin) {
        window.localStorage["remote-" + remote] = xlogin;
        success = true;
      }
      else {
        message("The access_token was not present in the response.");
      }
    }
    else {
      message("The page that tried to login to " + remote + " was not from the Madoko server; this might indicate a CSRF attack?");
    }
  }
  catch(exn) {
    message("Error, could not log in:<br>" + encodeURI(exn.toString()));
  }

  if (success) {
    windowClose();
  }
}


/* -----------------------------------------------------------------------
   Oauth Token flow
----------------------------------------------------------------------- */

function message(msg) {
  var elem = document.getElementById("message");
  if (elem && elem.textContent) {
    elem.textContent = msg;
  }  
}

function setSessionValue( owner, name, value ) {
  if (owner.sessionStorage && name) owner.sessionStorage.setItem(name,value);
}

function getSessionValue(owner, name) {
  return (owner.sessionStorage && name ? owner.sessionStorage.getItem(name) : null);
}

function removeSessionValue(owner, name) {
  if (owner.sessionStorage && name) owner.sessionStorage.removeItem(name);
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

function oauthTokenFlow() 
{
  var success = false;
  try {
    if (remote && window && window.location && window.location.hash) {
      if (window.location.origin === window.opener.location.origin) {
        var params = decodeParams(window.location.hash);
        //document.body.innerHTML = JSON.stringify(params);

        var state = getSessionValue(window, "oauth/state-" + remote); // read our own session storage: this can only read values from the same-origin session
        removeSessionValue( window.opener, "oauth/state-" + remote);  // clear state token
        if (state && params.state && state === params.state) {  // protect against CSRF attack
          if (params.access_token) {
            var info = { access_token: params.access_token, created: new Date().toISOString() };
            if (params.uid) info.uid = params.uid;
            if (params.refresh_token) info.refresh_token = params.refresh_token;
            setSessionValue( window.opener, "oauth/auth-" + remote, JSON.stringify(info) );  // write back to our opener; we already verified that it has the same origin
            var success = true;
          }
          else {
            message("The access_token was not present in the reponse.");
          }
        }
        else {
          message("The state parameter does not match; this might indicate a CSRF attack?");
        }
      }
      else {
        message("The page that tried to login to " + remote + " was not from the Madoko server; this might indicate a CSRF attack?");
      }
    }
  }
  catch(exn) {
    message("Error, could not log in:<br>" + encodeURI(exn.toString()));
  }

  if (success) {
    windowClose();
  }
}
