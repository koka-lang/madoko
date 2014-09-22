var Crypto  = require("crypto");
var Fs  		= require("fs");
var Path    = require("path");
var Promise = require("./client/scripts/promise.js");

var version = JSON.parse(Fs.readFileSync("../package.json")).version;
var options = JSON.parse(Fs.readFileSync("cache-config.json"));
var template= Fs.readFileSync("cache-template.txt");

function startsWith(s,pre) {
  if (!pre) return true;
  if (!s) return false;
  return (s.substr(0,pre.length) === pre);
}

function endsWith(s,post) {
  if (!post) return true;
  if (!s) return false;
  return (s.substr(-post.length) === post);
}

var _readDirRec	= require("recursive-readdir");
function readDirRec(dir) {
	return new Promise( function(cont) {
		return _readDirRec(dir,cont);
	});
}

function readResources() {
	return readDirRec(options.rootPath).then( function(files) {
		return files.map(function(fname) {
			return fname.substr(options.rootPath.length+1);
		}).filter( function(fname) {
			var dir = Path.dirname(fname);
			if (dir && !options.dirs.some(function(d) { return startsWith(dir,d); } )) {
				console.log("ignore: dir not included: " + dir + ": " + fname );
				return false;
			}
			var ext = Path.extname(fname).substr(1);
			if (!ext || !options.exts.some(function(e) { return (ext === e); })) {
				console.log("ignore: ext not included: " + fname );
				return false;
			}
			return true;
		});
	});
}

function readFile(fname) {
	return new Promise( function(cont) {
		return Fs.readFile(fname,cont);
	})
}

function createDigest(fnames) {
	var digest = Crypto.createHash('md5');
	var digests = fnames.map( function(fname) {
		return readFile(Path.join(options.rootPath,fname)).then( function(content) {
			digest.update(content);			
		});
	});
	return Promise.when(digests).then( function() {
		return digest.digest("hex");
	});
}

function createCache(fnames,digest) {
	var header = JSON.stringify( {
		version: version,
		digest: digest,
	});
	return [
		"CACHE MANIFEST",
		"#" + header,
		"",
		template,
		fnames.join("\n"),		
		"",
	].join("\n");
}

readResources().then( function(fnames) {
	console.log("creating digest...");
	return createDigest(fnames).then( function(digest) {
		var cache = createCache(fnames,digest);
		Fs.writeFileSync("madoko.appcache",cache);
		console.log("done");
	});	
}, function(err) {
	console.trace(err);
});