/*---------------------------------------------------------------------------
  This is based on the zotero-bibtex-parse library under the MIT license.
  
  Daan Leijen, December 2015:
    - removed latex processing from the original library.
    - improve robustness against errors
    - add line number information
    - transform field names to lowercase

  ----------------------------------------------------------------------------
  Original work by Henrik Muehe (c) 2010

  CommonJS port by Mikola Lysenko 2013
 
  Port to Browser lib by ORCID / RCPETERS

   Additions and slight changes by apcshields, Jul 2014.
  (Some of which bring this back closer to Lysenko's version.)

  ----------------------------------------------------------------------------
  The MIT License (MIT)
  Copyright (c) 2013 ORCID, Inc.

  Copyright (c) 2010 Henrik Muehe

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.
---------------------------------------------------------------------------*/

if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {


// Grammar implemented here:
// bibtex -> (string | preamble | comment | entry)*;
// string -> '@STRING' '{' key_equals_value '}';
// preamble -> '@PREAMBLE' '{' value '}';
// comment -> '@COMMENT' '{' value '}';
// entry -> '@' key '{' key ',' key_value_list '}';
// key_value_list -> key_equals_value (',' key_equals_value)*;
// key_equals_value -> key '=' value;
// value -> value_quotes | value_braces | key;
// value_quotes -> '"' .*? '"'; // not quite
// value_braces -> '{' .*? '"'; // not quite

function BibtexParser() {
  this.pos = 0;
  this.input = "";
  this.entries = [];
  this.warnings = [];

  this.setInput = function(inp) {
    this.input = inp;
  }

  this.strings = {  // Added from Mikola Lysenko's bibtex-parser. -APCS
      jan: "January",
      feb: "February",
      mar: "March",
      apr: "April",
      may: "May",
      jun: "June",
      jul: "July",
      aug: "August",
      sep: "September",
      oct: "October",
      nov: "November",
      dec: "December"
  };

  this.currentEntry = "";
  
  this.isWhitespace = function(s) {
    return (s == ' ' || s == '\r' || s == '\t' || s == '\n');
  };

  this.warning = function( msg, pos, recover ) {
    if (!pos) pos = this.pos;
    var post = this.input.substr(pos,20);
    var cap = /(.*)\r?\n/.exec(post);
    if (cap) post = cap[1];
    msg = msg + ": " + post;
    this.entries.push( {
      bibtype: "warning",
      line: this.currentLine(),
      value: msg,
    });
    if (recover) throw new Error("recover");
  }

  this.match = function(s, canCommentOut) {
    if (canCommentOut == undefined || canCommentOut == null)
      canCommentOut = true;
    this.skipWhitespace(canCommentOut);

    if (this.input.substring(this.pos, this.pos + s.length) == s) {
      this.pos += s.length;
    } else {
      this.warning( "Token mismatch, expected '" + s + "', found '" + this.input.substr(this.pos, s.length) + "'", this.pos, true );
    };
    this.skipWhitespace(canCommentOut);
  };

  this.tryMatch = function(s, canCommentOut) {
    if (canCommentOut == undefined || canCommentOut == null)
      canComment = true;
    this.skipWhitespace(canCommentOut);
    if (this.input.substring(this.pos, this.pos + s.length) == s) {
      return true;
    } else {
      return false;
    };
    this.skipWhitespace(canCommentOut);
  };

  /* when search for a match all text can be ignored, not just white space */
  this.matchAt = function() {
    while (this.input.length > this.pos && this.input[this.pos] != '@') {
      this.pos++;
    };

    if (this.input[this.pos] == '@') {
      return true;
    };
    return false;
  };

  this.skipWhitespace = function(canCommentOut) {
    while (this.isWhitespace(this.input[this.pos])) {
      this.pos++;
    };
    if (this.input[this.pos] == "%" && canCommentOut == true) {
      while (this.input[this.pos] != "\n") {
        this.pos++;
      };
      this.skipWhitespace(canCommentOut);
    };
  };

  this.value_braces = function() {
    var bracecount = 0;
    this.match("{", false);
    var start = this.pos;
    var escaped = false;
    while (true) {
        if (!escaped) {
          if (this.input[this.pos] == '}') {
            if (bracecount > 0) {
              bracecount--;
            } else {
              var end = this.pos;
              this.match("}", false);
              return this.input.substring(start, end);
            };
          } else if (this.input[this.pos] == '{') {
            bracecount++;
          } else if (this.pos >= this.input.length - 1) {
            this.warning( "Unterminated value", start, true );
          };
      };
        if (this.input[this.pos] == '\\' && escaped == false)
           escaped == true;
        else
           escaped == false;
      this.pos++;
    };
  };

  this.value_comment = function() {
    var str = '';
    var brcktCnt = 0;
    var start = this.pos;
    while (!(this.tryMatch("}", false) && brcktCnt == 0)) {
      str = str + this.input[this.pos];
      if (this.input[this.pos] == '{')
        brcktCnt++;
      if (this.input[this.pos] == '}')
        brcktCnt--;
      if (this.pos >= this.input.length - 1) {
        this.warning( "Unterminated value", start, true );
      };
      this.pos++;
    };
    return str;
  };

  this.value_quotes = function() {
    this.match('"', false);
    var start = this.pos;
    var escaped = false;
    while (true) {
      if (!escaped) {
        if (this.input[this.pos] == '"') {
          var end = this.pos;
          this.match('"', false);
          return this.input.substring(start, end);
        } else if (this.pos >= this.input.length - 1) {
          this.warning( "Unterminated value", start, true );
        };
      }
      if (this.input[this.pos] == '\\' && !escaped)
         escaped = true;
      else
         escaped = false;
      this.pos++;
    };
  };

  this.single_value = function() {
    var start = this.pos;
    if (this.tryMatch("{")) {
      return this.value_braces();
    } else if (this.tryMatch('"')) {
      return this.value_quotes();
    } else {
      var k = this.key();
      var repl = this.strings[k.toLowerCase()];
      if (repl) { 
        return repl;
      } else if (k.match("^[0-9]+$")) {
        return k;
      } else {
        this.warning("Value expected (or undefined string)", start, false );
        return k; 
      };
    };
  };

  this.value = function() {
    var values = [];
    values.push(this.single_value());
    while (this.tryMatch("#")) {
      this.match("#");
      values.push(this.single_value());
    };
    return values.join("");
  };

  this.lkey = function() {
    return this.key().toLowerCase();
  }

  this.key = function() {
    var start = this.pos;
    while (true) {
      if (this.pos >= this.input.length) {
        this.warning( "Runaway key", start, true );
      }
      ;

      if (this.input[this.pos].match(/[a-zA-Z0-9+_:\?\.\/\[\]\-]/)) { // Added question marks to handle Zotero going sideways. -APCS
        this.pos++;
      } else {
        return this.input.substring(start, this.pos);
      };
    };
  };


  this.key_equals_value = function() {
    var key = this.lkey();
    if (this.tryMatch("=")) {
      this.match("=");
      var val = this.value();
      return [ key, val ];
    } else {
      this.warning("value expected, equals sign missing", this.pos, true );
    };
  };

  this.key_value_list = function() {
    var kv = this.key_equals_value();
    this.currentEntry[kv[0]] = kv[1];
    while (this.tryMatch(",")) {
      this.match(",");
      // fixes problems with commas at the end of a list
      if (this.tryMatch("}")) {
        break;
      }
      ;
      kv = this.key_equals_value();
      this.currentEntry[kv[0]] = kv[1];
    };
  };

  this.entry_body = function(d) {
    this.currentEntry = {};
    this.currentEntry['bibkey'] = this.key();
    this.currentEntry['bibtype'] = d.substring(1);
    this.currentEntry['line'] = this.currentLine();    
    this.match(",");
    this.key_value_list();
    this.entries.push(this.currentEntry);
  };

  this.directive = function() {
    this.match("@");
    return "@" + this.lkey();
  };

  this.string = function () {
    var kv = this.key_equals_value();
    this.strings[kv[0]] = kv[1];
  }

  this.preamble = function() {
    this.currentEntry = {};
    this.currentEntry['bibtype'] = 'preamble';
    this.currentEntry['value'] = this.value_comment();
    this.currentEntry['line'] = this.currentLine();
    this.entries.push(this.currentEntry);
  };

  this.comment = function() {
    this.currentEntry = {};
    this.currentEntry['bibtype'] = 'comment';
    this.currentEntry['value'] = this.value_comment();
    this.currentEntry['line'] = this.currentLine();
    this.entries.push(this.currentEntry);
  };

  this.entry = function(d) {
    this.entry_body(d);
  };

  this.updateLineInfo = function() {
    if (this._lastLine==null) this._lastLine = 1;
    if (this._lastPos==null) this._lastPos = 0;
    for(var i = this._lastPos; i < this.pos; i++) {
      if (this.input[i] === "\n") this._lastLine++;
    }
    this._lastPos = this.pos;  
  }

  this.currentLine = function() {
    this.updateLineInfo();
    return this._lastLine;
  }

  this.parse = function(inp) {
    this.input = inp;
    this.entries = [];
    this.warnings = [];
    this.pos = 0;
    while (this.matchAt()) {
      try {
        var d = this.directive();
        var close = '}';
        // allow '(' instead of '{' too
        if (this.tryMatch('(')) {
          this.match('(');
          close = ')';
        }
        else this.match("{");
        if (d == "@string") {
          this.string();
        } else if (d == "@preamble") {
          this.preamble();
        } else if (d == "@comment") {
          this.comment();
        } else {
          this.entry(d);
        }
        this.match(close);
      }
      catch(exn) {
        if (exn.message === "recover") {
          /* continue */
        }
        else {
          throw exn; // rethrow
        }
      }
    };
    return this.entries;
  };
};

var bp = new BibtexParser();

function parseBibTex( input ) {
  try {
    return bp.parse(input);
  }
  catch(exn) {
    var prefix = bp.input.substr(0,bp.pos);
    var n = 1;
    var nl = /\n/g;
    while( nl.exec(prefix) ) { n++; };
    exn.message = n.toString() + ": " + exn.message;
    // console.log("line " + n.toString());
    throw exn;
  }
}

return {
  parse: parseBibTex,   
};

});
