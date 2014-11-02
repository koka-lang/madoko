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


function getHeadCommitUrl(path) {
  var rpath = splitPath(path);
  return github.requestGET( "repos/" + rpath.owner + "/" + rpath.repo +
                             "/git/refs/heads/" + rpath.branch )
              .then( function(ref) {
    return ref.object.url;
  });
}

function withPathUrl( tree, path, action ) {
  for(var i = 0; i < tree.length; i++) {
    if (tree[i].path === path) return action(tree[i].url);
  }
  return Promise.rejected("File not found: " + path);
}

function pullFileUrl( url, binary ) {  
  var headers = { Accept: "application/vnd.github.3.raw" };
  return github.requestGET( { url: url, binary: binary, cache: 30000, headers: headers } ).then( function(content) {
    return {
      url: url,
      content: content,
    };
  });
}

function pullFile( tree, path, binary ) {
  return withPathUrl( tree, path, function(url) {
    return pullFileUrl( url, binary );
  });
}

function getCommitTree( commitUrl, path ) {
  return github.requestGET( { url: commitUrl, cache: 10000 } ).then( function(commit) {
    return github.requestGET( { url: commit.tree.url, cache: 10000 }, { recursive: 1 } ). then( function(tree) {
      return {
        commit: commit,
        tree  : tree.tree.filter( function(item) {
                  if (!Util.startsWith( item.path, path )) return false;
                  item.path = item.path.substr(path.length);
                  if (Util.startsWith(item.path,"/")) item.path = item.path.substr(1);
                  return true;
                }),
      };
    });
  });
}


function treeFind( tree, item ) {
  for( var i = 0; i < tree.length; i++ ) {
    if (tree[i].sha === item.sha) return true;
  }
  return false;
}

function treeUpdates( tree0, tree1 ) {
  return tree1.filter( function(item) {
    return !treeFind( tree0, item );
  });
}


/* ----------------------------------------------
   Main entry points
---------------------------------------------- */


function createAt( path ) {
  return getHeadCommitUrl(path).then( function(commitUrl) {
    return new Github(path,commitUrl);
  });
}

function unpersist(obj) {
  return new Github(obj.folder, obj.commit);
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

  function Github( path, commitUrl ) {
    var self     = this;
    self.path    = path || "";
    self.context = {
      commitUrl: commitUrl || "",
      tree: null,
      commit: null,
    };
  }

  Github.prototype.createNewAt = function(path) {
    return createAt(path);
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
  Github.prototype.canCommit = true;

  Github.prototype.getFolder = function() {
    var self = this;
    return self.path;
  }

  Github.prototype.persist = function() {
    var self = this;
    return { folder: self.path, commit: self.context.commitUrl };
  }

  Github.prototype.fullPath = function(fname) {
    var self = this;
    if (fname == null) fname = "";
    return Util.combine(self.path,fname);
  }

  Github.prototype.treePath = function(fname) {
    var self = this;
    var p = splitPath(self.fullPath(fname));
    return p.tpath;
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

  Github.prototype._withTree = function(action) {
    var self = this;
    if (self.context.tree) return action(self.context.tree, self.context.commit);
    return getCommitTree( self.context.commitUrl, self.treePath() ).then( function(info) {
      self.context.tree = info.tree;
      self.context.commit = info.commit;
      return action( info.tree, info.commit );
    });
  }

  Github.prototype.pushFile = function( fpath, content ) {
    var self = this;
    throw "not implemented";
  }

  Github.prototype.pullFile = function( fpath, binary ) {
    var self = this;
    return self._withTree( function(tree,commit) {
      return pullFile( tree, fpath, binary ).then( function(info) {
        var fullPath = self.fullPath(fpath);
        return {
          path: fpath,
          content: info.content,
          url: info.url,
          createdTime: Util.dateFromISO(commit.committer.date),
          globalPath: "//github/shared/" + self.fullPath(fpath),
          //sharedPath: sharedPath,
        };
      });
    });
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

  Github.prototype.pull = function(action) {
    var self = this;
    return getHeadCommitUrl(self.path).then( function(commitUrl) {
      if (self.context.commitUrl === commitUrl) return action(null); // same commit
      return self._withTree( function(tree,commit) {
        return getCommitTree( commitUrl, self.treePath() ).then( function(info) {
          var updateInfo = {
            commit  : info.commit,
            tree    : info.tree,
            updates : treeUpdates( tree, info.tree ),
          };
          // update context .. but restore if action fails
          var oldContext = self.context;
          self.context = {
            commitUrl: commitUrl,
            tree: info.tree,
            commit: info.commit,
          };
          return Promise.wrap( action, updateInfo ).then( function(x) { return x; }, function(err) {
            self.context = oldContext; // restore old context
            throw err; // re-throw
          });
        });
      });  
    });
  }


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