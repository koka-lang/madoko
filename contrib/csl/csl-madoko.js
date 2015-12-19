/*---------------------------------------------------------------------------
  Copyright 2015 Daan Leijen, Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/


if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {

var Bibtex = require("./csl-bibtex");  // bibtex parsing and conversion to CSL format
var CSL = require("./citeproc");       // CSL processing based on style and locale
var Sax = require("./sax");            // XML parsing

/*---------------------------------------------------------------------------
  Helpers
---------------------------------------------------------------------------*/
function properties(obj) {
  var attrs = [];
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      attrs.push(key);
    }
  } 
  return attrs;
}

function reverse(xs) {
  var ys = [];
  xs.forEach(function(x) { ys.unshift(x); });
  return ys;
}

function joinx(xs,sep) {
  return xs.filter( function(x) { return (x ? true : false); }).join(sep);
}
function trim(s) {
  if (!s) return "";
  return s.replace(/^\s+/,"").replace(/\s+$/,"");
}

// ---------------------------------------------
// Format to Markdown
// ---------------------------------------------

function quote(s) {
  s = s.replace(/\r?\n/g,"&nl;");
  return "\"" + (s.indexOf("\"") < 0 ? s : s.replace(/"/g, "\\\"")) + "\"";
}

var madokoFormat = {
  "text_escape": function (text) {
    return (text ? text : "");
  },
  "bibstart": "~ begin bibliography\n",
  "bibend": "~ end bibliography",
  "@font-style/italic": "_%%STRING%%_",
  "@font-style/oblique": "[%%STRING%%]{font-style:oblique}",
  "@font-style/normal": "%%STRING%%",
  "@font-variant/small-caps": "[%%STRING%%]{font-variant:small-caps}",
  "@passthrough/true": CSL.Output.Formatters.passthrough,
  "@font-variant/normal": "[%%STRING%%]{font-variant:normal}",
  "@font-weight/bold": "**%%STRING%%**",
  "@font-weight/normal": "[%%STRING%%]{font-weight:normal}",
  "@font-weight/light": "[%%STRING%%]{font-weight:light}",
  "@text-decoration/none": "[%%STRING%%]{text-decoration:none}",
  "@text-decoration/underline": "[%%STRING%%]{text-decoration:underline}",
  "@vertical-align/sup": "__%%STRING%%__",
  "@vertical-align/sub": "^^%%STRING%%^^",
  "@vertical-align/baseline": "%%STRING%%",
  "@strip-periods/true": CSL.Output.Formatters.passthrough,
  "@strip-periods/false": CSL.Output.Formatters.passthrough,
  "@quotes/true": function (state, str) {
    if (str == null) {
      return "&ldquo;";
    }
    return "&ldquo;" + str + "&rdquo;";
  },
  "@quotes/inner": function (state, str) {
    if (str == null) {
      return "\u2019";
    }
    return "&ldquo;" + str + "&rdquo;";
  },
  "@quotes/false": false,
  "@cite/entry": function (state, str) {
    //console.log(this);
    return state.sys.wrapCitationEntry(str, this.item_id || this.id, this.locator_txt, this.suffix_txt);
  },
  "@bibliography/entry": function (state, str) {
    var insert = "";
    if (state.sys.embedBibliographyEntry) {
      insert = state.sys.embedBibliographyEntry(this.item_id) + "\n";
    }
    var bibitem = getBibitem(this,state);
    //console.log(bibitem)
    var attrs = {
      "cite-year": bibitem._citeYear,
      "cite-authors": bibitem._citeAuthors,
      "cite-authors-long": bibitem._citeAuthorsLong,
      "cite-info": bibitem._citeLabel,
      "id": bibitem.id,
      "cite-info": bibitem._citeInfo,
      "caption": bibitem._citeCaption,
      "line": bibitem._line,
      "searchterm": bibitem._citeCaption.replace(/\s+/g," "),
    }
    var attrsText = "{" + joinx(properties(attrs).map( function(key) { 
      return (!attrs[key] ? "" : key + ":" + quote(attrs[key]));
    }), "; ") + "}";
    return "~ begin bibitem " + attrsText + "\n" + trim(str) + "\n~ end bibitem\n" + insert;
  },
  "@display/block": function (state, str) {
    return "\n[]{.newblock}" + str + "\n";
  },
  "@display/left-margin": function (state, str) {
    return "[" + str + "]{.bibitem-label}\n";
  },
  "@display/right-inline": function (state, str) {
    return str + "\n";
  },
  "@display/indent": function (state, str) {
    var bibitem = getBibitem(this,state);
    if (bibitem) bibitem._caption = str;
    return "\n~ begin bibindent\n" + str + "\n~ end bibindent\n";
  },
  "@showid/true": function (state, str, cslid) {
    //console.log("Showid: " + str);
    //console.log(this.params);
    //console.log(str);
    if (!state.tmp.just_looking && ! state.tmp.suppress_decorations) {
      if (cslid) {
        return "[" + str + "]{class:'" + state.opt.nodenames[cslid] + "'; bibid:'" + cslid + "'}";
      } 
      else if ("string" === typeof str) {
        var prePunct = "";
        if (str) {
          var m = str.match(CSL.VARIABLE_WRAPPER_PREPUNCT_REX);
          prePunct = m[1];
          str = m[2];
        }
        var postPunct = "";
        if (str && CSL.SWAPPING_PUNCTUATION.indexOf(str.slice(-1)) > -1) {
          postPunct = str.slice(-1);
          str = str.slice(0,-1);
        }
        return state.sys.variableWrapper(this.params, prePunct, str, postPunct);
      } 
      else {
        return str;
      }
    } 
    else {
      return str;
    }
  },
  "@URL/true": function (state, str) {
    var urltext = getBibitem(this,state).URLtext || str;
    return "[" + urltext + "](" + str + ")";
  },
  "@DOI/true": function (state, str) {
    var urltext = getBibitem( this, state).URLtext || str;
    return "[" + urltext + "](https://dx.doi.org/" + str + ")";
  }
};

function getBibitem( self, state ) {
  var id = self.item_id;
  if (!id) {
    var st = state.output.current.value();
    if (st && st[0]) id = st[0].item_id || st[0].system_id;
  }
  if (id) {
    var obj = state.registry.registry[id];
    if (obj) {
      return obj.ref;
    }
  }
  return {};
}


// ---------------------------------------------
// parse XML
// ---------------------------------------------

function parseXml( xml ) {
  var parser = Sax.parser(false,{ trim: true, lowercase: true });
  var tags = [];
  var current = { 
    name    : "root",
    attrs   : {},
    children: [], 
  };

  parser.onerror = function (e) {
    throw e;
  };

  parser.ontext = function (t) {
    if (t) current.children.push(t);
  };

  parser.onopentag = function (node) {
    tags.push(current);
    current = { 
      name    : node.name, 
      attrs   : node.attributes,
      children: [], 
    };
  };

  parser.onclosetag = function (name) {
    var parent = tags.pop();
    parent.children.push(current);
    current = parent;
  };

  parser.write(xml).close(); 
  return (current.children.length===1 ? current.children[0] : current);
}


// ---------------------------------------------
// Make a Madoko bibliography
//
// citations   : an array of citation id's, 
//               or null for all entries in the bibliography.
// bibtex      : bibliography in bibtex format as a string
// bibStyleX   : CSL bib style as XML
// madokoStyleX: CSL madoko style as XML
// locale      : CSL locale as XML
// convertTex  : optional: string->string to convert TeX fields
// options     : optional options object for conversion from bibtex
//
// returns {
//   bibliography: a Madoko formatted bibliography as a string.
//   bib         : object with all bibliography entries as CSL (can be written as JSON)
//   warnings    : output messages,
//   errors      : if not empty, an error has occurred and this is the message.
// }
// ---------------------------------------------

function makeBibliography( citations, bibtex, bibStylex, madokoStylex, localex, convertTex, options ) {
  var bib = {};
  var bibl = "";
  var warnings = "";

  if (!convertTex) convertTex = function(s) { return s; };
  if (!options) options = {};

  var lang = "en-US";
  var cap = /\bxml:lang="([\w\-]+)"/.exec(localex);
  if (cap) lang = cap[1];

  // ----------------------
  // Set CSL engine hooks
  function cslDebug(msg) {
    warnings = warnings + "warning: " + msg + "\n";
  }

  function cslError(msg) {
    throw new Error("error: " + msg);
  }

  function retrieveLocale(lang) {
    //console.log("retrieve lang: " + lang);
    return locale;
  }

  function retrieveItem(id) {
    var bibitem = bib[id.toLowerCase()];
    //console.log("retrieve item: " + id + "= " + JSON.stringify(bibitem));
    if (!bibitem) {
      throw new Error("unknown citation: " + id);
    }
    if (bibitem.id !== id) {
      console.log("case mismatch: '" + bibitem.id + "'' is cited as '" + id + "'");
      newitem = {}
      properties(bibitem).forEach( function(key) {
        newitem[key] = bibitem[key];
      });
      newitem.id = id;  //prevent errors in citeproc
      newitem.system_id = id;
      return newitem;
    }
    else {
     return bibitem;
    }
  }

  CSL.debug = cslDebug;
  CSL.error = cslError;
  CSL.Output.Formats.madoko = madokoFormat;

  // CSL engine creation  
  function cslCreate( sys,style,lang ) {
    var csl = new CSL.Engine(sys,style,lang || "en-US");
    csl.opt.development_extensions.wrap_url_and_doi = true;
    csl.opt.development_extensions.apply_citation_wrapper = true;
    csl.setOutputFormat("madoko");
    return csl;
  }

  function createCslWith(cites,style,onCite) {
    function wrapCitationEntry(str,id) {
      var item = bib[id.toLowerCase()];
      if (!item) {
        return str; // TODO: give warning?
      }
      else {
        onCite(item,str);
        return str;
      }
    }

    var sys = {
      retrieveItem     : retrieveItem,
      retrieveLocale   : retrieveLocale,   
      wrapCitationEntry: wrapCitationEntry,
    };
    
    var csl = cslCreate(sys,style);
    //csl.updateItems(cites, false, false);    
    var citeItems = {
      citationItems: cites.map(function(cite) { return {id:cite}; }),
      properties: { },
    };
    var citation = csl.appendCitationCluster(citeItems,true); 
    //console.log("citation: " + citation);
    return csl;
  }

  // -----------
  try {
    
    // parse bibtex to a bibiliography object; bibtex can be either pre-parsed JSON or bibtex
    var bibconv = Bibtex.convertToCsl(bibtex,convertTex,options);
    var bib     = bibconv.bib;
    var warnings = bibconv.warnings;

    // fix-up with 'system_id' entries, needed for citeproc.js
    properties(bib).forEach( function(key) {
      var item = bib[key];
      if (item && item.id && !item.system_id) item.system_id = item.id;
    });
    
    // disable collapsing for the main style so we can get a true 'cite-label' for
    // each citation separately.
    var bibStyle    = parseXml(bibStylex.replace(/\bcollapse\s*=\s*("[^"]*"|'[^']*')/g,"")); 
    // The madoko style is used to get reliable 'cite-year','cite-authors', and 'cite-authors-long'
    var madokoStyle = parseXml(madokoStylex); 
    var locale      = parseXml(localex);

    // if no citations are given, use all the entries in the bibliography.
    if (!citations) {
      var citations = properties(bib).filter(function(id) { return (bib[id].id ? true : false) } ).map(function(id) {
        return bib[id].id;
      });
    }

    // first we render with the madoko style to get reliable
    // cite-year/author/author-long fields.
    var csl = createCslWith(citations, madokoStyle, function(item,str) {
      //console.log("**** wrap citations: " + item)
      var parts = str.split("|");
      if (parts.length<2) return str;
      item._citeAuthors     = parts[0];
      item._citeYear        = parts[1];
      item._citeAuthorsLong = parts[2] || parts[0];
      item._citeCaption     = (item.title || item.booktitle) + "\n" + item._citeAuthorsLong + ", " + item._citeYear;
      // item._citeInfo        = item._citeAuthors + "(" + item._citeYear + ")" + item._citeAuthorsLong;
    });
    
    // then we render with the actual style to get the actual
    // citation label 
    var csl = createCslWith(citations, bibStyle, function(item,str) {
      //console.log("wrap: " + item.id + " = " + str)
      item._citeLabel = str;
    });

    // and finally we generate the bibliography with the actual style
    // console.log("Creating bibliography..");
    var bibl = csl.makeBibliography()[1].join("\n");


    // we (and citeproc) have modified 'bib' items in place, clean up now
    properties(bib).forEach( function(key) {
      var item = bib[key];
      properties(item).forEach( function(ikey) {
        var value = item[ikey];
        if (!value || /^_cite/.test(ikey) || ikey==="system_id") delete item[ikey];
      });
    });

    return {
      bibliography: bibl,
      bib         : bib,
      warnings    : warnings,
      errors      : "",
    }
  }
  catch(exn) {
    return {
      bibliography: bibl,
      bib         : bib,
      warnings    : warnings,
      errors      : (exn ? "error: " + exn.toString() : "error while generating the bibiliography") + "\n",
    }
  }
}

return {
  makeBibliography: makeBibliography,
}

});
