#!/usr/bin/env node

//----------------------------------------------------------------------------
// Copyright 2015 Microsoft Corporation, Daan Leijen
//
// This is free software; you can redistribute it and/or modify it under the
// terms of the Apache License, Version 2.0. A copy of the License can be
// found in the file "license.txt" at the root of this distribution.
//----------------------------------------------------------------------------
var Fs = require("fs");
var Path = require("path");

//-----------------------------------------------------
// Configuration
//-----------------------------------------------------
var main      = "madoko-local";
var sourceDir = "src";
var mainCli   = Path.join(sourceDir,"cli.js");
var nodeExe   = "node";
var defaultArgs = "--port=81 --verbose=2"

//-----------------------------------------------------
// Tasks: compilation 
//-----------------------------------------------------
task("default",["server"]);

desc(["build & run the server",
      "     server [options]     pass <options> to madoko-local"].join("\n"));
task("server", [], function() {
  var args = process.argv.slice(3).join(" "); // strip: node jake cmd
  fixVersion();
  var cmd = [nodeExe,mainCli,defaultArgs,args].join(" ");
  jake.logger.log("> " + cmd);
  jake.exec(cmd, {interactive: true}, function() { 
    complete(); 
  });
},{async:true});

desc("run 'npm install' to install prerequisites.");
task("config", [], function () {
  var cmd = "npm install";
  jake.logger.log("> " + cmd);
  jake.exec(cmd + " 2>&1", {interactive: true}, function() { complete(); });
},{async:true});



//-----------------------------------------------------
// Tasks: help
//-----------------------------------------------------
var usageInfo = [
  "usage: jake target[options]",
  "  <options> are target specific, like launch[--verbose=0].",
  ""].join("\n");

function showHelp() {
  jake.logger.log(usageInfo);
  jake.showAllTaskDescriptions(jake.program.opts.tasks);
  process.exit();  
}

desc("show this information");
task("help",[],function() {
  showHelp();
});
task("?",["help"]);

if (process.argv.indexOf("-?") >= 0 || process.argv.indexOf("?") >= 0) {
  showHelp();
}
else if (jake.program.opts.tasks) {
  jake.logger.log(usageInfo);
};


//-----------------------------------------------------
// Get the version from the package.json file
//-----------------------------------------------------
function getVersion() {
  var content = Fs.readFileSync("package.json",{encoding: "utf8"});
  if (content) {
    var matches = content.match(/"version"\s*\:\s*"([\w\.\-]+)"/);
    if (matches && matches.length >= 2) {
      return matches[1];
    }
  }
  return "<unknown>"
} 


function fixVersion(fname) {
  fname = fname || Path.join(sourceDir,"config.js");
  
  var config = {
    version: getVersion(),
    main   : main,
  };
  var content0 = Fs.readFileSync(fname,{encoding: "utf8"});
  if (content0) {
    var content = content0;
    for( var key in config ) {
      var rx = new RegExp( "^(var\\s*" + key + "\\s*=\\s*)\"[^\"\\n]*\"", "m" );
      var tmp = content.replace( rx, "$1\"" + config[key] + "\"");
      if (tmp !== content) {
        jake.logger.log("updating " + key + " in '" + fname + "' to '" + config[key] + "'");
        content = tmp;
      }
    }
    if (content !== content0) {
      Fs.writeFileSync(fname,content,{encoding: "utf8"});
    } 
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

// copyFiles 'files' to 'destdir' where the files in destdir are named relative to 'rootdir'
// i.e. copyFiles('A',['A/B/c.txt'],'D')  creates 'D/B/c.txt'
function copyFiles(rootdir,files,destdir) {
  rootdir = rootdir || "";
  rootdir = rootdir.replace(/\\/g, "/");
  jake.mkdirP(destdir);        
  files.forEach(function(filename) {
    // make relative
    var destname = Path.join(destdir,(rootdir && filename.lastIndexOf(rootdir,0)===0 ? filename.substr(rootdir.length) : filename));
    var logfilename = (filename.length > 30 ? "..." + filename.substr(filename.length-30) : filename);    
    var logdestname = (destname.length > 30 ? "..." + destname.substr(destname.length-30) : destname);    
    //jake.logger.log("cp -r " + logfilename + " " + logdestname);
    jake.cpR(filename,Path.dirname(destname));
  })
}
