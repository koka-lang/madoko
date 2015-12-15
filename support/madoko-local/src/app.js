/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {

// -------------------------------------------------------------
// Imports
// -------------------------------------------------------------
var Express     = require('express');
var BodyParser  = require("body-parser");

// local modules
var Util        = require("./util.js");
var Promise     = require("./promise.js");
var Log         = require("./log.js");


// -------------------------------------------------------------
// Error handling (with promises)
// -------------------------------------------------------------
function handleError(err,req,res,next) {
  if (!err) err = "unknown error";
  console.log("----- error --------");
  console.log(err.message || err.toString());
  console.log("----- stack --------");
  console.log(err.stack || err);
  console.log("--------------------");

  var result = {
    message: err.message || err.toString(),
  };
  result.httpCode = err.httpCode || (Util.startsWith(result.message,"unauthorized") ? 500 : 500);
  
  //console.log("*****\nerror (" + result.httpCode.toString() + "): " + result.message);
  Util.dnsReverse(req.ip).then( function(doms) {
    Log.entry( {
      type: "error",
      error: result,
      ip: req.ip,
      domains: doms,    
      url: req.url,
      date: new Date().toISOString()
    });
  });

  res.status( result.httpCode ).send( "error: " + result.message );
}

function handleErrors( app ) {
  app.use( handleError );
}

// -------------------------------------------------------------
// Define a server entry point that handles promises
// -------------------------------------------------------------

function promiseEntry(action) {
  return (function(req,res) {
    var result = Promise.wrap( action, req, res);
    if (result && result.then) {
      result.then( function(finalres) {
          if (finalres != null) {
            res.send(finalres);
          }
        }, 
        function(err) {
          handleError(err,req,res);
        });
    }
    else return result;
  });
}

function entryGet( app, entry, action ) { 
  app.get(entry, promiseEntry(action) );
}

function entryPut( app, entry, action ) { 
  app.put(entry, promiseEntry(action) );
}

function entryPost( app, entry, action ) { 
  app.post(entry, promiseEntry(action) );
}

function entries( app, entries ) {
  Util.properties(entries).forEach(function(key) {
    var action = entries[key];
    if (key.startsWith("GET/"))       entryGet( app, key.substr(3), action );
    else if (key.startsWith("PUT/"))  entryPut( app, key.substr(3), action );
    else if (key.startsWith("POST/")) entryPost( app, key.substr(4), action );
    else throw new Error( "unrecognized METHOD: " + key );
  });
}




// -------------------------------------------------------------
// Set up server app  
// -------------------------------------------------------------
function createServer(maxFileSize) {
  var app = Express();
  app.locals.mime = Express.static.mime;
 
  // -------------------------------------------------------------
  // Basic middleware
  // -------------------------------------------------------------
  app.use(function(req, res, next) {
    //console.log("adjust csp header");
    if (req.headers['content-type']==="application/csp-report") {
      req.headers['content-type'] = "application/json";
    }
    next();
  });

  app.use(BodyParser.urlencoded({limit: maxFileSize, extended: true}));
  app.use(BodyParser.json({limit: maxFileSize, strict: false }));
  app.use(BodyParser.text({limit: maxFileSize, type:"text/*" }));
  app.use(BodyParser.raw({limit: maxFileSize, type:"application/octet-stream" }));

  // -------------------------------------------------------------
  // Basic security   
  // -------------------------------------------------------------
  app.use(function(req, res, next){
    // console.log("referer: " + req.get("Referrer") + ", path: " + req.path + ", host: " + req.hostname);
    if (Util.startsWithI(req.path,"/rest/")) {
      // for security do not store any rest or oauth request
      // console.log("cache: no-store: " + req.path);
      res.setHeader("Cache-Control","no-store");
    }
        
    // Don't allow content to be loaded in an iframe (legacy header)
    res.setHeader("X-Frame-Options","DENY");      
    next();
  });        

  return app;
}

function useCSP( app, csp, reportOnly ) {
  app.use( function(req,res,next) {
    // Set CSP header
    var cspHeader = Util.properties(csp).map(function(key) { return key + " " + csp[key]; }).join(";");
    if (reportOnly) {
      res.setHeader("Content-Security-Policy-Report-Only",cspHeader);
    }
    else {
      res.setHeader("Content-Security-Policy",cspHeader);
    }
    next();
  });
}

function serveStatic( app, dir, options ) {
  if (!options) options = {};
  if (!options.maxAge) options.maxAge = 10000;
  var staticClient = Express.static( dir, options);
  app.use('/', function(req,res,next) {
    Log.trace("serve static : " + req.url);
    return staticClient(req,res,next);
  });
}

return {
  createServer  : createServer,
  serveStatic   : serveStatic,
  handleErrors  : handleErrors, 
  useCSP        : useCSP, 
  entries       : entries,
};

});