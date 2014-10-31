/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util","../scripts/oauthRemote"], 
        function(Promise,Util,OAuthRemote) {

var github = new OAuthRemote( {
  name         : "github",
  defaultDomain: "https://api.github.com/",
  accountUrl   : "user",
  loginUrl     : "https://github.com/login/oauth/authorize",
  loginParams  : {
    client_id: "9c24f7ac71d1ede26ba3",
    scope    : "repo",
  },
  logoutUrl    : "https://github.com/logout",
  logoutTimeout: 5000,
  dialogHeight : 800,
  dialogWidth  : 800,
  headers: {
    "Accept"    : "application/vnd.github.v3+json",
  },
});


/* ----------------------------------------------
  Basic file API
---------------------------------------------- */

function getRepos() {
  return github.requestGET("user/repos");
}

function getBranches(owner,repo) {
  return github.requestGET("repos/" + owner + "/" + repo + "/git/refs/heads");
}

function getItems( owner, repo, branch, tpath, full ) {
  if (!branch) branch = "master";
  return github.requestGET( "repos/" + owner + "/" + repo + "/git/trees/" + branch, 
                            (full || tpath) ? { recursive: 1 } : {} ).then( function(tree) {
    var items = tree.tree;
    if (!tpath) return items;
    return items.filter( function(item) {
      return Util.dirname(item.path) === tpath;
    });
  });
}


function splitPath(path) {
  var parts = path.split("/");
  return {
    owner : parts[0],
    repo  : parts[1],
    branch: parts[2],
    tpath : parts.slice(3).join("/"),
  };
}

function joinPath(p) {
  return [p.owner,p.repo,p.branch,p.tpath].join("/");
}

function getListing(path) {
  return github.getUserLogin().then( function(login) {
    var p = splitPath(path);
    if (!p.owner) {
      return [{
        path: login,
        type: "folder.owner",
        readOnly: false,
        isShared: false,
      }];
    }
    else if (!p.repo) {
      if (p.owner === login) {
        return getRepos().then( function(repos) {
          return repos.map( function(repo) {
            return {
              type: "folder.repo",
              path: repo.full_name,
              readonly: !repo.permissions.push,
              isShared: repo.private,
            };
          });
        });
      }
    }
    else if (!p.branch) {
      return getBranches(p.owner,p.repo).then( function(branches) {
        return branches.map(function(branch) {
          return {
            type: "folder.branch",
            path: path + "/" + Util.basename(branch.ref),
            url : branch.url,            
          };
        });
      }); 
    }
    else {
      return getItems(p.owner,p.repo,p.branch,p.tpath).then( function(items) {
        return items.map( function(item) {
          var q = Util.copy(p);
          q.tpath = item.path;
          return {
            type: (item.type === "blob" ? "file" : "folder"),
            path: joinPath(q),
            url : item.url,
            readonly: Util.endsWith(item.mode,"755"),
          };
        });
      });
    }
  });
}


/* ----------------------------------------------
   Main entry points
---------------------------------------------- */


function createAt( folder ) {
  throw "not implemented"
}

function unpersist(obj) {
  return new Github(obj.folder);
}

function type() {
  return github.name;
}

function logo() {
  return github.logo;
}

/* ----------------------------------------------
   Github remote object
---------------------------------------------- */

var Github = (function() {

  function Github( folder ) {
    var self = this;
    self.folder = folder || "";
  }

  Github.prototype.createNewAt = function(folder) {
    return createAt(folder);
  }

  Github.prototype.type = function() {
    return type();
  }

  Github.prototype.logo = function() {
    return logo();
  }

  Github.prototype.readonly = false;
  Github.prototype.canSync  = false;
  Github.prototype.needSignin = true;

  Github.prototype.getFolder = function() {
    var self = this;
    return self.folder;
  }

  Github.prototype.persist = function() {
    var self = this;
    return { folder: self.folder };
  }

  Github.prototype.fullPath = function(fname) {
    var self = this;
    return Util.combine(self.folder,fname);
  }

  Github.prototype.connect = function() {
    return github.connect();
  }

  Github.prototype.login = function() {
    return github.login();
  }

  Github.prototype.logout = function(force) {
    return github.logout(force);
  }

  Github.prototype.getUserName = function() {
    return github.getUserName();
  }

  Github.prototype.pushFile = function( fpath, content ) {
    var self = this;
    throw "not implemented";
  }

  Github.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    throw "not implemented";
  }

  Github.prototype.getRemoteTime = function( fpath ) {    
    var self = this;
    throw "not implemented";
  }

  Github.prototype.createSubFolder = function(dirname) {
    var self = this;
    throw "not implemented";
  }

  Github.prototype.listing = function( fpath ) {
    var self = this;
    return getListing(self.fullPath(fpath));
  }

  Github.prototype.getShareUrl = function(fname) {
    var self = this;
    return null;
  };

  return Github;
})();   



return {
  createAt : createAt,
  unpersist: unpersist,
  type     : type,
  logo     : logo,
  Github  : Github,
}

});