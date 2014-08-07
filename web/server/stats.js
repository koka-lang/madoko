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

function parseLogs(dir) {
	dir = dir || "../../../log";
	return readDir( dir ).then( function(fnames) {
		fnames = fnames.filter( function(fname) { return /log-\d+\.txt/.test(Path.basename(fname)); } );
		return Promise.when( fnames.map( function(fname) { return readFile(Path.join(dir,fname),{encoding:"utf-8"}) } ) ).then( function(fcontents) {
			var datas = fcontents.map( function(content) { return JSON.parse(content); } );
			var entries = [].concat.apply([],datas);
			entries.forEach( function(entry) {
				// normalize
				if (!entry.date && entry.start) {
					entry.date = new Date(entry.start).toISOString();
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
	users = users.map( function(uentries) {
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
		}
	});
	return users.elems();
}

function digestDaily(entries) {
	entries = entries.filter( function(entry) { return (entry.user != null && entry.time != null); } );
	console.log("total user entries: " + entries.length);
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
	console.log(daily.length)
	daily = daily.map( function(dentries) {		
		var users = digestUsers(dentries);
		var runEntries = dentries.filter( function(entry) { return entry.url === "/rest/run"; })
		return { 
			userCount: users.length,
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
	return daily;
}

parseLogs().then( function(entries) {
	try {
		console.log("total entries: " + entries.length );
		var daily = digestDaily(entries);
		console.log(daily);
	}
	catch(exn) {
		console.log(exn.stack);
	}
	return;
	//console.log(entries.map(function(entry){ return entry.date; }));
}, function(err) {
	console.trace(err);
});
