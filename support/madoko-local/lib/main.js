/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// -------------------------------------------------------------
// Imports
// -------------------------------------------------------------

var Path    = require("path");
var Options = require("commander");
var Readline= require("readline");
var Http    = require("http");
var Buffer  = require("buffer");
var Express   = require('express');
var BodyParser= require("body-parser");

// local modules
var Util    = require("./util.js");
var Promise = require("./promise.js");
var Log     = require("./log.js");

// -------------------------------------------------------------
// Constants
// -------------------------------------------------------------

var localHostIP = "127.0.0.1";
var mb          = 1024*1024;
var second      = 1000;
var minute      = 60*second;
var hour        = 60*minute;
var day         = 24*hour;

// -------------------------------------------------------------
// Config & Command line options
// -------------------------------------------------------------

var config = {
  username  : "",
  userid    : "",
  installdir: Path.dirname(Path.dirname(Util.programDir())), // serve static content from here
  homedir   : Util.osHomeDir(), // user home directory
  configdir : null,             // save log and config info here ($HOME/.madoko)
  mountdir  : null,             // the local directory to give access to.
  port      : 80,
  origin    : "https://www.madoko.net",
  secret    : null, 
  log       : null,             // logging object.
  limits    : {
    fileSize    : 64*mb,
    logFlush    : 1*minute,
  },
}

var indent = "\n                   ";
Options
  .usage("[Options] <root directory (='.')>")
  .option("--secret [secret]", "Use secret key for increased security." + indent + "Generates random key if left blank.")
  .option("--launch", "Launch default browser at correct localhost address")
  .option("--port <n>", "Port number (=80)", parseInt )
  .option("--origin <url>", "Serve <url> (" + config.origin + ")")
  .option("--homedir <dir>", "Use <dir> as user home directory (for logging)")
  .option("--verbose","Output tracing messages")
  .parse(process.argv);

if (Options.homedir) config.homedir = Options.homedir;
config.configdir = Util.combine(config.homedir, ".madoko");

// Try to read local config file
var configFile  = Path.join(config.configdir,"config.json");
var localConfig = Util.jsonParse(Util.readFileSync(configFile, {encoding:"utf8"}, "{}" ));

if (typeof Options.secret === "string") {
  // use provided secret
  config.secret = Options.secret;
}
else if (typeof localConfig.secret === "string" && Options.secret !== true) {
  config.secret = localConfig.secret;
}
else {
  // generate a secret
  config.secret = Util.secureHash(12);    

  // write back secret to localConfig...
  localConfig.secret = config.secret;
  Util.writeFileSync(configFile, JSON.stringify(localConfig), {encoding:"utf8",ensuredir:true});
}

// Port
if (Options.port) config.port = Options.port;
else if (typeof localConfig.port === "number") config.port = localConfig.port;

// Origin
if (Options.origin) config.origin = Options.origin;
else if (typeof localConfig.origin === "string") config.origin = localConfig.origin;

// User
if (localConfig.username) config.username = localConfig.username;
else config.username = process.env["USER"] || process.env["USERNAME"] || "(local user)";

if (localConfig.userid) config.userid = localConfig.userid;
else config.userid = config.username;


// Verify local directory
if (Options.args && Options.args.length===1) {
  config.mountdir = Options.args[0];
  config.writebackDir = true;
}
else if (!Options.args || Options.args.length === 0) {
  if (typeof localConfig.mountdir === "string") config.mountdir = localConfig.mountdir;
  else {
    config.mountdir = process.cwd();
    config.writebackDir = true;
  }
}


if (!config.mountdir || !Util.fileExistSync(config.mountdir)) {
  console.log("Error: unable to find local root directory: " + config.mountdir);
  process.exit(1);
}
config.mountdir = Path.resolve(config.mountdir);

// write back local root directory
if (config.writebackDir) {
  localConfig.mountdir = config.mountdir;
  Util.writeFileSync(configFile, JSON.stringify(localConfig), {encoding:"utf8", ensuredir:true});
}

// Logging
config.log = new Log.Log( config.configdir, config.limits.logFlush );


function trace(msg) {
  if (!Options.verbose) return;
  console.log( "-- " + msg);
}

// -------------------------------------------------------------
// Error handling
// -------------------------------------------------------------

function promise(action) {
  return (function(req,res) {
    var result = action(req,res);
    if (result && result.then) {
      result.then( null, function(err) {
        handleError(err,req,res);
      });
    }
    else return result;
  });
}

function handleError(err,req,res,next) {
  if (!err) err = "unknown error";
  console.log("----- error --------");
  console.log(err.stack || err);
  console.log("--------------------");

  var result = {
    message: err.message || err.toString(),
  };
  result.httpCode = err.httpCode || (Util.startsWith(result.message,"unauthorized") ? 500 : 500);
  
  //console.log("*****\nerror (" + result.httpCode.toString() + "): " + result.message);
  if (config.log) {
    Util.dnsReverse(req.ip).then( function(doms) {
      config.log.entry( {
        type: "error",
        error: result,
        ip: req.ip,
        domains: doms,    
        url: req.url,
        date: new Date().toISOString()
      });
    });
  };

  res.status( result.httpCode ).send( "error: " + result.message );
};



// -------------------------------------------------------------
// Set up server app  
// -------------------------------------------------------------
var app = Express();

app.use(function(req, res, next) {
  //console.log("adjust csp header");
  if (req.headers['content-type']==="application/csp-report") {
    req.headers['content-type'] = "application/json";
  }
  next();
});

app.use(BodyParser.urlencoded({limit: config.limits.fileSize, extended: true}));
app.use(BodyParser.json({limit: config.limits.fileSize, strict: false }));
app.use(BodyParser.text({limit: config.limits.fileSize, type:"text/*" }));
app.use(BodyParser.raw({limit: config.limits.fileSize, type:"application/octet-stream" }));

Express.static.mime.define({    
  "text/madoko": ["mdk"],
  "text/markdown": ["md","mkdn","markdown"],
  "text/plain": ["tex","sty","cls","bib","bbl","aux","dimx","dim"],
});


// -------------------------------------------------------------
// Security   
// -------------------------------------------------------------

app.use(function(req, res, next){
  if (config.secret && Util.startsWith(req.url,"/rest/")) {
    if (config.secret !== req.query.secret) {
      throw { httpCode:401, message: "unauthorized access; secret key is not correct." };
    }
  }
  next();
});

app.use(function(req, res, next){
  if (config.mountdir && req.query && req.query.mount) {
    if (req.query.mount !== config.mountdir) {
      throw { httpCode:401, message: 
        ["Document was previously served from a different local root directory!",
         "  Previous root: " + req.query.mount,
         "  Current root : " + config.mountdir].join("\n") 
      }; 
    }
  }
  next();
});

app.use(function(req, res, next){
  // extra check: only serve to local host
  if (req.ip !== req.connection.remoteAddress || req.ip !== localHostIP) {
    throw { httpCode:401, message: "only serving localhost" };
  }

  // console.log("referer: " + req.get("Referrer") + ", Path: " + req.Path + ", host: " + req.hostname);
  if (Util.startsWith(req.Path,"/rest/")) {
    // for security do not store any rest or oauth request
    // console.log("cache: no-store: " + req.Path);
    res.setHeader("Cache-Control","no-store");
  }
      
  // Don't allow content to be loaded in an iframe (legacy header)
  res.setHeader("X-Frame-Options","DENY");              
  
  // default is very secure: just our server and no XHR/inline/eval/iframe
  var csp = { "default-src": "'self'",
              "connect-src": "'self'",
              "style-src"  : "'self' 'unsafe-inline'", // mostly for chrome-extensions :-(
              "frame-src"  : config.origin,
              "frame-ancestors": "'none'",
              "report-uri": "/report/csp",
            };

  // Set CSP header
  var cspHeader = Util.properties(csp).map(function(key) { return key + " " + csp[key]; }).join(";");
  //res.setHeader("Content-Security-Policy-Report-Only",cspHeader);
  res.setHeader("Content-Security-Policy",cspHeader);
  next();
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
      is_dir: (stat.isDirectory()),
      path: fpath,
      contents: [],
    };
  };
  return finfo;    
}

// Check of a file name is root-relative (ie. relative and not able to go to a parent)
// and that it contains only [A-Za-z0-9_\-] characters.
function isValidFileName(fname) {
  return (/^(?![\/\\])(\.(?=[\/\\]))?([\w\-]|[\.\/\\]\w)*$/.test(fname));
}

function checkValidPath(fpath) {
  if (typeof fpath !== "string" || !isValidFileName(fpath)) throw new Error("Invalid file name due to sandbox: " + fpath);
}

function getLocalPath(fpath) {
  checkValidPath(fpath);
  return Util.combine(config.mountdir,fpath);
}

// -------------------------------------------------------------
// Initial page 
// -------------------------------------------------------------

function getConfig(req,res) {
  if (req.query.show) console.log("** locally host madoko to: " + req.connection.remoteAddress );
  res.send( {
    origin  : config.origin,
    username: config.username,
    userid  : config.userid,
    mount   : config.mountdir,
  });
}

// -------------------------------------------------------------
// Metadata
// -------------------------------------------------------------

function getMetadata(req,res) {
  var root  = req.query.path;
  var fpath = getLocalPath(root);
  return Util.fstat(fpath).then( function(stat) {
    var finfo = finfoFromStat(stat,root);
    // console.log("read metadata: " + fpath );
    if (finfo && finfo.is_dir) {
      return Util.readDir(fpath).then( function(files) {
        //console.log("found:\n" + files.join("\n"));
        return Promise.when(files.map( function(fname) { return Util.fstat(Util.combine(fpath,fname)); } )).then( function(stats) {
          finfo.contents = [];
          for(var i = 0; i < stats.length; i++) {
            checkValidPath(files[i]);
            finfo.contents.push( finfoFromStat(stats[i], Util.combine(root,files[i])) );
          }
          return finfo;
        });
      });
    }
    else {
      if (finfo) trace("file meta: " + finfo.path + ", modified: " + finfo.modified);
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
  var fpath = getLocalPath(req.query.path);
  console.log("read file    : " + fpath);
  return Util.readFile( fpath, { encoding: (req.query.binary ? null : "utf8" ) } ).then( function(data) {
    res.send(data);
  });
}

function putWriteFile(req,res) {
  var fpath = getLocalPath(req.query.path); 
  var rtime = (typeof req.query.remoteTime === "string" ? Util.dateFromISOString(req.query.remoteTime) : null);
  console.log("write file   : " + fpath);
  return Util.fstat( fpath ).then( function(stat) {
    if (stat && rtime) {
      //trace("file write: " + fpath + "\n remoteTime: " + req.query.remoteTime + "\n rtime: " + rtime.toISOString() + "\n mtime: " + stat.mtime.toISOString());
      if (stat.mtime.getTime() > rtime.getTime()) {  // todo: is there a way to do real atomic updates? There is still a failure window here...
        trace("file write: " + fpath + "\n remoteTime: " + req.query.remoteTime + "\n rtime: " + rtime.toISOString() + "\n mtime: " + stat.mtime.toISOString());
        throw new Error("File was modified concurrently; could not save.");
      }
    }
    return Promise.guarded( stat==null, function() {
      return Util.ensureDir(Path.dirname(fpath));
    }, function() {
      //trace("body type: " + typeof req.body + " (" + (req.body instanceof Buffer.Buffer ? "is Buffer" : "not a Buffer") + ")");
      return Util.writeFile( fpath, req.body ).then( function() {
        return Util.fstat(fpath).then( function(stat) {
          if (!stat) throw new Error("File could not be saved");
          trace(" final mtime: " + stat.mtime.toISOString());
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
  var fpath = getLocalPath(req.query.path);
  console.log("create directory: " + fpath);
  return Util.ensureDir(fpath).then( function() {
    res.send({ created: true });
  });
}


// -------------------------------------------------------------
// CSP violation report
// -------------------------------------------------------------

function cspReport(req,res) {
  trace(req.body);
  if (config.log) config.log.entry( { type:"csp", report: req.body['csp-report'], date: new Date().toISOString() } );
  res.send();
}

// -------------------------------------------------------------
// The server entry points
// -------------------------------------------------------------

app.get("/rest/config", promise(getConfig));
app.get("/rest/metadata", promise(getMetadata));
app.get("/rest/readfile", promise(getReadFile));
app.put("/rest/writefile", promise(putWriteFile));
app.post("/rest/createfolder", promise(postCreateFolder));
app.post("/report/csp", promise(cspReport));

// -------------------------------------------------------------
// Static content 
// -------------------------------------------------------------

var staticOptions = {
  maxAge: 10000,
}
var staticClient = Express.static( Util.combine(config.installdir, "static"), staticOptions);
app.use('/', function(req,res,next) {
  trace("serve static : " + req.url);
  return staticClient(req,res,next);
});

app.use(handleError);

// -------------------------------------------------------------
// Start listening 
// -------------------------------------------------------------

Http.createServer(app).listen(config.port, "localhost"); // only listen on local host

var localHost = "http://localhost" + (config.port===80 ? "" : ":" + config.port.toString());
var accessPoint = localHost + (config.secret ? "?secret=" + encodeURIComponent(config.secret) : "");

console.log("listening on          : " + localHost );
console.log("connecting securely to: " + config.origin );
console.log("serving files under   : " + config.mountdir );
console.log("");
console.log("access server at      : " + accessPoint );
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
      if (config.log) config.log.flush();
      rl.close();
      setTimeout( function() { process.exit(0); }, 100 );
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

if (Options.launch) {
  Util.openUrl(accessPoint);
}
