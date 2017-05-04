/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/
var dns     = require("dns");
var Cp      = require("child_process");

var Fs      = require("fs");
var Path    = require("path");

var Promise = require("./client/scripts/promise.js");
var Map     = require("./client/scripts/map.js");
var date    = require("./client/scripts/date.js");

if (!module.parent) {
	var CmdLine = require("commander").Command;
	var Options = new CmdLine("stats");
	Options
	  .usage("[options] [directories]")
	  .option("--async", "run asynchronous");

	Options.parse(process.argv);  
}
else {
	var Options = {
		args: [],
		async: true,
	};
}

function jsonParse(s,def) {
  try {
    return JSON.parse(s);
  }
  catch(exn) {
    return def;
  }
}

function fileExist(fileName) {
  var stats = null;
  try {
    stats = Fs.statSync(fileName);    
  }
  catch(e) {};
  return (stats != null);
}

function fileTime(fileName) {
  try {
    var stats = Fs.statSync(fileName);    
    if (stats != null && stats.mtime != null) {
    	return stats.mtime.getTime();    
    } 
    else return 0;
  }
  catch(e) {
  	return 0;
  };  
}


function _readDir(dir) {
  return new Promise( function(cont) { 
  	Fs.readdir(dir,cont); 
  });
}

function readDir(dir) {
	return _readDir(dir).then( function(fnames) {
		return fnames.map( function(fname) {
			return Path.join(dir,fname);
		});
	});
}

function readFile( path, options ) {
  return new Promise( function(cont) {
    Fs.readFile( path, options, cont );
  });
}


function writeFile( path, content, options ) {
  return new Promise( function(cont) {
    Fs.writeFile( path, content, options, cont );
  });
}

function digestFile(fname) {
  var fullName = fname;
  var digestName = fullName + ".json";	

  if (fileTime(digestName) > fileTime(fullName)) {
  	console.log("reused digest: " + fname);
  	var content = Fs.readFileSync(digestName,{encoding:"utf8"});
  	return JSON.parse(content);
  }  	
  else {
		console.log("read fresh   : " + fname);
		var content = Fs.readFileSync(fullName,{encoding:"utf8"});
		// parse entries
		var entries = {}
		if (content && content.length>0)  {
			if (content[0] === "[") {
				entries = JSON.parse(content); // older log
			}
			else {
	  		var lines = content.split("\n");
	  		entries = lines.map(function(line){ 
	  			return (line ? jsonParse(line,{type:"none"}) : {type:"none"});   // new logs are line separated JSON objects
	  		});			  		
	  	}
	  }
	  // normalize entries					
	  entries.forEach( function(entry) {
			if (!entry.date && entry.start) {
				entry.date = new Date(entry.start).toISOString();
			}
			if (!entry.type) {
				if (entry.error) entry.type = "error";
				else if (entry.url==="/rest/run" && entry.user && entry.time) entry.type = "user"; 
				else entry.type = "request";
			}
			//else if (entry.date && typeof entry.date === "string") {
			//	entry.date = date.dateFromISO(entry.date);
			//}
		});
	  return writeDigest(digestName, entries );
	}
}


function digestLogs(dirs) {
	dirs = dirs || ["log"];
	console.log("reading dirs: " + dirs.join(";"));
	return Promise.when( dirs.map(readDir) ).then( function(fnamess) {
		var fnames = [].concat.apply([], fnamess);
		fnames = fnames.filter( function(fname) { return /^log-[\w\-]+\.txt$/.test(Path.basename(fname)); } );
		console.log("found " + fnames.length + " files")
		return fnames;
	}).then( function(fnames) {
		var statss = fnames.map( digestFile );
		var stat = combineDigests(statss);
		console.log("combined")
		return writeStats(null,stat);
	}).then( function(res) {
		return res;
	}, function(err) {
		console.log("error: " + err.stack);
		throw err;
	});
}

function sum(xs) {
	var total = 0;
	if (xs != null && xs.length > 0) {
		for(var i = 0; i < xs.length; i++) {
			total += xs[i];		
		}
	}
	return total;
}

function avg(xs) {
	var total = 0;
	var n = 0;
	if (xs != null && xs.length > 0) {
		for(var i = 0; i < xs.length; i++) {
			total += xs[i];
			if (xs[i] != 0) n++;
		}
	}
	if (n==0) return 0;
	return Math.round(total/n);
}



function max(xs) {
	var m = 0;
	for(var i = 0; i < xs.length; i++) {
		if (xs[i] > m) m = xs[i];
	}
	return m;
}

function userVal(user) {
	return user.reqCount + (user.uid ? 10000 : 0);
}


function digestUsers(entries, all) {
	//console.log("digest users")
	var users = new Map();

	function userGet(id) {
		var user = users.get(id);
		while (user && user.redirect) {
			user = users.get(user.redirect);
		}
		return user;
	}

	function userSet(id,user) {
		user.id = id;
		users.set(id,user);
		return user;
	}

	function userGetOrCreate(id,defaultVal) {
		var user = userGet(id);
		if (user) {
			if (!user.name && defaultVal.name) user.name = defaultVal.name;
			if (!user.email && defaultVal.email) user.email = defaultVal.email;
			return user;
		}
		return userSet(id,defaultVal);
	}

	function userLink(id,uid) {
		var user1 = userGet(id);
		var user2 = userGet(uid);

		if (id === uid || (user1 && user2 && user1.id === user2.id)) {
			return user1;
		}
		else if (!user1 && !user2) {
			return null;
		}
		else if (!user1) {
			users.set(id, { redirect: uid });
			return user2;
		}
		else if (!user2) {
			users.set(id, { redirect: uid });
			userSet(uid, user1 );
			return user1;
		}
		else {
			// merge
			users.set(id, { redirect: uid });
			if (user1.entries) user2.entries = user1.entries.concat(user2.entries);
			if (!user2.name)   user2.name    = user1.name;
			if (!user2.email)  user2.email   = user1.email;
			return user2;
		}
	}

	entries.forEach( function(entry) {
		var user;
		if (entry.type === "login" || entry.type==="uid") {
			//if (entry.type==="uid" && entry.name != null) entry.uid = entry.name;
			var uid = entry.name || entry.uid;
			if (uid != null) {
				userGetOrCreate(uid,{ name: entry.name, email: entry.email, entries: [] });
				userLink(entry.id,uid);
				user = userLink(entry.uid,uid);			
			}
		}
		else if (entry.user && entry.user.id) {
			user = userGetOrCreate(entry.user.id, { name: entry.user.name || "", email: "", entries: [] });
		}
		else {
			user = null;
		}
		if (user) {
			entry.dateTime = date.dateFromISO(entry.date).getTime();
			if (!user.entries) console.log(user)
			user.entries.push(entry);
		}
	});
	users = users.filter( function(id,user) { return user.entries != null; } ).map( function(id,user) {
		var remotes = new Map();
		var editTime = 0;
		var viewTime = 0;
		var activeTime = 0;
		user.entries = user.entries.sort( function(x,y) { return x.dateTime - y.dateTime; } );
		user.entries.forEach( function(entry) {
			if (entry.type==="stat") {
				if (entry.editTime) editTime += entry.editTime;
				if (entry.viewTime) viewTime += entry.viewTime;				
				if (entry.activeTime) activeTime += entry.activeTime;				
			}
			if (entry.remote!=null && !remotes.contains(entry.remote)) remotes.set(entry.remote,true);
		});
		return {
			reqCount: user.entries.length,
			name: user.name || user.id,
			remote: remotes.keys().sort().join(","),
			//email: user.email,
			workTime: Math.ceil(activeTime/(60*1000)),
			editTime: Math.ceil(editTime/(60*1000)),
			viewTime: Math.ceil(viewTime/(60*1000)),
			id: id,
			uid: (user.name != ""),
		}
	});
	return users.elems().sort( function(x,y) { return userVal(y) - userVal(x); });
}

function writeStats( fname, obj ) {
	console.log("writing: " + fname);
  if (!fname) fname = "client/private/stats.html";
	console.log("writing: " + fname);
  return readFile("stats-template.html",{encoding:"utf-8"}).then( function(content) {
  	var json = JSON.stringify(obj);
  	JSON.parse(json);
    content = content.replace(/\bSTATSHERE\b/i,encodeURIComponent(json));
    return writeFile("stats-munge.json", JSON.stringify(obj,null,2)).then( function() {
    	return writeFile(fname,content);
    });
  });
}

function digestDaily(entries) {
	var daily = new Map();
	entries.forEach( function(entry) {
		var date = entry.date.replace(/T.*/,"");
		var dateEntries = daily.getOrCreate(date,[]);
		if (!entry.size) {
			if (entry.files) {
				entry.size = sum( entry.files.map( function(file) { return file.size; } ) );
			}
			else {
				entry.size = 0;
			}
		}
		dateEntries.push(entry);
	});
	daily = daily.map( function(date,dentries) {		
		var users = digestUsers(dentries);
		var runEntries = dentries.filter( function(entry) { return entry.url === "/rest/run"; })
		var pagesEntries = dentries.filter( function(entry) { return entry.type === "pages"; })
		return { 
			userCnt: users.length,
			users: users.map( function(entry) { return entry.id; }),
			pagesCnt: sum( pagesEntries.map( function(entry) { return entry.pagesCount; })),
			pageIdxCnt: sum( pagesEntries.map( function(entry) { 
				var ipages = entry.pages.filter(function(page) { return (page.key==="/" || page.key=="/index.html" || page.key=="/editor.html"); });
				return sum(ipages.map( function(page) { return page.value; })); 
			})),
			reqCount: dentries.length,
			runCount: runEntries.length,
			avgWTm: Math.ceil( avg( users.map( function(entry) { return entry.workTime; }) ) ),
			maxWTm : Math.ceil( max( users.map( function(entry) { return entry.workTime; }) ) ),
			avgSTm: avg( runEntries.map( function(entry) { return entry.time; }) ),
			maxSTm: max( runEntries.map( function(entry) { return entry.time; }) ),
			avgSTm: avg( runEntries.map( function(entry) { return entry.size; }) ),
			maxSSz: max( runEntries.map( function(entry) { return entry.size; }) ),
			//entries: dentries.map( function(entry) { return entry.user.id; } ),
		};
	});	
	
	var knownUsers = new Map();
	var knownCount = 0;
	daily.forEach( function(date,entry) {
		entry.users.forEach( function(id) {
			if (!knownUsers.get(id)) {
				knownUsers.set(id,true);
				knownCount++;
			}
		});
		// delete entry.users;
		entry.cumUserCnt = knownCount;
	});

	return daily;
}

function anonIP(ip) {
	return ip;
	// return (ip ? ip.replace(/\.\d+\s*$/, ".***") : "");
}

function anon(s) {
	if (!s) return "";
	return s.replace(/(https?:\/\/)|[a-zA-Z]:[\\\/][\w\-\_\.\\\/]*\bmadoko[\/\\]/,"$1");
}

function anonURL(s) {
	if (!s) return "";
	return s.replace(/[?#].*$/,"");
}

function reverse(xs) {
	if (!xs) return;
	var res = [];
	xs.forEach( function(x) { res.unshift(x); });
	return res;
}

function anonDomain(d) {
	if (!d) return "";
	if (d instanceof Array) return d.join(",");
	return d.toString();
}

function onDate(d1,d2) {
	var t1 = date.dateFromISO(d1.date).getTime();
	var t2 = date.dateFromISO(d2.date).getTime();
	return (t2 < t1 ? -1 : (t2 > t1 ? 1 : 0));
}

function digestErrors( entries ) {
	var errors = [];
	var scans = new Map();
	var rejects = 0;
	var pushfails = 0;
	entries.forEach( function(entry) {
		if (!((entry.type === "error" && entry.error) || entry.type==="static-scan")) return;
		if (entry.type === "static-scan") {
			if (!(/^\/(styles|preview)\/.*|\/templates\/(article|default|presentation|webpage).mdk$/.test(entry.url))) {
				var e = scans.getOrCreate(entry.url,{ url: entry.url, domain:"", count: 0, ip:anonIP(entry.ip), });
				var dom = anonDomain(entry.domains || entry.domain);
				if (!e.domain) e.domain = dom;
				else if (e.domain != dom) e.domain += "," + dom;
				e.date = entry.date;
				e.ip   = anonIP(entry.ip);
				e.count++;
			}
		}
		else if (/is not allowed access|is not on the white list/.test(entry.error.message)) {
			rejects++;
		}
		else if (entry.url==="/rest/push-atomic" && /^failed\b/.test(entry.error.message)) {
			pushfails++;
		}
		else if (/^not found:/.test(entry.error.message)) {
			return;
		}
		else {
			errors.unshift( {
				msg: anon(entry.error.message || "<unknown>"),
				ip: anonIP(entry.ip),
				domain: anonDomain(entry.domains || entry.domain),
				url: anonURL(entry.url),
				date: entry.date,
			});
		}
	});
	return { 
		errors: errors.sort(onDate), 
		rejects: rejects, 
		pushfails: pushfails, 
		scans: scans.elems().sort(onDate), 
	};
}

function digestDomains(entries) {
	var domains = new Map();
	entries.forEach( function(entry) {
		if (entry.ip) {
			var key = entry.ip.replace(/\.\d+$/, "");
			var e = domains.getOrCreate( key,  {
				count: 0,
				ip: anonIP(entry.ip),
				domain: anonDomain(entry.domains || entry.domain),
			});
			e.count++;
		}
	});
	return reverse(domains.elems()).sort( function(x,y) { return y.count - x.count; }).slice(0,25);
}

function dnsReverse( ip ) {
	return new Promise( function(cont) {		
		dns.reverse( ip.replace("::ffff:",""), cont );		
	});
}

function resolveDomains(entries) {
	return Promise.when( entries.map( function(entry) {
		if (entry.domain || !entry.ip) return Promise.resolved();
		return dnsReverse(entry.ip).then( function(doms) {
			if (doms) entry.domain = doms.join(",");		
		}, function(err) {
			return;
		});
	}));
}

function writeDigest( fname, entries ) {
	var start = Date.now();	
	console.log("stats: total entries: " + entries.length );
	var xentries = entries.filter(function(entry){ return (entry.date && entry.type !== "error"); });
	var errors = digestErrors(entries);
	console.log("stats: total errors: " + errors.errors.length );
	console.log("stats: total scans: " + errors.scans.length );
	var domains  = digestDomains(entries);
	console.log("stats: digest users...");
	var users   = digestUsers(xentries,true);
	errors.errors = errors.errors.slice(0,25);	
	console.log("stats: digest daily...");
	var stats = {
		daily: digestDaily(xentries).keyElems(),
		errors: errors,
		users: users,//.slice(0,100),
		domains: domains,
		userCount: users.length,
		date: new Date(),
	};
	console.log("stats: total time: " + (Date.now() - start).toString() + " ms");
	Fs.writeFileSync( fname, JSON.stringify(stats,null,2), {encoding:"utf8"} );
	return stats;
};

function combineDigests( statss ) {
	console.log("combining digests...");
	var stat = {
		daily: new Map(),
		errors: {
			errors: [],
			pushfails: 0,
			rejects: 0,
			scans: [],
		},
		users: new Map(),
		domains: new Map(),
		userCount: 0,
		date: new Date(),
	};
	statss.forEach( function(stat1) {
		combineStat( stat, stat1 );
	});
	console.log(" normalizing...");
	// normalize
	stat.users = stat.users.elems().sort( function(x,y) { return userVal(y) - userVal(x); });
	stat.domains = stat.domains.elems().sort( function(x,y) { return (x.count < y.count ? 1 : (x.count==y.count ? 0 : -1)); }).slice(0,100);
	stat.daily = stat.daily.keyElems().sort( function(x,y) { return (x.key < y.key ? -1 : (x.key==y.key ? 0 : 1)); });
	stat.userCount = stat.users.length;

	// calculate cumulative user count
	var knownUsers = new Map();
	var knownCount = 0;
	stat.daily.forEach( function(entry) {
		entry.value.users.forEach( function(id) {
			if (!knownUsers.get(id)) {
				knownUsers.set(id,true);
				knownCount++;
			}
		});
		entry.value.cumUserCnt = knownCount;
	});

	stat.users = stat.users.filter(function(x) { return x.editTime > 10; }); 

	console.log(" done.");
	return stat;
}

var oneMonthAgo = new Date();
oneMonthAgo.setMonth( oneMonthAgo.getMonth() - 1 );

function isNewish(x) {
	return (x!=null && x.date != null && date.dateFromISO(x.date).getTime() > oneMonthAgo);
}

function combineStat( stat, _stat ) {
	if (_stat.daily) {
		_stat.daily.forEach( function(entry) {
			if (!stat.daily.contains(entry.key)) {
				stat.daily.set(entry.key,entry.value);
			}
			else {
				combineDaily( stat.daily.get(entry.key), entry.value );
			}
		});
	}
	if (_stat.domains) {
		_stat.domains.forEach( function(entry) {
			if (!stat.domains.contains(entry.ip)) {
				stat.domains.set(entry.ip, entry);
			}
			else {
				var dom = stat.domains.get(entry.ip);
				dom.count += entry.count;
			}
		});
	}
	if (_stat.users) {
		_stat.users.forEach( function(user) {
			if (!stat.users.contains(user.id)) {
				stat.users.set(user.id,user);
			}
			else {
				combineUser( stat.users.get(user.id), user);
			}
		});
	}
	if (_stat.errors) {
		stat.errors.errors = stat.errors.errors.concat(_stat.errors.errors.filter(isNewish));
		stat.errors.pushfails += _stat.errors.pushfails;
		stat.errors.rejects += _stat.errors.rejects;
		stat.errors.scans = stat.errors.scans.concat(_stat.errors.scans.filter(isNewish));
	}
}

function combineDaily( daily, _daily ) {
	daily.userCnt += _daily.userCnt;
	daily.users    = daily.users.concat(_daily.users);
	daily.pagesCnt += _daily.pagesCnt;
	daily.pageIdxCnt += _daily.pageIdxCnt;
	daily.reqCount += _daily.reqCount;
	daily.runCount += _daily.runCount;
	daily.avgWTm   = (daily.avgWTm + _daily.avgWTm) / 2;
	if (daily.maxWTm < _daily.maxWTm) daily.maxWTm = _daily.maxWTm;
  daily.avgSTm   = (daily.avgSTm + _daily.avgSTm) / 2;
	if (daily.maxSTm < _daily.maxSTm) daily.maxSTm = _daily.maxSTm;
	if (daily.maxSSz < _daily.maxSSz) daily.maxSSz = _daily.maxSSz;
	daily.cumUserCnt += _daily.cumUserCnt;	
}

function combineUser( user, _user ) {
	user.reqCount += _user.reqCount;
	if (user.name===user.id && _user.name !==user.id) user.name = _user.name;
	if (_user.remote && _user.remote.indexOf(user.remote) < 0) user.remote = user.remote + "," + _user.remote;
	user.workTime += _user.workTime;
	user.editTime += _user.editTime;
	user.viewTime += _user.viewTime;
	user.uid      = user.uid || _user.uid;
}



function oldwriteStatsPage( fname ) {
	if (!fname) fname = "client/private/stats.html";
	console.log("stats: reading files...");
	var start = Date.now();	
	return parseLogs().then( function(entries) {
		console.log("stats: total entries: " + entries.length );
		var xentries = entries.filter(function(entry){ return (entry.date && entry.type !== "error"); });
		var errors = digestErrors(entries);
		console.log("stats: total errors: " + errors.errors.length );
		console.log("stats: total scans: " + errors.scans.length );
		var domains  = digestDomains(entries);
		console.log("stats: digest users...");
		var users   = digestUsers(xentries,true);
		errors.errors = errors.errors.slice(0,25);
		// return resolveDomains(domains).then( function() {
			console.log("stats: digest daily...");
			var stats = {
				daily: digestDaily(xentries).keyElems(),
				errors: errors,
				users: users.slice(0,100),
				domains: domains,
				userCount: users.length,
				date: new Date(),
			};
			console.log("stats: total time: " + (Date.now() - start).toString() + " ms");
			return writeStats( fname, stats );
		//});
	}).then( function() {
		console.log("updated stats.");
	}, function(err) {
		console.log("unable to write stats:")
		console.log(err.stack);
	});;
};



function writeStatsPage() {
	var pdirs;
	if (Options.args && Options.args.length>0) {
		pdirs = Promise.resolved(Options.args);
	}
	else {
	  pdirs = readDir( "." ).then( function(dnames) {
			return dnames.filter( function(dname) { return /^log[\w\-]*$/.test(Path.basename(dname)); } );
		});
	}
	return pdirs.then( function(dirs) {
		console.log("dirs")
		return digestLogs(dirs);
	}, function(err) {
		console.log("error writing stats: " + err.stack);
	});
}

// run in a separate process so the website stays reactive
function asyncWriteStatsPage() {
	var command = /* "madoko */ "node ./stats.js";
	return new Promise( function(cont) {
  	console.log("> " + command);
  	Cp.exec( command, {timeout: 90000, maxBuffer: 512*1024 }, function(err,stdout,stderr) {
  		console.log(stdout);
  		console.log(stderr);
  		cont(err);
  	});
	}).then( function() { }, function(err) {
		console.log("unable to write stats:")
		console.log(err.stack);
	}); 
}

module.exports.writeStatsPage = asyncWriteStatsPage;

if (!module.parent) {
	if (Options.async) {
		asyncWriteStatsPage();
	}
	else {
		writeStatsPage();
	}
}


