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
var CmdLine     = require("commander").Command;
var Readline    = require("readline");
var Http        = require("http");
var Buffer      = require("buffer");
var Express     = require('express');
var BodyParser  = require("body-parser");

// local modules
var Util    = require("./util.js");
var Promise = require("./promise.js");
var Log     = require("./log.js");
var Config  = require("./config.js");
var Sandbox = require("./sandbox.js");
var Run     = require("./run.js");

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
  verbose   : 0,
  limits    : {
    fileSize    : 64*mb,
    logFlush    : 1*minute,
    timeoutPDF  : 2*minute,
    timeoutMath : 1*minute,
  },
  run       : null,     // program to run Madoko locally
  rundir    : null,     // directory under which to run LaTeX.
  rmdirDelay: 5*second, // after this amount the run directory gets removed
  mime      : null,     // gets set to Express.static.mime
}


var Options = new CmdLine(Config.main);
Options
  .usage("[options] [mount-directory]")
  .version(Config.version,"-v, --version")
  .option("-l, --launch", "launch default browser at correct localhost address")
  .option("--secret [secret]", "use specified secret key, or generated key if left blank")
  .option("--run [madoko]", "run madoko & latex locally for math rendering and PDF's")
  .option("--port <n>", "serve at port number (=80)", parseInt )
  .option("--origin <url>", "give local disk access to <url> (" + config.origin + ")")
  .option("--homedir <dir>", "use <dir> as user home directory (for logging)")
  .option("--rundir <dir>", "use <dir> for running madoko (<mount-directory>)")
  .option("--verbose [n]","output trace messages (0 none, 1 info, 2 debug)", parseInt )
  
Options.on("--help", function() {
  console.log([
    "  Notes:",
    "    Access is given to any files and sub-directories under <mount-directory>.",
    "    If blank, the previous mount directory or current directory is used.",
    "",
    "    Previous secrets or mount directories are read from the configuration",
    "    file in '$HOME/.madoko/config.json'. Log files are written there too.",
    "",
    "    If the --run flag is given, mathematics, the bibilography, and PDF's are",
    "    generated locally instead of on the Madoko server. By default calls the",
    "    'madoko' program on the PATH but you can pass an explicit path too.",
    "    The --rundir determines under which directory files are stored temporarily",
    "    when Madoko is invoked. By default this is '<mount-directory>/.madoko-run'.",
  ].join("\n"));
});

Options.parse(process.argv);

// Home dir
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

// Run
if (Options.run) {
  if (typeof Options.run === "string") 
    config.run = Options.run;
  else 
    config.run = "madoko";
}


// Verbose
if (Options.verbose === true) {
  config.verbose = 1;
}
else if (typeof Options.verbose === "number") {
  config.verbose = Options.verbose;
}

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

// Create rundir
if (typeof Options.rundir==="string") {
  config.rundir = options.rundir;
}
else {
  config.rundir = config.mountdir;
}
config.rundir = Util.combine(config.rundir,".madoko-run");

// Logging
config.log = new Log.Log( config.verbose, config.configdir, config.limits.logFlush );


// -------------------------------------------------------------
// Error handling
// -------------------------------------------------------------

function promise(action) {
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
  "text/plain": ["tex","sty","cls","bib","bbl","aux","dimx","dim","csl","bst"],
});
config.mime = Express.static.mime;

// -------------------------------------------------------------
// Security   
// -------------------------------------------------------------

app.use(function(req, res, next){
  if (config.secret && Util.startsWith(req.url,"/rest/")) {
    if (config.secret !== req.query.secret) {
      throw new Util.HttpError( "unauthorized access; secret key is not correct.", 401 );
    }
  }
  next();
});

app.use(function(req, res, next){
  if (config.mountdir && req.query && req.query.mount) {
    if (req.query.mount !== config.mountdir) {
      throw new Util.HttpError(  
        ["Document was previously served from a different local root directory!",
         "  Previous root: " + req.query.mount,
         "  Current root : " + config.mountdir].join("\n"), 401 );
    }
  }
  next();
});

app.use(function(req, res, next){
  // extra check: only serve to local host
  if (req.ip !== req.connection.remoteAddress || req.ip !== localHostIP) {
    throw new Util.HttpError( "only serving localhost", 401 );
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
    config.log.message("\nlocally host madoko to: " + req.connection.remoteAddress + " (" + req.hostname + ")\n" + 
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
  var relpath = req.query.path;
  var fpath = getLocalPath(relpath);
  return Util.fstat(fpath).then( function(stat) {
    var finfo = finfoFromStat(stat,relpath);
    // console.log("read metadata: " + fpath );
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
          config.log.trace("dir listing: " + finfo.path + ": " + finfo.contents.length.toString() + " items.");      
          return finfo;
        });
      });
    }
    else {
      config.log.trace("file meta  : " + relpath + (finfo ? ", modified: " + finfo.modified : ", not found."), 3);
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
  config.log.info("read file   : " + req.query.path);
  var fpath = getLocalPath(req.query.path);
  return Util.readFile( fpath, { encoding: (req.query.binary ? null : "utf8" ) } ).then( function(data) {
    res.send(data);
  });
}

function putWriteFile(req,res) {
  config.log.info("write file  : " + req.query.path);
  var fpath = getLocalPath(req.query.path); 
  var rtime = (typeof req.query.remoteTime === "string" ? Util.dateFromISOString(req.query.remoteTime) : null);
  return Util.fstat( fpath ).then( function(stat) {
    if (stat && rtime) {
      //trace("file write: " + fpath + "\n remoteTime: " + req.query.remoteTime + "\n rtime: " + rtime.toISOString() + "\n mtime: " + stat.mtime.toISOString());
      if (stat.mtime.getTime() > rtime.getTime()) {  // todo: is there a way to do real atomic updates? There is still a failure window here...
        config.log.trace("file write : atomic fail: " + req.query.path + "\n remoteTime: " + req.query.remoteTime + "\n rtime: " + rtime.toISOString() + "\n mtime: " + stat.mtime.toISOString());
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
          config.log.trace("file write : final mtime: " + stat.mtime.toISOString());
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
  config.log.info("create dir  : " + req.query.path);
  var fpath = getLocalPath(req.query.path);
  return Util.ensureDir(fpath).then( function() {
    res.send({ created: true });
  });
}


// -------------------------------------------------------------
// Run Madoko
// -------------------------------------------------------------
function postRun(req,res) {
  config.log.trace("postrun");
  return Run.madokoRun(config,req.body).then( function(info) {
    res.send(info);
  });
}

// -------------------------------------------------------------
// CSP violation report
// -------------------------------------------------------------

function cspReport(req,res) {
  config.log.trace(JSON.stringify(req.body));
  config.log.entry( { type:"csp", report: req.body['csp-report'], date: new Date().toISOString() } );
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
app.post("/rest/run", promise(postRun));
app.post("/report/csp", promise(cspReport));

// -------------------------------------------------------------
// Static content 
// -------------------------------------------------------------

var staticOptions = {
  maxAge: 10000,
}
var staticClient = Express.static( Util.combine(config.installdir, "static"), staticOptions);
app.use('/', function(req,res,next) {
  config.log.trace("serve static : " + req.url);
  return staticClient(req,res,next);
});

app.use(handleError);

// -------------------------------------------------------------
// Start listening 
// -------------------------------------------------------------

Http.createServer(app).listen(config.port, "localhost"); // only listen on local host

var localHost = "http://localhost" + (config.port===80 ? "" : ":" + config.port.toString());
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
      if (config.log) config.log.flush();
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

if (Options.launch) {
  Util.openUrl(accessPoint);
}
