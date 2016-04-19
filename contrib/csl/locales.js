/*---------------------------------------------------------------------------
  Copyright 2015 Daan Leijen, Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/


if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {

// Given a language id or name, return a valid language id and a non-empty array of a language names,
// where langnames[0] is the locale language name, and langnames[1] (if present) the US name.
// returns: { langid: string, langnames: [string] }.
function getLocaleInfo( name ) {
  var langname = (name||"?").replace(/[_\.]/g, "-");
  var langid   = langname.toLowerCase(); 
  var langnames = null;
  var cap = /^([a-z][a-z])(?:-([A-Z][A-Z])(-.*)?)?$/.exec(langname);
  if (cap) {
    // language code
    if (cap[2]) {
      langid = cap[1] + "-" + cap[2];
    }
    else {
      langid = locales["primary-dialects"][cap[1]];
      if (!langid) langid = cap[1];
    }
  }
  else {
    // find through language name
    properties(languages).some( function(id) {
      return languages[id].some( function(fullname) {
        var names = fullname.replace(/[\(\),;\.]/g,"").toLowerCase().split(/\s+/); // TODO: cache this?
        return names.some( function(lname) {
          if (lname===langid) {
            langid    = id;
            langnames = languages[id];
            return true;
          }
          else return false;
        });
      });
    });
  }
  // map to more common langid if necessary
  compatid = langid;    
  if (localeCompat[langid]) langid = localeCompat[langid];

  // try to find the language names
  if (!langnames) {
    if (languages[langid]) {
      langnames = languages[langid];
    }
    else {
      // we do not recognize this language...
      langid = "en-US";
      langnames = [langname];
    }
  }
  return { langid: langid, langnames: langnames, originalid: compatid };
}


var locales =
// 2015-12-21: Here follows the literal content of 'locales.json' from https://github.com/citation-style-language/locales
{
    "primary-dialects": {
        "af": "af-ZA",
        "ar": "ar",
        "bg": "bg-BG",
        "ca": "ca-AD",
        "cs": "cs-CZ",
        "cy": "cy-GB",
        "da": "da-DK",
        "de": "de-DE",
        "el": "el-GR",
        "en": "en-US",
        "es": "es-ES",
        "et": "et-EE",
        "eu": "eu",
        "fa": "fa-IR",
        "fi": "fi-FI",
        "fr": "fr-FR",
        "he": "he-IL",
        "hr": "hr-HR",
        "hu": "hu-HU",
        "id": "id-ID",
        "is": "is-IS",
        "it": "it-IT",
        "ja": "ja-JP",
        "km": "km-KH",
        "ko": "ko-KR",
        "lt": "lt-LT",
        "lv": "lv-LV",
        "mn": "mn-MN",
        "nb": "nb-NO",
        "nl": "nl-NL",
        "nn": "nn-NO",
        "pl": "pl-PL",
        "pt": "pt-PT",
        "ro": "ro-RO",
        "ru": "ru-RU",
        "sk": "sk-SK",
        "sl": "sl-SI",
        "sr": "sr-RS",
        "sv": "sv-SE",
        "th": "th-TH",
        "tr": "tr-TR",
        "uk": "uk-UA",
        "vi": "vi-VN",
        "zh": "zh-CN"
    },
    "language-names": {
        "af-ZA": [
            "Afrikaans",
            "Afrikaans"
        ],
        "ar": [
            "العربية",
            "Arabic"
        ],
        "bg-BG": [
            "Български",
            "Bulgarian"
        ],
        "ca-AD": [
            "Català",
            "Catalan"
        ],
        "cs-CZ": [
            "Čeština",
            "Czech"
        ],
        "cy-GB": [
            "Cymraeg",
            "Welsh"
        ],
        "da-DK": [
            "Dansk",
            "Danish"
        ],
        "de-DE": [
            "Deutsch (Deutschland)",
            "German (Germany)"
        ],
        "de-AT": [
            "Deutsch (Österreich)",
            "German (Austria)"
        ],
        "de-CH": [
            "Deutsch (Schweiz)",
            "German (Switzerland)"
        ],
        "el-GR": [
            "Ελληνικά",
            "Greek"
        ],
        "en-US": [
            "English (US)",
            "English (US)"
        ],
        "en-GB": [
            "English (UK)",
            "English (UK)"
        ],
        "es-ES": [
            "Español (España)",
            "Spanish (Spain)"
        ],
        "es-CL": [
            "Español (Chile)",
            "Spanish (Chile)"
        ],
        "es-MX": [
            "Español (México)",
            "Spanish (Mexico)"
        ],
        "et-EE": [
            "Eesti",
            "Estonian"
        ],
        "eu": [
            "Euskara",
            "Basque"
        ],
        "fa-IR": [
            "فارسی",
            "Persian"
        ],
        "fi-FI": [
            "Suomi",
            "Finnish"
        ],
        "fr-FR": [
            "Français (France)",
            "French (France)"
        ],
        "fr-CA": [
            "Français (Canada)",
            "French (Canada)"
        ],
        "he-IL": [
            "עברית",
            "Hebrew"
        ],
        "hr-HR": [
            "Hrvatski",
            "Croatian"
        ],
        "hu-HU": [
            "Magyar",
            "Hungarian"
        ],
        "id-ID": [
            "Bahasa Indonesia",
            "Indonesian"    
        ],
        "is-IS": [
            "Íslenska",
            "Icelandic"
        ],
        "it-IT": [
            "Italiano",
            "Italian"
        ],
        "ja-JP": [
            "日本語",
            "Japanese"
        ],
        "km-KH": [
            "ភាសាខ្មែរ",
            "Khmer"
        ],
        "ko-KR": [
            "한국어",
            "Korean"
        ],
        "lt-LT": [
            "Lietuvių",
            "Lithuanian"
        ],
        "lv-LV": [
            "Latviešu",
            "Latvian"
        ],
        "mn-MN": [
            "Монгол",
            "Mongolian"
        ],
        "nb-NO": [
            "Norsk bokmål",
            "Norwegian (Bokmål)"
        ],
        "nl-NL": [
            "Nederlands",
            "Dutch"
        ],
        "nn-NO": [
            "Norsk nynorsk",
            "Norwegian (Nynorsk)"
        ],
        "pl-PL": [
            "Polski",
            "Polish"
        ],
        "pt-PT": [
            "Português (Portugal)",
            "Portuguese (Portugal)"
        ],
        "pt-BR": [
            "Português (Brasil)",
            "Portuguese (Brazil)"
        ],
        "ro-RO": [
            "Română",
            "Romanian"
        ],
        "ru-RU": [
            "Русский",
            "Russian"
        ],
        "sk-SK": [
            "Slovenčina",
            "Slovak"
        ],
        "sl-SI": [
            "Slovenščina",
            "Slovenian"
        ],
        "sr-RS": [
            "Српски / Srpski",
            "Serbian"
        ],
        "sv-SE": [
            "Svenska",
            "Swedish"
        ],
        "th-TH": [
            "ไทย",
            "Thai"
        ],
        "tr-TR": [
            "Türkçe",
            "Turkish"
        ],
        "uk-UA": [
            "Українська",
            "Ukrainian"
        ],
        "vi-VN": [
            "Tiếng Việt",
            "Vietnamese"
        ],
        "zh-CN": [
            "中文 (中国大陆)",
            "Chinese (PRC)"
        ],
        "zh-TW": [
            "中文 (台灣)",
            "Chinese (Taiwan)"
        ]
    }
}
// end of 'locales.json'
;


var localeCompat = {
  // special mapping since the variants are not 
  // directly supported by current locales in CSL
  "en-EN": "en-US",
  "en-CA": "en-US",
  "en-AU": "en-GB",
  "en-NZ": "en-GB",
}

var languages = extend( extend({}, locales["language-names"] ), {
   "en-GB": ["British","UKenglish"],
   "en-US": ["American","USenglish"],
   "en-AU": ["English (AU)","Australian"],
   "en-NZ": ["English (NZ)","Newzealand"],
   "de-AT": ["Austrian"],
   "fr-CA": ["Canadian"],
});

function extend( target, obj ) {
  properties(obj).forEach( function(key) {
    if (target[key] && target[key] instanceof Array) {
      target[key].concat( obj[key] );
    }
    else {
      target[key] = obj[key];
    }
  });
  return target;
}

function properties(obj) {
  var attrs = [];
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      attrs.push(key);
    }
  } 
  return attrs;
}


return {
  getLocaleInfo: getLocaleInfo,
}

});
