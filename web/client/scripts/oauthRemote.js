/*---------------------------------------------------------------------------
  Copyright 2013-2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util"], function(Promise,Util) {

var OAuthRemote = (function() {

  function OAuthRemote(opts) {
    var self = this;
    
    self.name           = opts.name;
    self.displayName    = opts.displayName || Util.capitalize(opts.name);
    self.logo           = opts.logo || ("icon-" + self.name + ".png");
    self.defaultDomain  = opts.defaultDomain;
    self.loginUrl       = opts.loginUrl;
    self.loginParams    = opts.loginParams || {};
    self.logoutParams   = opts.logoutParams || {};
    self.logoutUrl      = opts.logoutUrl;
    self.logoutTimeout  = opts.logoutTimeout || false;
    self.revokeUrl      = opts.revokeUrl;
    self.useAuthHeader  = (opts.useAuthHeader !== false);
    self.headers        = opts.headers || {};
    self.dialogWidth    = opts.dialogWidth || 600;
    self.dialogHeight   = opts.dialogHeight || 600;
    self.timeout        = opts.timeout || 10000;  // should be short, real timeout can be 3 times as large, see primRequestXHR

    self.canRefresh     = false;
    self.access_token   = null;
    self.user           = {};    

    if (!self.loginParams.origin) {
      if (!self.loginParams.redirect_uri)  {
        self.loginParams.redirect_uri  = location.protocol + "//" + location.hostname + (location.port ? ':' + location.port : "") + "/oauth/redirect";
      }
      if (!self.loginParams.response_type) {
        self.loginParams.response_type = "code";
      }
    
      if (!self.logoutParams.client_id) self.logoutParams.client_id = self.loginParams.client_id;
      if (!self.logoutParams.redirect_uri) self.logoutParams.redirect_uri = self.loginParams.redirect_uri;
    }
    else {
      window.addEventListener( "message", function(ev) {
        console.log("message post: " + ev.data + ", src: " + ev.origin);
        if (ev.origin !== self.defaultDomain) return;
        if (typeof ev.data !== "string" ) return;
        // check ev.source too?
        var info = JSON.parse(ev.data);
        if (info.eventType  === "oauth") {
          if (info.secret) self.access_token = info.secret;
        }
      });
    }

    self.nextTry     = 0;     // -1: never try (on logout), 0: try always, N: try if Date.now() < N
    self.lastTryErr  = null;
    self.tryDelay    = 30000; 
    self.logoutErr   = { httpCode: 401, message: "Not logged in to " + self.displayName };
  }

  OAuthRemote.prototype._getLocalLogin = function() {
    var self = this;
    return localStorage.getItem("remote-" + self.name);
  }
  OAuthRemote.prototype._setLocalLogin = function(login) {
    var self = this;
    return localStorage.setItem("remote-" + self.name,login);
  }
  OAuthRemote.prototype._clearLocalLogin = function() {
    var self = this;
    localStorage.removeItem("remote-" + self.name);
  }

  OAuthRemote.prototype._updateLogin = function(info) {
    var self = this;
    if (info.access_token) self.access_token = info.access_token;
    if (info.can_refresh) self.canRefresh = info.can_refresh;
    if (info.uid) self.user.id = info.uid;
    if (info.name) self.user.name = info.name;
    if (info.email) self.user.email = info.email;
    if (info.avatar) self.user.avatar = info.avatar;
    if (info.xlogin) self._setLocalLogin(info.xlogin);
    Util.message("Connected to " + self.displayName, Util.Msg.Status );          
  }

  // try to set access token without full login; call action with connected or not.
  // if not connected, also apply the error.
  OAuthRemote.prototype._withConnect = function(action) {
    var self = this;
    if (self.access_token) return Promise.wrap(action, true);
    // are we logged in at all?
    var login = self._getLocalLogin();
    if (!login) return Promise.wrap(action,false,self.logoutErr);
    // get decrypted access token 
    return Util.requestPOST("/oauth/token",{}, { xlogin: login }).then( function(res) {
      if (!res || typeof(res.access_token) !== "string") {
        // invalid response?
        return self.logout().then( function() {
          return action(false, self.logoutErr);
        });
      }
      else {
        self._updateLogin(res);
        return action(true);
      }
    }, function(err) {
      if (err && err.httpCode === 401 /* expired */) {
        return self.logout().then( function() {
          return action(false,err);
        });
      }
      else return action(false,err);
    });
  }

  OAuthRemote.prototype._withAccessToken = function(action) {
    var self = this;
    return self._withConnect( function(connected,err) {
      if (!connected || !self.access_token) throw err;
      return action(self.access_token);
    });
  }

  OAuthRemote.prototype._primRequestXHR = function(options,params,body,recurse) {
    var self = this;
    return Util.requestXHR( options, params, body ).then( null, function(err) {
      // err.message.indexOf("request_token_expired") >= 0
      if (err) {
        if (err.httpCode === 401) { // access denied: usually caused by an expired access token 
          if (!recurse && self.canRefresh) {
            return self.refresh().then( function() {
              console.log("refreshed token; try again. " + options.url);
              return self._primRequestXHR(options,params,body,true);
            }, function(err2) {
              self.logout();
              throw err;
            });
          }
          self.logout();
          throw err;
        }
        else if (!recurse && err.httpCode===500) { // internal server error, try once more
          console.log("internal server error; try again. " + options.url);
          return Promise.delayed(250).then( function() {
            return self._primRequestXHR(options,params,body,true);
          });
        }
        else if (!recurse && err.httpCode===408 && options.timeout != null && options.timeout <= self.timeout) { // request timed out on short timeout
          options.timeout = options.timeout*2; // try once more with longer timeout
          console.log("request timed out; try again. " + options.url);
          return self._primRequestXHR(options,params,body,true);
        }
        else if (!recurse && err.message && /re-issue (the )? request/.test(err.message)) { // dropbox returns this for failed locks, try again
          console.log("request failed to grab a lock; try again. " + options.url);
          return Promise.delayed(250).then( function() {
            return self._primRequestXHR(options,params,body,true);
          });
        }
      }
      throw err;
    });
  }

  OAuthRemote.prototype.requestXHR = function( options, params, body ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    if (!options.headers) options.headers = self.headers;
    return self._withAccessToken( function(token) {
      if (options.useAuthHeader !== false && self.useAuthHeader) {
        options.headers.Authorization = "Bearer " + token;
      }  
      else {
        if (!params) params = {};
        params.access_token = token;
      }
      if (options.timeout==null) {
        options.timeout = self.timeout;
      }
      if (self.defaultDomain && options.url && !Util.startsWith(options.url,"http")) {
        options.url = self.defaultDomain + options.url;
      }
      return self._primRequestXHR(options,params,body,false);
    });
  }

  OAuthRemote.prototype.requestPOST = function( options, params, content ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    options.method = "POST";
    return self.requestXHR(options,params,content);
  }

  OAuthRemote.prototype.requestPUT = function( options, params, content ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    options.method = "PUT";
    return self.requestXHR(options,params,content);
  }

  OAuthRemote.prototype.requestGET = function( options, params ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    options.method = "GET";
    if (options.contentType === undefined) options.contentType = ";";
    return self.requestXHR(options,params);
  }

  OAuthRemote.prototype.requestDELETE = function( options, params ) {
    var self = this;
    if (typeof options === "string") options = { url: options };
    options.method = "DELETE";
    return self.requestXHR(options,params);
  }

  OAuthRemote.prototype.refresh = function() {
    var self = this;
    if (!self.canRefresh) throw new Error("Cannot refresh access token for '" + self.displayName + "'");
    var login = self._getLocalLogin();
    return Util.requestPOST("/oauth/refresh",{}, { xlogin: login}).then( function(res) {
      if (!res || typeof(res.access_token) !== "string") {
        throw new Error("Unable to refresh access token for '" + self.displayName + "'");
      }
      self._updateLogin(res);
      Util.message("Reconnected to " + self.displayName, Util.Msg.Status );
      return;
    });
  }

  OAuthRemote.prototype._revoke = function(token) {
    var self = this;
    if (self.revokeUrl && token) {
      var options = {
        url: self.revokeUrl,
        headers: { Authorization: "Bearer " + token },
      }
      return Util.requestPOST( options ).then( function() {}, function(err) {
        if (err && err.httpCode === 401) return; // sometimes we revoke in parallel and some will fail
        throw err;
      });
    }
    else if (self.revokeUrl === null || // for some remotes (ie. github) the client_secret is required
              (self.revokeUrl && token === null)) { // never got the token back, but still expired
      var login = self._getLocalLogin();
      return Util.requestPOST( "/oauth/revoke", {}, { xlogin: login } ); 
    }
    else {
      return Promise.resolved();
    }
  }
  
  OAuthRemote.prototype.logout = function(force) {
    var self  = this;
    var token = self.access_token;
    self.access_token = null;
    self.canRefresh = false;
    self.user = {};    
    return self._revoke(token).always( function() {
      self._clearLocalLogin();
      return (force && self.logoutUrl ? Util.openOAuthLogout(self.name, { url: self.logoutUrl, width: self.dialogWidth, height: self.dialogHeight, timeout: self.logoutTimeout }, self.logoutParams ) : Promise.resolved()).always( function() {
        Util.message("Logged out from " + self.displayName, Util.Msg.Status);
        return;
      });
    });
  }

  // Do a full login. 
  OAuthRemote.prototype.login = function() {
    var self = this;
    if (self.access_token) return Promise.resolved();
    return Util.openOAuthLogin(self.name, { url: self.loginUrl, width: self.dialogWidth, height: self.dialogHeight }, self.loginParams).then( function() {
      self.access_token = null;
      return self._withAccessToken( function() { // and get the token
        Util.message( "Logged in to " + self.displayName, Util.Msg.Status );
        return; 
      }); 
    });
  }

  // try to set access token without full login; return status code: 0 = ok, 401 = logged out, 400 = network failure.
  OAuthRemote.prototype.connect = function() {
    var self = this;
    return self._withConnect( function(connected,err) { 
      if (!connected) return (err.httpCode || 401);
      return 0;      
    });
  }

  OAuthRemote.prototype.withUserId = function(action) {
    var self = this;
    return Promise.wrap(action, self.user.id);
  }

  OAuthRemote.prototype.getUserName = function() {
    var self = this;
    return Promise.resolved(self.user.name);
  }

  OAuthRemote.prototype.getUserInfo = function() {
    var self = this;
    return Promise.resolved(self.user);
  }

  return OAuthRemote;
})();


return OAuthRemote;

});