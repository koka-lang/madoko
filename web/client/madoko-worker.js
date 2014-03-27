importScripts("lib/require.js");

require.config({
  baseUrl: "lib",
});

var languages = ["javascript","cpp","css","xml","markdown","coffeescript","java"
                ,"haskell","go","fsharp","r","cs","scala"]
                .map(function(name){ return "languages/" + name; });

require(["webmain","highlight.js"].concat(languages), function(madoko) {
  self.addEventListener( "message", function(ev) {
    try {    
      var req = ev.data;
      var t0 = Date.now();
      madoko.markdown(req.name,req.content,req.options, function(md,stdout,runOnServer,options1) 
      {
        self.postMessage( {
          content: md,
          time: (Date.now() - t0).toString(),
          options: options1,
          runOnServer: runOnServer,
          message: stdout,
          round: req.round
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
