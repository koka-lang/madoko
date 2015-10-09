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

  function Log(dir,flushIval,base) {
    var self = this;
    self.dir  = dir;
    self.base = base || "log-";    
    self.start(flushIval || 60000);
  }

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


// module interface
return {
  Log: Log,
};

});