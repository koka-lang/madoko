var cp     = require("child_process");
var mkdirp = require("mkdirp");
var fs    = require("fs");
var path = require("path");
var crypto = require("crypto");
var express = require('express');
var qs = require("querystring");
var https = require("https");
var http = require("http");

var app = express();
var previewApp = express();

var bodyParser = require("body-parser");
var cookieParser = require("cookie-parser");
var cookieSession = require("cookie-session");

app.use(bodyParser({limit: "5mb"}));
app.use(cookieParser("@MadokoRocks!@!@!"));
app.use(cookieSession({key:"madoko.sess", keys:["madokoSecret1","madokoSecret2"]}));


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

function isValidFileName(fname) {
  return (/^(?![\.\/])([\w\-]|\.\w|\/\w)+$/.test(fname));
}

// Download an image
function downloadImage( fpath, url, cont ) {
  https.get(url, function(res) {
    res.setEncoding("binary");

    var body = "";
    res.on('data', function(d) {
      body += d;
    })
    res.on('end', function() {
      var obj = null;
      try { obj = JSON.parse(body); } catch(exn) {};
      if (obj) {
        var msg = "error: could not download image: " + path.basename(fpath);
        if (obj.error && obj.error.message) {
          msg += "\n  " + obj.error.message;
        }
        console.log(msg);
        return cont(msg);
      }
      console.log("image downloaded: " + fpath);
      fs.writeFile( fpath, body, 'binary', cont );
    });
  }).on('error', function(err) {
    console.log("error while downloading image: " + err);
    cont(err);
  });  
}


function asyncForEach( xs, asyncAction, cont ) {
  if (!xs || xs.length===0) return cont(0,[]);
  var count = xs.length;
  var objs  = [];
  var err   = null;
  xs.forEach( function(x) {
    function localCont(xerr,obj) {
      objs.push(obj);
      if (xerr) err = xerr;
      count--;
      if (count <= 0) cont(err,objs);
    }
    try {
      asyncAction(x, localCont );
    }
    catch(exn) {
      localCont(exn);
    }
  });
}

// Save files to be processed.
function saveFiles( userPath, files, cont ) {
  asyncForEach( properties(files),  function(fname,xcont) {
    if (!fname || fname.substr(0,1) !== "/") return xcont();
    var file = files[fname];
    fname = fname.substr(1);
    if (!isValidFileName(fname)) return xcont("Invalid file name: " + fname);
    var fpath = path.join(userPath,fname); 
    console.log("writing file: " + fname + " (" + file.encoding + ")");
    var dir = path.dirname(fpath);
    mkdirp(dir, function(err) {
      if (err) return xcont(err);
      if (file.type === "text") {
        return fs.writeFile( fpath, file.content, {encoding:file.encoding}, xcont );
      }
      if (file.type === "image") {
        return fs.writeFile(fpath, file.content, {encoding:file.encoding}, xcont);
      }
      xcont(null);
    });
  }, cont );
}

// Read madoko generated files.
function readFiles( userpath, docname, fnames, cont ) {
  if (!fnames || (fnames instanceof Array && fnames.length == 0)) {
    var ext = path.extname(docname);
    var stem = docname.substr(0, docname.length - ext.length );
    fnames = [stem + ".dimx", stem + "-math-dvi.final.tex", stem + "-math-pdf.final.tex", 
              stem + "-bib.bbl", stem + "-bib.aux"];
  }
  console.log("sending back:\n" + fnames.join("\n"));
  var files = {};
  asyncForEach( fnames, function(fname,xcont) {
    fs.readFile( path.join(userpath,fname), {encoding:"utf8"}, function(err,data) {
      files["/" + fname] = (err ? "" : data);
      xcont();
    });
  }, function(err) {
    cont(err,files);
  });
}

// run madoko
function runMadoko( userPath, docname, flags, timeout, cont ) {
  var command = /* "madoko */ "node ../../client/lib/cli.js -vvv " + flags + " --sandbox " + docname;
  console.log("> " + command);
  cp.exec( command, {cwd: userPath, timeout: timeout || 10000, maxBuffer: 512*1024 }, cont); 
}


app.post('/rest/run', function(req,res) {
  var userpath = getUserPath(req,res);
  var docname = req.body.docname || "document.mdk";
  var result = { userpath: userpath };
  //console.log(req.body);
  console.log(properties(req.body));
  saveFiles( userpath, req.body, function(err1) {
    if (err1) {
      result.error = { message: err1.toString() };
      return res.send(401, result );
    }
    var flags = " -mmath-embed:512 -membed:512 " + (req.body.pdf ? " --pdf" : "");
    runMadoko( userpath, docname, flags, (req.body.pdf ? 30000 : 10000), function(err2,stdout,stderr) {
      result.stdout = stdout;
      result.stderr = stderr;
      if (err2) {
        result.error = { message: err2.toString() };
        return res.send(401, result);
      }
      readFiles( userpath, docname, [], function(err3,files) {
        if (err3) {
          result.error = { message: err3.toString() };
          return res.send(401, result);
        }
        console.log(result);
        //console.log(files);
        extend(result,files);
        res.send( result );
      });
    });
  });
});

var callbackPage = 
['<html>',
'<head>',
'  <title>Madoko Live Callback</title>',
'</head>',
'<body>',
'  <script src="//js.live.net/v5.0/wl.js" type="text/javascript"></script>',
'</body>',
'</html>'
].join("\n");

app.get("/redirect", function(req,res) {
  console.log("redirect GET");
  res.send(callbackPage);
});

function onedriveGet(query,cont) {
  https.get(query, function(res) {
    res.setEncoding("binary");
    //console.log("statusCode: ", res.statusCode);
    //console.log("headers: ", res.headers);
    var body = "";
    res.on('data', function(d) {
      body += d;
    })
    res.on('end', function() {
      cont(new Buffer(body) );
    });
  });  
}

app.get("/onedrive", function(req,res) {
  console.log("onedrive");
  console.log(req.query);
  onedriveGet(req.query.url, function(body) {
    //console.log("downloaded: " + body);
    res.send(body);
  });
});

app.get('/rest/download/:fname', function(req,res) {
  var userpath = getUserPath(req,res);
  var fname  = req.params.fname;
  console.log("download: " + req.path + ": " + path.join(userpath,fname));

  var url = "/temp/" + path.basename(userpath) + "/" + fname;
  console.log("redirect to: " + url);
  res.redirect(url);
  /*
  fs.readFile( path.join(userpath,fname), function(err,data) {
    console.log("download result: " + err);
    if (err) return res.send(403); // TODO: improve error result;
    //res.attachment(fname);
    var ext = path.extname(fname);
    res.type(ext);
    res.send(data);
  });
*/
});

/*

var liveClientId = "000000004C113E9D";
function liveGetAccessToken(code, cont) {
  var oauthurl = "https://login.live.com/oauth20_token.srf";
  var params = {
    client_id:     liveClientId,
    client_secret: "uZg0D-Mly-1UXtlyga5MQRsOH1PR0mL0",
    redirect_uri:  "http://madoko.cloudapp.net:8080/redirect",
    code:          code,
    grant_type:    "authorization_code"
  };
  var query = oauthurl + "?" + qs.stringify(params);
  console.log("GET: " + query);

  https.get(query, function(res) {
    console.log("statusCode: ", res.statusCode);
    console.log("headers: ", res.headers);

    var body = "";
    res.on('data', function(d) {
      body += d;
    })
    res.on('end', function() {
      cont(0,JSON.parse(body));
    });
  });
}

var oauthCallbackPage = 
['<html>',
'<head>',
'   <title>Madoko Live Callback</title>',
'</head>',
'<body>',
'   <script src="//js.live.net/v5.0/wl.js" type="text/javascript">alert("hi");</script>',
'</body>',
'</html>'
].join("\n");

app.get("/redirect/oauth", function(req,res) {
  var code = req.query.code;
  console.log("req: " + req.query);
  console.log("code: " + code);
  //console.log("cookies: " + req.cookies);
  if (!code) {
  res.end(500);
  }
  liveGetAccessToken(code, function(err,info) {
    console.log(req.host);
    console.log(info);
    var wl_auth = qs.parse(req.cookies.wl_auth);
    console.log(wl_auth);
    wl_auth.access_token = info.access_token;
    wl_auth.authentication_token = info.authentication_token;
    wl_auth.scope = info.scope;
    wl_auth.expires_in = info.expires_in;
    if (info.refresh_token) {
      wl_auth.refresh_token = info.refresh_token;
    }
    console.log(wl_auth);
    var age = parseInt(info.expires_in) * 1000;
    //console.log("age: " + age);
    console.log("set cookie: " + qs.stringify(wl_auth));
    res.cookie("wl_auth", qs.stringify(wl_auth), { expire: 0 } );
    res.send(callbackPage);
    res.end();
  });
});
*/

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

app.use('/temp/', express.static(__dirname + "/users/"));

app.use('/', express.static(__dirname + "/client"));

app.use(function(err, req, res, next){
  if (!err) return next();
  console.log(err);
  res.send(500,err.toString());
});



//app.listen(8080);
var sslOptions = {
  key: fs.readFileSync('./ssl/madoko-server.key'),
  cert: fs.readFileSync('./ssl/madoko-server.crt'),
  ca: fs.readFileSync('./ssl/daan-ca.crt'),
  requestCert: true,
  rejectUnauthorized: false
};
https.createServer(sslOptions, app).listen(8080);

previewApp.use('/preview', express.static(__dirname + "/client/preview"));
https.createServer(sslOptions, previewApp).listen(8181);
