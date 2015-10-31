/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

var _main = (function() {

// -------------------------------------------------------------
// Configuration: get the secret from the url fragment and remove it.
// -------------------------------------------------------------
var config = {
  username: "(local user)",
  userid  : "(local user)",
  origin  : "",
  mount   : "",  
  secret  : urlParamsDecode(window.location.hash).secret || "",
};

// remove secret from history & display
if (window.history && window.history.replaceState) {
  window.history.replaceState(undefined,undefined,"#"); 
}

// -------------------------------------------------------------
// Helpers   
// -------------------------------------------------------------

function jsonParse(s,def) {
  try{
    return JSON.parse(s);
  }
  catch(exn) {
    return def;
  }
}

function startsWith(s,pre) {
  if (!pre) return true;
  if (!s) return false;
  return (s.substr(0,pre.length).indexOf(pre) === 0);
}


function properties(obj) {
  var attrs = [];
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      attrs.push(key);
    }
  } 
  return attrs;
}

function urlParamsEncode( obj ) {
  if (!obj || typeof(obj)==="string") return obj;
  var vals = [];
  properties(obj).forEach( function(prop) {
    vals.push( encodeURIComponent(prop) + "=" + encodeURIComponent( obj[prop] != null ? obj[prop].toString() : "") );
  });
  return vals.join("&");
}

function urlParamsDecode(hash) {
  if (!hash) return {}; 
  if (hash[0]==="?") { hash = hash.substr(1); }
  if (hash[0]==="#") { hash = hash.substr(1); }
  var obj = {};
  hash.split("&").forEach( function(part) {
    var i = part.indexOf("=");
    var key = decodeURIComponent(i < 0 ? part : part.substr(0,i));
    var val = decodeURIComponent(i < 0 ? "" : part.substr(i+1));
    obj[key] = val;
  });
  return obj;
}

function randomHash8() {
  return (Math.random()*99999999).toFixed(0);
}

// -------------------------------------------------------------
// Send requests to local server   
// -------------------------------------------------------------

function xhrRequest( info, method, path, cont ) {
	var req = new XMLHttpRequest();
	req.method = method;
	if (config.secret) info.params.secret = config.secret; // pass on secret
	info.params.nocache = randomHash8(); // IE tends to cache GET requests on localhost despite nocache headers..
	var query = urlParamsEncode(info.params);
	if (query) query = "?" + query;
	var content = info.content || null;
	
	req.open(req.method,"/rest/" + path + query, true);
	req.timeout = 10000;
  
	function reject(message) {
		message = message || req.responseText;
		var msg = (req.statusText || "network request failed") + (message ? ": " + message : "");
    cont(msg);
	};
	req.reject    = function(ev) { reject(); }
	req.onerror   = function(ev) { reject(); }
	req.ontimeout = function(ev) { reject("request timed out"); }
	req.onload    = function(ev) {
		try {
			if (req.readyState !== 4 || req.status < 200 || req.status > 299) {
				reject();
			}
			else {
				// parse result
        var type = req.getResponseHeader("Content-Type") || req.responseType;
        var res;
        if (startsWith(type,"application/json") || startsWith(type,"text/javascript")) {
          res = jsonParse(req.responseText, null);
        }
        else {
          res = req.response;
        }
				cont(null, res);
			}
		}
		catch(err) {
			reject(err);
		}
	}
	
	var contentType = null;
	var content = "";
	if (info.content) {
		if (typeof info.content === "string") {
			contentType = "text/plain";
			content = info.content;
		}
		else if (info.content instanceof Uint8Array) {
			contentType = "application/octet-stream";
			content = info.content;
		}
		else {
			contentType = "application/json";
			content = JSON.stringify(info.content);
		}
	}
  if (!info.responseType && info.params.binary) {
    info.responseType = "arraybuffer";
  }
  if (info.responseType) {
    req.overrideMimeType(info.responseType);
    req.responseType = info.responseType;
  }
	if (contentType) req.setRequestHeader("Content-Type", contentType);
	req.send(content);
}

/* -------------------------------------------------------------
Send requests to local server from an object;

type info = {
	method: string = "login", "reload", "title", or "(GET|PUT|POST):<rest path>"
	?params: object = parameters send as urlencoded query in the request
	   ?binary: bool = if binary content
  ?content: string | UInt8Array | object = send as content body
  ?contentType: string
}
-------------------------------------------------------------*/

function jsonRequest( info, cont ) {
	try {
		if (typeof info==="string") info = { method: info };
		if (!info.params) info.params = {};
		var cap = /^(GET|PUT|POST):(\w+)$/.exec(info.method);
		if (info.method === "login" || info.method === "connect") {
			cont(null,{ name: config.username, id : config.userid, mount: config.mount });
		}
		else if (info.method === "reload") {
			window.location.reload(info.params.force);
			cont(null,{});
		}
    else if (info.method === "title" && typeof info.params.title === "string") {
      document.title = info.params.title.replace(/^(\w+)/,"$1Local");
      cont(null,{});
    }
		else if (cap) {
			xhrRequest( info, cap[1], cap[2], cont );
		}
		else {
			cont("unknown method call (" + info.method + ")");
		}
	}
	catch(err) {
		var msg = "unknown error";
		if (typeof err==="string") msg = err;
		else if (typeof err.message ==="string") msg = err.message;
		cont(msg);
	}
}

// Listen to event message:
// Security: only accept messages from our frame with our configured origin.
// The origin is determined by the server and usually https://www.madoko.net.
// The response message is also only sent to the frame with our configured origin as the target.
var frame = document.getElementById("madokoframe");
	
window.addEventListener( "message", function(ev) {
  if (ev.origin !== config.origin) return;
	if (ev.source !== frame.contentWindow) return;
	if (typeof ev.data !== "object") return;
	var info = ev.data;
	if (info.eventType !== "localhost") return;
	jsonRequest( info, function(err,res) {
		var msg = { eventType:"localhost", messageId: info.messageId };
		if (err) {
			msg.error = err;
		}
		else {
			msg.result = res;
		}
		frame.contentWindow.postMessage( msg, config.origin );
	});
});

// start off by requesting configuration info
jsonRequest( { method: "GET:config", params: { show: true } }, function(err,info) {
	if (err) {
		document.body.textContent = err.toString();
	}
	else {
		config.origin   = info.origin;
		config.username = info.username;
		config.userid   = info.userid;
		config.mount    = info.mount;
		frame.setAttribute("src", config.origin + "/editor.html");
	}
});

// invoke main as an anonymous function
})();
