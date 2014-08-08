/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

var Fs      = require("fs");
var Path    = require("path");

var Promise = require("../client/scripts/promise.js");
var Map     = require("../client/scripts/map.js");
var date    = require("../client/scripts/date.js");

var filenameStats = "stats.html";

function readDir(dir) {
  return new Promise( function(cont) { 
  	Fs.readdir(dir,cont); 
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

function parseLogs(dir) {
	dir = dir || "../log";
	return readDir( dir ).then( function(fnames) {
		fnames = fnames.filter( function(fname) { return /log-[\w\-]+\.txt/.test(Path.basename(fname)); } );
		return Promise.when( fnames.map( function(fname) { 
			console.log("read: " + fname);
			return readFile(Path.join(dir,fname),{encoding:"utf8"}); 
		})).then( function(fcontents) {
			var datas = fcontents.map( function(content) { 
				if (!content || content.length<=0) return [];
				if (content[0] === "[") return JSON.parse(content); // older log
			  var lines = content.split("\n");
			  return lines.map(function(line){ 
			  	return (line ? JSON.parse(line) : {type:"none"});   // new logs are line separated JSON objects
			  });
			});
			var entries = [].concat.apply([],datas);
			entries.forEach( function(entry) {
				// normalize
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
			return entries; 
		})
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

function digestUsers(entries) {
	var users = new Map();
	entries.forEach( function(entry) {
		if (entry.user == null || entry.user.id == null) return;
		var userEntries = users.getOrCreate(entry.user.id, []);
		userEntries.push(entry);
	});
	users = users.map( function(id,uentries) {
		var delta = 10*60*1000; // 10 minutes
		var total = 60*1000;    // 1 minute
		var prevTime = 0;
		uentries.forEach( function(entry) {
			var nextTime = date.dateFromISO(entry.date).getTime();
			if (prevTime===0) {
				prevTime = nextTime;
			}
			else if (prevTime + delta > nextTime) {
				total += (nextTime - prevTime);
				prevTime = nextTime;
			}
		});
		return {
			workTime: total,
			reqCount: uentries.length,
			id: id,
		}
	});
	return users.elems();
}

function writeStats( obj ) {
  return readFile("stats-template.html",{encoding:"utf-8"}).then( function(content) {
    content = content.replace("<STATS>", JSON.stringify(obj));
    return writeFile(filenameStats,content);
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
			userCount: users.length,
			users: users.map( function(entry) { return entry.id; }),
			pagesCount: sum( pagesEntries.map( function(entry) { return entry.pagesCount; })),
			pageIndexCount: sum( pagesEntries.map( function(entry) { 
				var ipages = entry.pages.filter(function(page) { return (page.key==="/" || page.key=="/index.html" || page.key=="/editor.html"); });
				return sum(ipages.map( function(page) { return page.value; })); 
			})),
			reqCount: dentries.length,
			avgWorkTime  : Math.ceil( avg( users.map( function(entry) { return entry.workTime; }) ) / (60*1000) ),
			maxWorkTime  : Math.ceil( max( users.map( function(entry) { return entry.workTime; }) ) / (60*1000) ),
			avgServerTime: avg( runEntries.map( function(entry) { return entry.time; }) ),
			maxServerTime: max( runEntries.map( function(entry) { return entry.time; }) ),
			avgServerSize: avg( runEntries.map( function(entry) { return entry.size; }) ),
			maxServerSize: max( runEntries.map( function(entry) { return entry.size; }) ),
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
		delete entry.users;
		entry.cumUserCount = knownCount;
	});

	return daily;
}

parseLogs().then( function(entries) {
	console.log("total entries: " + entries.length );
	var xentries = entries.filter(function(entry){ return (entry.date && entry.type !== "error"); });
	var stats = {
		daily: digestDaily(xentries).keyElems(),
		userCount: digestUsers(xentries).length
	};
	return writeStats( stats );
}).then( function() {
	console.log("done");
}, function(err) {
	console.log(err.stack);
});

