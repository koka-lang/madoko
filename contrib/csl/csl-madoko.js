/*---------------------------------------------------------------------------
  Copyright 2015 Daan Leijen, Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/


if (typeof define !== 'function') { var define = require('amdefine')(module) }
define(["./csl-bibtex","./citeproc","./sax"],function(Bibtex,CSL,Sax) {

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
  s = s || "";
  s = s.replace(/\r?\n/g,"&nl;");
  return "\"" + (s.indexOf("\"") < 0 ? s : s.replace(/"/g, "\\\"")) + "\"";
}

function fixNbsp(s) 
{
  s = s || "";
  return s.replace(/([A-Z]\.) +/g, "$1&nbsp;");
}

function escapeMadoko(s) {
  s = s || "";
  return s.replace(/([\[\]()#$@!`~\\^%_*&])/g,"\\$1");
}

function escapeURL(s) {
  s = s || "";
  return s.replace(/([()\s])/g, function(m) { return escape(m); } );
}

var madokoFormat = {
  "text_escape": function (text) {
    return (text ? text : "").replace("  ","&nbsp;");
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
      "id": (bibitem._preid || "") + bibitem.id,
      "cite-year": bibitem._citeYear,
      "cite-authors": fixNbsp(bibitem._citeAuthors),
      "cite-authors-long": fixNbsp(bibitem._citeAuthorsLong),
      "cite-label": bibitem._citeLabel,
      // "cite-info": fixNbsp(bibitem._citeInfo),
      "caption": bibitem._citeCaption,
      "data-line": bibitem._line,
      "searchterm": encodeURIComponent(bibitem._citeCaption.replace(/\s+/g," ")).replace(/[\/\\:\-()\[\]]/g,""),
    }
    if (bibitem._bibitemLabel) attrs["bibitem-label"] = bibitem._bibitemLabel;
    var attrsText = "{" + joinx(properties(attrs).map( function(key) { 
      return (!attrs[key] ? "" : key + ":" + quote(attrs[key]));
    }), "; ") + "}";
    return "~ begin bibitem " + attrsText + "\n" + fixNbsp(trim(str)) + "\n~ end bibitem\n" + insert;
  },
  "@display/block": function (state, str) {
    return "\n[]{.newblock}" + str + "\n";
  },
  "@display/left-margin": function (state, str) {
    var bibitem = getBibitem(this,state);
    bibitem._bibitemLabel = escapeMadoko(str);
    return "\\/";
    // return "[" + escapeMadoko(str) + "]{.bibitem-label}\n";
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
    var bibitem = getBibitem(this,state);
    var urltext = bibitem.URLtext || str;
    var urlpre  = bibitem.URLpretext || "";
    return (urlpre ? "[" + urlpre + "]{.urlpre}" : "") + "[" + urltext + "](" + escapeURL(str) + ")";
  },
  "@DOI/true": function (state, str) {
    var doitext = getBibitem( this, state).DOItext || str;
    return "[" + doitext + "](https://dx.doi.org/" + escapeURL(str) + ")";
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

function parseXml( fname, xml ) {
  var parser = Sax.parser(false,{ trim: true, lowercase: true });
  var tags = [];
  var current = { 
    name    : "root",
    attrs   : {},
    children: [], 
  };

  parser.onerror = function (e) {
    throw ("error: " + (fname ? fname + ": " : "") + e.toString());
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
// citations   : an array of { id: string; lineinfo: string }
//               or null for all entries in the bibliography.
// bibtexs     : array of bibliography fileinfo's
// bibStyleX   : CSL bib style as XML fileinfo
// madokoStyleX: CSL madoko style as XML fileinfo
// locale      : CSL locale as XML fileinfo
// convertTex  : optional: string->string to convert TeX fields
// options     : optional options object for conversion from bibtex, and
//  attrs: extra attributes the outer bibliography
//
// returns {
//   bibliography: a Madoko formatted bibliography as a string.
//   bib         : object with all bibliography entries as CSL (can be written as JSON)
//   warnings    : output messages,
//   errors      : if not empty, an error has occurred and this is the message.
// }
// ---------------------------------------------

function makeBibliography( citeinfos, bibtexs, bibStylex, madokoStylex, localex, convertTex, options ) {
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
  function cslWarning(fname,msg) {
    warnings = warnings + "warning: " + (fname ? "source line: " + fname + "\n  " : "") + msg + "\n";
  }

  function cslError(fname,msg) {
    throw new Error("error: " + (fname ? "source line: " + fname + "\n  " : "") + msg);
  }

  function retrieveLocale(localelang) {
    //console.log("retrieve lang: " + lang);
    return locale;
  }

  function retrieveItem(id) {
    var bibitem = bib[id.toLowerCase()];
    //console.log("retrieve item: " + id + "= " + JSON.stringify(bibitem));
    if (!bibitem) {
      throw new Error("unknown citation: " + id);
    }
    return bibitem;
  }

  CSL.Output.Formats.madoko = madokoFormat;

  // CSL engine creation  
  function cslCreate( sys,style,langid ) {
    var csl = new CSL.Engine(sys,style,langid || "en-US");
    csl.opt.development_extensions.wrap_url_and_doi = true;
    csl.opt.development_extensions.apply_citation_wrapper = true;
    csl.setOutputFormat("madoko");
    return csl;
  }

  function createCslWith(cites,style,fname,langid,onCite,onWarn) {
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
    CSL.debug = function(msg) { return (onWarn ? onWarn(msg) : cslWarning(fname,msg)); };
    CSL.error = function(msg) { return cslError(fname,msg); };

    var csl = cslCreate(sys,style,langid);
    
    //csl.updateItems(cites, false, false);    
    var citeItems = {
      citationItems: cites.map( function(itemid) { return { id: itemid }; }), 
      properties: { },
    };
    var citation = csl.appendCitationCluster(citeItems,true); 
    //console.log("citation: " + citation);
    return csl;
  }

  // -----------
  try {
    
    // parse bibtex to a bibiliography object; bibtex can be either pre-parsed JSON or bibtex
    var bibconv = Bibtex.convertToCsl(bibtexs,convertTex,options);
    var bib     = bibconv.bib;
    var jsonBib = JSON.stringify(bib,null,2) // do early since citeproc mutates bib for dates
    var warnings = bibconv.warnings;

    // fix-up with 'system_id' entries, needed for citeproc.js
    properties(bib).forEach( function(key) {
      var item = bib[key];
      if (item && item.id && !item.system_id) item.system_id = item.id;
    });
    
    // disable collapsing for the main style so we can get a true 'cite-label' for
    // each citation separately.
    var bibStyle    = parseXml(bibStylex.filename, bibStylex.contents.replace(/\bcollapse\s*=\s*("[^"]*"|'[^']*')/g,"")); 
    // The madoko style is used to get reliable 'cite-year','cite-authors', and 'cite-authors-long'
    var madokoStyle = parseXml(madokoStylex.filename, madokoStylex.contents); 
    var locale      = parseXml(localex.filename, localex.contents);

    function getAllReferences() {
      return properties(bib).filter(function(id) { return (bib[id].id ? true : false) } ).map(function(id) {
        return bib[id].id;
      });
    }

    // if citeinfos is null, use all the entries in the bibliography.
    var citations = [];
    if (!citeinfos) {
      citations = getAllReferences();
    }
    else {
      // check citations and normalize case
      var newcites = {};
      citeinfos.forEach( function(cite) {
        if (cite.id==="*") {
          // star is used for all references in the biliography
          getAllReferences().forEach( function(id) { newcites[id] = true; } );
        }      
        else {
          var bibitem = bib[cite.id.toLowerCase()];
          if (!bibitem) {
            cslWarning( cite.lineinfo || bibStylex.filename, "unknown citation reference: '" + cite.id + "'");
          }
          else {
            if (bibitem.id !== cite.id) {
              cslWarning( cite.lineinfo || bibStylex.filename, "case mismatch: '" + bibitem.id + "'' is cited as '" + cite.id + "'");
            }
            if (!newcites[bibitem.id]) {
              newcites[bibitem.id] = true;
            }
          }
        }        
      });
      citations = properties(newcites);
    }

    // first we render with the madoko style to get reliable
    // cite-year/author/author-long fields.
    var csl = createCslWith(citations, madokoStyle, madokoStylex.filename, lang, function(item,str) {
      //console.log("**** wrap citations: " + item)
      var parts = str.split("|");
      item._citeAuthors     = parts[0] || "";
      item._citeYear        = parts[1] || "";
      item._citeAuthorsLong = parts[2] || parts[0];
      item._citeCaption     = (item.title || item.booktitle) + "\n" + item._citeAuthorsLong + ", " + item._citeYear;
      item._citeInfo        = item._citeAuthors + "(" + item._citeYear + ")" + item._citeAuthorsLong;
    }, function(warnmsg) { /* ignore */ }  );
    
    // then we render with the actual style to get the actual
    // citation label 
    var csl = createCslWith(citations, bibStyle, bibStylex.filename, lang, function(item,str) {
      //console.log("wrap: " + item.id + " = " + str)
      item._citeLabel = escapeMadoko(str);
    });

    // get (approximate) cite class & style
    var citecap = /\bcitation-format *= *"([\w\-]+)"/.exec(bibStylex.contents);
    var citeformat = (citecap ? citecap[1] : "numeric" );
    var citemode;
    if (citeformat=="author" || citeformat=="author-year" || citeformat=="author-date") citemode="natural";
    else if (citeformat=="note" || citeformat=="label" || citeformat=="numeric") citemode="numeric";
    else citemode="numeric";

    var citestyle = citemode;
    citecap = /<layout *(?:vertical-align="([^"\n]*)" *)?(?:prefix="([^"\n]*)" *)?(?:suffix="([^"\n]*)" *)?delimiter="([^"\n]*)"/.exec(bibStylex.contents);
    if (citecap) {
      if (citecap[1]==="sup") citemode = "super";
      citestyle = citemode + ":'" + [citecap[2],citecap[3],citecap[4]].join("','") + "'";
    }
    
    // and finally we generate the bibliography with the actual style
    // console.log("Creating bibliography..");
    var bibres = csl.makeBibliography();
    var bibl = 
      "~ begin bibliography { .bib-" + citemode + "; cite-style:\"" + citestyle + "\" ; " +
                                "caption:\"" + citations.length.toString() + "\" ; " +
                                "data-style:\"" + citeformat + "\" ; " +
                                (bibres[0].hangingindent ? "data-hanging-indent:\"" + bibres[0].hangingindent  + "\"; " : "") +
                                options.attrs + " }\n" +
      bibres[1].join("\n") + 
      "\n~ end bibliography\n";

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
      bib         : jsonBib,
      warnings    : warnings,
      errors      : "",
      citeformat  : citeformat,
    }
  }
  catch(exn) {
    return {
      bibliography: bibl,
      bib         : JSON.stringify(bib,null,2),
      warnings    : warnings,
      errors      : (exn ? "error: " + exn.toString() : "error while generating the bibiliography") + "\n",
      citeformat  : citeformat,
    }
  }
}

return {
  makeBibliography: makeBibliography,
}

});
