/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/
// -------------------------------------------------------------
// Passprases
// -------------------------------------------------------------

var passphraseSSL = process.argv[2];
if (!passphraseSSL) {
  throw new Error("Need to supply passphrase(s) as an argument.");
}

var passphraseLocal   = passphraseSSL + (process.argv[3] || "local");
var passphraseSession = passphraseSSL + (process.argv[4] || "session"); // + ":" + new Date().toDateString().replace(/\s+/,"-");

// -------------------------------------------------------------
// Constants
// -------------------------------------------------------------

var runDir = "run"
var mb        = 1024*1024;
var second    = 1000;
var minute    = 60*second;
var hour      = 60*minute;
var day       = 24*hour;

var limits = {
  requestsPerDomain: 100,     // at most X concurrent requests per domain
  requestsPerUser  : 10,      // at most X concurrent requests per user
  requestNewUser   : 10,      // at most X users per hour per domain
  maxProcesses: 10, 
  hashLength  : 16,  
  fileSize    : 16*mb,         
  cookieAge   : 30*day,       // our session cookie expires after one month
  timeoutPDF  : 4*minute,
  timeoutMath : 2*minute,
  timeoutGET  : 30*second,
  atomicDelay : 1*minute,     // a push to cloud storage is assumed visible everywhere after this time
  editDelay   : 30*second,  
  logFlush    : 1*minute,
  logDigest   : 8*hour,
  rmdirDelay  : 120*second,
  tokenExpires: 15*day,        // we disable access_tokens older than this time
};

var allowedIps = null; 
var blockedIps = null;
var privateIps = /^(131\.107\.(147|174|159|160|192)\.\d+|127\.0\.0\.1|173\.160\.195\.\d+)$/;

// -------------------------------------------------------------
// Imports
// -------------------------------------------------------------

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
var Url     = require("url");

var express       = require('express');
var bodyParser    = require("body-parser");
var cookieSession = require("cookie-session");


// -------------------------------------------------------------
// Wrap promises
// We use promises mostly to reliable catch exceptions 
// -------------------------------------------------------------
var Promise = require("./client/scripts/promise.js");
var Map     = require("./client/scripts/map.js");
var date    = require("./client/scripts/date.js");
var Stats   = require("./stats.js");

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

function dnsReverse( ip, callback ) {
  try {
    dns.reverse( ip, function(err,doms) {
      if (err) {
        doms = null;
        console.log("unable to resolve ip: " + err.toString() );
      }
      callback(doms);      
    });
  }
  catch(exn) {
    console.log("unable to resolve ip: " + exn.toString() );
    callback(null);
  }  
}

function onError(req,res,err) {
  if (!err) err = "unknown error";
  console.log("*******");
  console.log(err.stack || err);
  console.log("*******");

  var result = {
    message: err.killed ? "process time-out" : (err.message || err.toString()),
    code: err.code || 0,
  };
  result.httpCode = err.httpCode || (startsWith(result.message,"unauthorized") ? 403 : 500);
  if (err.stdout) result.stdout = err.stdout;
  if (err.stderr) result.stderr = err.stderr;

  //console.log("*****\nerror (" + result.httpCode.toString() + "): " + result.message);
  if (logerr) {
    dnsReverse(req.ip, function(doms) {
      logerr.entry( {
        type: "error",
        error: result,
        user: res.user || { id: (req.session ? req.session.userid : null) },
        ip: req.ip,
        domains: doms,    
        url: req.url,
        date: new Date().toISOString()
      });
    });
  };

  res.status( result.httpCode ).send( result );
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

function usersGetRequests(req) {
  return users.getOrCreate(req.ip, { requests: 0 }).requests;
}

// every hour, reset stats
setInterval( function() {
  users.forEach( function(id,info) {
    if (info.requests <= 0) users.remove(id);
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


function initSession(req,res) {
  // check if we encrypt cookies: need to patch cookie-session or 'encrypted' flag is ignored
  if (!req.sessionEncryptionKeys) {
    throw new Error("Session cookies are not encrypted!");
  }

  // initialize session
  if (!req.session) req.session = {};
  if (!req.session.userid) {
    console.log("create guest userid")
    req.session.userid = uniqueHash();
    req.session.created = (new Date()).toISOString();
    var domain = domainsGet(req);
    if (domain.newUsers > limits.requestNewUser) throw { httpCode: 429, message: "too many requests for new users from this domain" };
    domain.newUsers++;
  }
  if (!req.session.logins) req.session.logins = {};
  var today = new Date().toDateString();
  if (req.session.lastDate != today) req.session.lastDate = today; // update cookie at least once every day
  if (req.sessionCookies.get("auth")) res.clearCookie("auth",{path:"/"}); // legacy
  
  //console.log(req.session.toJSON());
  return req.session.userid;
}

function event( req, res, useSession, action, maxRequests, allowAll ) {
  var domain = null;
  if (!maxRequests) maxRequests = limits.requestsPerDomain;
  try {
    if (mode !== Mode.Normal) throw { httpCode: 503, message: "server is in " + mode + " mode" };
    if (!allowAll && (allowedIps && !allowedIps.test(req.ip))) throw { httpCode: 401, message: "sorry, ip " + req.ip + " is not allowed access" };
    if (blockedIps && blockedIps.test(req.ip)) throw { httpCode: 401, message: "sorry, ip " + req.ip + " is blocked" };
    var start = Date.now();

    if (useSession) {
      initSession(req,res);    
    }
    
    var entry =  {
      type: "none",
      ip: req.ip,
      url: req.url,
      params: req.params, 
      date: new Date(start).toISOString(),  
      id: req.session.userid,      
    };    
    if (logev) logev.entry( entry );    
    var logit = (req.url != "/rest/edit");
    entry.type = "request";
    domain = domainsGet(req);
    domain.requests++;
    if (domain.requests > maxRequests) throw { httpCode: 429, message: "too many requests from this domain"};
    var x = action();
    if (x && x.then) {
      x.then( function(result) {
        domain.requests--;
        entry.time = Date.now() - start;
        if (logev && logit) logev.entry(entry);
        res.status(200).send(result);
      }, function(err) {
        domain.requests--;
        onError(req,res,err);
      });
    }
    else {
      domain.requests--;
      entry.time = Date.now() - start;
      if (logev && logit) logev.entry(entry);
      res.status(200).send(x);
    }
  }
  catch(err) {
    if (domain) domain.requests--;
    onError(req,res,err);
  }
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

app.use(bodyParser.urlencoded({limit: limits.fileSize, extended: true}));
app.use(bodyParser.json({limit: limits.fileSize, strict: false }));
app.use(cookieSession({ name: "session", secret: passphraseSession, encrypted: true, maxage: limits.cookieAge, httpOnly: true, secure: true, signed: false, overwrite: true }));

app.use(function(err, req, res, next){
  if (!err) return next();
  onError(req, res,err);
});

// -------------------------------------------------------------
// Security   
// -------------------------------------------------------------
app.use(function(req, res, next){
  // console.log("referer: " + req.get("Referrer") + ", path: " + req.path + ", host: " + req.hostname);
  if (startsWith(req.path,"/rest/") || startsWith(req.path,"/oauth/")) {
    // for security do not store any rest or oauth request
    console.log("cache: no-store: " + req.path);
    res.setHeader("Cache-Control","no-store");
  }
  else {
    //console.log("cache: regular: " + req.path); 
  }
  
  // tell browsers to immediately redirect to https    
  res.setHeader("Strict-Transport-Security","max-age=43200; includeSubDomains");
  
  // default is very secure: just our server and no XHR/inline/eval 
  var csp = { "default-src": "'self'",
              "connect-src": "'none'",
              "report-uri": "/rest/report/csp",
            };

  // preview is sandboxed
  if (startsWith(req.path,"/preview/")) {
    delete csp["default-src"];
    csp["sandbox"]      = "allow-scripts allow-popups"; // already set in document, but just to be sure :-)    
  }
  else {
    // Don't allow content to be loaded in an iframe
    res.setHeader("X-Frame-Options","DENY");              
    // index uses bootstrap theme
    if (req.path==="/" || req.path==="/index.html") {
      csp["img-src"]      = "'self' data: https://maxcdn.bootstrapcdn.com";
      csp["font-src"]     = "'self' https://maxcdn.bootstrapcdn.com";
      csp["style-src"]    = "'self' 'unsafe-inline' https://maxcdn.bootstrapcdn.com";
      csp["script-src"]   = "'self' https://maxcdn.bootstrapcdn.com https://ajax.googleapis.com";
    }
    // the editor can use only server resources and connect to dropbox, onedrive.
    else if (req.path==="/editor.html") {
      csp["style-src"]    = "'self' 'unsafe-inline'";  // editor needs unsafe-inline for styles.
      csp["img-src"]      = "'self' data:";
      csp["connect-src"]  = "'self' https://*.dropbox.com https://login.live.com https://apis.live.net https://api.github.com https://localhost";
    } 
    else if (endsWith(req.path,".svg")) { 
      csp["style-src"]   = "'self' 'unsafe-inline'";   // editor/contrib/find needs this.
    }
  }
  var cspHeader = properties(csp).map(function(key) { return key + " " + csp[key]; }).join(";");
  res.setHeader("Content-Security-Policy-Report-Only",cspHeader);
  next();
});

// -------------------------------------------------------------
// Helpers 
// -------------------------------------------------------------

function startsWith(s,pre) {
  if (!pre) return true;
  if (!s) return false;
  return (s.substr(0,pre.length).indexOf(pre) === 0);
}

function endsWith(s,post) {
  if (!post) return true;
  if (!s) return false;
  return (s.indexOf(post, s.length - post.length) >= 0);
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
  mkdn: "text/markdown",
  markdown: "text/markdown",

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
  dim: "text/plain",

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
  return (mime.indexOf("text/") === 0 || mime==="application/json" ? "utf8" : "base64" );
}


function createHash(data) {
  return crypto.createHash('md5').update(data).digest('hex').substr(0,limits.hashLength);
}

function uniqueHash() {
  var unique = Date.now().toString() + ":" + Math.random().toString();
  return createHash(unique);
}



// -------------------------------------------------------------
// Logging
// -------------------------------------------------------------

var Log = (function(){

  function Log(base) {
    var self = this;
    self.base = base || "log-";    
    self.lastDigest = 0;
    self.start();
  }

  Log.prototype.start = function() {
    var self = this;
    if (self.ival) {
      clearInterval(self.ival);
      flush();
    }
    
    self.log = [];
    self.ival = setInterval( function() {
      self.flush();      
    }, limits.logFlush );
  }

  Log.prototype.flush = function() {
    var self=this;
    if (!self.log || self.log.length <= 0) return;

    var content = self.log.join("\n") + "\n";
    var date = new Date().toISOString().replace(/T.*/,"");
    var logFile = "log/" + self.base + date + ".txt";
    fs.appendFile( logFile, content, {encoding:"utf8"}, function(err) {
      if (err) {
        console.log("unable to write log data to " + logFile + ": " + err);
      }
    });
    self.log = []; // clear log
    var now = Date.now();
    if (now - self.lastDigest > limits.logDigest) {
      self.lastDigest = now;
      Stats.writeStatsPage();
    }
  }

  Log.prototype.entry = function( obj, hide ) {
    var self = this;
    if (!obj) return;
    var data = JSON.stringify(obj);
    if (!hide) console.log( data + "\n" );
    if (obj.type != "none" && self.log[self.log.length-1] !== obj) {
      self.log.push( data );
    }
  }

  return Log;
})();


var log    = new Log();
var logerr = log;
var logev  = log; // new Log("log-event");


function logRequest(req,msg) {
  var date = new Date().toISOString() ;
  dns.reverse( req.ip, function(err,doms) {
    if (err) doms = [];
    var mdoms = new Map();
    doms.forEach( function(dom) { mdoms.set(dom,true); } );
    doms = mdoms.keys();
    log.entry( { type: msg, ip: req.ip, url: req.url, domains: doms, date: date });
  });
}

/* count page hits */

var pagesCount = 0;
var pages = new Map();

setInterval( function() {
  if (pagesCount===0) return;
  var pagesStat = {
    type: "pages",
    pagesCount: pagesCount,
    pages: pages.keyElems(),
    date: new Date().toISOString(),    
  };
  if (log) log.entry( pagesStat, true );
  pagesCount = 0;
  pages = new Map();
}, limits.logFlush );

// -------------------------------------------------------------
// General server helpers
// -------------------------------------------------------------

// Get a unique user path for this session.
function getUser( req ) {  // : { id: string, requests: int, path: string }
  var requests = usersGetRequests(req.session.userid);
  if (requests >= limits.requestsPerUser) throw { httpCode: 429, message: "too many requests from this user" } ;
  
  return {
    id: req.session.userid,
    requests: requests,
    path: combine(runDir, createHash(req.session.userid) + "-" + uniqueHash()),
  };
}

function userEvent( req, res, action ) {
  return event(req,res,true, function() {
    return withUser(req, action );
  });
}


function withUser( req, action ) {
  var user = getUser(req);
  var start = Date.now();
  var entry = { type: "none", user: user, url: req.url, ip: req.ip, date: new Date(start).toISOString() };
  if (req.body.docname) entry.docname = req.body.docname;
  if (req.body.pdf) entry.pdf = req.body.pdf;
  log.entry( entry );
  user.requests++;

  return fstat(user.path).then( function(stats) {
    if (stats) throw { httpCode: 429, message: "can only run one process per user -- try again later" };
    return ensureDir(user.path);
  }).then( function() {
    return action(user);    
  }).always( function() {  
    entry.type = "user";  
    entry.time = Date.now() - start; 
    entry.size = 0;
    entry.files = req.body.files.map( function(file) {
      var size = file.content.length;
      entry.size += size;
      return { 
        path: file.path,
        //encoding: file.encoding,
        //mime: file.mime,
        size: size,
      };
    });
    log.entry( entry );
    if (user.path) {
      //console.log("remove: " + user.path);      
      setTimeout( function() {
        rmdir( user.path, function(err) {
          if (err) {
            var eentry = { type: "error", error: { message: "unable to remove: " + user.path + ": " + err.toString() } };
            extend(eentry,entry);          
            logerr.entry( eentry );
          }
        });
      }, limits.rmdirDelay );    
    }
    user.requests--;
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
function readFiles( userpath, docname, pdf, out ) {
  var ext    = path.extname(docname);
  var stem   = docname.substr(0, docname.length - ext.length );
  var fnames = [".dimx", "-math-dvi.dim", "-math-pdf.dim", 
                "-math-dvi.tex", "-math-pdf.tex", 
                "-math-dvi.final.tex", "-math-pdf.final.tex",
                "-bib.bbl", "-bib.aux"]
                .concat( pdf ? [".pdf",".tex"] : [] )
                .map( function(s) { return combine( outdir, stem + s ); });
  // find last log file
  var rxLog = /^[ \t]*log written at: *([\w\-\/\\]+\.log) *$/mig;
  var cap = rxLog.exec(out);
  var capx = cap;
  while((capx = rxLog.exec(out)) != null) {
    cap = capx;
  }
  if (cap && isValidFileName(cap[1])) {
    console.log("add output: " + cap[1]);
    fnames.push(cap[1]);
    //fnames.push(combine(outdir, stem + ".tex" ));
  }
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
      var out = stdout + "\n" + stderr + "\n";
      console.log("result: \n" + out);      
      return readFiles( userpath, docname, pdf, out ).then( function(filesOut) {
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
// Authentication redirection
// -------------------------------------------------------------
function encrypt(secret,value) {
  var cipher = crypto.createCipher('aes256', secret);
  var encrypted = cipher.update(value, 'utf8', 'base64') + cipher.final('base64');
  return encrypted;
}

function decrypt(secret,value) {
  var decipher = crypto.createDecipher('aes256', secret);
  var decrypted = decipher.update(value, 'base64', 'utf8') + decipher.final('utf8');
  return decrypted;
}

var remotes = JSON.parse(fs.readFileSync("./remotes.json",{encoding:"utf8"}));
properties(remotes).forEach( function(name) {
  var remote = remotes[name];
  //if (remote.xclient_id) remote.client_id = decrypt(passphraseSSL, remote.xclient_id);
  if (remote.xclient_secret) remote.client_secret = decrypt(passphraseLocal, remote.xclient_secret);
  if (!remote.name) remote.name = name;
  if (!remote.redirect_uris) {
    remote.redirect_uris = [
      "https://www.madoko.net/oauth/redirect",
      "https://madoko.cloudapp.net/oauth/redirect",
    ];
  }
});

function redirectPage(remote, message, status ) { 
  if (!remote) remote = { name: ""};
  if (!status) status = "ok";
  if (!message) {
    message = "Logged in to " + remote.name;
  }
  return [
    '<html>',
    '<head>',
    '  <title>Madoko ' + remote.name + ' login</title>',
    '  <link rel="stylesheet" type="text/css" href="../styles/main.css">',
    '</head>',
    '<body id="auth-redirect">',
    '  <div class="auth-redirect">',
    '    <p id="message">' + message + '</p>',
    '    <p><button id="button-close">Close Window</button></p>', 
    '    <script id="auth" data-status="' + status + '" data-remote="' + remote.name + '" src="../scripts/auth-redirect.js" type="text/javascript"></script>',
    '  </div>',
    '</body>',    
    '</html>'
  ].join("\n");
}

function redirectError(remote,message) {
  return redirectPage(remote, "Could not login" + (remote ? " to " + remote.name : "") + "." + (message ? "<br>" + message : ""), "error");
}

function oauthLogin(req,res) {
  res.status(200);
  var remote = null;

  console.log("oauth login request: " + req.path + ", " + JSON.stringify(req.query) );

  // check if this is a logout request..
  if (req.query.code == null) {
    return redirectPage(remote,"Logged out");
  }

  // get oauth state
  var cookieName = "oauth/state";
  var cookie = req.sessionCookies.get(cookieName); res.clearCookie(cookieName);
  var state  = {};
  try { state = JSON.parse(decodeURIComponent(cookie)); } catch(exn) { };
  
  remote = remotes[state.remote];
  if (!remote) {
    return redirectError(remote, "Unknown remote service." );
  }
  if (remote.flow === "token") {
    return redirectPage(remote,"","token");
  }

  // code flow
  // check state and redirection uri
  // console.log("states: " + req.query.state + ", " + state.state );
  if (!req.query.state || req.query.state != state.state) {
    return redirectError(remote, "The state parameter did not match; this might indicate a CSRF attack?" );
  }
  var uri = req.protocol + "://" + (req.hostname || req.host) + req.path;
  if (!remote.redirect_uris || remote.redirect_uris.indexOf(uri) < 0) {
    console.log(remote.redirect_uris);
    return redirectError(remote, "Invalid redirection url: " + uri ); 
  }

  // get access token
  var query = { 
    code: req.query.code,                
    grant_type: "authorization_code", 
    redirect_uri: uri,    
    client_id: remote.client_id,
    client_secret: remote.client_secret,
  };
  return makeRequest( { url: remote.token_url, method: "POST", secure: true, json: true }, query ).then( function(tokenInfo) {
    console.log(tokenInfo);
    if (!tokenInfo || !tokenInfo.access_token) {
      return redirectError(remote, "Failed to get access token from the token server.");
    }
    //req.session[remote.name] = { access_token: info.access_token };
    var options = { 
      url: remote.account_url, 
      secure: true, 
      json: true,
      headers: { "User-Agent": "Madoko" },
    };
    if (remote.useAuthHeader) {
      options.headers.Authorization = "Bearer " + tokenInfo.access_token;
    }
    else {
      options.query = { access_token: tokenInfo.access_token };
    }
    return makeRequest( options ).then( function(info) {
      console.log(info);
      var userInfo = {
        uid: info.uid || info.id || info.user_id || info.userid || null,
        name: info.display_name || info.name || "",
        access_token: tokenInfo.access_token,
        created:  new Date().toISOString(),
        nonce: uniqueHash(),
      };
      // store info in our encrypted cookie
      req.session.logins[remote.name] = userInfo;
      if (log) {
        log.entry( { 
          type: "login", id: req.session.userid, 
          uid: userInfo.uid, 
          remote: remote.name, 
          name: userInfo.name, 
          email: info.email || "", 
          date: userInfo.created, ip: req.ip, url: req.url 
        });
      }
      return redirectPage(remote);      
    }, function(err) {
      console.log("access_token failed: " + err.toString());
      return redirectError(remote, "Failed to retrieve account information.");
    });
  }, function(err) {
    console.log("authorization failed: " + err.toString());
    return redirectError(remote, "Failed to contact the token server.");
  });
}

function oauthLogout(req,res,remoteName,login) {
  delete req.session.logins[remoteName];
  var remote = remotes[remoteName];
  if (!remote || !login.access_token) return Promise.resolved();
  if (log) log.entry( { type: "logout", id: req.session.userid, uid: login.uid, remote: remote.name, created: remote.created, date: (new Date()).toISOString(), ip: req.ip, url: req.url } );
  
  if (!remote.disable_url) return Promise.resolved();
  console.log("disabling token...");  
  var options = { 
    url: remote.disable_url, 
    secure: true, 
    json: true 
  };
  if (remote.useAuthHeader) {
    options.headers = { Authorization: "Bearer " + login.access_token };
  }
  else {
    options.query = { access_token: login.access_token };
  }
  return makeRequest(options).then( function(info) {
    if (info) console.log("Successfully disabled the access token");
  });
}

// -------------------------------------------------------------
// Onedrive request redirection:
// Because onedrive does not support CORS we redirect all file
// content request over our server
// -------------------------------------------------------------

function urlParamsDecode(hash) {
  if (!hash) return {};
  if (hash[0]==="#" || hash[0]==="?") hash = hash.substr(1);
  var obj = {};
  hash.split("&").forEach( function(part) {
    var i = part.indexOf("=");
    var key = decodeURIComponent(i < 0 ? part : part.substr(0,i));
    var val = decodeURIComponent(i < 0 ? "" : part.substr(i+1));
    obj[key] = val;
  });
  return obj;
}

function urlParamsEncode( obj ) {
  var vals = [];
  properties(obj).forEach( function(prop) {
    vals.push( encodeURIComponent(prop) + "=" + encodeURIComponent( obj[prop] != null ? obj[prop].toString() : "") );
  });
  return vals.join("&");
}

function requestGET(query, encoding) {
  if (!encoding || encoding==="base64") encoding = "binary";
  return makeRequest( { url: query, encoding: encoding } );
}

function makeRequest(options,obj) {
  if (typeof options==="string") options = { url: options };
  if (!options.method) options.method = "GET";
  if (options.url) {
    var parts = Url.parse(options.url);
    options.hostname = parts.hostname;
    options.port = parts.port;
    options.path = parts.path;
    if (!options.secure) options.secure = (parts.protocol != "http:");
  }
  if (options.query) {
    options.path += "?" + urlParamsEncode(options.query);
  }

  var data = "";
  if (obj) {
    if (typeof obj === "string") {
      data = obj;
      options.headers['Content-Type'] = options.contentType || ';';
    }
    else {
      data = urlParamsEncode(obj);
      if (!options.headers) options.headers = {};
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    options.headers['Content-Length'] = data.length;
  }
  
  return new Promise( function(cont) {
    var req;
    var timeout = setTimeout( function() { 
      if (req) req.abort();
    }, (options.timeout && options.timeout > 0 ? options.timeout : limits.timeoutGET ) );
    console.log("outgoing request: " + (options.secure===false?"http://" : "https://") + options.hostname + (options.port ? ":" + options.port : "") + options.path);
    console.log(options);
    req = (options.secure===false ? http : https).request(options, function(res) {
      if (options.encoding) res.setEncoding(options.encoding);
      var body = "";
      res.on('data', function(d) {
        body += d;
        if (body.length > limits.fileSize) {
          req.abort();
        }
      });
      res.on('end', function() {
        clearTimeout(timeout);
        if (options.json) {
          try {
            body = JSON.parse(body);
          }
          catch(exn) {
            if (typeof body === "string") {
              body = urlParamsDecode(body);
            }
          }
        }
        cont( null, body ); //(encoding ? new Buffer(body,encoding) : body) );
      });
      res.on('error', function(err) {
        clearTimeout(timeout);
        cont(err, "");
      })
    });
    req.on('error', function(err) {
      clearTimeout(timeout);
      cont(err, "")
    });
    if (data) {
      req.write(data);
    }
    req.end();
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

function pushAtomic( name, time, release ) {
  if (!name || typeof name !== "string") throw { httpCode: 400, message: "invalid request (no 'name')" };
  if (!time) time = new Date(0);
  else if (typeof time === "string") time = date.dateFromISO(time);
  else if (!(time instanceof Date)) time = new Date(time.toString());


  var info = atomics.get(name);
  var atime = (info ? info.time : new Date(0));
  console.log("push-atomic: " + (release ? "release" : "acquire") + ": " + name)
  console.log("  acquire time: " + time );
  console.log("  found time: " + atime );
  if (release) {
    if (atime.getTime() == time.getTime()) {
      // only remove if not concurrently reaquired by someone else
      atomics.remove(name);
    }
    return { message: "released" };    
  }
  else {
    if (atime <= 0 || atime < time) {
      // someone is pushing a more recent version: ok
      atomics.set(name, { time: time, created: Date.now() });
      return { message: "acquired" };
    }
    else {
      // ouch. someone pushed a more recent version concurrently.
      throw { httpCode: 409, message: "failed to push atomically due to concurrent update." };
    }
  }
}

/* -------------------------------------------------------------
   Keep track of who edits what.
   The edits map, maps a 'global unique file name' to:

   info {
      users: map<uid,user>
   }

   user {
      lastUpdate: time   -- the last time this was updated
      editing: bool      -- true if writing, false if just reading
   }

   Since it proves hard to create truly global unique names,
   we also have an aliases map which maps file names to other names.
   This way we can use revisions on dropbox for example to create
   unique names. 
------------------------------------------------------------- */

var edits = new Map();
var aliases = new Map();

// We remove edit info after limits.editDelay if there was no update
setInterval( function() {
  var now = Date.now();
  edits.forEach( function(name,info) {
    info.users.forEach( function(id,user) {
      if (user.lastUpdate + limits.editDelay < now) {
        info.users.remove(id);
      }
    });
    if (info.users.count() === 0) {
      edits.remove(name);
    }
  });
  aliases.forEach( function(name,info) {
    var realname = resolveAlias(name);
    if (edits.get(realname)) {
      info.name = realname; // shorten chain
    }
    else {
      aliases.remove(name);
    }
  });
}, limits.editDelay/2 );

// Resolve a name to its shared true name
function resolveAlias(name) {
  var aliasInfo = null;
  var xname = name;
  while ((aliasInfo = aliases.get(xname)) != null && xname !== aliasInfo.name) {
    xname = aliasInfo.name;
  } 
  if (xname !== name) {
    //console.log("resolve alias final: " + name + " -> " + xname);    
  }
  return xname;
} 

// return a record { readers, writers } that show how many
// other readers and writers there are.
function getEditInfo( id, fname ) {
  var res = { fileName: fname, users: [] };
  var info = edits.get(fname);
  if (info && info.users) {
    info.users.forEach( function(uid,user) {
      if (uid !== id) {
        res.users.push( { name: user.name, kind: user.kind, line: user.line } );
      }
    });
  }
  return res;
}

function updateEditInfo( id, fname, editInfo, userName ) {
  if (!fname) return;
  var info = edits.get(fname);
  if (!info) {
    if (editInfo.kind === "none") return;
    info = { users : new Map() };
    edits.set(fname,info);
  }

  if (editInfo.kind === "none") {
    info.users.remove( id );
    if (info.users.count === 0) edits.remove(fname);
  }
  else {
    var user = info.users.getOrCreate( id, { lastUpdate: 0, kind: editInfo.kind, line: editInfo.line, name: (userName || "?") });
    user.lastUpdate = Date.now();
    user.kind = editInfo.kind;
    user.line = editInfo.line;
  }
}

// given a list of file names with their edit operation,
// return a list those file names with the number of readers and writers for each.
function editUpdate( req, userid, files, userName ) {
  if (!files) return {};
  var res = {};
  properties(files).forEach( function(fname) {
    if (!fname || fname[0] !== "/") return;
    var info = files[fname];
    if (!info) return;
    if (typeof info === "string") info = { kind: info, line: 0 }; //legacy
    if (typeof info !== "object") return;
    if (info.kind==null || info.kind=="remove") info.kind = "none";
    var realname = resolveAlias(fname);
    updateEditInfo( userid, realname, info, userName);
    res[fname] = getEditInfo(userid, realname);
    console.log("user: " + (userName || userid) + ": " + fname + ": " + (realname == fname ? "" : "as " + realname + ": ") + 
                  info.kind + ":" + info.line + "\n  " + JSON.stringify(res[fname]));
  });
  return res;
}

// Create a new alias
function editCreateAlias( req, userid, alias, name ) {
  console.log("edit alias: " + alias + " -> " + name);
  if (!alias || !name || alias == name) return;
  var realname = resolveAlias(name);
  if (realname == alias) return; // no cycles please
  var now = Date.now();
  aliases.set(alias, { createdTime: Date.now(), name: name });  
}

// -------------------------------------------------------------
// The server entry points
// -------------------------------------------------------------

var runs = 0;
app.post('/rest/run', function(req,res) {
  userEvent( req, res, function(user) {
    console.log("run request: " + (req.body.round ? req.body.round.toString() + ": " : "") + user.path);
    if (runs >= limits.maxProcesses) throw { httpCode: 503, message: "too many processes" };
    runs++;
    var docname  = req.body.docname || "document.mdk";
    var files    = req.body.files || [];
    var pdf      = req.body.pdf || false;
    return madokoRun( user.path, docname, files, pdf ).always( function() { runs--; } );  
  }); 
});

app.post('/rest/push-atomic', function(req,res) {
  event( req, res, false, function() {
    return pushAtomic( req.body.name, req.body.time, req.body.release );
  }, null, true );
});

app.post("/rest/edit", function(req,res) {
  event( req, res, true, function() {
    var files = req.body.files || {};
    var name  = req.body.name;
    return editUpdate(req,req.session.userid,files,name);
  });
});

app.post("/rest/edit-alias", function(req,res) {
  event( req, res, true, function() {
    var name = req.body.name || {};
    var alias = req.body.alias || {};
    editCreateAlias(req,req.session.userid,alias,name);
    editCreateAlias(req,req.session.userid,alias + "*",name + "*");
  });
});

app.put( "/rest/stat", function(req,res) {
  event(req,res,true,function() {
    var stat = {
      editTime: req.body.editTime || 0,
      viewTime: req.body.viewTime || 0,
      activeTime: req.body.activeTime || 0,
    };
    var login = null;
    properties(remotes).some( function(name) {
      login = req.session.logins[name];
      return (login != null);
    });
    var name = (login ? login.name : null) || req.session.userid;    
    console.log("stat user: " + name + ": editing: " + stat.editTime.toString() + "ms, active: " + stat.activeTime.toString() + "ms");
    log.entry( {
      type: "stat", 
      user: { id: req.session.userid, name: name },
      editTime: stat.editTime,
      viewTime: stat.viewTime,
      activeTime: stat.activeTime,
      ip: req.ip,
      url: req.url,      
      date: new Date().toISOString()
    });
  });
});

app.post("/rest/report/csp", function(req,res) {
  event(req,res, false, function() {
    console.log(req.body);
    //logerr.entry( { type:"csp", report: req.body['csp-report'], date: new Date().toISOString() } );
  });
});

app.get("/oauth/redirect", function(req,res) {
  event( req, res, true, function() {
    return oauthLogin(req,res);
  });
});

app.get("/oauth/token", function(req,res) {
  event( req, res, true, function() {
    var remoteName = req.param("remote");
    if (!remoteName) throw { httpCode: 400, message: "No 'remote' parameter" }
    var login = req.session.logins[remoteName];
    if (!login || typeof(login.access_token) !== "string" || typeof(login.created) !== "string") {
      return { httpCode: 401, message: "Not logged in to " + remoteName };
    }

    // check expiration date: we expire tokens ourselves for extra security
    var created = date.dateFromISO(login.created);
    if (created==null || created.getTime() === 0 || Date.now() > created.getTime() + limits.tokenExpires) {
      console.log("Expired token: " + login.created);
      return oauthLogout(req,res,remoteName,login).then( function() {
        return { httpCode: 401, message: "Not logged in to " + remoteName };
      });
    }
    return { access_token: login.access_token };
  });
})

app.post("/oauth/logout", function(req,res) {
  event( req, res, true, function() {
    var remoteName = req.param("remote");
    if (!remoteName) throw { httpCode: 400, message: "No 'remote' parameter" }
    var login = req.session.logins[remoteName];
    if (login) {
      return oauthLogout(req,res,remoteName,login);
    }
  });
})

app.get("/rest/remote/onedrive", function(req,res) {
  event( req, res, true, function() {
    var login = req.session.logins.onedrive;
    if (!login || !login.access_token) throw { httpCode: 401, message: "Must be logged in to request Onedrive content" };
    if (!/https:\/\/[\w\-\.]+?\.(livefilestore|files\.1drv)\.com\//.test(req.query.url)) {
      throw { httpCode: 403, message: "Illegal onedrive url: " + req.query.url };
    }
    return requestGET( req.query.url, "binary" );
  }, 100 );
});

app.get("/rest/remote/http", function(req,res) {
  event( req, res, false, function() {
    console.log("remote http get: " + req.query.url );
    return requestGET( req.query.url, encodingFromExt(req.query.url) ).then( function(content) {
      res.set('Content-Disposition',';');
      if (content==="Not Found" || // github
          (!/\.html?$/.test(req.query.url) && /^\s*<! *DOCTYPE\b/.test(content)) // generic
         ) {
        console.log(content.substr(0,40));
        throw { httpCode: 404, message: "not found: " + req.query.url };
      }
      return content;
    });
  }, 100 );
});

var staticOptions = {
  maxAge: 10000  
}
var staticClient      = express.static( combine(__dirname, "client"), staticOptions);
var staticMaintenance = express.static( combine(__dirname, "maintenance"), staticOptions);
var staticDirs = /\/(images(\/dark)?|scripts|dictionaries(\/en_US)?|styles(\/(lang|out|math|latex))?|lib(\/(vs|typo)(\/.*)?)?|preview(\/(lang|out|math|styles))?|templates(\/style)?|private)?$/;

function staticPage(req,res,next) {
  var dir = path.dirname(req.path);
  if (!staticDirs.test(dir)) {
    logRequest(req,"static-scan");
  }
  /*
  // don't allow queries
  var props = properties(req.query);
  if (!(props == null || props.length === 0 || (props.length===1 && props[0] === "nocache") || startsWith(req.url,"/lib/vs/base/worker"))) {
    onError( req, res, { httpCode: 403, message: "Sorry, queries are not allowed on this resource: " + req.url } );
    return;
  }
  */
  pagesCount++;
  pages.set(req.path, 1 + pages.getOrCreate(req.path,0));
  return (mode===Mode.Maintenance ? staticMaintenance : staticClient)(req,res,next);
}

app.use('/private', function(req,res,next) {
  console.log("private request: " + req.url)
  if (!privateIps.test(req.ip)) {
    onError( req, res, { httpCode: 403, message: "sorry, ip " + req.ip + " is not allowed access to private data" } );
  }
  else {
    return staticPage(req,res,next);
  }
});

app.use('/', function(req,res,next) {
  return staticPage(req,res,next);
});


// -------------------------------------------------------------
// Start listening on https
// -------------------------------------------------------------

var sslOptions = {
  pfx: fs.readFileSync('./ssl/madoko-cloudapp-net.pfx'),
  passphrase: passphraseSSL, // fs.readFileSync('./ssl/madoko-cloudapp-net.txt'),
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
  // don't allow queries
  if (req.url.indexOf("?") >= 0) { 
    res.status(403).send("Can only serve through secure connections.");
  }
  else {
    res.redirect("https://" + (req.hostname || req.host) + req.path); 
  }
});

http.createServer(httpApp).listen(80);


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
      if (logev) logev.flush();
      if (logerr) logerr.flush();
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

// and listen to console commands
listen();


