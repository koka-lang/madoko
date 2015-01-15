/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/
if (typeof define !== 'function') { var define = require('amdefine')(module) }
define(["../scripts/promise.js","../scripts/localStore.js"],function(Promise,LocalStore) {

  function createPageStore() {
    return LocalStore.create().then( function(localStore) {
      return new PageStore(localStore);
    });
  }

  var PageStore = (function() {
    function PageStore(store) {
      var self = this;
      self.page = 0;
      self.store = store;
    }

    PageStore.prototype.getKey = function(key) {
      var self = this;
      return "page" + self.page.toString() + "/" + key;
    }

    PageStore.prototype.getItem = function(key) {
      var self = this;
      return self.store.getItem( self.getKey(key) );
    }

    PageStore.prototype.setItem = function(key,value) {
      var self = this;
      return self.store.setItem( self.getKey(key),value);
    }

    PageStore.prototype.removeItem = function(key) {
      var self = this;
      return self.store.removeItem( self.getKey(key) );
    }

    PageStore.prototype.keys = function() {
      var self = this;
      return self.store.keys().then(function(keys) {
        var prefix = self.getKey("");
        return keys.filter( function(key) {
          return (key.indexOf(prefix) === 0);
        });
      });
    }

  })();

  return {
    createLocalStore: createLocalStore,
  }
});