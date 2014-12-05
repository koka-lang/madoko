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
  return github.requestGET( { url: "user/repos", cache: 10000 }, { per_page:100 } );
}

function getBranches(repoPath) {
  return github.requestGET( { url: repoPath + "/git/refs/heads", cache: 10000 }, { per_page:100 } );
}

function getItems( repoPath, branch, tpath, full ) {
  if (!branch) branch = "master";
  return github.requestGET( {url: repoPath + "/git/trees/" + branch, cache: 10000 },
                            (full || tpath) ? { recursive: 1 } : {} ).then( function(tree) {
    var items = tree.tree;
    if (!tpath) return items;
    return items.filter( function(item) {
      return Util.dirname(item.path) === tpath;
    });
  });
}


function getAllRepos() {
  return github.requestGET( { url: "user/orgs", cache: 10000 }, { per_page:100 } ).then(function(orgs) {
    var getrepos = orgs.map( function(org) { return github.requestGET( { url: org.url + "/repos", cache: 10000 }, { per_page:100 } ); } );
    getrepos.unshift( getRepos() );
    return Promise.when( getrepos ).then( function(reposs) {
      return [].concat.apply([],reposs);
    });
  });
}

function splitPath(path) {
  var parts = path.split("/");
  var p = {
    repo  : parts[0] ? decodeURIComponent(parts[0]) : "",    
    branch: parts[1] ? decodeURIComponent(parts[1]) : "",
    tpath : parts.slice(2).join("/"),
  };
  p.repoPath = "repos/" + p.repo;
  return p;
}

function joinPath(p) {
  return [encodeURIComponent(p.repo),encodeURIComponent(p.branch),p.tpath].join("/");
}

function normalizePath(path) {
  var p = splitPath(path);
  return [p.repo,p.branch,p.tpath].filter(function(s) { return (s != ""); }).join("/");
}

function getListing(path) {
  return github.getUserInfo().then( function(info) {
    var p = splitPath(path);
    if (!p.repo) {
      return getAllRepos().then( function(repos) {
        return repos.map( function(repo) {
          return {
            type: "folder.repo",
            path: encodeURIComponent(repo.full_name),
            display: repo.full_name,
            readonly: !repo.permissions.push,
            isShared: !repo.private,
          };
        });
      });
    }
    else if (!p.branch) {
      return getBranches(p.repoPath).then( function(branches) {
        return branches.map(function(branch) {
          var branchName = branch.ref.split("/").slice(2).join("/");
          return {
            type: "folder.branch",
            path: encodeURIComponent(p.repo) + "/" + encodeURIComponent(branchName),
            display: branchName,
            url : branch.url,
          };
        });
      }); 
    }
    else {
      return getItems(p.repoPath,p.branch,p.tpath).then( function(items) {
        return items.map( function(item) {
          var q = Util.copy(p);
          q.tpath = item.path;
          return {
            type: (item.type === "blob" ? "file" : "folder"),
            path: joinPath(q),
            sha : item.sha,
            readonly: Util.endsWith(item.mode,"755"),
          };
        });
      });
    }
  });
}


function getHeadCommitUrl(path) {
  var p = splitPath(path);
  return github.requestGET( p.repoPath + "/git/refs/heads/" + p.branch ).then( function(ref) {
    return ref.object.url;
  });
}

function withPathUrl( tree, path, action ) {
  for(var i = 0; i < tree.length; i++) {
    if (tree[i].path === path) return action(tree[i].url, tree[i] );
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
  return withPathUrl( tree, path, function(url, info) {
    return pullFileUrl( url, binary ).then( function(item) {
      item.sha = info.sha;
      return item;
    });
  });
}

function pushBlob( path, content, encoding ) {
  var p = splitPath(path);
  return github.requestPOST( p.repoPath + "/git/blobs", {}, { content: content, encoding: encoding || "utf-8" }).then( function(blob) {
    if (blob) {
      blob.path = p.tpath;
      blob.type = "blob";
      blob.mode = "100644";
      blob.content = content;
      blob.encoding = encoding;
    }
    return blob;
  });
}

function createTree( path, baseTreeSha, blobs ) {
  var p = splitPath(path);
  var tree = blobs.map( function(blob) {
    return {
      path: blob.path,
      mode: blob.mode || "100644",
      type: blob.type || "blob",
      sha : blob.sha,
    };
  });
  return github.requestPOST( p.repoPath + "/git/trees", {},
                             { tree: tree, base_tree: baseTreeSha } );
}

function createCommit( path, message, treeSha, parents ) {
  var p = splitPath(path);
  return github.requestPOST( p.repoPath + "/git/commits", {},
                             { message: message, tree: treeSha, parents: parents} );
}

function updateHead( path, commitSha ) {
  var p = splitPath(path);
  return github.requestXHR( { method: "PATCH", url: p.repoPath + "/git/refs/heads/" + p.branch }, {},
                            { sha: commitSha, force: false } );
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


function getCommits( path, commit ) {
  var p = splitPath(path);
  return github.requestGET( p.repoPath + "/commits", 
                            { path: p.tpath, since: commit.committer.date } ).then( function(commits) {
    commits.pop(); // do not include our latest commit
    return commits;
  });
}

var Change = { Add: "add", Update: "update", Delete: "delete", None: "none" };

// find the changed item with respect to a tree
// : [{path,sha}], [{path,sha}] -> [{path,sha,update}]
function treeChange( tree, item ) {
  for( var i = 0; i < tree.length; i++ ) {
    if (tree[i].sha === item.sha) return Change.None;
    if (tree[i].path === item.path) return Change.Update;
  }
  return Change.Add;
}

function findChanges( tree, items ) {
  var changes = [];
  items.forEach( function(item) {
    var change = treeChange(tree,item);
    if (change && change !== Change.None) {
      changes.push({ 
        path: item.path, 
        sha: item.sha, 
        change: change,
        // the following fields may or may not be there
        type: item.type,
        content: item.content,
        encoding: item.encoding
      });    
    }
  });
  return changes;
}

// Get the updated items in a tree
function treeUpdates( tree0, tree1 ) {
  return findChanges(tree0,tree1).filter( function(change) {
    return (change.type === "blob");
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

  Github.prototype.readonly   = false;
  Github.prototype.canSync    = true;
  Github.prototype.needSignin = true;
  Github.prototype.canCommit  = true;

  Github.prototype.getFolder = function() {
    var self = this;
    return self.path;
  }

  Github.prototype.getDisplayFolder = function() {
    var self = this;
    return normalizePath(self.path);
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
        return {
          path: fpath,
          content: info.content,
          sha: info.sha,
          createdTime: Util.dateFromISO(commit.committer.date),
          globalPath: "//github/shared/" + normalizePath(self.fullPath(fpath)),
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
    return Promise.resolved(null);
  };

  Github.prototype.isAtHead = function() {
    var self = this;
    return getHeadCommitUrl(self.path).then( function(commitUrl) {
      return (self.context.commitUrl === commitUrl);
    });
  }

  Github.prototype.pull = function(action) {
    var self = this;
    return getHeadCommitUrl(self.path).then( function(commitUrl) {
      if (self.context.commitUrl === commitUrl) return action(null); // same commit
      return self._withTree( function(tree,commit) {
        return getCommits( self.path, commit ).then( function(commits) {
          return getCommitTree( commitUrl, self.treePath() ).then( function(info) {
            var updateInfo = {
              commit  : info.commit,
              tree    : info.tree,
              updates : treeUpdates( tree, info.tree ),
              commits : commits.map( function(commit) {
                return { 
                  message: commit.commit.message,
                  author : commit.commit.author,
                };
              }),
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
    });
  }

  Github.prototype.getChanges = function(files) {
    var self = this;
    return self._withTree( function(tree,commit) {
      return Promise.resolved(findChanges(tree,files));
    });
  }

  Github.prototype.commit = function( message, changes ) {
    var self = this;
    return self._withTree( function(tree,commit) {
      var pushBlobs = changes.map( function(change) { 
        return pushBlob(self.fullPath(change.path),change.content,change.encoding).then( function(blob) {
          blob.localPath = change.path;
          return blob;
        }); 
      });
      return Promise.when( pushBlobs ).then(function(blobs) {
        return createTree(self.path,commit.tree.sha, blobs).then(function(newTree) {
          return createCommit(self.path,message,newTree.sha,[commit.sha]).then(function(newCommit) {
            return updateHead(self.path,newCommit.sha).then(function() {
              // update ourself to the latest commit
              return getCommitTree( newCommit.url, self.treePath() ).then( function(info) {
                self.context = {
                  commitUrl: newCommit.url,
                  commit: info.commit,
                  tree: info.tree,
                };
                // return commit info so we can update the file modified flags.
                return {
                  committed: true,
                  date: Util.dateFromISO(commit.committer.date),
                  blobs: blobs.map( function(blob) { 
                    blob.path = blob.localPath;
                    delete blob.localPath;
                    return blob;
                  }),
                };
              });
            }, function(err) {
              if (err && err.httpCode === 422) {  // updates in the meantime
                return { committed: false };
              }
              throw err;
            });
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
  Github   : Github,
  Change   : Change,
}

});