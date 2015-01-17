/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/
if (typeof define !== 'function') { var define = require('amdefine')(module) }
define(["../scripts/promise"],function(Promise) {


  /*-------------------------------------------------------------------------
    Defines a local database abstraction: using IndexedDB when possible
    since it has a higher storage limit (50mb), but falling back to regular
    localStorage otherwise (limit 5mb)
  -------------------------------------------------------------------------*/

  var Local = (function() {
    function Local(root) {
      var self = this;
      self.root = (root==null ? "local" : root);
    }

    Local.prototype.getKey = function(key) {
      var self = this;
      return self.root + "/" + key;
    }

    Local.prototype.getItem = function(key) {
      var self = this;
      return Promise.do( function() {
        try {
          return JSON.parse(localStorage.getItem( self.getKey(key) ));
        }
        catch(exn) {
          return null;
        }
      });
    }

    Local.prototype.setItem = function(key,value) {
      var self = this;
      return Promise.do( function() {
        return localStorage.setItem( self.getKey(key), JSON.stringify(value));
      });
    }

    Local.prototype.removeItem = function(key) {
      var self = this;
      return Promise.do( function() {
        return localStorage.removeItem( self.getKey(key) );
      });
    }

    Local.prototype.addItem = function(key,value) {
      var self = this;
      return Promise.do( function() {
        var fullKey = self.getKey(key);
        var svalue = JSON.stringify(value);
        if (localStorage.getItem(fullKey)!==undefined) return false; // ouch, not atomic :-(
        localStorage.setItem(fullKey,svalue);
        return true;
      });
    }

    Local.prototype.atomicSetItem = function(key,value,expected) {
      var self = this;
      return Promise.do( function() {
        var fullKey = self.getKey(key);
        var svalue = JSON.stringify(value);
        if (localStorage.getItem(fullKey)!==expected) return false; // ouch, not atomic :-(
        localStorage.setItem(fullKey, svalue);
        return true;
      });
    }

    Local.prototype.keys = function() {
      var self = this;
      return Promise.do( function() {
        var keys   = [];
        var prefix = self.getKey("");
        var n = localStorage.length;
        var i;
        for( i = 0; i < n; i++) {
          var key = localStorage.key(i);
          if (key.indexOf(prefix) === 0) keys.push(key);
        }
        return keys;
      });
    }

    Local.prototype.limit = function() {
      return (2.5*1024*1024);
    }

    return Local;
  })();

  var indexedDb = indexedDB || window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB || window.OIndexedDB || window.msIndexedDB;
  var rw = ((window.IDBTransaction || window.webkitIDBTransaction || {}).READ_WRITE) || "readwrite";

  function openIndexedDB(root,storeName,version) {
    if (root==null) root = "local";
    if (version==null) version = 1;
    if (storeName==null) storeName = "local";
    return new Promise( function(cont) {
      var req = indexedDB.open(root, version);
      req.onerror = function() {
        cont(req.error);
      };
      req.onupgradeneeded = function() {
        var db = req.result;
        if (!db) return;
        [].forEach.call(db.objectStoreNames, function(name) {
          if (name !== storeName) db.deleteObjectStore(name);
        });
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      req.onsuccess = function() {
        cont(null,req.result);
      };
    });
  }

  var IDb = (function() {
    function IDb(db,storeName) {
      var self = this;
      self.db = db;
      self.storeName = storeName || "local";
    }

    IDb.prototype.getItem = function(key) {
      var self = this;
      return new Promise( function(cont) {
        var transaction = self.db.transaction([self.storeName], 'readonly')
        var store = transaction.objectStore(self.storeName);
        var req = store.get(key);
        req.onsuccess = function() {
          var value = req.result;
          if (value===undefined) value = null;
          cont(null,value);
        };
        req.onerror = function() {
          cont(req.error);
        };
      });
    }

    IDb.prototype.setItem = function(key,value) {
      var self = this;
      if (value === null) value = undefined;
      return new Promise( function(cont) {
        var transaction = self.db.transaction([self.storeName], rw);
        var store = transaction.objectStore(self.storeName);
        var req = store.put(value, key);
        req.onsuccess = function() {
          cont(null,req.result);
        };
        req.onerror = function() {
          cont(req.error);
        };
      });
    }

    IDb.prototype.removeItem = function(key) {
      var self = this;
      return new Promise( function(cont) {
        var transaction = self.db.transaction([self.storeName], rw);
        var store = transaction.objectStore(self.storeName);
        var req = store['delete'](key);
        req.onsuccess = function() {
          cont();
        };
        req.onerror = function() {
          cont(req.error);
        };
      });
    }

    IDb.prototype.addItem = function(key,value) {
      var self = this;
      return self.getItem(key).then( function(value0) {
        if (value0 != null) return false;
        return new Promise( function(cont) {
          var transaction = self.db.transaction([self.storeName], rw);
          var store = transaction.objectStore(self.storeName);
          var req = store.add(value,key);
          transaction.oncomplete = function() {
            cont(true);
          };
          transaction.onerror = function() {
            cont(false);
          };
          transaction.onabort = function(event) {
            cont(false);
          }
        });
      });
    }

    IDb.prototype.interlockedSetItem = function(key,value,expected) {
      var self = this;
      return self.getItem(key).then(function(value0) {
        if (value0 !== expected) return false;
        var lockKey = key + ".lock";
        return self.addItem(lockKey).then(function(success) { // atomic!
          if (!success) return false;
          return self.setItem(key,value).then( function() {
            return true;
          }).always( function() { self.removeItem(lockKey); } );
        });
      });
    }

    IDb.prototype.keys = function() {
      var self = this;
      return new Promise( function(cont) {
        var transaction = self.db.transaction([self.storeName], rw);
        var store = transaction.objectStore(self.storeName);
        var req = store.openCursor();
        var keys = [];
        req.onsuccess = function() {
          var cursor = req.result;
          if (!cursor) {
            cont(null,keys);
          }
          else {
            keys.push(cursor.key);
            cursor.continue();
          }
        };
        req.onerror = function() {
          cont(req.error);
        };
      });
    }

    IDb.prototype.limit = function() {
      return (50*1024*1024);
    }

    return IDb;
  })();


  function create(storeName) {
    if (indexedDB != null) {  // prefer indexedDB since the storage limit is much higher and it provides true atomic updates
      return openIndexedDB("local",storeName,3).then( function(db) {
        return new IDb(db,storeName);
      });
    }
    else {
      return Promise.resolved( new Local(storeName) );
    }
  }

  return {
    create: create,
  }
});