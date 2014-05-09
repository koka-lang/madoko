/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

var cp      = require("child_process");
var mkdirp  = require("mkdirp");
var rmdir   = require("rimraf");
var fs      = require("fs");
var path    = require("path");
var crypto  = require("crypto");
var https   = require("https");

var express       = require('express');
var bodyParser    = require("body-parser");
var cookieParser  = require("cookie-parser");

// -------------------------------------------------------------
// Wrap promises
// We use promises mostly to reliable catch exceptions 
// -------------------------------------------------------------
var Promise = require("./client/scripts/promise.js");
var Map     = require("./client/scripts/map.js");

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
  console.log("*******");
  console.log(err);
  var result = {
    message: err.killed ? "process time-out" : err.toString(),
    code: err.code || 0,
  };
  result.httpCode = err.httpCode || (startsWith(result.message,"unauthorized") ? 403 : 500);
  if (err.stdout) result.stdout = err.stdout;
  if (err.stderr) result.stderr = err.stderr;

  //console.log("*****\nerror (" + result.httpCode.toString() + "): " + result.message);
  if (logerr) logerr.entry( {
    error: result,
    user: res.user,
    ip: req.ip,
    url: req.url,
    start: Date.now(),
  });

  res.send( result.httpCode, result );
}

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
}, 60 * 60 * 1000); 

function event( req, res, action, maxRequests ) {
  var domain = null;
  if (!maxRequests) maxRequests = limits.requestsPerDomain;
  try {
    var entry =  {
      ip: req.ip,
      url: req.url,
      params: req.params,
      start: Date.now(),        
    };
    if (logev) logev.entry( entry );    
    domain = domainsGet(req);
    if (domain.requests > maxRequests) throw { httpCode: 429, message: "too many requests from this domain"};
    domain.requests++;
    var x = action();
    if (x && x.then) {
      x.then( function(result) {
        domain.requests--;
        entry.time = Date.now() - entry.start;
        if (logev) logev.entry(entry);
        res.send(200,result);
      }, function(err) {
        domain.requests--;
        onError(req,res,err);
      });
    }
    else {
      domain.requests--;
      entry.time = Date.now() - entry.start;
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

var limits = {
  requestsPerDomain: 10,
  requestsPerUser: 2,
  requestNewUser: 5,
  maxProcesses: 10, 
  hashLength: 16,
  fileSize: 5,                // max file-size in mb
  cookieAge: 24 * 60 * 60000, // 1 day for now
  timeoutPDF: 60000,
  timeoutMath: 30000,
  timeoutGET: 5000,
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

app.use(bodyParser({limit: limits.fileSize.toString() + "mb", strict: false }));
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

  Log.prototype.start = function( n ) {
    var self = this;
    if (self.ival) {
      clearInterval(self.ival);
      flush();
    }
    self.logNum = n;
    self.logFile = combine("log", self.base + self.logNum.toString() + ".txt");
    self.log = [];
    self.ival = setInterval( function() {
      var size = self.flush();
      if (size > limits.fileSize * mb) {
        self.start(n+1);
      }
    }, 1000 );
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
var logev  = new Log("log-event");

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
  var entry = { user: user, url: req.url, ip: req.ip, start: Date.now() };
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
    entry.time = Date.now() - entry.start; 
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
      rmdir( user.path, function(err) {
        if (err) {
          var eentry = { error: { message: "unable to remove: " + user.path + ": " + err.toString() } };
          extend(eentry,entry);          
          logerr.entry( eentry );
        }
      });    
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
      if (stats.size > limits.fileSize*mb) return Promise.rejected( new Error("generated file too large: " + fname) );
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
  var command = /* "madoko */ "node ../../client/lib/cli.js " + flags + " " + stdflags + " "  + docname;
  return new Promise( function(cont) {
    console.log("> " + command);
    cp.exec( command, {cwd: userpath, timeout: timeout || 10000, maxBuffer: 512*1024 }, cont);
  }); 
}

// Run madoko program
function madokoRun( userpath, docname, files, pdf ) {
  return saveFiles( userpath, files ).then( function() {
    var flags = " -mmath-embed:512 -membed:512 " + (pdf ? " --pdf" : "");
    return madokoExec( userpath, docname, flags, (pdf ? limits.timeoutPDF : limits.timeoutMath) ).then( function(stdout,stderr) {
      //console.log("result: \n" + stdout + "\n" + stderr + "\n");
      return readFiles( userpath, docname, pdf ).then( function(filesOut) {
        return {
          files: filesOut.filter( function(file) { return (file.content && file.content.length > 0); } ),
          stdout: stdout,
          stderr: stderr,
        };
      });
    }, function(err,stdout,stderr) {
      //console.log("command error: \nstdout: " + stdout + "\nstderr: " + stderr + "\n");
      //console.log(err);
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
    req = https.get(query, function(res) {
      if (encoding) res.setEncoding(encoding);
      var body = "";
      res.on('data', function(d) {
        body += d;
        if (body.length > limits.fileSize * mb) {
          req.abort();
        }
      });
      res.on('end', function() {
        clearTimeout(timeout);
        cont( null, (encoding ? new Buffer(body,encoding) : body) );
      });
      res.on('error', function(err) {
        clearTimeout(timeout);
        cont(err, "");
      })
    });
  });  
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

app.post("/report/csp", function(req,res) {
  event(req,res, function() {
    console.log(req.body);
    logerr.entry( { 'csp-report': req.body['csp-report'], start: Date.now() } );
  });
});

app.get("/redirect/live", function(req,res) {
  event( req, res, function() {
    console.log("redirect authentication");
    return liveCallbackPage;
  });
});


app.get("/onedrive", function(req,res) {
  event( req, res, function() {
    console.log("onedrive get: " + req.query.url );
    return requestGET( req.query.url, "binary" );
  }, 100 );
});

app.use('/', express.static( combine(__dirname, "client") ));


// -------------------------------------------------------------
// Start listening
// -------------------------------------------------------------

var sslOptions = {
  key: fs.readFileSync('./ssl/madoko-server.key'),
  cert: fs.readFileSync('./ssl/madoko-server.crt'),
  ca: fs.readFileSync('./ssl/daan-ca.crt'),
  requestCert: true,
  rejectUnauthorized: false
};
https.createServer(sslOptions, app).listen(443);
