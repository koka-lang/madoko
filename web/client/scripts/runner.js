define(["../scripts/util","../scripts/onedrive","webmain"],
        function(util,onedrive,madoko) {

function Runner(ui) {
  var self = this;
  self.ui = ui;
  self.files = {};
  self.options = madoko.initialOptions();
  self.options.mathEmbedLimit = 256 * 1024;

  self.madokoWorker = new Worker("madoko-worker.js");
  self.madokoWorker.addEventListener("message", function(ev) {
    var res = ev.data;
    self.onMadokoComplete(res);
  });
}

Runner.prototype.onMadokoComplete = function(res) 
{
  var self = this;
  if (res.message) {
    util.message(" " + res.message);
  }
  if (res.content) {
    view.innerHTML = res.content;
    //MathJax.Hub.Queue(["Typeset",MathJax.Hub,"view"]); // schedule mathjax    
  }
  if (res.runOnServer) {
    self.serverRun(res.ctx);
  }
  if (res.time) {
    util.message(" time: " + res.time + "ms" );
  }
  if (res.filesRead && res.filesRead.length > 0) {
    //message("files read:\n  " + res.filesRead.join("\n  "));
    res.filesRead.forEach( function(file) {
      if (!(self.files[file])) {
        if (hasImageExt(file)) {
          self.loadImage(res.ctx.docInfo,file);
        }
        else if (hasTextExt(file)) {
          self.loadText(res.ctx.docInfo, file);
        }
      }
    });
  }
  if (self.ui) self.ui.completed(res.ctx);
}

Runner.prototype.runMadoko = function(text,ctx) 
{
  var self = this;
  util.message( "update " + ctx.round.toString() + " ..." );
  self.madokoWorker.postMessage( {
    content: text,
    ctx    : ctx,
    name   : ctx.docName,
    options: self.options,
    files  : self.files
  });
}

    
var imageExts = ["",".jpg",".png",".gif",".svg"].join(";");
function hasImageExt(fname) {
  return util.contains(imageExts,util.extname(fname));
}

var textExts = ["",".bib",".mdk",".md",".txt"].join(";");
function hasTextExt(fname) {
  return util.contains(textExts,util.extname(fname));
}

Runner.prototype.loadImage = function( docInfo, fname ) {
  var self = this;
  onedrive.getImageUrl( docInfo, fname, function(url) {
    self.options.imginfos = madoko.addImage(self.options.imginfos,fname,url);
  });
}

Runner.prototype.loadText = function( docInfo, fname ) {
  var self = this;
  onedrive.getFileInfo( docInfo, fname, function(info) {
    onedrive.readFile( info, function(data) {
      self.files[fname] = data;
    });
  });
}

// Called whenever the server needs to run madoko. The server can run:
// - bibtex: generates a document.bbl file on the server with typeset bibliographies.
//           for this to work, we need to send over a ".bib" file and potentially
//           a bibliography style file ".bst".
// - latex: formulas are typeset using latex. This generates a "document.dimx" file
//           containing all typeset formulas. For this to work, we may need to 
//           send extra style files (".sty") or class files (".cls"). 
Runner.prototype.serverRun = function(ctx) {
  var self = this;
  if (!self.ui.allowServer()) return;

  var text = this.ui.getEditText();

  // TODO: schedule run on server
  // send: document, and other files (like .bib and include files (but not images))    
  // receive back: document.dimx file (math content) and document.bbl (bibliography)
  var params = {};    
  params.docname = ctx.docName;
  params["/" + params.docname] = text;
  util.properties(self.files).forEach( function(fname) {
    if (hasTextExt(fname)) {
      params["/" + fname] = self.files[fname];
    }
  })

  $.post( "/rest/run", params, function(data,status,jqXHR) {
    util.message(data.stdout + data.stderr);
    util.properties(data).forEach(function(name) {
      if (name.substr(0,1) !== "/") return;
      //madoko.writeTextFile( name.substr(1), data[name] );
      util.message("write: " + name.substr(1) );
      self.files[name.substr(1)] = data[name];
    })
    //runMadoko(editor.getValue());
    self.ui.setStale();
  });
}

  
return {
  Runner: Runner,
};  

});