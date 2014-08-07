/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {

  function dateFromISO(s) {
    function parseNum(n) {
      var i = parseInt(n,10);
      return (isNaN(i) ? undefined : i);
    }

    var rxISO = /^(\d\d\d\d)\-?(\d\d)\-?(\d\d)(?:T(\d\d):?(\d\d)(?:[:]?(\d\d)(?:[\.,](\d\d\d))?)?(?:Z|([\+\-])(\d\d)(?:[:]?(\d\d))?)?)?$/i;
    var cap = rxISO.exec( s.replace(/\s+/g, "") );
    if (!cap) return new Date(0);    
    var utc  = new Date( Date.UTC( parseNum(cap[1]), parseNum(cap[2])-1, parseNum(cap[3]),
                                   parseNum(cap[4]), parseNum(cap[5]), parseNum(cap[6]), parseNum(cap[7]) ) );
    if (!utc || isNaN(utc)) return new Date(0);
    var tz = (cap[8]=="+" ? -1 : 0) * ((parseNum(cap[9])||0) * 60 + (parseNum(cap[10])||0));
    if (tz !== 0) utc.setUTCMinutes( utc.getUTCMinutes + tz );
    return utc;
  }

  return {
    dateFromISO: dateFromISO,
  };
});