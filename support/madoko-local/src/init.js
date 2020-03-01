/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.

  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {

// -------------------------------------------------------------
// Imports
// -------------------------------------------------------------

var Path        = require("path");
var CmdLine     = require("commander").Command;

// local modules
var Util    = require("./util.js");
var Log     = require("./log.js");
var Config  = require("./config.js");

// -------------------------------------------------------------
// Constants
// -------------------------------------------------------------

var mb          = 1024*1024;
var second      = 1000;
var minute      = 60*second;
var hour        = 60*minute;
var day         = 24*hour;

// -------------------------------------------------------------
// Config & Command line options
// -------------------------------------------------------------

var config = {
  username  : "",
  userid    : "",
  installdir: Path.dirname(Path.dirname(Util.programDir())), // serve static content from here
  homedir   : Util.osHomeDir(), // user home directory
  configdir : null,             // save config info here ($HOME/.madoko)
  logdir    : null,             // save log files here (<configdir>/log)
  mountdir  : null,             // the local directory to give access to.
  port      : 8080,
  origin    : "https://www.madoko.net",
  secret    : null,
  verbose   : 0,
  concurrency: 4,
  limits    : {
    fileSize    : 64*mb,
    logFlush    : 5*minute,
    timeoutPDF  : 2*minute,
    timeoutMath : 2*minute,
  },
  run       : null,     // program to run Madoko locally
  rundir    : null,     // directory under which to run LaTeX. (<configdir>/run)
  runflags  : "",       // extra run flags.
  rmdirDelay: 10*second, // after this amount the run directory gets removed
  mime      : null,     // gets set to Express.static.mime
  launch    : false,    // if true, launch the browser at startup
}


var Options = new CmdLine(Config.main);
Options
  .usage("[options] [mount-directory]")
  .version(Config.version,"-v, --version")
  .option("-l, --launch", "launch default browser at correct localhost address")
  .option("-r, --run", "run madoko & latex locally for math and PDF rendering")
  .option("--secret [secret]", "use specified secret key, or generated key if left blank")
  .option("--port <n>", "serve at port number (=80)", parseInt )
  .option("--origin <url>", "give local disk access to <url> (" + config.origin + ")")
  .option("--homedir <dir>", "use <dir> as user home directory (for logging)")
  .option("--rundir <dir>", "use <dir> for running madoko (<homedir>/.madoko)")
  .option("--runcmd <cmd>", "use <cmd> as the madoko program")
  .option("--runflags <opts>", "pass extra options <opts> to the madoko program")
  .option("--verbose [n]","output trace messages (0 none, 1 info, 2 debug)", parseInt )
  .option("--rmdelay <secs>","delay before run directory is removed", parseInt )
  .option("-c, --concurrency <n>", "render math using <n> (=" + config.concurrency.toString() + ") processors", parseInt )

Options.on("--help", function() {
  console.log([
    "  Notes:",
    "    Access is given to any files and sub-directories under <mount-directory>.",
    "    If blank, the previous mount directory or current directory is used.",
    "",
    "    Previous secrets or mount directories are read from the configuration",
    "    file in '$HOME/.madoko/config.json'. Log files are written there too.",
    "",
    "    If the --run flag is given, mathematics, the bibilography, and PDF's are",
    "    generated locally instead of on the Madoko server. By default calls the",
    "    'madoko' program on the PATH but you can use --runcmd to change this.",
    "    The --rundir determines under which directory files are stored temporarily",
    "    when Madoko is invoked. By default this is '<homedir>/.madoko'",
  ].join("\n"));
});

function initializeConfig() {
  Options.parse(process.argv);

  // Home dir
  if (Options.homedir) config.homedir = Options.homedir;
  config.configdir = Util.combine(config.homedir, ".madoko");
  config.logdir = Util.combine(config.configdir,"log");

  // Try to read local config file
  var configFile  = Path.join(config.configdir,"config.json");
  var localConfig = Util.jsonParse(Util.readFileSync(configFile, {encoding:"utf8"}, "{}" ));

  if (typeof Options.secret === "string") {
    // use provided secret
    config.secret = Options.secret;
  }
  else if (typeof localConfig.secret === "string" && Options.secret !== true) {
    config.secret = localConfig.secret;
  }
  else {
    // generate a secret
    config.secret = Util.secureHash(12);

    // write back secret to localConfig...
    localConfig.secret = config.secret;
    Util.writeFileSync(configFile, JSON.stringify(localConfig), {encoding:"utf8",ensuredir:true});
  }

  // Port
  if (Options.port) config.port = Options.port;
  else if (typeof localConfig.port === "number") config.port = localConfig.port;

  // Concurrency
  if (Options.concurrency) config.concurrency = Options.concurrency;

  // Origin
  if (Options.origin) config.origin = Options.origin;
  else if (typeof localConfig.origin === "string") config.origin = localConfig.origin;

  // User
  if (localConfig.username) config.username = localConfig.username;
  else config.username = process.env["USER"] || process.env["USERNAME"] || "(local user)";

  if (localConfig.userid) config.userid = localConfig.userid;
  else config.userid = config.username;

  // Run
  if (Options.run) {
    if (typeof Options.runcmd === "string")
      config.run = Options.runcmd;
    else
      config.run = "madoko";

    if (typeof Options.runflags === "string") {
      config.runflags = Options.runflags;
    }

    if (typeof Options.rmdelay === "number" && Options.rmdelay >= 1) {
      config.rmdirDelay = Options.rmdelay * second;
      console.log("rmdir delay: " + config.rmdirDelay.toString());
    }
  }


  // Verbose
  if (Options.verbose === true) {
    config.verbose = 1;
  }
  else if (typeof Options.verbose === "number") {
    config.verbose = Options.verbose;
  }

  // Verify local directory
  if (Options.args && Options.args.length===1) {
    config.mountdir = Options.args[0];
    config.writebackDir = true;
  }
  else if (!Options.args || Options.args.length === 0) {
    if (typeof localConfig.mountdir === "string") config.mountdir = localConfig.mountdir;
    else {
      config.mountdir = process.cwd();
      config.writebackDir = true;
    }
  }

  if (!config.mountdir || !Util.fileExistSync(config.mountdir)) {
    console.log("Error: unable to find local root directory: " + config.mountdir);
    process.exit(1);
  }
  config.mountdir = Path.resolve(config.mountdir);

  // write back local root directory
  if (config.writebackDir) {
    localConfig.mountdir = config.mountdir;
    Util.writeFileSync(configFile, JSON.stringify(localConfig), {encoding:"utf8", ensuredir:true});
  }

  // Create rundir
  if (typeof Options.rundir==="string") {
    config.rundir = Options.rundir;
  }
  else {
    config.rundir = config.configdir;
  }
  config.rundir = Util.combine(config.rundir,".madoko-run");


  // Logging
  Log.setLog( config.verbose, config.logdir, config.limits.logFlush );

  // Launch
  config.launch = Options.launch;
  return config;
}


return {
  initializeConfig: initializeConfig,
};

});
