define(["../scripts/util"], function(util) {

  function onedriveFail(res) {
    res = (res.error && res.error.message ? res.error.message : res);
    util.message("onedrive error: " + res);
  }

  function get( path, cont, errmsg ) {
    WL.api( { path: path, method: "GET" }).then(cont, function(resFail) {
      var msg = resFail;
      if (resFail.error && resFail.error.message) {
        msg = resFail.error.message + (resFail.error.code ? " (" + resFail.error.code + ")" : "");
      }
      onedriveFail( (errmsg ? errmsg + ": " : "") + msg );
    });
  }

    // todo: abstract folderId and WL.getSession(). implement subdirectories.
  function getFileInfo( parentInfo, path, cont ) {  
    folderId = parentInfo.parent_id;
    if (!folderId) return;

    get( folderId + "/files", function(res) {
      var file = null;
      if (res.data) {
        for (var i = 0; i < res.data.length; i++) {
          var f = res.data[i];
          if (f.name == path) {
            file = f;
            break;
          }
        }
      }
      if (!file) return onedriveFail("unable to find: " + path);
      cont(file);
    }, "/files");
  }

  function getImageUrl( parentInfo, path, cont ) {
    getFileInfo( parentInfo, path, function(info) {
      var url = onedriveDomain + info.id + "/picture?type=full&access_token=" + WL.getSession().access_token;
      cont(url);
    })
  }

  function readFile( finfo, cont ) {
    $.get( "onedrive", { url: finfo.source }, cont);
  }

  var onedriveDomain = "https://apis.live.net/v5.0/"

  function getFileInfoFromId( file_id, cont ) {
    WL.api( { path: file_id, method: "GET" } ).then(
      function(res) {
        cont(res);
      },
      function(resFail) { 
        onedriveFail(resFail); 
      } 
    );
  }

  function fileDialog( cont ) {
    WL.fileDialog( {
      mode: "open",
      select: "single",
    }).then( function(res) 
    {
      if (!(res.data && res.data.files && res.data.files.length==1)) return onedriveFail("no file selected");
      var file = res.data.files[0];
      getFileInfoFromId( file.id, function(info) {
        cont(info.name,info);
      });
    }, onedriveFail );
  }

  
  /*
  function onedriveGetFiles( fs ) {
    fs.forEach( function(file) {
      onedriveGetFileContent(file, function(body) {
        //madoko.writeTextFile( file.path, body );
        files[file.path] = body;
      });
    });
  }

  
  function onedriveListFiles( folder, cont ) {
    WL.api( { path: folder.id + "/files", method: "GET" } )
     .then( function(res) {
        var files = [];
        res.data.forEach( function(f) {
          if (f.type && f.type=="file") {
            f.path = f.name;
            files.push(f);
          };
          if (f.type && f.type=="photo") {
            var url = onedriveDomain + f.id + "/picture?type=full&access_token=" + WL.getSession().access_token;
            document.getElementById("testimg").src = url;
          };
        });
        cont(files);
     },
     onedriveFail );
  }
  */

  function init(options) {
    if (!options.response_type) options.response_type = "token";
    if (!options.scope) options.scope = ["wl.signin","wl.skydrive"];
    WL.init(options);
  }

  return {
    init: init,
    getFileInfo: getFileInfo,
    getImageUrl: getImageUrl,
    readFile: readFile, 
    fileDialog: fileDialog,
  }
});