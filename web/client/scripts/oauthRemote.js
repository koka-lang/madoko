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
    self.accountUrl     = opts.accountUrl;
    self.useAuthHeader  = (opts.useAuthHeader !== false);
    self.access_token   = null;
    self.userName       = null;
    self.userId         = null;
    self.dialogWidth    = opts.dialogWidth || 600;
    self.dialogHeight   = opts.dialogHeight || 600;

    if (!self.loginParams.redirect_uri)  self.loginParams.redirect_uri  = location.origin + "/oauth/redirect";
    if (!self.loginParams.response_type) self.loginParams.response_type = "code";
  }

  // try to set access token without full login; call action with logged in or not.
  OAuthRemote.prototype._withConnect = function(action) {
    var self = this;
    if (self.access_token) return Promise.wrap(action, true);
    if (self.access_token === false) return Promise.wrap(action, false, new Error("Cannot login to " + self.name));
    return Util.requestGET("/oauth/token",{ remote: self.name } ).then( function(res) {
      if (!res || typeof(res.access_token) !== "string") {
        self.access_token = false; // remember we tried
        return action(false,new Error("Cannot login to " + self.name));
      }
      self.access_token = res.access_token;
      Util.message("Connected to " + self.name, Util.Msg.Status );
      return action(true);
    }, function(err) {
      self.access_token = false; // remember we tried
      return action(false,err);
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

  OAuthRemote.prototype.logout = function() {
    var self  = this;
    var token = self.access_token;
    self.access_token = false;
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
  }

  // Do a full login. Pass 'true' to give up if not yet logged in (instead of presenting a login form to the user).
  OAuthRemote.prototype.login = function(dontForce) {
    var self = this;
    return self._withConnect( function(ok) {
      if (ok) return;
      if (dontForce) return Promise.rejected( new Error("Not logged in to " + self.name) );
      return Util.openOAuthLogin(self.name,self.loginUrl,self.loginParams,self.dialogWidth, self.dialogHeight).then( function() {
        self.access_token = null; // reset from 'false'
        return self._withAccessToken( function() { // and get the token
          Util.message( "Logged in to " + self.name, Util.Msg.Status );
          return; 
        } ); 
      });
    });
  }

  // try to set access token without full login; return whether logged in or not.
  OAuthRemote.prototype.connect = function(verify) {
    var self = this;
    return self._withConnect( function(connected) { 
      if (!connected || !verify) return connected;
      return self.getUserInfo().then( function() {
        return true;
      }, function(err) {
        return false;
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