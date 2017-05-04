#!/usr/bin/env node

/**
 * Madoko tests
 * Copyright (c) 2013, Daan Leijen
 *
 * Modified from original file by:
 *
 * Copyright (c) 2011-2013, Christopher Jeffrey. (MIT Licensed)
 * https://github.com/chjj/marked
 */

/**
 * Modules
 */

var fs = require('fs')
  , path = require('path')
  , madoko = require('../lib/madoko');

/**
 * Load Tests
 */

function load() {
  var dir = __dirname + '/tests'
    , files = {}
    , list
    , file
    , i
    , l;

  list = fs
    .readdirSync(dir)
    .filter(function(file) {
      return path.extname(file) !== '.html';
    })
    .sort(function(a, b) {
      a = path.basename(a).toLowerCase().charCodeAt(0);
      b = path.basename(b).toLowerCase().charCodeAt(0);
      return a > b ? 1 : (a < b ? -1 : 0);
    });

  i = 0;
  l = list.length;

  for (; i < l; i++) {
    file = path.join(dir, list[i]);
    files[path.basename(file)] = {
      text: fs.readFileSync(file, 'utf8'), //.replace(/\r\n?|\u2424/g,"\n").replace(/\t/g, "    "),
      html: fs.readFileSync(file.replace(/[^.]+$/, 'html'), 'utf8')
    };
  }

  return files;
}

/**
 * Test Runner
 */

function runTests(engine, options) {
  if (typeof engine !== 'function') {
    options = engine;
    engine = null;
  }

  var engine = engine || madoko.markdown
    , options = options || {}
    , files = options.files || load()
    , complete = 0
    , failed = 0
    , skipped = 0
    , keys = Object.keys(files)
    , i = 0
    , len = keys.length
    , filename
    , file
    , text
    , html
    , j
    , l;

  options.madoko = options.madoko || {}
  //if (options.marked) {
  //  marked.setOptions(options.marked);
  //}

main:
  for (; i < len; i++) {
    filename = keys[i];
    file = files[filename];

    
    if ((~filename.indexOf('gfm_') && !options.madoko.gfm)
        || (~filename.indexOf('pedantic_') && !options.madoko.pedantic)
        || (~filename.indexOf('sanitize_') && !options.madoko.sanitize)
        || (~filename.indexOf('extra_') && !options.madoko.extra)
        || (~filename.indexOf('skip_'))) {
      skipped++;
      console.log('#%d. %s skipped.', i + 1, filename);
      continue main;
    }
    
    if (~filename.indexOf('extra_') || ~filename.indexOf('gfm_')) {
      options.madoko.bench = false;
      options.madoko.tocDepth = 3;
      options.madoko.headingDepth = 3;  
    }
    else {
      options.madoko.bench = true;
    }
    //options.madoko.bench = false;

    try {
      text = engine(file.text, options.madoko ).replace(/\s+/g, '').replace(/<!--[\s\S]*?-->/g,"");
      html = file.html.replace(/\s+/g, '').replace(/<!--[\s\S]*?-->/g,"");
    } catch(e) {
      console.log('%s failed.', filename);
      throw e;
    }

    j = 0;
    l = html.length;

    for (; j < l; j++) {
      if (text[j] !== html[j]) {
        failed++;

        text = text.substring(
          Math.max(j - 30, 0),
          Math.min(j + 30, text.length));

        html = html.substring(
          Math.max(j - 30, 0),
          Math.min(j + 30, html.length));

        console.log(
          '\n#%d. %s failed at offset %d. Near: "%s".\n',
          i + 1, filename, j, text);

        console.log("test options: " + showOptions(options.madoko))

        console.log('Got:\n%s\n', text.trim() || text);
        console.log('Expected:\n%s\n', html.trim() || html);

        if (options.stop) {
          break main;
        }

        continue main;
      }
    }

    complete++;
    console.log('#%d. %s completed.', i + 1, filename);
  }

  console.log('%d/%d tests completed successfully.', complete, len);
  if (failed) console.log('%d/%d tests failed.', failed, len);
  if (skipped) console.log('%d/%d tests skipped.', skipped, len);

  console.log("test options: " + showOptions(options.madoko))
  madoko.traceRuleHist()
}

/**
 * Benchmark a function
 */
var filename = ""
var benched = {}
var tries = 10;
var times = 50;

function bench(name, func) {
  var files = bench.files || load();

  if (!bench.files) {
    bench.files = files;

    // Change certain tests to allow
    // comparison to older benchmark times.
    fs.readdirSync(__dirname + '/new').forEach(function(name) {
      if (path.extname(name) === '.html') return;
      if (name === 'main.text') return;
      if (name.match(/^markdown/)) return;
      delete files[name];
    });
    

    files['backslash_escapes.text'] = {
      text: 'hello world \\[how](are you) today'
    };

    files['main.text'].text = files['main.text'].text.replace('* * *\n\n', '');
  }


  var keys = Object.keys(files)
    , l = keys.length
    //, filename
    , file;

  var bestTime = 0;
  var worstTime = 0;

  var tryCount = tries;
  while (tryCount--) {
    var start = Date.now() 
    var timeCount = times;

    while (timeCount--) {
      for (var i = 0; i < l; i++) {
        filename = keys[i];
        file = files[filename];
        //console.log("bench: " + filename)
        func(file.text,filename);
      }
    }
    var time = Date.now() - start;
    if (bestTime===0 || time < bestTime) bestTime = time
    if (worstTime===0 || time > worstTime) worstTime = time
  }
  console.log(' %s: completed in %dms.', leftAlign(name,27), time);
  benched[name] = time;
}

/**
 * Benchmark all engines
 */

noshow = { tex:true, css:true, packages:true, docClass:true, citestyle:true } 

function showOptions(obj) {
  var flags = []
  for (var key in obj) {
    if (obj.hasOwnProperty(key) && !noshow[key]) {
      if (typeof obj[key] === "boolean") {
        if (obj[key]) flags.push(key)
      }
      else if (typeof obj[key] === "number") {
        if (obj[key] > 0 && key != "headingBase") {
          flags.push(key)
        }
      }
      else if (obj[key]) {
        flags.push(key + ": " + obj[key])
      }
    }
  }
  return flags.join(", ")
}

function show(obj) {
  if (typeof obj === "object") {
    var xs = []
    for(var key in obj) {
      if (obj.hasOwnProperty(key)) {
        xs.push(key + ": " + show(obj[key]))
      }
    }
    return "{" + xs.join(", ") + "}"
  }
  else if (typeof obj === "string") {
    return obj
  }
  else if (typeof obj === "undefined") {
    return "undefined"
  }
  else if (obj === null) {
    return "null"
  }
  else return obj.toString()
}

function leftAlign(s,n) {
  if (!s || s.length >= n) return s
  return s + Array(1+n-s.length).join(" ")
}

function showBenchSummary() {  
  // show relative times
  var madokoTime = 0;
  for (var key in benched) {
    if (benched.hasOwnProperty(key) && /^madoko\b/.test(key)) {
      madokoTime = benched[key];
      break;
    }
  }
  if (madokoTime > 0) {
    console.log("\nrelative to madoko: ")
    for (var key in benched) {
      if (benched.hasOwnProperty(key)) {
        var relative = benched[key]/madokoTime;
        console.log(" %s: %d%s", leftAlign(key,27), relative.toFixed(2), (relative>1 ? "x slower" : (relative <1 ? "x faster" : "")) )
      }
    }
  }
}

function runBench(options) {  
    var options = options || {};
    var files = load();
    if (options.quick) tries = 3;
    console.log("benchmarking (best of %d times %d repetitions on %d files)", tries, times, Object.keys(bench.files || files).length )

    // madoko
    try {
      bench('madoko (' + showOptions(options.madoko) + ')', (function() {
        return function(text) {
          return madoko.markdown(text, options.madoko );
        };
      })());
      //madoko.statsShow()
    } catch (e) {
      console.log( filename + ': Could not bench madoko:');
      console.log(e)
    }

    // Non-GFM, Non-pedantic
    try {
      var marked = require("marked")
      marked.setOptions({
        gfm: false,
        tables: false,
        breaks: false,
        pedantic: false,
        sanitize: false,
        smartLists: false
      });
      if (options.marked) {
        marked.setOptions(options.marked);
      }
      bench('marked (' + showOptions(options.marked) + ')', marked);

      if (options.quick) {
        showBenchSummary()
        return;
      } 


       // GFM
      marked.setOptions({
        gfm: true,
        tables: false,
        breaks: false,
        pedantic: false,
        sanitize: false,
        smartLists: false
      });
      if (options.marked) {
        marked.setOptions(options.marked);
      }
      //bench('marked (gfm)', marked);

      // Pedantic
      marked.setOptions({
        gfm: false,
        tables: false,
        breaks: false,
        pedantic: true,
        sanitize: false,
        smartLists: false
      });
      if (options.marked) {
        marked.setOptions(options.marked);
      }
      //bench('marked (pedantic)', marked);

    } catch (e) {
      console.log( filename + ': Could not bench marked:');
      console.log(e)
    } 


    // robotskirt
    try {
      bench('robotskirt', (function() {
        var rs = require('robotskirt');
        return function(text) {
          var parser = rs.Markdown.std();
          return parser.render(text);
        };
      })());
    } catch (e) {
      console.log('Could not bench robotskirt.');
    }


    // showdown
    try {
      bench('showdown (reuse converter)', (function() {
        var Showdown = require('showdown');
        var convert = new Showdown.converter();
        return function(text) {
          return convert.makeHtml(text);
        };
      })());
      bench('showdown (new converter)', (function() {
        var Showdown = require('showdown');
        return function(text) {
          var convert = new Showdown.converter();
          return convert.makeHtml(text);
        };
      })());
    } catch (e) {
      console.log('Could not bench showdown.');
    }

    // markdown.js
    try {
      bench('markdown.js', require('markdown').parse);
    } catch (e) {
      console.log('Could not bench markdown.js.');
    }

    showBenchSummary()
}

/**
 * A simple one-time benchmark
 */

function time(options) {
  var options = options || {};
  bench('madoko', (function() {
    return function(text) {
      return madoko.markdown(text);
    };
  })());
}

/**
 * Markdown Test Suite Fixer
 *   This function is responsible for "fixing"
 *   the markdown test suite. There are
 *   certain aspects of the suite that
 *   are strange or might make tests
 *   fail for reasons unrelated to
 *   conformance.
 */

function fix(options) {
  ['tests', 'original', 'new'].forEach(function(dir) {
    try {
      fs.mkdirSync(path.resolve(__dirname, dir), 0755);
    } catch (e) {
      ;
    }
  });

  // rm -rf tests
  fs.readdirSync(path.resolve(__dirname, 'tests')).forEach(function(file) {
    fs.unlinkSync(path.resolve(__dirname, 'tests', file));
  });

  // cp -r original tests
  fs.readdirSync(path.resolve(__dirname, 'original')).forEach(function(file) {
    fs.writeFileSync(path.resolve(__dirname, 'tests', file),
      fs.readFileSync(path.resolve(__dirname, 'original', file)));
  });

  // node fix.js
  var dir = __dirname + '/tests';

  // fix unencoded quotes
  fs.readdirSync(dir).filter(function(file) {
    return path.extname(file) === '.html';
  }).forEach(function(file) {
    var file = path.join(dir, file)
      , html = fs.readFileSync(file, 'utf8');

    html = html
      .replace(/='([^\n']*)'(?=[^<>\n]*>)/g, '=&__APOS__;$1&__APOS__;')
      .replace(/="([^\n"]*)"(?=[^<>\n]*>)/g, '=&__QUOT__;$1&__QUOT__;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/&__QUOT__;/g, '"')
      .replace(/&__APOS__;/g, '\'');

    fs.writeFileSync(file, html);
  });

  // turn <hr /> into <hr>
  fs.readdirSync(dir).forEach(function(file) {
    var file = path.join(dir, file)
      , text = fs.readFileSync(file, 'utf8');

    text = text.replace(/(<|&lt;)hr\s*\/(>|&gt;)/g, '$1hr$2');

    fs.writeFileSync(file, text);
  });

  // markdown does some strange things.
  // it does not encode naked `>`, madoko does.
  (function() {
    var file = dir + '/amps_and_angles_encoding.html';
    var html = fs.readFileSync(file, 'utf8')
      .replace('6 > 5.', '6 &gt; 5.');

    fs.writeFileSync(file, html);
  })();

  // cp new/* tests/
  fs.readdirSync(path.resolve(__dirname, 'new')).forEach(function(file) {
    fs.writeFileSync(path.resolve(__dirname, 'tests', file),
      fs.readFileSync(path.resolve(__dirname, 'new', file)));
  });
}

/**
 * Argument Parsing
 */

function parseArg(argv) {
  var argv = process.argv.slice(2)
    , options = { madoko: madoko.initialOptions()  }
    , orphans = []
    , arg;

  options.madoko.tocDepth = 0
  options.madoko.headingDepth = 0
  options.madoko.headingBase = 1

  function getarg() {
    var arg = argv.shift();

    if (arg.indexOf('--') === 0) {
      // e.g. --opt
      arg = arg.split('=');
      if (arg.length > 1) {
        // e.g. --opt=val
        argv.unshift(arg.slice(1).join('='));
      }
      arg = arg[0];
    } else if (arg[0] === '-') {
      if (arg.length > 2) {
        // e.g. -abc
        argv = arg.substring(1).split('').map(function(ch) {
          return '-' + ch;
        }).concat(argv);
        arg = argv.shift();
      } else {
        // e.g. -a
      }
    } else {
      // e.g. foo
    }

    return arg;
  }

  while (argv.length) {
    arg = getarg();
    switch (arg) {
      case '-f':
      case '--fix':
      case 'fix':
        options.fix = true;
        break;
      case '-b':
      case '--bench':
        options.bench = true;
        options.madoko.bench = true;
        break;
      case '-s':
      case '--stop':
        options.stop = true;
        break;
      case '-t':
      case '--time':
        options.time = true;
        break;
      case '-q':
      case '--quick':
        options.quick = true;
        break;
      default:
        if (arg.indexOf('--') === 0) {
          opt = camelize(arg.replace(/^--(no-?)?/, ''));
          
          //if (!marked.defaults.hasOwnProperty(opt)) {
          //  continue;
          //}
          
          if (arg.indexOf('--no-') === 0 || arg.indexOf('--no') === 0) {
            options.madoko[opt] = false;
          }
          else {
            options.madoko[opt] = true;            
          }
        } else {
          orphans.push(arg);
        }
        break;
    }
  }
  options.marked = options.madoko || undefined;

  return options;
}

/**
 * Helpers
 */

function camelize(text) {
  return text.replace(/(\w)-(\w)/g, function(_, a, b) {
    return a + b.toUpperCase();
  });
}

/**
 * Main
 */

function main(argv) {
  var opt = parseArg();

  if (opt.fix) {
    return fix(opt);
  }

  if (opt.bench) {
    return runBench(opt);
  }

  if (opt.time) {
    return time(opt);
  }

  return runTests(opt);
}

/**
 * Execute
 */

if (!module.parent) {
  process.title = 'madoko';
  main(process.argv.slice());
} else {
  exports = main;
  exports.main = main;
  exports.runTests = runTests;
  exports.runBench = runBench;
  exports.load = load;
  exports.bench = bench;
  module.exports = exports;
}
