/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], function(Promise,Util) {

var OAuthRemote = (function() {

  function OAuthRemote(opts) {
    var self = this;
    
    self.name           = opts.name;
    self.client_id      = opts.client_id;
    self.redirect_uri   = opts.redirect_uri;
    self.response_type  = opts.response_type || "code";
    self.authorizeUrl   = opts.authorizeUrl;
    self.accountUrl     = opts.accountUrl;
    self.useAuthHeader  = opts.useAuthHeader || true;
    self.access_token   = null;
    self.userName = null;
    self.userId = null;
  }

  OAuthRemote.prototype._withAccessToken = function(action) {
    var self = this;
    if (self.access_token) return Promise.wrap(action(self.access_token));
    if (self.access_token === false) return Promise.rejected("Not logged in");
    return Util.requestGET("/oauth/token",{ remote: self.name } ).then( function(access_token) {
      self.access_token = access_token;
      return action(self.access_token);
    }, function(err) {
      self.access_token = false; // remember we tried
      throw err;
    });
  }

  OAuthRemote.prototype._requestXHR = function( options, params, body ) {
    var self = this;
    return self._withAccessToken( function(token) {
      if (options.useAuthHeader !== false && self.useAuthHeader) {
        if (!options.headers) options.headers = {};
        options.headers.Authorization = "Bearer " + token;
      }  
      else {
        if (!params) params = {};
        params.access_token = token;
      }
      return Util.requestXHR( options, params, body ).then( null, function(err) {
        if (err && err.httpCode === 401) { // access token expired 
          self.logout();
        }
        throw err;
      });
    });
  }

  OAuthRemote.prototype.requestPOST = function( options, params, content ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    options.method = "POST";
    return self._requestXHR(options,params,content);
  }

  OAuthRemote.prototype.requestPUT = function( options, params, content ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    options.method = "PUT";
    return self._requestXHR(options,params,content);
  }

  OAuthRemote.prototype.requestGET = function( options, params ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    options.method = "GET";
    return self._requestXHR(options,params);
  }

  OAuthRemote.prototype.logout = function() {
    var self = this;
    var token = self.access_token;
    self.access_token = false;
    self.userId = null;
    self.userName = null;

    if (token) {
      // invalidate the access_token
      return Util.requestPOST( {url: "/oauth/logout"}, { remote: "dropbox" } );
    }
    else {
      return Promise.resolved();
    }
  }

  OAuthRemote.prototype._tryLogin = function(action) {
    var self = this;
    if (self.access_token) return Promise.wrap(action(true));
    if (self.access_token===false) return Promise.wrap(action(false));
    return self._withAccessToken( function() { return true; }).then( function() {
      return action(true);
    }, function(err) {
      return action(false);
    });
  }

  OAuthRemote.prototype.login = function(dontForce) {
    var self = this;
    return self._tryLogin( function(ok) {
      if (ok) return;
      if (dontForce) return Promise.rejected( new Error("Not logged in to " + self.name) );
      var params = { 
        response_type: self.response_type, 
        client_id    : self.client_id, 
        redirect_uri : self.redirect_uri,
      };
      return Util.openOAuthLogin(self.name,self.authorizeUrl,params,600,600).then( function() {
        self.access_token = null; // reset from 'false'
        return self._withAccessToken( function() { return; } ); // and get the token
      });
    });
  }

  OAuthRemote.prototype.connect = function() {
    var self = this;
    return self.login(true).then( function() { return true; }, function(err) { return false; });
  }

  OAuthRemote.prototype.withUserId = function(action) {
    var self = this;
    if (self.userId) return Promise.wrap(action(self.userId));
    return self.getUserInfo().then( function(info) {
      return action(self.userId);
    });
  }

  OAuthRemote.prototype.getUserName = function() {
    var self = this;
    if (self.userName) return Promise.resolved(self.userName);
    return self.getUserInfo().then( function(info) {
      return self.userName;
    });
  }

  OAuthRemote.prototype.getUserInfo = function() {
    var self = this;
    return self.requestGET( { url: self.accountUrl } ).then( function(info) {
      self.userId = info.uid || info.id || info.userId || info.user_id || null;
      self.userName = info.display_name || info.name || null;
      return info;
    });
  }

  OAuthRemote.prototype.haveToken = function() {
    var self = this;
    return (self.access_token ? true : false);
  }

  OAuthRemote.prototype.checkConnected = function() {
    var self = this;
    return self.getUserInfo().then( function(info) { return true; }, function(err) { return false; });    
  } 

  return OAuthRemote;
})();


return OAuthRemote;

});