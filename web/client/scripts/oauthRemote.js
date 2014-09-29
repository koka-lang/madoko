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
    self.logo           = opts.logo || ("icon-" + self.name + ".png");
    self.defaultDomain  = opts.defaultDomain;
    self.loginUrl       = opts.loginUrl;
    self.loginParams    = opts.loginParams;
    self.logoutUrl      = opts.logoutUrl;
    self.logoutTimeout  = opts.logoutTimeout || false;
    self.accountUrl     = opts.accountUrl;
    self.useAuthHeader  = (opts.useAuthHeader !== false);
    self.access_token   = null;
    self.userName       = null;
    self.userId         = null;
    self.dialogWidth    = opts.dialogWidth || 600;
    self.dialogHeight   = opts.dialogHeight || 600;

    if (!self.loginParams.redirect_uri)  self.loginParams.redirect_uri  = location.origin + "/oauth/redirect";
    if (!self.loginParams.response_type) self.loginParams.response_type = "code";

    self.logoutParams = opts.logoutParams || {};
    if (!self.logoutParams.client_id) self.logoutParams.client_id = self.loginParams.client_id;
    if (!self.logoutParams.redirect_uri) self.logoutParams.redirect_uri = self.loginParams.redirect_uri;

    self.nextTry     = 0;     // -1: never try (on logout), 0: try always, N: try if Date.now() < N
    self.lastTryErr  = null;
    self.tryDelay    = 10000; 
    self.logoutErr   = { httpCode: 401, message: "Not logged in to " + self.name };
  }

  // try to set access token without full login; call action with connected or not.
  // if not connected, also apply the error.
  OAuthRemote.prototype._withConnect = function(action) {
    var self = this;
    if (self.access_token) return Promise.wrap(action, true);
    if (self.nextTry < 0 || Date.now() < self.nextTry) {
      if (!self.lastTryErr) self.lastTryErr = self.logoutErr;
      return Promise.wrap(action, false, self.lastTryErr);
    }
    self.lastTryErr = null;
    return Util.requestGET("/oauth/token",{ remote: self.name } ).then( function(res) {
      if (!res || typeof(res.access_token) !== "string") {
        self.nextTry = Date.now() + self.tryDelay; // remember we tried
        self.lastTryErr = self.logoutErr;
        return action(false, self.lastTryErr);
      }
      else {
        self.access_token = res.access_token;
        Util.message("Connected to " + self.name, Util.Msg.Status );
        return action(true);
      }
    }, function(err) {
      if (err && err.httpCode === 401) {
        self.logout();
      }
      else {
        self.nextTry    = Date.now() + self.tryDelay; // remember we tried
        self.lastTryErr = err || { httpCode: 400, message: "Network request failed" };
      }
      return action(false,self.lastTryErr);
    });
  }

  OAuthRemote.prototype._withAccessToken = function(action) {
    var self = this;
    return self._withConnect( function(connected,err) {
      if (!connected || !self.access_token) throw err;
      return action(self.access_token);
    });
  }

  OAuthRemote.prototype._requestXHR = function( options, params, body ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    return self._withAccessToken( function(token) {
      if (options.useAuthHeader !== false && self.useAuthHeader) {
        if (!options.headers) options.headers = {};
        options.headers.Authorization = "Bearer " + token;
      }  
      else {
        if (!params) params = {};
        params.access_token = token;
      }
      if (self.defaultDomain && options.url && !Util.startsWith(options.url,"http")) {
        options.url = self.defaultDomain + options.url;
      }
      return Util.requestXHR( options, params, body ).then( null, function(err) {
        // err.message.indexOf("request_token_expired") >= 0
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
    if (options.contentType === undefined) options.contentType = ";";
    return self._requestXHR(options,params);
  }

  OAuthRemote.prototype.logout = function(force) {
    var self  = this;
    return (force && self.logoutUrl ? Util.openOAuthLogout(self.name, { url: self.logoutUrl, width: self.dialogWidth, height: self.dialogHeight, timeout: self.logoutTimeout }, self.logoutParams ) : Promise.resolved()).always( function() {
      var token = self.access_token;
      self.access_token = null;
      self.nextTry    = -1; // no need to ever try to get the token
      self.lastTryErr = self.logoutErr;
      self.userId   = null;
      self.userName = null;
      Util.message("Logged out from " + self.name, Util.Msg.Status);


      if (token) {
        // invalidate the access_token
        return Util.requestPOST( {url: "/oauth/logout"}, { remote: self.name } );
      }
      else {
        return Promise.resolved();
      }
    });
  }

  // Do a full login. 
  OAuthRemote.prototype.login = function() {
    var self = this;
    if (self.access_token) return Promise.resolved();
    return Util.openOAuthLogin(self.name, { url: self.loginUrl, width: self.dialogWidth, height: self.dialogHeight }, self.loginParams).then( function() {
      self.nextTry = 0; // ensure we access the server this time
      return self._withAccessToken( function() { // and get the token
        Util.message( "Logged in to " + self.name, Util.Msg.Status );
        return; 
      } ); 
    });
  }

  // try to set access token without full login; return status code: 0 = ok, 401 = logged out, 400 = network failure.
  OAuthRemote.prototype.connect = function(verify) {
    var self = this;
    return self._withConnect( function(connected,err) { 
      if (!connected) return (err.httpCode || 401);
      if (!verify) return 0;
      return self.getUserInfo().then( function() {
        return 0;
      }, function(err) {
        return (err.httpCode || 401);
      });
    });
  }

  OAuthRemote.prototype.withUserId = function(action) {
    var self = this;
    if (self.userId) return Promise.wrap(action, self.userId);
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

  return OAuthRemote;
})();


return OAuthRemote;

});