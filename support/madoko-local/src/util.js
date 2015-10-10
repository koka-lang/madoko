/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {

// NodeJS modules
var Fs        = require("fs");
var Dns       = require("dns");
var Crypto    = require("crypto");
var Path      = require("path");

// function imports
var osHomeDir = require("os-homedir");
var openUrl   = require("open");
var mkdirp    = require("mkdirp");

// local imports
var Promise     = require("./promise.js");
var dateFromISO = require("./date.js").dateFromISO;


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
  return Path.normalize(fpath).replace(/\\/g,"/");
}

function combine() {
  var p = "";
  for(var i = 0; i < arguments.length; i++) {
    p = Path.join(p,arguments[i]);
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

function secureHash(len) {
  var unique = Crypto.randomBytes(256);
  var hash = Crypto.createHash('sha256').update(unique)
  return hash.digest('base64').substr(0,len || config.limits.hashLength);
}


// -------------------------------------------------------------
// Wrap promises
// We use promises mostly to reliable catch exceptions 
// -------------------------------------------------------------

function programDir() {
  var m = module; 
  if (m==null) return ''; 
  while(m.parent) { m = m.parent; }; 
  return (m.filename ? m.filename : '');
};

function jsonParse(s,def) {
  try{
    return JSON.parse(s);
  }
  catch(exn) {
    return def;
  }
}

function fileExistSync(fileName) {
  var stats = null;
  try {
    stats = Fs.statSync(fileName);    
  }
  catch(e) {};
  return (stats != null);
}

function readFileSync( fileName, options, defaultContent ) {
  try {
    return Fs.readFileSync(fileName,options);
  }
  catch(err) {
    if (defaultContent !== undefined) 
      return defaultContent;
    else
      throw err;
  }
}

function writeFileSync( fileName, content, options) {
  try {
    return Fs.writeFileSync(fileName, content, options);
  }
  catch(err) {
    console.log(err);
    console.log(options);
    if (err.code === "ENOENT" && options.ensuredir && !options.recurse) {
      mkdirp.sync(Path.dirname(fileName));
      return Fs.writeFileSync(fileName,content,options);
    }
    else throw err;
  }
}


function ensureDir(dir) {
  return new Promise( function(cont) { mkdirp(dir,cont); } );
}

function writeFile( fpath, content, options ) {
  return new Promise( function(cont) {
    Fs.writeFile( fpath, content, options, function(err) {
      if (err && err.code === "ENOENT" && options.ensuredir) {
        mkdirp( Path.dirname(fpath), function(err) {
          if (err) return cont(err);
          Fs.writeFile(fpath,content,options,cont);
        });
      }
      else {
        cont(err);
      }
    });
  });
}

function readFile( fpath, options ) {
  return new Promise( function(cont) {
    Fs.readFile( fpath, options, cont );
  });
}

function appendFile( fpath, content, options ) {
  return new Promise( function(cont) {
    Fs.appendFile( fpath, content, options, function(err) {
      if (err && err.code === "ENOENT" && options.ensuredir) {
        mkdirp( Path.dirname(fpath), function(err) {
          if (err) return cont(err);
          Fs.appendFile(fpath,content,options,cont);
        });
      }
      else cont(err);
    });
  });
}

function readDir( fpath ) {
  return new Promise( function(cont) {
    Fs.readdir( fpath, cont );
  });
}

function fstat( fpath ) {
  return new Promise( function(cont) {
    Fs.stat(fpath, function(err,stat) {
      if (err) cont(null,null);
         else  cont(err,stat);
    });
  });
}

function dnsReverse( ip ) {
  return new Promise( function(cont) {
    Dns.reverse( ip, function(err,doms) {
      if (err) {
        doms = null;
        console.log("unable to resolve ip: " + err.toString() );
      }
      cont(null,doms);      
    });
  });  
}


// module interface
return {
  // helpers
  startsWith  : startsWith,
  endsWith    : endsWith,
  jsonParse   : jsonParse,
  combine     : combine,
  properties  : properties,
  extend      : extend,
  secureHash  : secureHash,
  programDir  : programDir,
  osHomeDir   : osHomeDir,
  openUrl     : openUrl,
  dateFromISOString : dateFromISO,

  // sync read & write
  fileExistSync : fileExistSync,
  readFileSync  : readFileSync,
  writeFileSync : writeFileSync,

  // promise based file api
  ensureDir   : ensureDir,
  readFile    : readFile,
  writeFile   : writeFile,
  appendFile  : appendFile,
  readDir     : readDir,
  fstat       : fstat,
  dnsReverse  : dnsReverse,  
};

});