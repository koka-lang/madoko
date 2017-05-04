/*---------------------------------------------------------------------------
  Copyright 2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {

  var rxISO = /^(\d\d\d\d)\-?(\d\d)\-?(\d\d)(?:T(\d\d):?(\d\d)(?:[:]?(\d\d)(?:[\.,](\d+))?)?(?:Z|([\+\-])(\d\d)(?:[:]?(\d\d))?)?)?$/i;
    
  var rxIsoZ = /\.?0+(?=Z|$)/

  function dateFromISO(s) {
    function parseNum(n) {
      var i = parseInt(n,10);
      return (isNaN(i) ? undefined : i);
    }

    var utc = null;
    var cap = rxISO.exec( s.replace(/\s+/g, "") );    
    if (cap) {
      var ms    = parseNum( ((cap[7] || "") + "000").substr(0,3) );
      var utcx  = new Date( Date.UTC( parseNum(cap[1]), parseNum(cap[2])-1, parseNum(cap[3]),
                                   parseNum(cap[4]), parseNum(cap[5]), parseNum(cap[6]), ms ) );
      if (utcx && !isNaN(utcx)) {
        utc = utcx;
        var tz = (cap[8]=="+" ? -1 : 1) * ((parseNum(cap[9])||0) * 60 + (parseNum(cap[10])||0));
        if (tz !== 0) utc.setUTCMinutes( utc.getUTCMinutes + tz );
      }
    }
    if (!utc) {
      console.log("dateFromISO: cannot convert: " + s);      
      utc = new Date(0);
    }
    else if (utc.toISOString().replace(rxIsoZ,"") !== s.replace(rxIsoZ,"")) {
      console.log( "dateFromISO: illegal conversion:\n original: " + s + "\n parsed  : " + utc.toISOString());
    }
    return utc;
  }

  return {
    dateFromISO: dateFromISO,
  };
});

