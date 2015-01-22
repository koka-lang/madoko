/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

importScripts("lib/require.js");

require.config({
  baseUrl: "lib",
});


var heartbeat = 0;
setInterval( function() {
  heartbeat++;
  self.postMessage( { messageId: -1, heartbeat: heartbeat } );
}, 15000);

require(["../scripts/map","../scripts/util","typo/typo"], function(Map,Util,Typo) 
{
  var checker = null;

  function updateIgnores(ignores) {
    // restore base dictionary
    if (!checker.baseDictionaryTable) checker.baseDictionaryTable = checker.dictionaryTable;
    checker.dictionaryTable = Util.copy(checker.baseDictionaryTable);
    if (ignores) {
      // add ignores
      if (!/^\d+\r?\n/.test(ignores)) ignores = "0\n" + ignores;
      // parse ignores as dictionary
      var dictionary = checker._parseDIC(ignores);
      // and add the newly parsed dictionary
      Util.forEachProperty(dictionary, function(word,rules) {
        if (rules instanceof Array) {
          if (checker.dictionaryTable[word]==null) {
            checker.dictionaryTable[word] = [];
          }
          checker.dictionaryTable[word].push(rules);
        }
      });  
    }
  }


  function regexOr( rxs, flags ) {
    return new RegExp( rxs.map( function(rx) { return "(?:" + rx.source + ")"; } ).join("|"), flags );
  }

  var rxWord   = /([a-zA-Z\u00C0-\u1FFF\u2C00-\uD7FF]+(?:'[st])?)/;
  var rxCode   = /(`+)(?:(?:[^`]|(?!\1)`)*)\2/;
  var rxRefer  = /[#@][\w\-:]+/;
  var rxEntity = /&(#?[\w\-:]*);/;
  var rxSpecial= /\[(?:INCLUDE|BIB|TITLE|TOC|FOOTNOTES)\b[^\]]*\]/
  var rxInlineParts  = regexOr([rxWord,rxCode,rxEntity,rxRefer,rxSpecial],"gi");

  var rxMathEnv = /\n *(~+) *(?:Equation|TexRaw|Math|MathDisplay|Snippet).*[\s\S]*?\n *\1 *(?:\n|$)/;
  var rxMath   = /\$((?:[^\\\$]|\\[\s\S])+)\$/;
  var rxBlockParts  = regexOr([rxMathEnv,rxMath],"gi");

  function checkLine( line, lineNo, options ) {
    rxWord.lastIndex = 0; // reset
    var cap;
    var errors = [];
    while ((cap = rxInlineParts.exec(line)) != null) {
      var word = cap[1];
      if (word && !checker.check(word)) {
        errors.push( {
          line: lineNo,
          column: cap.index+1,
          length: word.length,
          word  : word,
        });
      }
    }
    return errors;
  }

  function whiten(s) {
    return s.replace(/(\n)|([^\n]+)/g, function(part,nl,other) {
      return (nl ? nl : Array(other.length+1).join(" "));
    });
  }

  function normalizeId(s) {
    return s.replace(/[^\w\-_:\*\s]+/g,"").replace(/\s+|[:\*]/g,"-").toLowerCase();
  }

  var metaKey = /(?:@(?:\w+) +)?((?:\w|([\.#~])(?=\S))[\w\-\.#~, ]*?\*?) *[:]/;
  var rxMeta = new RegExp("^("+ metaKey.source + " *)((?:.*(?:\n .*)*)(?:\\n+(?=\\n|" + metaKey.source + ")|$))", "g");
  var rxMetaIgnore = /(html-meta|css|script|package|doc(ument)?-class|bib(liography)?(-style)?|bib-data|biblio-style|mathjax-ext(ension)?|(tex|html)-(header|footer)|fragment-(start|end)|cite-style|math-doc(ument)?-class|mathjax|highlight-language|colorizer|refer|latex|pdflatex|math-pdflatex|bibtex|math-convert|convert|ps2pdf|dvips)/;

  function sanitizeMeta( text ) {
    var res = "";
    var cap = /^(\s|<!--[\s\S]*?-->)+/.exec(text);
    if (cap) {
      res = cap[0];
      text = text.substr(cap[0].length);
    }
    rxMeta.lastIndex = 0;
    while((cap = rxMeta.exec(text)) != null) {
      var key = normalizeId(cap[2]);
      res = res + (cap[3] || rxMetaIgnore.test(key) ? whiten(cap[0]) : whiten(cap[1]) + cap[4]);
      text = text.substr(rxMeta.lastIndex);
      rxMeta.lastIndex = 0;
    }
    return res + text;
  }

  var rxIndentedCode = /(\n( *)\S.*\n)((?:\2 {0,3})?\n)((?:\2    .*\n)+)((\2 {0,3})?(?=\n))/g
  
  function sanitizeIndentedCode( text ) {
    return text.replace(rxIndentedCode,function(matched,start,ofs,pre,code,post) {
      return start + "```\n" + whiten(code) + "```";
    });
  }

  function checkText( text, options ) {
    var text1 = text.replace(/\t/g,"    ").replace(/\r/g,"")
    var text2 = sanitizeMeta(text1);
    var text3 = text2.replace(rxBlockParts,function(matched) {
      return whiten(matched);
    });
    var text4 = sanitizeIndentedCode(text3);

    var lines = text4.split("\n");
    var errorss = lines.map( function(line,idx) {
      return checkLine( line, idx+1, options );
    });
    return [].concat.apply([],errorss);
  }

  self.addEventListener( "message", function(ev) {
    try {    
      var req = ev.data;
      var t0 = Date.now();            
      if (req.type === "dictionary") {
        checker = new Typo( req.lang, req.affData, req.dicData, req.options );   
        if (req.ignores) updateIgnores(req.ignores); 
        self.postMessage( {
          messageId: req.messageId,
          err: null,
        });
      }
      if (req.type === "ignores") {
        updateIgnores(req.ignores);
        self.postMessage( {
          messageId: req.messageId,
          err: null,
        });
      }
      if (req.type === "suggest" && checker != null) {
        var suggestions = checker.suggest(req.text, req.limit || 8);
        var time   = (Date.now() - t0).toString();
        console.log("spell check: " + time + "ms\n  suggest: " + req.word + ": "+ JSON.stringify(suggestions));
        self.postMessage( {
          messageId  : req.messageId, // message id is required to call the right continuation
          message    : "",
          err        : null,
          time       : time,
          suggestions: suggestions,
        });
      }
      else if (req.type==="check" && checker != null) {
        var errors = checkText( req.text, req.options );
        var time   = (Date.now() - t0).toString();
        console.log("spell check: " + time + "ms\n" + errors.map(function(err) { return JSON.stringify(err); }).join("\n") );
        self.postMessage( {
          messageId  : req.messageId, // message id is required to call the right continuation
          message    : "",
          err        : null,
          time       : time,
          errors     : errors,
        });      
      }
      else if (req.type==="clear") {
        checker = null;
        self.postMessage({
          messageId: req.messageId,
          err: null,
        });
      }
      else {
        throw new Error("Spell checker: unknown request, or invalid dictionary.");
      }
    }
    catch(exn) {
      self.postMessage( {
        messageId: req.messageId,
        message  : exn.toString(),
        err      : exn.toString(),
      });
    }
  });

  self.postMessage( { messageId: 0 }); // signal we are ready
});
