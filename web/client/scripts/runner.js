define(["../scripts/util","../scripts/onedrive","webmain"],
        function(util,onedrive,madoko) {

  var files = {};
  var options = madoko.initialOptions();
  options.mathEmbedLimit = 256 * 1024;
    
  var imageExts = ["",".jpg",".png",".gif",".svg"].join(";");
  function hasImageExt(fname) {
    return util.contains(imageExts,util.extname(fname));
  }

  var textExts = ["",".bib",".mdk",".md",".txt"].join(";");
  function hasTextExt(fname) {
    return util.contains(textExts,util.extname(fname));
  }


  // Called whenever the server needs to run madoko. The server can run:
  // - bibtex: generates a document.bbl file on the server with typeset bibliographies.
  //           for this to work, we need to send over a ".bib" file and potentially
  //           a bibliography style file ".bst".
  // - latex: formulas are typeset using latex. This generates a "document.dimx" file
  //           containing all typeset formulas. For this to work, we may need to 
  //           send extra style files (".sty") or class files (".cls"). 
  function serverRun(ui,ctx) {
    if (!ui.allowServer()) return;

    var text = ui.getEditText();

    // TODO: schedule run on server
    // send: document, and other files (like .bib and include files (but not images))    
    // receive back: document.dimx file (math content) and document.bbl (bibliography)
    var params = {};    
    params.docname = ctx.docName;
    params["/" + params.docname] = text;
    util.properties(files).forEach( function(fname) {
      if (hasTextExt(fname)) {
        params["/" + fname] = files[fname];
      }
    })

    $.post( "/rest/run", params, function(data,status,jqXHR) {
      util.message(data.stdout + data.stderr);
      util.properties(data).forEach(function(name) {
        if (name.substr(0,1) !== "/") return;
        //madoko.writeTextFile( name.substr(1), data[name] );
        util.message("write: " + name.substr(1) );
        files[name.substr(1)] = data[name];
      })
      //runMadoko(editor.getValue());
      ui.setStale();
    });
  }

  function loadImage( docInfo, fname ) {
    onedrive.getImageUrl( docInfo, fname, function(url) {
      options.imginfos = madoko.addImage(options.imginfos,fname,url);
    });
  }

  function loadText( docInfo, fname ) {
    onedrive.getFileInfo( docInfo, fname, function(info) {
      onedrive.readFile( info, function(data) {
        files[fname] = data;
      });
    });
  }

  function init(ui) {
    var madokoWorker = new Worker("madoko-worker.js");
    madokoWorker.addEventListener("message", function(ev) {
      var res = ev.data;
      if (res.message) {
        util.message(" " + res.message);
      }
      if (res.content) {
        view.innerHTML = res.content;
        //MathJax.Hub.Queue(["Typeset",MathJax.Hub,"view"]); // schedule mathjax    
      }
      if (res.runOnServer) {
        serverRun(ui,res.ctx);
      }
      if (res.time) {
        util.message(" time: " + res.time + "ms" );
      }
      if (res.filesRead && res.filesRead.length > 0) {
        //message("files read:\n  " + res.filesRead.join("\n  "));
        res.filesRead.forEach( function(file) {
          if (!(files[file])) {
            if (hasImageExt(file)) {
              loadImage(res.ctx.docInfo,file);
            }
            else if (hasTextExt(file)) {
              loadText(res.ctx.docInfo, file);
            }
          }
        });
      }
      ui.completed(res.ctx);
    });

    function runMadoko(text,ctx) {
      util.message( "update " + ctx.round.toString() + " ..." );
      madokoWorker.postMessage( {
        content: text,
        name   : ctx.docName,
        options: options,
        ctx    : ctx,
        files  : files
      });
    }

    return runMadoko;
  }
  
  return {
    init: init,
  };  
});