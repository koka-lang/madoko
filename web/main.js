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

// Get a unique user path for this session.
function getUserPath( req,res ) {
  var userpath = req.signedCookies.userpath
  if (!userpath) {
    var unique = (new Date()).toString() + ":" + Math.random().toString;
    userCount++;
    userpath = userCount.toString() + "-" + crypto.createHash('md5').update(unique).digest('hex').substr(0,userHashLimit);
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

// run madoko
function runMadoko( userPath, docname, flags, cont ) {
  var command = "madoko -v " + flags + " " + docname;
  console.log("> " + command);
  cp.exec( command, {cwd: userPath, timeout: 10000 }, cont); 
}

app.post('/rest/process', function(req,res) {
  var userPath = getUserPath(req,res);
  console.log(properties(req.body));
  saveFiles( userPath, req.body, function(err1) {
    console.log("save files: " + err1);
    var flags = "" + (req.body.pdf ? " --pdf" : "");
    runMadoko( userPath, req.body.docname || "document.mdk", flags, function(err,stdout,stderr) {
      res.send( { result: err,
                  stdout: stdout,
                  stderr: stderr,
                  userpath: userPath });
    });
  });
});

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

app.use('/', express.static(__dirname + "/client"));

app.listen(3000);
