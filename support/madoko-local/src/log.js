/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {

var Util = require("./util.js");

// -------------------------------------------------------------
// Logging
// -------------------------------------------------------------

var Log = (function(){

  function Log(verbose,dir,flushIval,base) {
    var self = this;
    self.verbose = verbose;
    self.dir  = dir;
    self.base = base || "log-";    
    self.start(flushIval || 60000);
  }

  Log.prototype.message = function( msg, level, logfileLevel ) {
    var self = this;
    if (level==null) level = 0;
    if (logfileLevel==null) logfileLevel = 0;
    if (logfileLevel <= self.verbose) {
      self.entry( { type: "message", level: level, message: msg, /*date: new Date().toISOString()*/ });
    }
    if (level <= self.verbose) {
      var pre = (typeof level !== "number" || level <= 0 ? "" : Array(level+1).join("-") + " ");
      console.log( pre + msg );
    }
  }

  Log.prototype.info = function(msg,ll) {
    var self = this;
    self.message(msg,1,ll);
  };

  Log.prototype.trace = function(msg,ll) {
    var self = this;
    self.message(msg,2,ll);
  };

  Log.prototype.start = function(flushIval) {
    var self = this;
    if (self.ival) {
      clearInterval(self.ival);
      flush();
    }
    
    self.log = [];
    self.ival = setInterval( function() {
      self.flush();      
    }, flushIval );
  }

  Log.prototype.flush = function() {
    var self=this;
    if (!self.log || self.log.length <= 0) return;

    var content = self.log.join("\n") + "\n";
    var date = new Date().toISOString().replace(/T.*/,"");
    var logFile = Util.combine( self.dir, self.base + date + ".txt");
    return Util.appendFile(logFile, content, {encoding:"utf8",ensuredir: true} ).then( function() {
      return;
    }, function(err) {
      console.log("unable to write log data to " + logFile + ": " + err);
    });
    self.log = []; // clear log
  }

  Log.prototype.entry = function( obj, showConsole ) {
    var self = this;
    if (!obj) return;
    var data = JSON.stringify(obj);
    if (showConsole) console.log( data + "\n" );
    if (obj.type != "none" && self.log[self.log.length-1] !== obj) {
      self.log.push( data );
    }
  }

  return Log;
})();

var ConsoleLog = (function(){

  function ConsoleLog() { }

  ConsoleLog.prototype.message = function( msg, level, logfileLevel ) {
    var pre = (typeof level !== "number" || level <= 0 ? "" : Array(level+1).join("-") + " ");
    console.log( pre + msg );    
  }

  ConsoleLog.prototype.info = function(msg,ll) {
    var self = this;
    self.message(msg,1,ll);
  };

  ConsoleLog.prototype.trace = function(msg,ll) {
    var self = this;
    self.message(msg,2,ll);
  };

  ConsoleLog.prototype.flush = function() { }

  ConsoleLog.prototype.entry = function( obj, showConsole ) {
    var data = JSON.stringify(obj);
    if (showConsole) console.log( data + "\n" );
  }

  return ConsoleLog;
})();

var log = new ConsoleLog();

function setLog(verbose,dir,flushIval,base) {
  if (log) log.flush();
  log = new Log(verbose,dir,flushIval,base);
}

function message( msg, level, logfileLevel ) {
  if (log) log.message(msg,level,logfileLevel);
}

function info(msg,ll) { 
  if (log) log.info(msg,ll);
}

function trace(msg,ll) { 
  if (log) log.trace(msg,ll);
}

function entry(obj,showConsole) { 
  if (log) log.entry(obj,showConsole);
}

function flush() { 
  if (log) log.flush();
}

// module interface
return {
  setLog : setLog,
  message: message,
  info   : info,
  trace  : trace,
  entry  : entry,
  flush  : flush,
  Log    : Log,
};

});