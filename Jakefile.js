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
var styleDir  = "styles";
var contribDir = "contrib";
var web       = "web";
var webclient = path.join(web,"client");

var kokaDir   = "../koka"
var libraryDir= path.join(kokaDir,"lib")
var kokaExe   = path.join(kokaDir,"out/release/koka-0.6.0-dev")
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
  fixVersion();
  var cmd = kokaCmd + " -v " + args + " " + maincli;
  jake.logger.log("> " + cmd);
  jake.exec(cmd, {interactive: true}, function() { 
    jake.cpR(path.join(sourceDir,"cli.js"), outputDir);
    jake.cpR("contrib/monarch/monarch.js", outputDir);
    complete(); 
  })
},{async:true});

desc("interactive madoko.");
task("interactive", [], function(mainmod) {
  mainmod = mainmod || maincli
  var cmd = kokaCmd + " -e -p " + mainmod
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
  jake.rmRf("doc/out");
  jake.rmRf("web/client/lib");
});

//-----------------------------------------------------
// Tasks: web 
//-----------------------------------------------------
desc("build web madoko")
task("web", [], function() {
  // fixVersion("web/client/editor.html");
  var args = Array.prototype.slice.call(arguments).join(" ")
  var cmd = kokaCmd + " -v -l " + args + " " + "web" + maincli
  jake.logger.log("> " + cmd);
  jake.exec(cmd, {interactive: true}, function(err) {
    complete();
  });
},{async:true})

var localTexDir = "c:/texlive/texmf-local/tex/latex/local";
desc("setup web");
task("webcopy", ["web"], function() {
  // copy all madoko sources
  var js = new jake.FileList().include(path.join(outputDir,"*.js"));
  copyFiles(outputDir,js.toArray(),path.join(webclient,"lib"));
  
  // copy style, language, and image files
  jake.mkdirP(path.join(webclient,path.join(styleDir,"lang")));
  jake.mkdirP(path.join(webclient,path.join(styleDir,"images")));
  var js = new jake.FileList().include(path.join(styleDir,"*.css"))
                              .include(path.join(styleDir,"*.mdk"))
                              .include(path.join(styleDir,"lang","*.json"));
  copyFiles(styleDir,js.toArray(),path.join(webclient,styleDir));
  js     = new jake.FileList().include(path.join(contribDir,"styles","*.css"))
                              .include(path.join(contribDir,"styles","*.mdk"))
                              .include(path.join(contribDir,"styles","*.bib"))
                              .include(path.join(contribDir,"styles","*.cls"));
  copyFiles(path.join(contribDir,"styles"),js.toArray(),path.join(webclient,styleDir));
  js     = new jake.FileList().include(path.join(contribDir,"images","*.png"))
                              .include(path.join(contribDir,"images","*.pdf"));
  copyFiles(contribDir,js.toArray(),path.join(webclient,styleDir));
  
  // copy sty files to local texmf tree
  var sty = new jake.FileList().include(path.join(styleDir,"*.sty"));
  copyFiles(styleDir,sty.toArray(),localTexDir);
  copyFiles(styleDir,sty.toArray(),path.join(webclient,styleDir,"latex"))
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
task("doc", [], function() {
  var docout = "out";
  args = Array.prototype.slice.call(arguments).join(" ");
  var pngs = new jake.FileList().include(path.join("doc","*.png"));
  copyFiles("doc",pngs.toArray(),path.join("doc",docout));  
  process.chdir("doc");
  mdCmd = "node ../lib/cli.js -v --odir=" + docout + " " + args + " reference.mdk mathdemo.mdk slidedemo.mdk";
  jake.log("> " + mdCmd);
  jake.exec(mdCmd, {interactive:true}, function() {
    var files = ["reference","mathdemo","slidedemo"];
    var styles= [path.join(docout,"madoko.css")];
    var htmls = files.map( function(fname) { return path.join(docout,fname + ".html") });
    var pdfs  = files.map( function(fname) { return path.join(docout,fname + ".pdf") });
    var outfiles = htmls.concat(args.indexOf("--pdf") < 0 ? [] : pdfs,styles)
    copyFiles(docout,outfiles,".");
    complete();
  });
});


var doclocal = (process.env.doclocal || "\\\\research\\root\\web\\external\\en-us\\UM\\People\\daan\\madoko\\doc");
desc("publish documentation")
task("publish", [], function () {
  // copy to website
  var docout = "doc"
  var files = new jake.FileList().include(path.join(docout,"*.html"))
                                 .include(path.join(docout,"*.css"))
                                 .include(path.join(docout,"*.pdf"))
                                 .include(path.join(docout,"*.png"))
                                 .include(path.join(docout,"*.bib"))
                                 .include(path.join(docout,"*.js"))
                                 .include(path.join(docout,"*.mdk"));
  copyFiles(docout,files.toArray(),doclocal);
  fs.renameSync(path.join(doclocal,"reference.mdk"),path.join(doclocal,"reference.mdk.txt"));
  fs.renameSync(path.join(doclocal,"slidedemo.mdk"),path.join(doclocal,"slidedemo.mdk.txt"));
},{async:false});

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
  fname = fname || path.join(sourceDir,"options.kk");
  
  var version = getVersion();
  var content1 = fs.readFileSync(fname,{encoding: "utf8"});
  if (content1) {
    var content2 = content1.replace(/^(public\s*val\s*version\s*=\s*)"[^"\n]*"/m, "$1\"" + version + "\"")
                           .replace(/(<span\s+id="version">)[^<\n]*(?=<\/span>)/, "$1" + version)
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

// copyFiles 'files' to 'destdir' where the files in destdir are named relative to 'rootdir'
// i.e. copyFiles('A',['A/B/c.txt'],'D')  creates 'D/B/c.txt'
function copyFiles(rootdir,files,destdir) {
  rootdir = rootdir || "";
  rootdir = rootdir.replace(/\\/g, "/");
  jake.mkdirP(destdir);        
  files.forEach(function(filename) {
    // make relative
    var destname = path.join(destdir,(rootdir && filename.lastIndexOf(rootdir,0)===0 ? filename.substr(rootdir.length) : filename));
    var logfilename = (filename.length > 30 ? "..." + filename.substr(filename.length-30) : filename);    
    var logdestname = (destname.length > 30 ? "..." + destname.substr(destname.length-30) : destname);    
    //jake.logger.log("cp -r " + logfilename + " " + logdestname);
    jake.cpR(filename,path.dirname(destname));
  })
}
