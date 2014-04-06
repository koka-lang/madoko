importScripts("lib/require.js");

require.config({
  baseUrl: "lib",
});

var languages = ["javascript","cpp","css","xml","markdown","coffeescript","java"
                ,"haskell","go","fsharp","r","cs","scala"]
                .map(function(name){ return "languages/" + name; });

require(["webmain","highlight.js"].concat(languages), function(madoko) 
{
  function nub( xs ) {
    if (!xs || xs.length <= 0) return [];
    var seen = {};
    var ys = [];
    for(var i = 0; i < xs.length; i++) {
      if (!(seen["$" + xs[i]])) {
        seen["$" + xs[i]] = true;
        ys.push(xs[i]);
      }
    }
    return ys;
  }

  // Get the properties of an object.
  function properties(obj) {
    var attrs = [];
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        attrs.push(key);
      }
    } 
    return attrs;
  }

  self.addEventListener( "message", function(ev) {
    try {    
      var req = ev.data;
      if (req.files) {
        properties(req.files).forEach( function(fname) {
          madoko.writeTextFile(fname,req.files[fname]);  
        });
      }

      var t0 = Date.now();            
      madoko.markdown(req.name,req.content,req.options, function(md,stdout,filesRead,runOnServer,options1) 
      {
        self.postMessage( {
          content: md,
          time: (Date.now() - t0).toString(),
          options: options1,
          runOnServer: runOnServer,
          message: stdout,
          ctx: req.ctx,
          filesRead: nub(filesRead.split("\n")),
        });
      });
    }
    catch(exn) {
      self.postMessage( {
        message: exn.toString(),
        round: ev.data.round
      });
    }
  });
});
