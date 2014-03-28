var cp     = require("child_process");
var mkdirp = require("mkdirp");
var async = require("async");
var fs    = require("fs");
var path = require("path");
var crypto = require("crypto");
var express = require('express');
var app = express();

app.use(express.json());
app.use(express.urlencoded());
app.use(express.cookieParser("@MadokoRocks!@!@!"));
app.use(express.cookieSession({key:"madoko.sess"}));
app.use(app.router);
app.use(function(err, req, res, next){
  if (!err) return next();
  console.log(err);
  res.send(500,err.toString());
});

var cookieAge = 20000; //24 * 60 * 60000;
var userRoot = "users";
var userHashLimit = 8;
var userCount = 0;

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

// Get a unique user path for this session.
function getUserPath( req,res ) {
  var userpath = req.signedCookies.userpath
  if (!userpath) {
    var unique = (new Date()).toString() + ":" + Math.random().toString;
    userCount++;
    userpath = "test"; // userCount.toString() + "-" + crypto.createHash('md5').update(unique).digest('hex').substr(0,userHashLimit);
    res.cookie("userpath", userpath, { signed: true, maxAge: cookieAge, httpOnly: true } );    
  }
  return userRoot + "/" + userpath;
}


// Save files to be processed.
function saveFiles( userPath, files, cont ) {
  async.each( properties(files),  function(fname,xcont) {
    if (fname.substr(0,1) !== "/") return xcont();
    var fpath = path.join(userPath,fname.substr(1)); // todo: check validity of the file name
    console.log("file: " + fpath);
    var dir = path.dirname(fpath);
    mkdirp(dir, function(err) {
      if (err) xcont(err);
          else fs.writeFile( fpath, files[fname], {encoding:"utf8"}, xcont );
    });
  }, cont );
}

// Read madoko generated files.
function readFiles( userpath, docname, fnames, cont ) {
  if (!fnames || (fnames instanceof Array && fnames.length == 0)) {
    var ext = path.extname(docname);
    var stem = docname.substr(0, docname.length - ext.length );
    fnames = [stem + ".dimx", stem + "-bib.bbl"];
  }
  console.log(fnames);
  var files = {};
  async.each( fnames, function(fname,xcont) {
    fs.readFile( path.join(userpath,fname), {encoding:"utf8"}, function(err,data) {
      files["/" + fname] = (err ? "" : data);
      xcont();
    });
  }, function(err) {
    cont(err,files);
  });
}

// run madoko
function runMadoko( userPath, docname, flags, cont ) {
  var command = /* "madoko */ "node ../../client/lib/cli.js -vvv " + flags + " " + docname;
  console.log("> " + command);
  cp.exec( command, {cwd: userPath, timeout: 10000 }, cont); 
}

app.post('/rest/run', function(req,res) {
  var userpath = getUserPath(req,res);
  var docname = req.body.docname || "document.mdk";
  var result = { userpath: userpath };
  console.log(properties(req.body));
  saveFiles( userpath, req.body, function(err1) {
    if (err1) {
      result.err = err1.toString();
      return res.send(403, result );
    }
    var flags = " -mmath-embed:256 " + (req.body.pdf ? " --pdf" : "");
    runMadoko( userpath, docname, flags, function(err2,stdout,stderr) {
      result.stdout = stdout;
      result.stderr = stderr;
      if (err2) {
        result.err = err2.toString();
        return res.send(403, result);
      }
      readFiles( userpath, docname, [], function(err3,files) {
        if (err3) {
          result.err = err3.toString();
          return res.send(403, result);
        }
        console.log(result);
        //console.log(files);
        extend(result,files);
        res.send( result );
      });
    });
  });
});

/*
app.get("/rest/ask", function(req,res) {
  var userpath = getUserPath(req,res);
  var name     = req.body.path || "document.mdk";
  var fpath    = path.join(userpath,name);
  fs.readFile( fpath, {encoding:"utf8"}, function(err,data) {
    if (err) {
      res.send(404,"Could not find: " + name );
    }
    else {
      res.send(data);
    }
  });
});
*/

app.use('/', express.static(__dirname + "/client"));
app.listen(3000);
