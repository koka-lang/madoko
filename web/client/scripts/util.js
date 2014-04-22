/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["std_core","std_path","../scripts/promise"],function(stdcore,stdpath,Promise) {

  var Msg = { 
    Normal: "normal", 
    Info: "info", 
    Warning: "warning", 
    Error: "error", 
    Exn: "exception",
    Status: "status",
    Tool: "tool",
    Trace: "trace",
  };

  var warning;
  var status;
  var consoleOut;
  if (typeof document !== "undefined") {
    warning    = document.getElementById("warning");
    status     = document.getElementById("status");
    consoleOut = document.getElementById("koka-console-out");
  }

  var escapes = {
      '&': '&amp;', // & first!
      '<': '&lt;',
      '>': '&gt;',
      '\'': '&apos;',
      '"': '&quot;',
      '\n': '<br>',
      '\r': '',
      ' ': '&nbsp;',
  };
  var escapes_regex = new RegExp("[" + Object.keys(escapes).join("") + "]", "g");

  function htmlEscape(txt) {
    return txt.replace(escapes_regex, function (s) {
      var r = escapes[s];
      return (r ? r : "");
    });
  }

  // Call for messages
  function message( txt, kind ) {
    if (typeof txt === "object") {
      if (txt.stack) {
        console.log(txt.stack);
      }
      if (txt.message) 
        txt = txt.message;
      else
        txt = txt.toString();
    }
    if (!kind) kind = Msg.Normal;
    // stdcore.println(txt);
    console.log("madoko: " + (kind !== Msg.Normal ? kind + ": " : "") + txt);
    if (kind !== Msg.Trace && consoleOut && status && warning) {
      function span(s,n) {
        if (n && s.length > n-2) {
          s = s.substr(0,n) + "...";
        }
        return "<span class='msg-" + kind + "'>" + htmlEscape(s) + "</span>";
      }

      consoleOut.innerHTML = "<div class='msg-section'>" + span(txt) + "</span></div>" + consoleOut.innerHTML;
      
      if (kind===Msg.Warning || kind===Msg.Error || kind===Msg.Exn) {
        status.innerHTML = span(txt,35);
        removeClassName(warning,"hide");
      }
      else if (kind===Msg.Status) {
        status.innerHTML = span(txt,35);
        addClassName(warning,"hide");
      }
    }
  }

  function assert( pred, msg ) {
    if (!pred) {
      console.log("assertion failed: " + msg);
    }
  }

  // Get the properties of an object.
  function properties(obj) {
    var attrs = [];
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        attrs.push(key);
      }
    } 
    return attrs;
  }

  // extend target with all fields of obj.
  function extend(target, obj) {
    properties(obj).forEach( function(prop) {
      target[prop] = obj[prop];
    });
  }

  function copy(src ) {
    return clone(src,false);
  }

  function clone(src, deep, _visited) 
  {
    deep = (deep===undefined ? true : deep);

    if (src==null || typeof(src)!=="object") {
      return src;
    }
    if (deep) {
      if (typeof _visited===undefined) {
        _visited = [];
      }
      else {
        var i,len = _visited.length;
        for(i=0; i<len; i++) {
          if (_visited[i]===src) return src;
        }
      }
      _visited.push(src);
    }

    if (typeof src.clone === "function") {
      return src.clone(true);
    }
    else if (src instanceof Date){
      return new Date(src.getTime());
    }
    else if(src instanceof RegExp){
      return new RegExp(src);
    }
    else if(src.nodeType && typeof src.cloneNode == 'function'){
      return src.cloneNode(true);
    }
    else {
      var proto = (Object.getPrototypeOf ? Object.getPrototypeOf(src): src.__proto__);
      if (!proto) {
        proto = src.constructor.prototype;
      }
      var dest = Object.create(proto);
      for(var key in src){
        dest[key] = (deep ? clone(src[key],true,_visited) : src[key]);
      }
      return dest;
    }
  }


  var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
  };


  function contains( xs, s ) {
    if (!xs) return false;
    if (!s) return true;
    if (xs instanceof Array) {
      for(var i = 0; i < xs.length; i++) {
        if (xs[i] === s) return true;
      }
    }
    else if (typeof xs === "string") {
      if (xs.indexOf(s) >= 0) return true;
    }
    return false;
  }

  function hasClassName( elem, cname ) {    
    var names = elem.className.split(/\s+/);
    return contains(names,cname);
  }

  function toggleClassName( elem, cname ) {
    if (hasClassName(elem,cname)) {
      removeClassName(elem,cname);
    }
    else {
      addClassName(elem,cname);
    }
  }

  function removeClassName( elem, cname ) {
    var cnames = elem.className;
    var names = cnames.split(/\s+/);
    var newnames = names.filter( function(n) { return (n !== cname); });
    if (names.length !== newnames.length) {
      elem.className = newnames.join(" ");
    }
  }

  function addClassName( elem, cname ) {
    var cnames = elem.className;
    var names = cnames.split(/\s+/);
    if (!contains(names,cname)) {
      elem.className = cnames + " " + cname;
    }    
  }

  function startsWith(s,pre) {
    if (!pre) return true;
    if (!s) return false;
    return (s.substr(0,pre.length).indexOf(pre) === 0);
  }

  function endsWith(s,post) {
    if (!post) return true;
    if (!s) return false;
    var i = s.indexOf(post);
    return (i >= 0 && (s.length - post.length) == i);
  }


  var imageExts = ["",".jpg",".png",".gif",".svg"].join(";");
  function hasImageExt(fname) {
    var ext = stdpath.extname(fname);
    if (!ext) return false;
    return contains(imageExts,ext);
  }

  var textExts = ["",".bib",".mdk",".md",".txt",".tex",".sty",".cls",".js"].join(";");
  function hasTextExt(fname) {
    var ext = stdpath.extname(fname);
    if (!ext) return false;
    return (contains(textExts,ext) && !endsWith(fname,".final.tex"));
  }


  function toggleButton( elemName, text0, text1, action ) {
    var button = (typeof elemName === "string" ? document.getElementById(elemName) : elemName);
    var toggled = true;
    function toggle() {
      toggled = !toggled;
      if (text0) button.innerHTML = (toggled ? text1 : text0);
    }
    toggle();
    button.onclick = function(ev) {
      toggle();
      action(ev,toggled);
    }
  }

  function px(s) {
    if (typeof s === "number") return s;
    var cap = /^(\d+(?:\.\d+)?)(em|ex|pt|px|pc|in|mm|cm)?$/.exec(s);
    if (!cap) return 0;
    var i = parseInt(cap[1]);
    if (isNaN(i)) return 0;
    if (cap[2] && cap[2] !== "px") {
      var dpi = 96;
      var empx = 12;
      if (cap[2]==="em") {
        i = (i * empx);
      }
      else if (cap[2]==="ex") {
        i = (i * empx * 0.5);
      }
      else if (cap[2]==="pt") {
        i = (i/72) * dpi;
      }
      else if (cap[2]==="pc") {
        i = (i/6) * dpi;
      }
      else if (cap[2]==="in") {
        i = i * dpi;
      }
      else if (cap[2]==="mm") {
        i = (i/25.6) * dpi;
      }
      else if (cap[2]==="cm") {
        i = (i/2.56) * dpi;
      }
    }
    return i;
  }

  function asyncForEach( xs, asyncAction, cont ) {
    if (!xs || xs.length===0) return cont(0,[]);
    var count = xs.length;
    var objs  = [];
    var err   = null;
    xs.forEach( function(x) {
      function localCont(xerr,obj) {
        objs.push(obj);
        if (xerr) err = xerr;
        count--;
        if (count <= 0) cont(err,objs);
      }
      try {
        asyncAction(x, localCont );
      }
      catch(exn) {
        localCont(exn);
      }
    });
  }

  function animate( elem, props, duration, steps ) {
    var ival = (steps ? duration / steps : 50);
    steps = (duration / ival) | 0;
    if (steps <= 0) steps = 1;
    var elem0 = {};
    properties(props).forEach( function(prop) {
      elem0[prop] = elem[prop];
    });
    var n = 0;
    if (elem.animate) {
      clearInterval(elem.animate);
    }
    var action = function() {
      n++;
      if (n >= steps) {
        clearInterval(elem.animate);
        elem.animate = undefined;
        properties(props).forEach(function(prop) {
          elem[prop] = props[prop];
        });
      }
      else {
        properties(props).forEach(function(prop) {
          var x = elem0[prop] + ((props[prop] - elem0[prop]) * (n/steps));
          elem[prop] = x;
        });
      }
    };

    elem.animate = setInterval( action, ival);
    action(); // perform one step right away
  }

  function unpersistMap(obj) {
    var map = new Map();
    properties(obj).forEach( function(prop) {
      map[prop] = obj[prop];
    });
    return map;
  }

  var Map = (function() {
    function Map() { };

    Map.prototype.persist = function() {
      return this;
    };

    Map.prototype.set = function( name, value ) {
      this["/" + name] = value;
    }

    Map.prototype.get = function( name ) {
      return this["/" + name];
    }

    Map.prototype.contains = function( name ) {
      return (this.get(name) !== undefined);
    }

    Map.prototype.delete = function( name ) {
      this.set(name,undefined);
    }

    // apply action to each element. breaks early if action returns "false".
    Map.prototype.forEach = function( action ) {
      var self = this;
      properties(self).every( function(name) {
        if (name.substr(0,1) === "/") {
          var res = action(name.substr(1), self[name]);
          return (res===false ? false : true);
        }
      });
    }

    Map.prototype.elems = function() {
      var self = this;
      var res = [];
      self.forEach( function(name,elem) {
        res.push(elem);
      });
      return res;
    }

    return Map;
  })();

  var ContWorker = (function() {
    function ContWorker( scriptName ) {
      var self = this;
      self.promises = {};
      self.unique = 1;
      
      // collect message while the worker starts up
      self.ready = false;
      self.postqueue = []; 

      self.worker = new Worker("madoko-worker.js");
      self.worker.addEventListener("message", function(ev) {
        var res = ev.data;
        self._onComplete(res);
      });
    }

    ContWorker.prototype._isReady = function() {
      return self.ready;
    }

    ContWorker.prototype.postMessage = function( info ) {
      var self = this;
      var promise = new Promise();
      if (!self.ready) {
        self.postqueue.push( { info: info, promise: promise });
      }
      else {
        var id = self.unique++;
        info.messageId = id; 
        self.promises[id] = promise;
        self.worker.postMessage( info );
      }
      return promise;
    }

    ContWorker.prototype._onComplete = function( info ) {
      var self = this;
      if (!info || typeof info.messageId === "undefined") return;
      if (info.messageId === 0) {
        self.ready = true;
        self.postqueue.forEach( function(elem) {  // post delayed messages
          self.postMessage( elem.info ).then(elem.promise);
        });
      }
      else {
        var promise = self.promises[info.messageId];
        self.promises[info.messageId] = undefined;
        if (!promise) return;
        promise.resolve(info);
      }
    }

    return ContWorker;
  })();


  var AsyncRunner = (function() {
    function AsyncRunner( refreshRate, spinner, isStale, action ) {
      var self = this;
      self.spinner = spinner;
      self.isStale = isStale;
      self.action = action;
      self.ival = 0;
      self.round = 0;
      self.lastRound = 0;
      self.stale = false;
      self.refreshRate = refreshRate || 1000;
      self.resume(refreshRate);
    }
    
    AsyncRunner.prototype.resume = function(refreshRate) {
      var self = this;
      if (!self.ival) {
        self.refreshRate = refreshRate || self.refreshRate;
        self.ival = setInterval( function(){ self.update(); }, refreshRate );
      }
    }

    AsyncRunner.prototype.pause = function() {
      var self = this;
      if (self.ival) {
        clearInterval(self.ival);
        self.ival = 0;
      }
    }

    AsyncRunner.prototype.setStale = function() {
      var self = this;
      self.stale = true;
      self.run();
    }

    AsyncRunner.prototype.clearStale = function() {
      var self = this;
      self.stale = false;
    }

    AsyncRunner.prototype.update = function() {
      var self = this;
      if (!self.stale && self.isStale) {
        self.stale = self.isStale();
      }
      self.run();
    }

    AsyncRunner.prototype.run = function() {
      var self = this;
      if (self.stale && self.round <= self.lastRound) {
        self.stale = false;
        self.round++;
        var round = self.round;
        //setTimeout( function() {
        //  if (self.lastRound < round && self.spinner) 
        self.spinner(true);
        //}, 200);
        self.action( self.round, function() {
          if (self.lastRound < round) {
            self.lastRound = round;          
            if (self.spinner) self.spinner(false);
          }
        });
        return true;
      }
      else {
        return false;
      }
    }

    return AsyncRunner;
  })();

  function urlEncode( obj ) {
    var vals = [];
    properties(obj).forEach( function(prop) {
      vals.push( encodeURIComponent(prop) + "=" + encodeURIComponent( obj[prop] ? obj[prop].toString() : "") );
    });
    return vals.join("&");
  }

  function requestGET( opts, params ) {
    var reqparam = (typeof opts === "string" ? { url: opts } : opts);
    if (!reqparam.method) reqparam.method = "GET";

    var query = (params ? urlEncode(params) : "");
    if (query) reqparam.url = reqparam.url + "?" + urlEncode(params);
    reqparam.contentType = null;
    
    return requestPOST( reqparam, "" );
  }
  
  function requestPUT( opts, params ) {
    var reqparam = (typeof opts === "string" ? { url: opts } : opts);
    if (!reqparam.method) reqparam.method = "PUT";

    return requestPOST( reqparam, params );
  }

  function requestPOST( opts, params ) {
    var reqparam = (typeof opts === "string" ? { url: opts } : opts);    
    var req = new XMLHttpRequest();
    req.open(reqparam.method || "POST", reqparam.url, true );
    
    var timeout = 0;  // timeout handler id.
    var promise = new Promise();

    function reject() {
      if (timeout) clearTimeout(timeout);
      var msg = req.statusText;
      var res = req.responseText;
      var type = req.getResponseHeader("Content-Type");
      if (req.responseText && startsWith(type,"application/json;")) {
        var res = JSON.parse(req.responseText);
        if (res.error && res.error.message) {
          msg = msg + ": " + res.error.message + (res.error.code ? "(" + res.error.code + ")" : "");
        }      
      }
      else {
        msg = msg + ": " + req.responseText;
      }
      //cont(msg, res, req.response);
      console.log(msg + "\n request: " + reqparam.method + ": " + reqparam.url );
      promise.reject(msg);
    }

    req.onload = function(ev) {
      if (req.readyState === 4 && req.status >= 200 && req.status <= 299) {
        if (timeout) clearTimeout(timeout);
        var type = req.getResponseHeader("Content-Type");
        var res;
        if (startsWith(type,"application/json;")) {
          res = JSON.parse(req.responseText);
        }
        else {
          res = req.responseText;
        }
        promise.resolve(res,req.response);
      }
      else {
        reject();
      }
    }
    req.reject = function(ev) {
      reject();
    }
    req.onerror = function(ev) {
      reject();
    }
    req.ontimeout = function(ev) {
      reject();
    }
    
    var contentType = "text/plain";
    var content = null;

    if (typeof params === "string") {
      contentType = "text/plain";
      content = params;
    } 
    // object: use url-encoded for GET and json for POST/PUT      
    else if (reqparam.method==="GET") {
      contentType = "application/x-www-form-urlencoded";
      content = urlEncode(params);
    }
    else {
      contentType = "application/json";
      content = JSON.stringify(params);
    }
    
    // override content type?
    if (reqparam.contentType !== undefined) {
      contentType = reqparam.contentType;
    }
    // override response type?
    if (reqparam.responseType != null) {
      req.overrideMimeType(reqparam.responseType);
      req.responseType = reqparam.responseType;
    }
    
    if (contentType != null) req.setRequestHeader("Content-Type", contentType);    
    if (reqparam.timeout != null) req.timeout = reqparam.timeout;
    req.send(content);
    
    return promise;
  }

  function downloadText(fname,text) {
    w = window.open();
    doc = w.document;
    doc.open( 'text/html','replace');
    doc.charset = "utf-8";
    doc.write(text);
    doc.close();
    w.scrollTo(0,0);
    //doc.execCommand("SaveAs", null, fname)
  }

  function downloadFile(url) 
  {
    window.open(url, "_newtab");    
  }
    //var frame = document.getElementById("download-frame");
    //frame.src = url + "?download";
  /*
    var userAgent = navigator.userAgent.toLowerCase();
    //If in Chrome or Safari - download via virtual link click
    if ((contains(userAgent,"chrome") || contains(userAgent,"safari")) && document.createEvent) {
      var link = document.createElement('a');
      link.href = url;

      if (link.download !== undefined){
        //Set HTML5 download attribute. This will prevent file from opening if supported.
        link.download = stdpath.basename(url);
      }

      var ev = document.createEvent('MouseEvents');
      ev.initEvent('click' ,true ,true);
      link.dispatchEvent(ev);
      //link.click();
    }
    else {
      window.open(url + "?download");
    }
  }
*/
  /*
w = window.open();
doc = w.document;
doc.open( mimetype,'replace');
doc.charset = "utf-8";
doc.write(data);
doc.close();
doc.execCommand("SaveAs", null, filename)
*/

   
  
  return {
    properties: properties,
    extend: extend,
    copy: copy,
    message: message,
    assert: assert,
    escape: htmlEscape,
    Msg: Msg,
    
    changeExt: stdpath.changeExt,
    extname: stdpath.extname,
    basename: stdpath.basename,
    dirname: stdpath.dirname,
    stemname: stdpath.stemname,

    hasImageExt: hasImageExt,
    hasTextExt: hasTextExt,

    startsWith: startsWith,
    endsWith: endsWith,
    contains: contains,
    
    hasClassName: hasClassName,
    toggleClassName: toggleClassName,
    removeClassName: removeClassName,
    addClassName:addClassName,    
    toggleButton: toggleButton,
    px: px,
    animate: animate,
    asyncForEach: asyncForEach,

    requestPOST: requestPOST,
    requestPUT: requestPUT,
    requestGET: requestGET,
    downloadFile: downloadFile,
    downloadText: downloadText,

    Map: Map,
    unpersistMap: unpersistMap,
    ContWorker: ContWorker,
    AsyncRunner: AsyncRunner,
    Promise: Promise,
  };
});