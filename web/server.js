/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

var readline= require("readline");
var cp      = require("child_process");
var mkdirp  = require("mkdirp");
var rmdir   = require("rimraf");
var fs      = require("fs");
var path    = require("path");
var crypto  = require("crypto");
var dns     = require("dns");
var https   = require("https");
var http    = require("http");

var express       = require('express');
var bodyParser    = require("body-parser");
var cookieParser  = require("cookie-parser");

var allowedIps = /^((131\.107\.).*|127.0.0.1)$/;
var blockedIps = null;

// -------------------------------------------------------------
// Wrap promises
// We use promises mostly to reliable catch exceptions 
// -------------------------------------------------------------
var Promise = require("./client/scripts/promise.js");
var Map     = require("./client/scripts/map.js");
var date    = require("./client/scripts/date.js");

function ensureDir(dir) {
  return new Promise( function(cont) { mkdirp(dir,cont); } );
}

function writeFile( path, content, options ) {
  return new Promise( function(cont) {
    fs.writeFile( path, content, options, cont );
  });
}

function readFile( path, options ) {
  return new Promise( function(cont) {
    fs.readFile( path, options, cont );
  });
}

function fstat( fpath ) {
  return new Promise( function(cont) {
    fs.stat(fpath, cont);
  }).then( function(stat) { return stat; },
           function(err)  { return null; } );
}

function onError(req,res,err) {
  if (!err) err = "unknown error";
  //console.log("*******");
  //console.log(err);
  var result = {
    message: err.killed ? "process time-out" : (err.message || err.toString()),
    code: err.code || 0,
  };
  result.httpCode = err.httpCode || (startsWith(result.message,"unauthorized") ? 403 : 500);
  if (err.stdout) result.stdout = err.stdout;
  if (err.stderr) result.stderr = err.stderr;

  //console.log("*****\nerror (" + result.httpCode.toString() + "): " + result.message);
  if (logerr) {
    dns.reverse(req.ip, function(err,doms) {
      if (err) {
        doms = null;
        console.log("unable to resolve ip: " + err.toString() );
      }
      
      logerr.entry( {
        error: result,
        user: res.user,
        ip: req.ip,
        domains: doms,    
        url: req.url,
        date: new Date().toISOString()
      });
    });
  };

  res.send( result.httpCode, result );
}

// -------------------------------------------------------------
// server mode 
// -------------------------------------------------------------
var Mode = {
  Normal: "normal",
  Maintenance: "maintenance",
};

var mode = Mode.maintenance;


// -------------------------------------------------------------
// Events 
// -------------------------------------------------------------

var users   = new Map();  // userid -> { requests: int }
var domains = new Map();  // ip -> { requests: int, newUsers: int }

function domainsGet(req) {
  return domains.getOrCreate(req.ip, { requests: 0, newUsers: 0 });
}

function usersGet(req) {
  return users.getOrCreate(req.ip, { requests: 0 });
}

// every hour, reset stats
setInterval( function() {
  users.forEach( function(id,user) {
    if (user.requests <= 0) users.remove(id);
  });
  domains.forEach( function(ip,domain) {
    if (domain.requests <= 0) {
      domains.remove(ip);
    }
    else {
      domain.newUsers = 0;
    }
  });
}, hour); 

function event( req, res, action, maxRequests ) {
  var domain = null;
  if (!maxRequests) maxRequests = limits.requestsPerDomain;
  try {
    if (mode !== Mode.Normal) throw { httpCode: 503, message: "server is in " + mode + " mode" };
    if (allowedIps && !allowedIps.test(req.ip)) throw { httpCode: 401, message: "sorry, ip " + req.ip + " is not allowed access" };
    if (blockedIps && blockedIps.test(req.ip)) throw { httpCode: 401, message: "sorry, ip " + req.ip + " is blocked" };
    var start = Date.now();
    var entry =  {
      ip: req.ip,
      url: req.url,
      params: req.params, 
      date: new Date(start).toISOString(),        
    };
    if (logev) logev.entry( entry );    
    domain = domainsGet(req);
    if (domain.requests > maxRequests) throw { httpCode: 429, message: "too many requests from this domain"};
    domain.requests++;
    var x = action();
    if (x && x.then) {
      x.then( function(result) {
        domain.requests--;
        entry.time = Date.now() - start;
        if (logev) logev.entry(entry);
        res.send(200,result);
      }, function(err) {
        domain.requests--;
        onError(req,res,err);
      });
    }
    else {
      domain.requests--;
      entry.time = Date.now() - start;
      if (logev) logev.entry(entry);
      res.send(200,x);
    }
  }
  catch(err) {
    if (domain) domain.requests--;
    onError(req,res,err);
  }
}

// -------------------------------------------------------------
// Constants
// -------------------------------------------------------------

var runDir = "run"
var mb        = 1024*1024;
var second    = 1000;
var minute    = 60*second;
var hour      = 60*minute;

var limits = {
  requestsPerDomain: 10,
  requestsPerUser  : 2,
  requestNewUser   : 5,
  maxProcesses: 10, 
  hashLength  : 16,  
  fileSize    : 5*mb,         
  cookieAge   : 24 * hour,  // 1 day for now
  timeoutPDF  : minute,
  timeoutMath : 45*second,
  timeoutGET  : 5*second,
  atomicDelay : 10*minute,  // a push to cloud storage is assumed visible everywhere after this time
  logFlush    : 1*minute,
  rmdirDelay  : 3*second,
}

// -------------------------------------------------------------
// Set up server app 
// -------------------------------------------------------------
var app = express();

app.use(function(req, res, next) {
  if (req.headers['content-type']==="application/csp-report") {
    req.headers['content-type'] = "application/json";
  }
  next();
});

app.use(bodyParser({limit: limits.fileSize, strict: false }));
app.use(cookieParser(fs.readFileSync("ssl/madoko-cookie.txt",{encoding:"utf-8"})));

app.use(function(err, req, res, next){
  if (!err) return next();
  onError(req, res,err);
});

var scriptSrc = "'self' https://apis.live.net https://js.live.net 'unsafe-inline'";

app.use(function(req, res, next){
  var csp = ["script-src " + scriptSrc,
             "report-uri /report/csp"
            ].join(";");

  res.setHeader("Strict-Transport-Security","max-age=43200; includeSubDomains");
  //res.setHeader("Content-Security-Policy-Report-Only",csp);
  //res.setHeader("X-Content-Security-Policy-Report-Only",csp);      
  next();
});

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------

function startsWith(s,pre) {
  if (!pre) return true;
  if (!s) return false;
  return (s.substr(0,pre.length) === pre);
}

function normalize(fpath) {
  return path.normalize(fpath).replace(/\\/g,"/");
}

function combine() {
  var p = "";
  for(var i = 0; i < arguments.length; i++) {
    p = path.join(p,arguments[i]);
  }
  return normalize(p);
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

var mimeTypes = {    
  mdk: "text/madoko",
  md: "text/markdown",

  txt: "text/plain",
  css: "text/css",
  html:"text/html",
  htm: "text/html",
  xml: "text/html",
  js:  "text/javascript",
  pdf: "application/pdf",
  json: "application/json",
  
  tex: "text/tex",
  sty: "text/latex",
  cls: "text/latex",
  bib: "text/plain",
  bbl: "text/plain",
  aux: "text/plain",
  dimx: "text/plain",

  png:  "image/png",
  jpg:  "image/jpg",
  jpeg: "image/jpg",
  gif:  "image/gif",
  svg:  "image/svg+xml",
};

function mimeFromExt( fname ) {
  var ext = path.extname(fname);
  if (ext) {
    var mime = mimeTypes[ext.substr(1)];
    if (mime) return mime;
  }
  return "text/plain";
}

function encodingFromExt(fname) {
  var mime = mimeFromExt(fname);
  return (mime.indexOf("text/") === 0 ? "utf-8" : "base64" );
}

function uniqueHash() {
  var unique = (new Date()).toString() + ":" + Math.random().toString();
  return crypto.createHash('md5').update(unique).digest('hex').substr(0,limits.hashLength);
}


// -------------------------------------------------------------
// Logging
// -------------------------------------------------------------

var Log = (function(){

  function Log(base) {
    var self = this;
    self.base = base || "log-";
    
    var fnames = fs.readdirSync("log");
    var max = 0;
    var rx = new RegExp( "^" + self.base + "(\\d+)\\.txt$");    
    fnames.forEach( function(fname) {
      var cap = rx.exec(fname);
      if (cap) {
        var i = parseInt(cap[1]);
        if (!isNaN(i) && i > max) max = i;
      }
    });
    self.start( max+1 );
  }

  function leftfill( s, n, fill ) {
    if (!fill) fill = " ";
    if (s.length >= n) return s;
    return (new Array(n - s.length + 1).join(fill) + s); 
  }

  Log.prototype.start = function( n ) {
    var self = this;
    if (self.ival) {
      clearInterval(self.ival);
      flush();
    }
    self.logNum = n;
    var logNumStr = self.logNum.toFixed(0);
    self.logFile = combine("log", self.base + leftfill(self.logNum.toString(),4,"0") + ".txt");
    self.log = [];
    self.ival = setInterval( function() {
      var size = self.flush();
      if (size > limits.fileSize) {
        self.start(n+1);
      }
    }, limits.logFlush );
  }

  Log.prototype.flush = function() {
    var self=this;
    var content = JSON.stringify(self.log);
    fs.writeFile( self.logFile, content );
    return content.length;
  }

  Log.prototype.entry = function( obj ) {
    var self = this;
    console.log( JSON.stringify(obj) + "\n" );
    if (self.log[self.log.length-1] !== obj) {
      self.log.push( obj );
    }
  }

  return Log;
})();


var log    = new Log();
var logerr = new Log("log-err");
var logev  = log; // new Log("log-event");


function logRequest(req,msg) {
  var date = new Date().toISOString() ;
  dns.reverse( req.ip, function(err,doms) {
    if (err) doms = null;
    log.entry( { type: msg, ip: req.ip, url: req.url, domains: doms, date: date });
  });
}

// -------------------------------------------------------------
// General server helpers
// -------------------------------------------------------------



// Get a unique user path for this session.
function getUser( req,res ) {
  var userid = req.signedCookies.auth;
  if (!userid) {
    var domain = domainsGet(req);
    if (domain.newUsers > limits.requestNewUser) throw { httpCode: 429, message: "too many requests for new users from this domain" };
    userid = uniqueHash();
    res.cookie("auth", userid, { signed: true, maxAge: limits.cookieAge, httpOnly: true, secure: true } );
    domain.newUsers++;
  }
  var user = usersGet(userid);
  if (user.requests >= limits.requestsPerUser) throw { httpCode: 429, message: "too many requests from this user" } ;

  return {
    id: userid,
    user: user,
    path: combine(runDir, userid + "-" + uniqueHash()),
  };
}

function withUser( req,res, action ) {
  var user = getUser(req,res);
  var start = Date.now();
  var entry = { user: user, url: req.url, ip: req.ip, date: new Date(start).toISOString() };
  if (req.body.docname) entry.docname = req.body.docname;
  if (req.body.pdf) entry.pdf = req.body.pdf;
  log.entry( entry );
  user.user.requests++;
  return fstat(user.path).then( function(stats) {
    if (stats) throw { httpCode: 429, message: "can only run one process per user -- try again later" };
    return ensureDir(user.path);
  }).then( function() {
    return action(user);    
  }).always( function() {    
    entry.time = Date.now() - start; 
    entry.files = req.body.files.map( function(file) {
      return { 
        path: file.path,
        //encoding: file.encoding,
        //mime: file.mime,
        size: file.content.length,
      };
    });
    log.entry( entry );
    if (user.path) {
      //console.log("remove: " + user.path);      
      setTimeout( function() {
        rmdir( user.path, function(err) {
          if (err) {
            var eentry = { error: { message: "unable to remove: " + user.path + ": " + err.toString() } };
            extend(eentry,entry);          
            logerr.entry( eentry );
          }
        });
      }, limits.rmdirDelay );    
    }
    user.user.requests--;
  });
}

// Check of a file names is root-relative (ie. relative and not able to go to a parent)
// and that it contains only [A-Za-z0-9_\-] characters.
function isValidFileName(fname) {
  return (/^(?![\/\\])(\.(?=[\/\\]))?([\w\-]|[\.\/\\]\w)+$/.test(fname));
}


// -------------------------------------------------------------
// Madoko
// -------------------------------------------------------------

var outdir = "out";
var stdflags = "--odir=" + outdir + " --sandbox";


// Save files to be processed.
function saveFiles( userpath, files ) {
  return Promise.when( files.map( function(file) {
    if (!isValidFileName(file.path)) return Promise.rejected( new Error("unauthorized file name: " + file.path) );
    var fpath = combine(userpath,file.path);
    console.log("writing file: " + fpath + " (" + file.encoding + ")");
    var dir = path.dirname(fpath);
    return ensureDir(dir).then( function() {
      return writeFile( fpath, file.content, {encoding: file.encoding} );
    });
  }));
}


// Read madoko generated files.
function readFiles( userpath, docname, pdf ) {
  var ext    = path.extname(docname);
  var stem   = docname.substr(0, docname.length - ext.length );
  var fnames = [".dimx", "-math-dvi.final.tex", "-math-pdf.final.tex", "-bib.bbl", "-bib.aux"]
                .concat( pdf ? [".pdf"] : [] )
                .map( function(s) { return combine( outdir, stem + s ); });
  //console.log("sending back:\n" + fnames.join("\n"));
  return Promise.when( fnames.map( function(fname) {
    // paranoia
    if (!isValidFileName(fname)) return Promise.rejected( new Error("unauthorized file name: " + fname) );
    var fpath = combine(userpath,fname);

    function readError(err) {
      //console.log("Unable to read: " + fpath);
      return {
        path: fname,
        encoding: encodingFromExt(fname),
        mime: mimeFromExt(fname),
        content: "",
      };
    };

    return fstat( fpath ).then( function(stats) {
      if (!stats) return readError();
      if (stats.size > limits.fileSize) return Promise.rejected( new Error("generated file too large: " + fname) );
      return readFile( fpath ).then( function(buffer) {
          var encoding = encodingFromExt(fname);
          return {
            path: fname,
            encoding: encoding,
            mime: mimeFromExt(fname),
            content: buffer.toString(encoding),
          };
        }, function(err) {
          return readError(err);
        }
      );
    });
  }));  
}

// execute madoko program
function madokoExec( userpath, docname, flags, timeout ) {
  var command = /* "madoko */ "node ../../client/lib/cli.js " + flags + " " + stdflags + " \""  + docname + "\"";
  return new Promise( function(cont) {
    console.log("> " + command);
    cp.exec( command, {cwd: userpath, timeout: timeout || 10000, maxBuffer: 512*1024 }, cont);
  }); 
}

// Run madoko program
function madokoRun( userpath, docname, files, pdf ) {
  return saveFiles( userpath, files ).then( function() {
    if (!isValidFileName(docname)) return Promise.rejected( new Error("unauthorized document name: " + docname) );
    var flags = " -mmath-embed:512 -membed:512 -vv" + (pdf ? " --pdf" : "");
    return madokoExec( userpath, docname, flags, (pdf ? limits.timeoutPDF : limits.timeoutMath) ).then( function(stdout,stderr) {
      console.log("result: \n" + stdout + "\n" + stderr + "\n");
      return readFiles( userpath, docname, pdf ).then( function(filesOut) {
        return {
          files: filesOut.filter( function(file) { return (file.content && file.content.length > 0); } ),
          stdout: stdout,
          stderr: stderr,
        };
      });
    }, function(err,stdout,stderr) {
      console.log("command error: \nstdout: " + stdout + "\nstderr: " + stderr + "\n");
      console.log(err);
      err.stdout = stdout;
      err.stderr = stderr;
      throw err;
    });
  });
}



// -------------------------------------------------------------
// Live authentication redirection
// -------------------------------------------------------------

var liveCallbackPage = 
['<html>',
'<head>',
'  <title>Madoko Live Callback</title>',
'</head>',
'<body>',
'  <script src="//js.live.net/v5.0/wl.js" type="text/javascript"></script>',
'</body>',
'</html>'
].join("\n");

var dropboxCallbackPage = 
['<html>',
'<head>',
'  <title>Madoko Dropbox Callback</title>',
'  <script src="../scripts/auth-dropbox.js" type="text/javascript"></script>',
'</head>',
'<body>',
'  Dropbox callback',
'</body>',
'</html>'
].join("\n");

// -------------------------------------------------------------
// Onedrive request redirection:
// Because onedrive does not support CORS we redirect all file
// content request over our server
// -------------------------------------------------------------

function requestGET(query,encoding) {
  return new Promise( function(cont) {
    var req;
    var timeout = setTimeout( function() { 
      if (req) req.abort();
    }, limits.timeoutGET );
    req = (startsWith(query,"http://") ? http : https).get(query, function(res) {
      if (encoding) res.setEncoding(encoding);
      var body = "";
      res.on('data', function(d) {
        body += d;
        if (body.length > limits.fileSize) {
          req.abort();
        }
      });
      res.on('end', function() {
        clearTimeout(timeout);
        cont( null, body ); //(encoding ? new Buffer(body,encoding) : body) );
      });
      res.on('error', function(err) {
        clearTimeout(timeout);
        cont(err, "");
      })
    });
  });  
}

/* -------------------------------------------------------------
   Enable atomic file push

Since cloud storage like onedrive generally don't provide 
atomic updates, we provide it. The idea is that a client 
will push a file update together with the creation time it expects
the file to be. 
------------------------------------------------------------- */

var atomics = new Map();

// recycle locks after atomicDelay
setInterval( function() {
  var now = Date.now();
  atomics.forEach( function(name,info) {
    if (info.created + limits.atomicDelay < now) {
      atomics.remove(name);
    }
  });
}, limits.atomicDelay / 4 );

function pushAtomic( name, time ) {
  if (!name || typeof name !== "string") throw { httpCode: 400, message: "invalid request (no 'name')" };
  if (!time) time = new Date(0);
  else if (typeof time === "string") time = date.dateFromISO(time);
  else if (!(time instanceof Date)) time = new Date(time.toString());

  if (time.getTime() <= 0) {
    atomics.remove(name);
    return { message: "released" };
  }
  else {
    var info = atomics.get(name);
    var atime = (info ? info.time : new Date(0));
    if (atime < time) {
      // someone is pushing a more recent version: ok
      atomics.set(name, { time: time, created: Date.now() });
      return { message: "acquired" };
    }
    else {
      // ouch. someone pushed a more recent version concurrently.
      throw { httpCode: 409, message: "failed" };
    }
  }
}



// -------------------------------------------------------------
// The server entry points
// -------------------------------------------------------------

var runs = 0;
app.post('/rest/run', function(req,res) {
  event( req, res, function() {
    return withUser(req, res, function(user) {
      console.log("run request: " + (req.body.round ? req.body.round.toString() + ": " : "") + user.path);
      if (runs >= limits.maxProcesses) throw { httpCode: 503, message: "too many processes" };
      runs++;
      var docname  = req.body.docname || "document.mdk";
      var files    = req.body.files || [];
      var pdf      = req.body.pdf || false;
      return madokoRun( user.path, docname, files, pdf ).always( function() { runs--; } );  
    });
  });  
});

app.post('/rest/push-atomic', function(req,res) {
  event( req, res, function() {
    return pushAtomic( req.body.name, req.body.time );
  });
});

app.post("/report/csp", function(req,res) {
  event(req,res, function() {
    console.log(req.body);
    logerr.entry( { 'csp-report': req.body['csp-report'], date: new Date().toISOString() } );
  });
});

app.get("/redirect/live", function(req,res) {
  //event( req, res, function() {
    console.log("live redirect authentication");
    res.send(200,liveCallbackPage);
  //});
});

app.get("/redirect/dropbox", function(req,res) {
  //event( req, res, function() {
    console.log("dropbox redirect authentication");
    console.log(req.query);
    console.log(req.url);
    res.send(200,dropboxCallbackPage);
  //});
});

app.get("/remote/onedrive", function(req,res) {
  event( req, res, function() {
    if (!/https:\/\/[\w\-\.]+?\.livefilestore\.com\//.test(req.query.url)) {
      throw { httpCode: 403, message: "illegal onedrive url: " + req.query.url };
    }
    return requestGET( req.query.url, "binary" );
  }, 100 );
});

app.get("/remote/http", function(req,res) {
  event( req, res, function() {
    console.log("remote http get: " + req.query.url );
    return requestGET( req.query.url, "binary" ).then( function(content) {
      res.set('Content-Disposition',';');
      if (!/\.html?$/.test(req.query.url) && /^\s*<! *DOCTYPE\b/.test(content)) {
        console.log(content.substr(0,40));
        throw { httpCode: 404, message: "not found: " + req.query.url };
      }
      return content;
    });
  }, 100 );
});


var staticClient      = express.static( combine(__dirname, "client"));
var staticMaintenance = express.static( combine(__dirname, "maintenance"));
var staticDirs = /\/(images(\/dark)?|scripts|styles(\/(lang|out))?|lib(\/vs(\/.*)?)?|preview(\/out)?)?$/;

app.use('/', function(req,res,next) {
  var dir = path.dirname(req.path);
  if (!staticDirs.test(dir)) {
    logRequest(req,"static-scan");
  }
  return (mode===Mode.Maintenance ? staticMaintenance : staticClient)(req,res,next);
});


// -------------------------------------------------------------
// Listen on the console for commands
// -------------------------------------------------------------

var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function listen() {
  rl.question( "quit (q, q!), maintenance (m), or normal (n)? ", function(answer) {
    if (answer==="m") {
      mode = Mode.Maintenance;
    }
    else if (answer==="n") {
      mode = Mode.Normal;
    }
    else if (answer==="q" || answer==="q!") {
      mode = Mode.Maintenance;
      secs = (answer==="q!" ? 10 : 60);
      console.log("quitting in " + secs.toString() + " seconds...");
      rl.close();
      setTimeout( function() { process.exit(0); }, secs*second );
      return;
    }
    else {
      console.log("unknown command: " + answer);
    }
    console.log( mode + " mode." )
    return listen();
  });
}

mode = Mode.Normal;


rl.question( "ssl passphrase: ", function(passphrase) {

  // -------------------------------------------------------------
  // Start listening on https
  // -------------------------------------------------------------

  var sslOptions = {
    pfx: fs.readFileSync('./ssl/madoko-cloudapp-net.pfx'),
    passphrase: passphrase, // fs.readFileSync('./ssl/madoko-cloudapp-net.txt'),
    //key: fs.readFileSync('./ssl/madoko-server.key'),
    //cert: fs.readFileSync('./ssl/madoko-server.crt'),
    //ca: fs.readFileSync('./ssl/daan-ca.crt'),
    //requestCert: true,
    //rejectUnauthorized: false
  };
  https.createServer(sslOptions, app).listen(443);
  console.log("listening...");


  // -------------------------------------------------------------
  // Set up http redirection
  // -------------------------------------------------------------

  var httpApp = express();

  httpApp.use(function(req, res, next) {
    logRequest(req,"http-redirection");
    res.redirect("https://" + req.host + req.path);
  });

  http.createServer(httpApp).listen(80);

  // and listen to console commands
  listen();
});

