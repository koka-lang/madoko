/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

if (typeof define !== 'function') { var define = require('amdefine')(module) }
define([],function() {

  function delayed(action,delay) {
    if (!delay && typeof setImmediate !== "undefined") {
      setImmediate( function(){ action(); } );  // on NodeJS
    }
    else { 
      setTimeout( function(){ action(); }, delay || 0 );
    }
  }

  function promiseWhen() {
    var ps = (arguments.length > 1 ? Array.prototype.slice.call(arguments) : (arguments[0] ? arguments[0] : []));
    return promiseWhenBatched(ps);
  }

  function promiseWhenBatched(ps,batch) {
    if (ps==null) ps = [];
    var total = ps ? ps.length : 0;
    var count = 0;
    var result = [];
    var error = null;
    var continuation = new Promise();
    if (batch==null || typeof batch !== "number" || batch <= 0) batch = total;

    var top = 0;
    function setup(i) {
      if (i >= total) return;
      result[i] = undefined;
      if (top <= i) top = i+1;
      try {
        if (ps[i] == null) return done();
      
        if (!(ps[i].then)) {
          ps[i] = ps[i]();  // call anonymous function for a batched when.
        }

        ps[i].then( function(res) {
          result[i] = res; 
          done();
        }, function(err) {
          error = err; 
          done();
        });    
      }
      catch(exn) {
        error = exn;
        done();
      }
    }
    
    function done() {
      count++;
      if (count<total) {
        if (total > 0) continuation.progress( count/total );
        if (top < total) setup(top); // for batched when, initiate next promise
      }
      else if (error) {
        continuation.reject(error);
      }
      else {
        continuation.resolve(result);
      }
    }
    
    if (total <= 0) {
      delayed( function() { continuation.resolve(result); } );
    }
    else {      
      var n = (batch < total ? batch : total);
      for(var i = 0; i < n; i++) {
        setup(i);
      }
    }

    return continuation;
  }

  var Queue = (function() {
    function Queue() {
      var self = this;
      self.finalp = null;
    }

    // push an action that returns a promise on a queue; every action in the queue will
    // be executed in sequence. Returns a promise.
    Queue.prototype.push = function(action) {
      var self = this;
      if (self.finalp==null) return action();
      var p = self.finalp.then( function() {
        return action();
      }, function() {
        return action();
      }).always( function() {
        if (self.finalp === p) self.finalp = null;
      });
      self.finalp = p;
      return p;
    };

    return Queue;
  })();

  var Promise = (function() {
    var Event = { Success: "resolve", Progress: "progress", Error: "reject" };

    function Promise( asyncAction ) {
      var self = this;
      self.listeners = [];
      self.completed = false;
      if (asyncAction && asyncAction.then) {
        // a promise itself, hook up to it.. this is used to interoperate with other libraries' promises
        asyncAction.then( 
          function() { self.resolve.apply(self,arguments); },
          function() { self.reject.apply(self,arguments); },
          function() { self.progress.apply(self,arguments); }
        );
      }
      else if (typeof asyncAction === "function") {
        // asynAction is a function that takes a continuation as its last argument 
        asyncAction( function(err) {
          if (err) {
            self.reject.apply(self,arguments);
          }
          else {
            var args = Array.prototype.slice.call(arguments,1);
            self.resolve.apply(self,args);
          }
        });
      }
    }

    Promise.when = function(promises) { 
      return promiseWhen(promises);
    }
    Promise.whenBatched = function(promises,batch) { 
      return promiseWhenBatched(promises,batch);
    }

    Promise.timeout = function(msecs,err) {
      var self = this;
      setTimeout( function() {
        if (!self.completed) self.reject(err || "Asynchronous operation timed out.");
      }, msecs );
      return self;
    }

    Promise.createQueue = function() {
      return new Queue();
    }

    Promise.guarded = function(pred,action,after) { 
      if (pred) {
        return action().then( function() { return after(); } );
      }
      else {
        return after();
      }
    }

    Promise.delayed = function(delay) {
      return new Promise( function(cont) {
        setTimeout( function() {
          cont(null);
        }, delay );
      });
    }


    Promise.rejected = function(err) {
      var promise = new Promise();
      delayed( function() { promise.reject(err); });
      return promise;
    }

    Promise.resolved = function() {
      var args = Array.prototype.slice.call(arguments);
      var promise = new Promise();
      delayed( function() { promise.resolve.apply(promise,args); });
      return promise;
    }

    Promise.do = function(action) {
      return Promise.resolved().then( function() { return action(); } );
    }

    Promise.maybe = function(p,action) {
      if (p && p.then) {
        return p.then(action);
      }
      else {
        return action(p);
      }
    }

    Promise.wrap = function() {
      try {
        var args = Array.prototype.slice.call(arguments);
        if (args.length < 2) console.log ("madoko: Promise.wrap does not have enough arguments!");
        var p = args[0].apply(args[0],args.slice(1));
        if (p && p.then) return p;
                   else  return Promise.resolved(p);
      }
      catch(exn) {
        return Promise.rejected(exn);
      }
    }

    Promise.prototype.always = function( action ) {
      var self = this;
      return self.then( function(x){ action(); return x; }, function(err){ action(); throw err; });
    }

    Promise.prototype.then = function( onSuccess, onError, onProgress ) {
      var self = this;
      var listener;

      if (onSuccess && onSuccess.then) {
        // propagate to a promise
        listener = {
          continuation: (onSuccess instanceof Promise ? onSuccess : new Promise(onSuccess))
          // no handlers: will propagate immediately to the onSucces promise
        }
      } 
      else {
        // set up handlers
        listener = { 
          continuation: new Promise(),
          resolve: onSuccess,
          reject: onError,
          progress: onProgress
        };
      }
      self.listeners.push(listener);
      return listener.continuation;
    }

    Promise.prototype._onEvent = function(event,args) {
      var self = this;
      if (self.completed) return;
      self.completed = (event !== Event.Progress);

      self.listeners.forEach( function(listener) {
        var callback = listener[event];
        var continuation = listener.continuation;
        if (callback) {
          try {
            // invoke the callback
            var res = callback.apply(listener, args);
            if (self.completed) {     // if not progress
              if (res && res.then) {  // if the callback returned a promise, hook up to it..
                res.then( 
                  function() { continuation.resolve.apply(continuation, arguments); },
                  function() { continuation.reject.apply(continuation, arguments); },
                  function() { continuation.progress.apply(continuation, arguments); }
                );
              }
              else if (typeof res !== "undefined") {
                // if a regular value is returned, immediately invoke the success handler
                continuation.resolve(res);
              }
              else {
                // otherwise, invoke the continuation without any arguments
                continuation.resolve();
              }
            }
          }
          catch(exn) {
            // if an exception is raised in the callback, propagate the error (if not progress)
            if (self.completed) {
              continuation.reject(exn);
            }  
          }
        }
        else if (self.completed) {  // if not progress && no callback
          // just propagate the event to our listeners
          continuation[event].apply(continuation, args);
        }          
      });
    }

    Promise.prototype.resolve = function() {
      var self = this;
      self._onEvent(Event.Success,arguments);
    }

    Promise.prototype.progress = function() {
      var self = this;
      self._onEvent(Event.Progress,arguments);
    }

    Promise.prototype.reject = function() {
      var self = this;
      self._onEvent(Event.Error,arguments);
    }

    return Promise;
  })();

  return Promise;
});