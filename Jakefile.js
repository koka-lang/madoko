#!/usr/bin/env node

//----------------------------------------------------------------------------
// Copyright 2013 Microsoft Corporation, Daan Leijen
//
// This is free software; you can redistribute it and/or modify it under the
// terms of the Apache License, Version 2.0. A copy of the License can be
// found in the file "license.txt" at the root of this distribution.
//----------------------------------------------------------------------------
var fs = require("fs");
var path = require("path");
var child = require("child_process");



//-----------------------------------------------------
// Configuration
//-----------------------------------------------------
var main      = "madoko";
var maincli   = "main";
var sourceDir = "src";
var outputDir = "lib";

var kokaDir   = "../koka"
var libraryDir= path.join(kokaDir,"lib")
var kokaExe   = path.join(kokaDir,"out/release/koka-0.5.0-dev")
var testDir   = "test";

var kokaFlags = "-i" + sourceDir + " -i" + libraryDir + " " + (process.env.kokaFlags || "");
var kokaCmd = kokaExe + " " + kokaFlags + " -c -o" + outputDir + " --outname=" + main + " " 


//-----------------------------------------------------
// Tasks: compilation 
//-----------------------------------------------------
task("default",["madoko"]);




desc(["build madoko.",
      "  madoko[--target=cs] # generate .NET binary."].join("\n"));
task("madoko", [], function(rebuild) {
  var args = Array.prototype.slice.call(arguments).join(" ")
  if (args.indexOf("--target=cs") >= 0) {
    args.unshift("-o" + outputDir + "net")
  }
  fixVersion()
  var cmd = kokaCmd + " -v " + args + " " + maincli
  jake.logger.log("> " + cmd);
  jake.exec(cmd, {interactive: true}, function() { 
    jake.cpR(path.join(sourceDir,"cli.js"), outputDir);
    jake.cpR(path.join(sourceDir,"css.sty"), outputDir);
    jake.cpR(path.join(sourceDir,main + ".sty"), outputDir);
    jake.cpR(path.join(sourceDir,main + ".css"), outputDir);
    complete(); 
  })
},{async:true});

desc("interactive madoko.");
task("interactive", [], function(rebuild) {
  var cmd = kokaCmd + " -e -p " + maincli
  jake.logger.log("> " + cmd);
  jake.exec(cmd, {interactive: true}, function() { complete(); })
},{async:true});

desc("run 'npm install' to install prerequisites.");
task("config", [], function () {
  if (!fileExist("node_modules")) {
    var cmd = "npm install";
    jake.logger.log("> " + cmd);
    jake.exec(cmd + " 2>&1", {interactive: true}, function() { complete(); });
  }
  else {
    complete();
  }
},{async:true});


//-----------------------------------------------------
// Tasks: clean 
//-----------------------------------------------------
desc("remove all generated files.");
task("clean", function() {
  jake.logger.log("remove all generated files");
  jake.rmRf(outputDir);
  jake.rmRf(outputDir + "net");
  jake.rmRf(outputDir + "doc");
});

//-----------------------------------------------------
// Tasks: test 
//-----------------------------------------------------
desc("run tests.\n  test[--extra]    # run tests for extensions.");
task("test", ["madoko"], function() {
  testFlags=(process.env.testFlags||"")
  args = Array.prototype.slice.call(arguments)
  testCmd = "node test " + testFlags + args.filter(function(s){ return (s.substr(0,2) == "--"); }).join(" ")
  jake.log("> " + testCmd)
  jake.exec(testCmd, {printStdout: true, printStderr: true})
}); 

//-----------------------------------------------------
// Tasks: bench 
//-----------------------------------------------------
desc("run benchmark.\n  bench[--quick]   # run the bench mark in quick mode.");
task("bench", [], function() {
  testFlags=(process.env.testFlags||"") 
  args = Array.prototype.slice.call(arguments)
  testCmd = "node test --bench --gfm " + testFlags + args.join(" ")
  jake.log("> " + testCmd)
  jake.exec(testCmd,{interactive:true})
}); 

//-----------------------------------------------------
// Tasks: doc
//-----------------------------------------------------
desc("generate documentation.\n  doc[--pdf]       # generate pdf too (using LaTeX).")  
task("doc", [], function(arg) {
  mdCmd = "node lib/cli.js --tex -v doc/overview.mdk";
  jake.log("> " + mdCmd);
  jake.exec(mdCmd, function() {
    if (arg=="pdf" || arg=="--pdf") {
      process.chdir("doc");
      texCmd = "pdflatex -halt-on-error overview.tex";
      jake.log("> " + texCmd);
      jake.exec(texCmd,function() { 
        process.chdir("..");
      },{interactive:true});
    }
  }, {interactive:true});
});


//-----------------------------------------------------
// Tasks: line count
//-----------------------------------------------------
desc("line count.")  
task("linecount", [], function() {
  var sources = new jake.FileList().include(path.join(sourceDir,"*.kk"));
  var src = sources.toArray().map( function(file) { return fs.readFileSync(file,{encoding:"utf8"}); }).join()
  //xsrc     = src.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t\r]*\n|^[ \t]*\/\/.*\n/gm, "")
  comments = lineCount(src.match(/^[ \t]*\/\*[\s\S]*?\*\/[ \t\r]*\n|^[ \t]*\/\/.*\n/gm).join())
  blanks   = src.match(/\r?\n[ \t]*(?=\r?\n)/g).length  
  total    = lineCount(src)
  jake.log("total lines   : " + total)  
  jake.log(" source lines : " + (total-comments-blanks))
  jake.log(" comment lines: " + comments) 
  jake.log(" blank lines  : " + blanks ) 
});

function lineCount(s) {
  return s.split(/\n/).length;
}

//-----------------------------------------------------
// Tasks: documentation generation & editor support
//-----------------------------------------------------
var cmdMarkdown = "node " + path.join(outputDir,maincli + ".js");
          
desc("create source documentation.")  
task("sourcedoc", [], function(mode) {
  jake.logger.log("build documentation");
  var out = outputDir + "doc"
  var tocCmd = kokaCmd + "-o" + out + " -l --html -v toc.kk"
  jake.log("> " + tocCmd)
  jake.exec(tocCmd, {interactive: true}, function () {
    var outstyles = path.join(out,"styles");
    var xmpFiles = new jake.FileList().include(path.join(out,"*.xmp.html"));
    var cmd = cmdMarkdown + " " + xmpFiles.toArray().join(" ")
    jake.log( "> " + cmd)
    jake.exec(cmd, {printStdout: true, printStderr:true}, function () {
      // copy style file
      jake.mkdirP(outstyles);
      jake.cpR(path.join(kokaDir,"doc","koka.css"),outstyles);
      complete();
    });
  });
}, {async:true});


desc(["install Sublime Text 2 support files.",
     "     sublime[<version>]  # install for <version> instead (2 or 3)."].join("\n")
    );
task("sublime", function(sversion) {
  jake.logger.log("install Sublime Text support");
  var sublime =　"";
  var sversion = sversion || "2"
  if (process.env.APPDATA) {
    sublime = path.join(process.env.APPDATA,"Sublime Text " + sversion);
  } 
  else if (process.env.HOME) {
    if (path.platform === "darwin") 
      sublime = path.join(process.env.HOME,"Library","Application Support","Sublime Text " + sversion);
    else 
      sublime = path.join(process.env.HOME,".config","sublime-text-" + sversion);
  }
  sublime = path.join(sublime,"Packages");

  if (!fileExist(sublime)) {
    jake.logger.error("error: cannot find sublime package directory: " + sublime);
  }
  else {
    var dirCS = "Color Scheme - Default";
    var sublimeCS = path.join(sublime,dirCS);

    jake.mkdirP(sublimeCS);
    jake.cpR(path.join("support","sublime-text","Snow.tmTheme"),sublimeCS);    
    jake.cpR(path.join("support","sublime-text","madoko"),sublime);
  }
});


//-----------------------------------------------------
// Tasks: help
//-----------------------------------------------------
var usageInfo = [
  "usage: jake target[options]",
  "  <options>        are target specific, like bench[--quick].",
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
  var content = fs.readFileSync("package.json",{encoding: "utf8"});
  if (content) {
    var matches = content.match(/"version"\s*\:\s*"([\w\.\-]+)"/);
    if (matches && matches.length >= 2) {
      return matches[1];
    }
  }
  return "<unknown>"
} 


function fixVersion(fname) {
  fname = fname || "options.kk";
  fname = path.join(sourceDir,fname);
  var version = getVersion();
  var content1 = fs.readFileSync(fname,{encoding: "utf8"});
  if (content1) {
    var content2 = content1.replace(/^(public\s*val\s*version\s*=\s*)"[^"\n]*"/m, "$1\"" + version + "\"")
    if (content1 !== content2) {
      jake.logger.log("updating version string in '" + fname + "' to '" + version + "'")
      fs.writeFileSync(fname,content2,{encoding: "utf8"});
    } 
  }
}

function fileExist(fileName) {
  var stats = null;
  try {
    stats = fs.statSync(fileName);    
  }
  catch(e) {};
  return (stats != null);
}
