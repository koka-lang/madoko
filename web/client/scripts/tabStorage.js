/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/
if (typeof define !== 'function') { var define = require('amdefine')(module) }
define(["../scripts/promise","../scripts/localDb"],function(Promise,LocalDb) {

  var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
  };

  var tabTickIval = 10000; // in milliseconds
  var tabMax = 4;

  function tabTicksKey(n) {
    return "tab/" + n.toString() + "/ticks";
  }

  function tabGetTicks(n) {
    var key = tabTicksKey(n);
    var s = localStorage.getItem(key);
    if (s==null) return 0;
    var t = Number(s);
    if (isNaN(t)) return 0;
    return t;
  }

  function tabSetTicks(n,t) {
    var key = tabTicksKey(n);
    localStorage.setItem(key, Date.now().toString());
  }

  function tabRemoveTicks(n) {
    var key = tabTicksKey(n);
    localStorage.removeItem(key);
  }

  function tabClaim(n, noupdate) {
    var t    = tabGetTicks(n);
    var diff = t + tabTickIval - Date.now();
    if (diff < 0) {  
      // it's old: claim it
      tabSetTicks(n); 
      if (!noupdate) {
        setInterval( function() { tabSetTicks(n); }, tabTickIval/2 );  
        window.addEventListener( "unload", function() { tabRemoveTicks(n); } );
        // set hash
        var h = window.location.hash.replace(/^#|\btab=\d($|[&])/g, "");
        if (n > 1 && h.length > 0) h = "&" + h;
        window.location.hash = "#" + (n > 1 ? "tab=" + n.toString() : "") + h;
      }
      return true;
    }
    return false;
  }

  function claim(n) {
    if (window.tabStorage.tabNo === n) return true;
    return tabClaim(n,true);
  }

  function unClaim(n) {
    if (window.tabStorage.tabNo !== n) {
      tabRemoveTicks(n);
    }
  }

  function tabClaimTabNo() {
    var cap = /\btab=(\d)\b/.exec(window.location.hash);
    var i;
    if (cap) {
      i = Number(cap[1]);
      if (tabClaim(i)) return i;
    }
    for(i = 1; i <= tabMax; i++) {
      if (tabClaim(i)) return i;
    }
    return 0;
  }

  function initialize() {
    if (window.tabStorage) return true;
    var tabNo = tabClaimTabNo();
    if (tabNo === 0) return false;
    window.tabStorage = new TabStorage(tabNo);
    return true;
  }

  function createTabDb() {
    if (!initialize()) return false;
    return LocalDb.create().then( function(localDb) {
      return new TabStore(window.tabStorage.tabNo, localDb);
    });
  }


  var TabStore = (function() {
    function TabStore(tabNo,store) {
      var self     = this;
      self.tabNo  = (tabNo != null ? tabNo : (window.tabStorage ? window.tabStorage.tabNo : 1));
      self.store   = store || window.localStorage;
      self.tabKey = "tab/" + self.tabNo.toString();      
    }

    TabStore.prototype._getKey = function(key,tabNo) {
      var self = this;
      var tabKey = (tabNo == null || tabNo === self.tabNo) ? self.tabKey : "tab/" + tabNo.toString();
      return tabKey + (key == null ? "" : "/" + key);
    }

    TabStore.prototype.getItem = function(key) {
      var self = this;
      return self.getItemFrom(self.tabNo,key);
    }

    TabStore.prototype.getItemFrom = function(tabNo,key) {
      var self = this;
      return self.store.getItem( self._getKey(key,tabNo) );
    }

    TabStore.prototype.setItem = function(key,value) {
      var self = this;
      return self.store.setItem( self._getKey(key), value );
    }
    
    TabStore.prototype.removeItem = function(key) {
      var self = this;
      return self.removeItemFrom( self.tabNo, key );
    }

    TabStore.prototype.removeItemFrom = function(tabNo,key) {
      var self = this;
      return self.store.removeItem( self._getKey(key,tabNo) );
    }

    TabStore.prototype._allKeys = function(f) {
      var self = this;
      return self.store.keys().then( function(keys) { return f(keys); });
    }

    TabStore.prototype.keys = function(tabNo) {
      var self = this;
      return self._allKeys( function(keys) {
        var prefix = self._getKey("",tabNo);
        return keys.map( function(key) {
          return (key.indexOf(prefix) === 0 ? key.substr(prefix.length) : null);
        }).filter( function(key) {
          return (key != null);
        });
      });
    }

    TabStore.prototype.limit = function() {
      var self = this;
      return (typeof self.store.limit === "function" ? self.store.limit() : 2.5*1024*1024);
    }

    TabStore.prototype.clear = function(tabNo) {
      var self = this;
      return self.keys(tabNo).then( function(keys) {
        return Promise.map( keys, function(key) {
          return self.removeItemFrom(tabNo,key);
        });
      });
    }

    return TabStore;
  })();

  var TabStorage = (function(_super) {
    __extends(TabStorage,_super);

    function TabStorage(tabNo) {
      _super.call(this,tabNo,window.localStorage);
    }

    TabStorage.prototype._encode = function(value) {
      return JSON.stringify(value);
    }

    TabStorage.prototype._decode = function(value) {
      if (value==null) return value;
      try {
        return JSON.parse(value);
      }
      catch(exn) {
        return undefined;
      }    
    }

    TabStorage.prototype.getItemFrom = function(tabNo,key) {
      var self = this;
      return self._decode( self.store.getItem( self._getKey(key,tabNo) ) );
    }

    TabStorage.prototype.setItem = function(key,value) {
      var self = this;
      return self.store.setItem( self._getKey(key), self._encode(value) );
    }

    TabStorage.prototype._allKeys = function(f) {
      var self = this;
      var keys = [];
      for(var i = 0; i < self.store.length; i++) {
        keys.push(self.store.key(i));
      }
      return f(keys);
    }

    TabStorage.prototype.getItemFromAll = function(key) {
      var self = this;
      var values = [];
      for(var i = 1; i <= tabMax; i++) {
        var value = self.getItemFrom(i,key);
        if (value != null) values.push({ tabNo: i, value: value });
      }
      return values;
    }

    TabStorage.prototype.clear = function(tabNo) {
      var self = this;
      return self.keys(tabNo).map( function(key) {
        return self.removeItemFrom(tabNo,key);
      });
    }

    return TabStorage;
  })(TabStore);

  return {
    createTabDb: createTabDb,
    initialize: initialize,
    claim : claim,
    unClaim: unClaim,
  }
});