/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// -------------------------------------------------------------
// Imports
// -------------------------------------------------------------

var Path        = require("path");
var Readline    = require("readline");
var Http        = require("http");

// local modules
var Util    = require("./util.js");
var Log     = require("./log.js");
var Promise = require("./promise.js");
var Init    = require("./init.js");
var Sandbox = require("./sandbox.js");
var Run     = require("./run.js");
var App     = require("./app.js");

var localHostIP = "127.0.0.1";

// -------------------------------------------------------------
// Parse command line and initialize the configuration options
// -------------------------------------------------------------

var config = Init.initializeConfig();

// -------------------------------------------------------------
// Set up server app  
// -------------------------------------------------------------
var app = App.createServer(config.limits.fileSize);
config.mime = app.locals.mime;

// set extra mime types
app.locals.mime.define({    
  "text/madoko": ["mdk"],
  "text/markdown": ["md","mkdn","markdown"],
  "text/plain": ["tex","sty","cls","bib","bbl","aux","dimx","dim","csl","bst"],
});

// -------------------------------------------------------------
// Security   
// -------------------------------------------------------------

app.use(function(req, res, next){
  // check secret
  if (config.secret && Util.startsWithI(req.path,"/rest/")) {
    if (config.secret !== req.query.secret) {
      throw new Util.HttpError( "unauthorized access; secret key is not correct.", 401 );
    }
  }
 
  // extra check: only serve to local host
  if (req.ip !== req.connection.remoteAddress || req.ip !== localHostIP) {
    throw new Util.HttpError( "only serving localhost", 403 );
  }

  // check mount directory matches
  if (config.mountdir && req.query && req.query.mount) {
    if (!Util.pathIsEqual(req.query.mount, config.mountdir)) {
      throw new Util.HttpError(  
        ["Document was previously served from a different local root directory!",
         "  Previous root: " + req.query.mount,
         "  Current root : " + config.mountdir].join("\n"), 403 );
    }
  }

  next();
});

// Use content security policy; very safe by default.
App.useCSP(app, { 
  "default-src": "'self'",
  "connect-src": "'self'",
  "style-src"  : "'self' 'unsafe-inline'", // mostly for chrome-extensions :-(
  "frame-src"  : config.origin,
  "frame-ancestors": "'none'",
  "report-uri": "/report/csp",
});


// -------------------------------------------------------------
// File helpers
// -------------------------------------------------------------

function finfoFromStat( stat, fpath ) {
  var finfo;
  if (stat===null) {
    finfo = null;
  }
  else {
    finfo = { 
      bytes: stat.size,
      modified: stat.mtime.toISOString(),    
      is_dir: stat.isDirectory(),
      path: fpath,
      contents: [],
    };
  };
  return finfo;    
}


function getLocalPath(fpath) {
  return Sandbox.getSafePath(config.mountdir,fpath);
}

// -------------------------------------------------------------
// Initial page 
// -------------------------------------------------------------

function getConfig(req,res) {
  if (req.query.show) {
    Log.message("\nlocally host madoko to: " + req.connection.remoteAddress + " (" + req.hostname + ")\n" + 
                  "serving files under   : " + config.mountdir + "\n");
  }
  res.send( {
    origin  : config.origin,
    username: config.username,
    userid  : config.userid,
    mount   : config.mountdir,
    canRunLocal : (config.run != null),
  });
}

// -------------------------------------------------------------
// Metadata
// -------------------------------------------------------------

function getMetadata(req,res) {
  //console.log("get metadata");
  var relpath = req.query.path;
  var fpath = getLocalPath(relpath);
  return Util.fstat(fpath).then( function(stat) {
    var finfo = finfoFromStat(stat,relpath);
    //console.log("read metadata: " + fpath );
    if (finfo && finfo.is_dir) {
      return Util.readDir(fpath).then( function(files) {
        //console.log("found:\n" + files.join("\n"));
        return Promise.when(files.map( function(fname) { return Util.fstat(Util.combine(fpath,fname)); } )).then( function(stats) {
          finfo.contents = [];
          for(var i = 0; i < stats.length; i++) {
            if (stats[i] != null && Sandbox.isSafePath(fpath,files[i])) { // only list valid accessible files
              finfo.contents.push( finfoFromStat(stats[i], Util.combine(relpath,files[i])) );
            }
          }
          Log.trace("dir listing: " + finfo.path + ": " + finfo.contents.length.toString() + " items.");      
          return finfo;
        });
      });
    }
    else {
      Log.trace("file meta  : " + relpath + (finfo ? ", modified: " + finfo.modified : ", not found."), 3);
      return finfo;
    }
  }, function(err) {
    throw err;
  }).then( function(finfo) {
    res.send(finfo);
  });
}

// -------------------------------------------------------------
// Read & Write
// -------------------------------------------------------------

function getReadFile(req,res) {
  Log.info("read file   : " + req.query.path);
  var fpath = getLocalPath(req.query.path);
  return Util.readFile( fpath, { encoding: (req.query.binary ? null : "utf8" ) } ).then( function(data) {
    res.send(data);
  });
}

function putWriteFile(req,res) {
  Log.info("write file  : " + req.query.path);
  var fpath = getLocalPath(req.query.path); 
  var rtime = (typeof req.query.remoteTime === "string" ? Util.dateFromISOString(req.query.remoteTime) : null);
  return Util.fstat( fpath ).then( function(stat) {
    if (stat && rtime) {
      //trace("file write: " + fpath + "\n remoteTime: " + req.query.remoteTime + "\n rtime: " + rtime.toISOString() + "\n mtime: " + stat.mtime.toISOString());
      if (stat.mtime.getTime() > rtime.getTime()) {  // todo: is there a way to do real atomic updates? There is still a failure window here...
        Log.trace("file write : atomic fail: " + req.query.path + "\n remoteTime: " + req.query.remoteTime + "\n rtime: " + rtime.toISOString() + "\n mtime: " + stat.mtime.toISOString());
        throw new Util.HttpError( "File was modified concurrently; could not save: " + req.query.path );
      }
    }
    return Promise.guarded( stat==null, function() {
      return Util.ensureDir(Path.dirname(fpath));
    }, function() {
      //trace("body type: " + typeof req.body + " (" + (req.body instanceof Buffer.Buffer ? "is Buffer" : "not a Buffer") + ")");
      return Util.writeFile( fpath, req.body ).then( function() {
        return Util.fstat(fpath).then( function(stat) {
          if (!stat) throw new Util.HttpError( "File could not be saved");
          Log.trace("file write : final mtime: " + stat.mtime.toISOString());
          res.send({ 
            path: req.query.path, 
            modified: stat.mtime.toISOString(),
          });
        });
      });
    });
  });
}


// -------------------------------------------------------------
// Create folder
// -------------------------------------------------------------

function postCreateFolder(req,res) {
  Log.info("create dir  : " + req.query.path);
  var fpath = getLocalPath(req.query.path);
  return Util.ensureDir(fpath).then( function() {
    res.send({ created: true });
  });
}


// -------------------------------------------------------------
// Run Madoko
// -------------------------------------------------------------
function postRun(req,res) {
  Log.trace("postrun");
  return Run.madokoRun(config,req.body).then( function(info) {
    res.send(info);
  });
}

// -------------------------------------------------------------
// CSP violation report
// -------------------------------------------------------------

function cspReport(req,res) {
  Log.trace(JSON.stringify(req.body));
  Log.entry( { type:"csp", report: req.body['csp-report'], date: new Date().toISOString() } );
  res.send();
}

// -------------------------------------------------------------
// The server entry points
// -------------------------------------------------------------

App.entries( app, {
  "GET/rest/config"   : getConfig,
  "GET/rest/metadata" : getMetadata,
  "GET/rest/readfile" : getReadFile,
  "PUT/rest/writefile": putWriteFile,
  "POST/rest/createfolder" : postCreateFolder,
  "POST/rest/run"     : postRun,
  "POST/report/csp"   : cspReport,     
});

// -------------------------------------------------------------
// Static content 
// -------------------------------------------------------------

App.serveStatic(app, Util.combine(config.installdir, "static") );

// -------------------------------------------------------------
// Handle all errors
// -------------------------------------------------------------

App.handleErrors(app);

// -------------------------------------------------------------
// Start listening 
// -------------------------------------------------------------

Http.createServer(app).listen(config.port, "localhost"); // only listen on local host

var localHost   = "http://localhost" + (config.port===80 ? "" : ":" + config.port.toString());
var accessPoint = localHost + (config.secret ? "#secret=" + encodeURIComponent(config.secret) : "");

console.log("listening on       : " + localHost );
console.log("connect securely to: " + config.origin );
console.log("serving files under: " + config.mountdir );
console.log("");
console.log("---------------------------------------------------------------");
console.log("access server at   : " + accessPoint );
console.log("---------------------------------------------------------------");
console.log("");

// -------------------------------------------------------------
// Listen on the console for commands
// -------------------------------------------------------------

var rl = Readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function listen() {
  rl.question( "type 'q' to quit.\n", function(answer) {
    if (answer==="q" || answer==="y") {
      Log.flush();
      rl.close();
      if (Util.fileExistSync(config.rundir)) {
        Util.removeDir(config.rundir); // try to remove in a promise.
      }
      setTimeout( function() { process.exit(0); }, 250 ); // give some time to flush and remove .madoko-run
      return;
    }
    else {
      console.log("unknown command: " + answer);
    }
    return listen();
  });
}

// and listen to console commands
listen();
console.log("");

if (config.launch) {
  Util.openUrl(accessPoint);
}
