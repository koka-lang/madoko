/*---------------------------------------------------------------------------
  Copyright 2015 Daan Leijen, Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

if (typeof define !== 'function') { var define = require('amdefine')(module) }
define(["./locales","./bibtex-parse"],function(Locales,BibtexParse) {

var parseBibtex = BibtexParse.parse;

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

// extend target with all fields of obj.
function extend(target, obj) {
  properties(obj).forEach( function(prop) {
    target[prop] = obj[prop];
  });
}

// extend target with all fields of obj that are not in targe.
function extendWithNew(target, obj) {
  properties(obj).forEach( function(prop) {
    if (target[prop]===undefined) target[prop] = obj[prop];
  });
}

function joinx(xs,sep) {
  return xs.filter( function(x) { return (x ? true : false); }).join(sep);
}

function trim(s) {
  if (!s) return "";
  return s.replace(/^\s+/,"").replace(/\s+$/,"");
}

function firstOf(obj,props) {
  if (!props) return "";
  for(var i = 0; i < props.length; i++) {
    var x= obj[props[i]];
    if (x) return x;
  }
  return "";
}

/*---------------------------------------------------------------------------
  Tex options record
---------------------------------------------------------------------------*/

function optionsParse( s ) {
  if (!s) return {};
  var options = {};
  var rx = /\b(\w+) *= *(?:\{([^\}]*)\}|([^,\}]*))/g;
  var cap;
  while ((cap = rx.exec(s))) {
    options[cap[1]] = cap[2] || cap[3] || "";
  }
  return options;
}


/*---------------------------------------------------------------------------

---------------------------------------------------------------------------*/


// recogize tex groups and commands
function texnest(s) {
  return "(?:" + texval + "|(?:\\{" + s + "\\}))";
}
var texcmd   = "\\\\(?:[@a-zA-Z]+\\b|.)\\s*";
var texval   = "(?:[^\\\\{}]|" + texcmd + ")";
var texvals0 = texval + "*";
var texvals1 = texnest(texvals0) + "*"
var texvals  = texnest(texvals1) + "*"

// ---------------------------------------------
// Convert authors 
// ---------------------------------------------
function convertAuthorList(item, bibitem, ctex, options, ikey, bikey ) {
  var texarg  = new RegExp("^(?:" + texcmd + "|\\{" + texvals + "\\})" );
  var texword = new RegExp("(?:[^\\s\\{]|\\{" + texvals + "\\})+", "g");
    
  function firstIsLower(w) {
    if (!w) return false;
    var cap = texarg.exec(w);
    if (cap) return firstIsLower(w.substr(cap.index + cap[0].length));
        else return (w.substr(0,1).toLowerCase() === w.substr(0,1));
  }

  function words(s) {
    var ws = [];
    var cap;
    texword.lastIndex = 0;
    while( (cap = texword.exec(s)) != null) {
      ws.push(cap[0]);
    }
    return ws;
  }

  var authors = bibitem[bikey];
  if (!authors) return;

  item[ikey] = trim(authors).split(/\s*\band\b\s*/gi).map( function(author) {
    if (author==="others") return { literal: "others" };
    
    var parts = author.split(/\s*,\s*/g);
    var first = [];
    var von   = [];
    var last  = [];
    var jr    = [];
    if (parts.length>1) { // vonlast,first - vonlast,jr,first 
      // split the vonlast part
      var ws = words(parts[0]); 
      for(var i = 0; i < ws.length; i++) {
        if (i < ws.length-1 && firstIsLower(ws[i])) {
          von.push(ws[i]);
        }
        else {
          last = ws.slice(i);
          break;
        }
      }
      // assign jr & first
      if (parts.length>2) {
        jr = [parts[1]];
        first = [parts.slice(2).join(", ")];
      }
      else {
        first = [parts[1]];
      }
    }
    else { // one name
      var ws    = words(author);      
      for(var i = 0; i < ws.length; i++) {
        if (firstIsLower(ws[i])) {
          von.push(ws[i]);
        }
        else if (von.length===0 && i !== ws.length-1) {
          first.push(ws[i]);
        }
        else {
          last.push(ws[i]);
        }
      }
    }
    // construct result
    var res = {
      family: ctex(last.join(" ")),
    }
    if (first.length>0) res.given = ctex(first.join(" "));
    if (jr.length>0)    res.suffix = ctex(jr.join(" "));
    if (von.length>0)   res[(options.useprefix ? "non-" : "") + "dropping-particle"] = ctex(von.join(" "));
    if (options.juniorcomma) res["comma-suffix"] = true;
    //console.log( bikey + ": " + author + " -> " + JSON.stringify(res));
    return res;
  });
}

function convertAuthors(item,bibitem,ctex,options) {
  convertAuthorList(item,bibitem, ctex,options, "author", "author");
  convertAuthorList(item,bibitem, ctex,options, "container-author", "bookauthor");
  convertAuthorList(item,bibitem, ctex,options, "translator", "translator");
  convertAuthorList(item,bibitem, ctex,options, "director", "director");
  convertAuthorList(item,bibitem, ctex,options, "editor", "eds");
  if (bibitem.editortype==="director") 
    convertAuthorList(item,bibitem, ctex,options, "director", "editor");
  else
    convertAuthorList(item,bibitem, ctex,options, "editor", "editor");
}

// ---------------------------------------------
// Convert entry type 
// ---------------------------------------------

var typeMap = {
  article       : "article${entrysubtype|journal}",
  book          : "book",
  booklet       : "pamphlet",
  bookinbook    : "chapter",
  collection    : "book",
  electronic    : "webpage",
  inbook        : "chapter",
  incollection  : "chapter",
  inreference   : "entry-encyclopedia",
  inproceedings : "paper-conference",
  manual        : "book",
  mastersthesis : "thesis",
  misc          : "no-type",
  mvbook        : "book",
  mvcollection  : "book",
  mvproceedings : "book",
  mvreference   : "book",
  online        : "webpage",
  patent        : "patent",
  periodical    : "article${entrysubtype|journal}",
  phdthesis     : "thesis",
  proceedings   : "book",
  reference     : "book",
  report        : "report",
  suppbook      : "chapter",
  suppcollection: "chapter",
  suppperiodical: "article${entrysubtype|journal}",
  techreport    : "report",
  thesis        : "thesis",
  www           : "webpage",
  // biblatex
  artwork       : "graphic",
  audio         : "song",
  commentary    : "book",
  data          : "dataset",
  image         : "graphic",
  jurisdiction  : "legal-case",
  legislation   : "legislation",
  legal         : "treaty",
  letter        : "personal-communication",
  letters       : "personal-communication",
  movie         : "motion-picture",
  music         : "song",
  newsarticle   : "article-newspaper",
  performance   : "speech",
  review        : "review",
  software      : "book",
  standard      : "legislation",
  video         : "motion-picture",
}

function convertType(item, bibitem) {
  var tp = typeMap[bibitem.bibtype];
  if (tp==null) {
    if (bibitem.bibtype==="unpublished") {
      if (bibitem.eventdate || bibitem.eventtitle || bibitem.venue) 
        item.type = "speech";
      else 
        item.type = "manuscript";
    }
    else {
      item.type = bibitem.bibtype;
    }
  }
  else {
    item.type = tp.replace(/\$\{(\w+)(?:\|(\w+))?\}/g, function(matched,key,def) {
      var s = bibitem[key];
      return (s ? "-" + s : (def ? "-" + def : ""));
    });
  }
  if (bibitem.bibtype==="mastersthesis") item.genre = "mathesis";
  if (bibitem.bibtype==="phdthesis") item.genre = "phdthesis";
}

// ---------------------------------------------
// Convert titles
// ---------------------------------------------
function convertTitles(item,bibitem,ctex) {
  var main     = (bibitem.maintitle ? true : false);
  var chapters = (item.type === "chapter" || item.type==="entry-encyclopedia" || item.type==="paper-conference");

  function convertTitleX(bikeys, birepl ) {
    if (birepl) {
      bikeys = bikeys.map( function(bikey) {
        var newkey = bikey.replace("title",birepl);
        return (newkey===bikey ? "" : newkey);
      });
    }
    var result = "";
    bikeys.some( function(bikey) {
      if (!bikey) return false;
      var t = bibitem[bikey];
      if (!t) return false;
      result = ctex(t);
      return true;
    });
    return result;
  }
  function convertTitle(ikey, bikeys) {
    var t = convertTitleX(bikeys);
    var st = convertTitleX(bikeys,"subtitle");
    var at = convertTitleX(bikeys,"titleaddon");
    var full = t + (st ? ":" + st : "") + (at ? "." + at : "");
    item[ikey] = full;
  }

  convertTitle("title",[(bibitem.bibtype==="periodical" ? "issuetitle" : ""), (main && !chapters ? "maintitle" : ""), "title"]);
  convertTitle("volume-title",[main ? (chapters ?  "booktitle" : "title") : ""]);
  convertTitle("container-title", (bibitem.bibtype==="periodical" ? ["title"] : (chapters ? ["maintitle","booktitle"] :[]).concat(["journaltitle","journal"])) );
  item["container-title-short"] = ctex(bibitem.shorttitle || bibitem.shortjournal);
  item["collection-title"]= ctex(bibitem.series);
  item["title-short"]     = ctex(bibitem.shorttitle);
  item["event-title"]     = ctex(bibitem.eventtitle);
  item["original-title"]  = ctex(bibitem.origtitle);

  if (bibitem.chapter) item["chapter-number"] = bibitem.chapter;
}

// ---------------------------------------------
// Convert dates
// ---------------------------------------------

function convertDate(item,bibitem,ikey,bikey) {
  var prefix = bikey.replace("date","");    
  var dates = [];
  var rng = bibitem[bikey];
  if (!rng) {
    // old-style date
    dates[0] = [bibitem[prefix+"year"],bibitem[prefix+"month"],bibitem[prefix+"day"]];
    dates[1] = [bibitem[prefix+"endyear"],bibitem[prefix+"endmonth"],bibitem[prefix+"endday"]];    
  }
  else {
    // parse modern date
    dates = rng.split(/\s*\/\s*/g).map( function(date) { return date.split(/\s*\-\s*/g); } );
  }
  
  dates = dates.map( function(date) {
    return (date ? date.filter( function(x) { return (x ? true : false); } ).map( function(n) {
      return n.replace(/^\-\-+/,"-").replace(/^0+(?=\d)/,"");
    }) : null);
  }).filter( function(xs) { return (xs && xs.length>0 ? true : false); } );

  if (dates && dates.length>0) item[ikey] = { "date-parts": dates };
  if (bibitem[prefix+"season"]) item[ikey].season = bibitem[prefix+"season"];
  if (bibitem[prefix+"circa"]) item[ikey].season = bibitem[prefix+"circa"];  
}

function convertDates(item,bibitem) {
  convertDate(item,bibitem,"issued","date");
  convertDate(item,bibitem,"event-date","eventdate");
  convertDate(item,bibitem,"original-date","origdate");
  convertDate(item,bibitem,"accessed","urldate");
}


var standardItems = {
  "original-publisher": ["origpublisher"],
  "original-publisher-place" : ["origlocation"],
  "publisher"         : ["school","institution","organization","howpublished","publisher"],
  "event-place"       : ["venue"],
  "number-of-volumes" : ["volumes"],
  "number-of-pages"   : ["pagetotal"],
  "edition"           : null,
  "version"           : null,
  "isbn"              : null,
  "issn"              : null,
  "call-number"       : ["library"],
  "annote"            : ["annotation","annote"],
  "abstract"          : null,
  "keywords"          : null,
  "status"            : ["pubstate"],
}

function convertStandard(item,bibitem,ctex) {
  properties(standardItems).forEach( function(ikey) {
    var bikeys = standardItems[ikey];
    if (bikeys==null) bikeys = [ikey];
    var val = firstOf(bibitem,bikeys);
    if (val) item[ikey] = ctex(val);
  });
}

function convertMisc(item,bibitem,ctex,options) {
  item["publisher-place"] = ctex(firstOf(bibitem,["address",(bibitem.bibtype === "patent" ? "" : "location")]));
  if (bibitem.bibtype==="patent") {
    item["jurisdiction"]= ctex(bibitem["location"]); 
  }
  
  // pages
  var pages = bibitem.pages;
  if (pages) {
    item.page = pages.replace(/\-\-\-?/g,"-");
    item["page-first"] = pages.replace(/^(\d+).*$/,"$1");
  }
  
  // volume
  item.volume = joinx([bibitem.volume,bibitem.part], ".");
  item.note   = joinx([bibitem.type!=="periodical" ? bibitem.note : "", bibitem.addendum],".");
  
  // number
  var number = bibitem.number;
  if (number) {
    if (item.type==="book" || item.type==="chapter" || 
          item.type==="paper-conference" || item.type==="entry-encyclopedia") {
      // collection-number
      item["collection-number"] = number;
    }
    else if (/^article/.test(item.type) || item.type==="review") {
      // issue
      var issue = bibitem.issue;
      item.issue = (issue ? number + "," + issue : number);
    }
    else {
      // number
      item.number = number;
    }
  }

  // language
  var lang = bibitem.langid || bibitem.hyphenation;
  if (lang) {
    if (lang.toLowerCase() === "english") {
      var langopts = optionsParse( bibitem.langidopts );
      if (langopts.variant) {
        if (langopts.variant==="uk") lang = "british";
        else if (langopts.variant==="us" || langopts.variant==="american") lang = "american";
        else lang = langopts.variant;
      }
    }
    var langinfo = Locales.getLocaleInfo(lang);  
    if (langinfo) item.language = langinfo.langid;
  }
}

function convertElectronic(item,bibitem,ctex,options) {
  // eprinttype, eprint,
  var etype = firstOf(bibitem,["eprinttype","etype","archiveprefix"]).toLowerCase();
  var eprint = bibitem.eprint;
  var rxArxiv = /^https?:\/\/arxiv.org\/((abs|pdf|ps|format)\/)?/;
  if (!etype && !eprint) {
    if (bibitem.arxiv && rxArxiv.test(bibitem.arxiv)) {
      etype = "arxiv";
      eprint = bibitem.arxiv.replace(rxArxiv,"");
    }
    else if (bibitem.pmcid || bibitem.pmc) {
      etype = "pmcid";
      eprint = bibitem.pmcid || bibitem.pmc;
    }
    else if (bibitem.pmid) {
      etype = "pubmed";
      eprint = bibitem.pmid;
    }
    else if (bibitem.jstor) {
      etype = "jstor";
      eprint = bibitem.jstor;
    }
    else if (bibitem.zbl) {
      etype = "zbl";
      eprint = bibitem.zbl;
    }
    else if (bibitem.hdl) {
      etype = "hdl";
      eprint = bibitem.hdl;
    }
    else if (bibitem.mr) {
      etype = "mr";
      eprint = bibitem.mr;
    }
  }
  var eclass  = firstOf(bibitem,["eprintclass","primaryclass"]);
  var eprefix = firstOf(bibitem,["eprintpath"]);
  if (!eprefix) {
    if (bibitem.arxiv && !rxArxiv.test(bibitem.arxiv)) {
      eprefix = bibitem.arxiv;
    }
    else if (etype==="arxiv") {
      eprefix = "abs";
    }
  }
  var epath = joinx([eprefix,eprint],"/");
  function etypeid(s) { return "[" + s + ":]{.etype}"; }

  // set initial url and text based on the eprint/etype
  var url = "";
  var urltext = "";
  var urlpre  = "";
  if (eprint) {
    if (etype==="arxiv") {
      urlpre  = etypeid("arXiv");
      urltext = joinx([eclass,eprint],"/");
      url     = "http://arxiv.org/" + epath; // 2015: no https support yet
    }
    else if (etype==="googlebooks") {
      urlpre  = etypeid("Google Books");
      urltext = eprint;
      url     = "https://books.google.com?id=" + epath;
    }
    else if (etype==="jstor") {
      urlpre  = etypeid("JSTOR");
      urltext = eprint;
      url     = "https://www.jstor.org/stable/" + epath;
    }
    else if (etype==="pmcid") {
      urlpre  = etypeid("PMCID");
      urltext = eprint;
      url     = "https://www.ncbi.nlm.nih.gov/pmc/articles/" + epath;
    }
    else if (etype==="pubmed") {
      urlpre  = etypeid("PMID");
      urltext = eprint;
      url     = "https://www.ncbi.nlm.nih.gov/pubmed/" + epath;
    }
    else if (etype==="zbl") {
      urlpre  = etypeid("Zbl");
      urltext = eprint;
      url     = "https://zbmath.org/?q=an:" + epath;
    }
    else if (etype==="hdl") {
      urlpre  = etypeid("HDL");
      urltext = eprint;
      url     = "https://hdl.handle.net/" + epath;
    }  
    else if (etype==="mr") {
      urlpre  = etypeid("MR");
      urltext = eprint;
      url     = "https://www.ams.org/mathscinet-getitem?mr=MR" + epath;
    }  
  }
  // this is the text displayed for a url
  item.URLtext = ctex(bibitem.urltext) || urltext;
  item.URLpretext = ctex(bibitem.urlpretext) || urlpre;

  // for future compat, emit the eprint/eprinttype fields
  if (etype && eprint) {
    item["eprint-type"] = etype;
    item["eprint"]      = eprint;
    if (eclass) item["eprint-class"] = eclass;
  }

  // and finally set the url & doi
  var rxDoi = /^https?\:\/\/(?:dx\.doi\.org|doi(?:\.\w+)?\.org)\//;
  var doi   = bibitem.doi;
  var doitext = bibitem.doitext || "";
  if (options.url !== false && bibitem.url) {
    if (!doi && options.doi !== false && rxDoi.test(bibitem.url)) {
      doi = bibitem.url;        
      doitext = urltext;
    }
    else {
      url = bibitem.url; // allows user to override eprint generated url
    }
  }
  if (url && (item.URLtext || options.url !== false)) {
    item.URL = url;
  }
  if (doi && options.doi !== false) {
    item.DOI     = doi.replace(rxDoi,"");
    item.DOItext = doitext;
  }

}


// ---------------------------------------------
// Resolve cross references
// ---------------------------------------------

// do not propagate these fields from a crossref base entry.
var dontPropagate = {
  ids: true,
  crossref: true,
  xref: true,
  entryset: true,
  entrysubtype: true,
  execute: true,
  label: true,
  options: true,
  presort: true,
  related: true,
  relatedoptions: true,
  relatedstring: true,
  relatedtype: true,
  shorthand: true,
  shorthandintro: true,
  sortkey: true,
};

function transformCrossRef( bibitem ) {
  var item = {};
  var multiVolume = /^mv/.test(bibitem.bibtype);
  var isBooklike  =(bibitem.bibtype==="book" || bibitem.bibtype==="proceedings" ||
                    bibitem.bibtype==="collection" || bibitem.bibtype==="reference" || 
                    bibitem.bibtype==="periodical");

  properties(bibitem).forEach( function(key) {
    if (dontPropagate[key]) return;
    item[key] = bibitem[key];
    if (key === "author") {
      if (bibitem.bibtype==="book" || bibitem.bibtype==="mvbook") 
        item.bookauthor = bibitem.author;
    }
    if (multiVolume) {
      if (bibitem.title)    item.maintitle = bibitem.title;
      if (bibitem.subtitle) item.mainsubtitle = bibitem.subtitle;
      if (bibitem.titleaddon) item.maintitleaddon = bibitem.titleaddon;
    }
    if (isBooklike) {
      if (bibitem.title)    item.booktitle = bibitem.title;
      if (bibitem.subtitle) item.booksubtitle = bibitem.subtitle;
      if (bibitem.titleaddon) item.booktitleaddon = bibitem.titleaddon;      
    }
  });
  return item;
}

function getCrossRef( cref, bibitems, options ) {
  var bibitem = bibitems[cref];
  if (!bibitem) return null; // todo: warning?
  resolveCrossRefs( bibitem, bibitems, options ); // resolve this one too
  return (options.bibtex ? bibitem : transformCrossRef(bibitem));
}

function resolveCrossRefs( bibitem, bibitems, options ) {
  if (bibitem._resolved) return; // prevent infinite recursion
  bibitem._resolved = true;
  [bibitem.crossref,bibitem.xdata].forEach( function(cref) {
    if (cref) {
      var base = getCrossRef(cref, bibitems, options );
      if (base) extendWithNew(bibitem,base);
    }
  });
}

// ---------------------------------------------
// Convert bib item entry
// ---------------------------------------------

function convertBibitem(bibitem, bibitems, ctex, baseOptions) {
  if (bibitem.bibtype==="xdata") return null;

  // resolve cross references
  resolveCrossRefs( bibitem, bibitems, baseOptions );

  // extend base options with local options
  var itemOptions = optionsParse( bibitem.options );
  var options;
  if (!itemOptions) {
    options = baseOptions;
  }
  else {
    options = {};
    properties(baseOptions).forEach( function(key) { options[key] = baseOptions[key]; });
    properties(itemOptions).forEach( function(key) { options[key] = itemOptions[key]; });
  }

  var item = {};
  item.id = bibitem.bibkey;  
  
  convertType(item, bibitem);
  if (bibitem.type) item.genre = bibitem.type;
  
  convertAuthors(item,bibitem,ctex,options);
  convertTitles(item,bibitem,ctex);
  convertDates(item,bibitem);
  convertStandard(item,bibitem,ctex);
  convertElectronic(item,bibitem,ctex,options);
  convertMisc(item,bibitem,ctex,options);

  // clean up empty entries
  properties(item).forEach( function(key) {
    if (item[key]==null || item[key]==="") {
      delete item[key];
    }
  });

  //console.log( bibitem );
  //console.log(" -> ");
  //console.log(item);
  //console.log();
  return item;
}


// ---------------------------------------------
// 
// ---------------------------------------------

function evalBib(entries,convTex,fname,options) {
  function showLine(line) {
    return (fname ? fname + ":" : "") + (typeof line === "string" ? line : line.toString());
  }

  var warnings = [];
  var bibitems = {};

  var bib = { 
    _preamble : "", 
    _comments : "",
  };

  entries.forEach( function(entry) {
  	if (entry.bibtype==="warning") {
      warnings.push("warning: " +  showLine(entry.line) + ": " + entry.value);
    }
  	else if (entry.bibtype==="comment") {
      bib._comments = bib._comments + entry.value + "\n";
    }
  	else if (entry.bibtype==="preamble") {
      bib._preamble = bib._preamble + entry.value + "\n";
    }
  	else {
      bibitems[entry.bibkey] = entry;
    }
  });
  properties(bibitems).forEach( function(bikey) {
    var bibitem = bibitems[bikey];
    var item = convertBibitem( bibitem, bibitems, convTex, options );
    //console.log(item);
    if (item) {
      if (bibitem.line) item._line = showLine(bibitem.line);
      if (options.preid) item._preid = options.preid;
      bib[item.id.toLowerCase()] = item;
    }
  });
  
  return { bib: bib, warnings: warnings.join("\n") };
}


/* ---------------------------------------------
   Convert bibtex input to CSL format.

inputs    : array of { filename, contents } bibtex bibliographies;
            the contents are a plain bibtex file, or pre-processed JSON of the CSL entries
convertTex: function from string to string -- applied to bibtex fields
options   : optional options; options can be extended in every bibliography entry
            by using the field 'options', like: 'options={useprefix=true}'
  bibtex     : set to 'true' to disable cross-reference transformations
               (setting for example a 'title' field in a BOOK entry to 'booktitle' when 
                 imported into a @INCHAPTER entry.)
  juniorcomma: set to 'true' to emit a comma before a 'Jr' part of a name
  useprefix  : set to 'true' to make a particle ('von' part) non-dropping in a citation.
  preid      : sets _preid on each bibitem

returns {
  bib     : object, contains an CSL bibentry object for every entry in the bibtex
  warnings: string with all warnings
}
--------------------------------------------- */

function bibtexToCsl( inputs, convertTex, options ) {
  function convTex(s) {
    return (s ? (convertTex != null ? convertTex(s) : s) : "");
  }
  if (!inputs) return { bib: {}, warnings: "" };

  var bibs = inputs.map( function(finfo) {
    if (/^\s*\{/.test(finfo.contents)) {
      // json formatted CSL items
      try {
        var bib = JSON.parse(finfo.contents);
        return { bib: bib, warnings: "" };
      }
      catch(exn) {
        return { bib: {}, warnings: finfo.filename + ": " + (exn ? exn.toString() : "unable to parse bibtex input as JSON") };
      }
    }
    else {
      // plain bibtex file
      var entries = parseBibtex(finfo.contents);
      return evalBib(entries,convTex,finfo.filename,options || {});
    }
  });
  // merge results from each file
  var res = bibs[0];
  bibs.slice(1).forEach( function(bib) {
    res.warnings = [res.warnings,bib.warnings].joinx("\n");
    var preamble = [res.bib._preamble,bib.bib._preamble].joinx("\n");
    var comments = [res.bib._comments,bib.bib._comments].joinx("\n");
    extend(res.bib,bib.bib); 
    res.bib._preamble = preamble;
    res.bib._comments = comments;
  });
  return res;
}

return {
  convertToCsl: bibtexToCsl,
}

});