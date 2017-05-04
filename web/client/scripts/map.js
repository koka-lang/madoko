/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/
if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {

  function sortKey(l1,l2) {
    var s1 = l1.key.toLowerCase();
    var s2 = l2.key.toLowerCase();
    return (s1 < s2 ? -1 : (s1 > s2 ? 1 : 0));
  } 

  var Map = (function() {
    function Map(arr) { 
      var self = this;
      if (arr && arr instanceof Array) {
        arr.forEach( function(elem) {
          self.set(elem.key, elem.value);
        });
      }
    };

    Map.unpersist = function(obj) {
      var map = new Map();
      for(var prop in obj) {
        if (obj.hasOwnProperty(prop) && prop[0]==="/") {
          map[prop] = obj[prop];
        }
      };
      return map;
    }


    Map.prototype.count = function() {
      var self = this;
      var total = 0;
      for (var key in self) {
        if (key[0] === "/") {  
          total++;
        }
      }
      return total;
    }

    Map.prototype.clear = function() {
      var self = this;
      self.forEach( function(name,value) {
        self.remove(name);
      });      
    }

    Map.prototype.persist = function() {
      return this;
    };

    Map.prototype.copy = function() {
      var self = this;
      var map = new Map();
      self.forEach( function(name,value) {
        map.set(name,value);
      });
      return map;
    }

    Map.prototype.set = function( name, value ) {
      this["/" + name] = value;
    }

    Map.prototype.get = function( name ) {
      return this["/" + name];
    }

    Map.prototype.getOrCreate = function( name, def ) {
      var self = this;
      if (!self.contains(name)) self.set(name,def);
      return self.get(name);
    }

    Map.prototype.contains = function( name ) {
      return (this.get(name) !== undefined);
    }

    Map.prototype.remove = function( name ) {
      delete this["/" + name];
    }

    // apply action to each element. breaks early if action returns "false".
    Map.prototype.forEach = function( action ) {
      var self = this;
      for (var key in self) {
        if (key.substr(0,1) === "/") {  
          var res = action(key.substr(1), self[key]);
          if (res===false) return;
        }        
      };
    }

    // return a new map where action is applied to every element
    Map.prototype.map = function( action ) {
      var self = this;
      var res = new Map();
      self.forEach( function(name,elem) {
        res.set(name,action(name,elem));
      });
      return res;
    }

    // return a new map where every element satisfies the predicate
    Map.prototype.filter = function( pred ) {
      var self = this;
      var res = new Map();
      self.forEach( function(name,elem) {
        if (pred(name,elem)) res.set(name,elem);
      });
      return res;
    }

    Map.prototype.elems = function() {
      var self = this;
      var res = [];
      self.forEach( function(name,elem) {
        res.push(elem);
      });
      return res;
    }

    Map.prototype.keyElems = function() {
      var self = this;
      var res = [];
      self.forEach( function(name,elem) {
        res.push( {key:name,value:elem} );
      });
      return res;
    }

    Map.prototype.sortedKeyElems = function() {
      var self = this;
      return self.keyElems().sort(sortKey);
    };
 
 	  Map.prototype.keys = function() {
      var self = this;
      var res = [];
      self.forEach( function(name,elem) {
        res.push( name );
      });
      return res;
    }

    return Map;
  })();

  return Map;
});