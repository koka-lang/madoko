define(["../scripts/util","../scripts/onedrive","../scripts/madokoMode"],
        function(util,onedrive,madokoMode) {

  var runMadoko;
  var editor;
  var refreshContinuous = true;
  var allowServer = true;

  function init( _runMadoko ) {
    runMadoko = _runMadoko;

    editor  = Monaco.Editor.create(document.getElementById("editor"), {
      value: document.getElementById("initial").textContent,
      mode: "text/x-web-markdown",
      theme: "vs",
      lineNumbers: false,
      mode: madokoMode.mode,
      tabSize: 4,
      insertSpaces: false,
      automaticLayout: true,
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
        //verticalHasArrows: true,
        //horizontalHasArrows: true,
        //arrowSize: 10,
      }
    });

    editor.addListener("scroll", function (e) {
      var view = editor.getView();
      var lines = view.viewLines;
      var rng = lines._currentVisibleRange;
      syncView(rng.startLineNumber, rng.endLineNumber);    
    });

    onedrive.init({
      client_id: "000000004C113E9D",
      redirect_uri: "http://madoko.cloudapp.net:8080/redirect", //"https://login.live.com/oauth20_desktop.srf",                     
      scope: ["wl.signin","wl.skydrive"],
    });
   
    setInterval(update, refreshRate);
    
    document.getElementById('checkContinuous').onchange = function(ev) { 
      refreshContinuous = ev.target.checked; 
    };

    document.getElementById('checkAllowServer').onchange = function(ev) { 
      allowServer = ev.target.checked; 
    };

    document.getElementById("onedrive-download").onclick = function(ev) {
      onedrivePickFile();
    };

    var buttonEditorNarrow = document.getElementById("button-editor-narrow");
    var buttonEditorWide = document.getElementById("button-editor-wide");

    var triLeft   = "<div class='tri-left'></div>";
    var triRight  = "<div class='tri-right'></div>";
    var triUp     = "<div class='tri-up'></div>";
    var triDown   = "<div class='tri-down'></div>";
   
    util.toggleButton( "button-updown", triUp, triDown, function(ev) {
      util.toggleClassName(cons,"short");
      util.toggleClassName(view,"short");       
    });

    util.toggleButton( buttonEditorNarrow, triLeft, triRight, function(ev,toggled) {
      if (toggled) {
        util.addClassName(viewpane,"wide");
        util.addClassName(editpane,"narrow");
        util.addClassName(buttonEditorWide,"hide");
      }
      else {
        util.removeClassName(viewpane,"wide");
        util.removeClassName(editpane,"narrow");
        util.removeClassName(buttonEditorWide,"hide");
      }
    });

    util.toggleButton( buttonEditorWide, triRight, triLeft, function(ev,toggled) {
      if (toggled) {
        util.addClassName(viewpane,"narrow");
        util.addClassName(editpane,"wide");
        util.addClassName(buttonEditorNarrow,"hide");
      }
      else {
        util.removeClassName(viewpane,"narrow");
        util.removeClassName(editpane,"wide");
        util.removeClassName(buttonEditorNarrow,"hide");
      }
    });

  }

  // Called whenever the text buffer changes.
  // TODO: can we run this invoked by the editor instead of an interval?
  // and should we run in a worker perhaps?
  var text0 = "";     // text from the previous round
  var stale = true;   // is the view stale with respect to the current text?

  var refreshRate = 500;
  
  var lastRound = 0;  
  var round = lastRound;
  var staleTime = Date.now();
  function update() {
    var text = editor.getValue();
    if (text != text0) {   // set stale but do not update yet (as long as the user types)
      stale = true;      
      staleTime = Date.now();
      text0 = text;
      if (!refreshContinuous) return;
    }
    if (stale && (round == lastRound || Date.now() > staleTime + 5000)) {
      stale = false;
      round++;
      runMadoko(text,round)
    }
  }

  function completed( r ) {
    lastRound = r;
  }

  function setStale() {
    stale = true;
  }

  function editFile( text ) {
    editor.model.setValue(text);
  }

  // Insert some text in the document 
  function documentInsert( txt ) {
    var pos = editor.viewModel.cursors.lastCursorPositionChangedEvent.position;
    editor.model._insertText([],pos,txt);
  }

  // Called when a user selects an image to insert.
  function insertImages(evt) {
    var files = evt.target.files; // FileList object

    // files is a FileList of File objects. List some properties.
    for (var i = 0, f; f = files[i]; i++) {
        // Only process image files.
        if (!f.type.match('image.*')) {
          continue;
        }
    
        var reader = new FileReader();

        // Closure to capture the file information.
        reader.onload = (function(file) {
          return function(loadEvt) {
            var content  = loadEvt.target.result;
            var fileName = imgDir + "/" + file.name;
            var name     = stdpath.stemname(file.name); 
            //stdcore.println("image: " + fileName);
            options.imginfos = madoko.addImage(options.imginfos,fileName,content);
            documentInsert( "![" + name + "]\n\n[" + name + "]: " + fileName + ' "' + name + '"\n' );
            //madoko.writeTextFile(file.name,content);
          };
        })(f);

        // Read in the image file as a data URL.
        reader.readAsDataURL(f);
    }
  }

  var lastScroll = null;
  function syncView( startLine, endLine ) {
    var elem = $('#view').children(':first');
    $('#view *[data-line]').each( function() {
      var line = parseInt($(this).attr("data-line"));
      if ((line && !isNaN(line) && line <= startLine)) {
        elem=$(this);
      }
      if (line >= startLine) {
        return false;      
      } 
    });
    if (elem && elem[0] !== lastScroll) {
      lastScroll = elem[0];
      var topMargins = (elem.outerHeight(true) - elem.height())/2;
      var ofs = elem.offset().top - $("#view").offset().top - topMargins;
      var viewtop = $("#view").scrollTop();
      var newtop = ofs + viewtop;
      $("#view").animate({
        scrollTop: newtop
      }, 50 );
      console.log("scroll: " + startLine + ": " + ofs + "px : " + viewtop + "px : " + newtop + "px : " + elem[0].tagName + ": " + elem.text().substr(0,40));
    }
  }
  
  function onedrivePickFile() {
    onedrive.fileDialog( function(fname,info) {
      if (!util.endsWith(fname,".mdk")) return util.message("only .mdk files can be selected");
      onedrive.readFile(info, function(text) { 
        docName = fname;
        docInfo = info;
        editFile(text);
      });
    });
  }

  
  return {
    init: init,
    allowServer: function() { allowServer; },
    editFile: editFile,
    setStale: setStale,
    completed: completed
  };  
});