importScripts("lib/require.js");

require.config({
  baseUrl: "lib",
});

require(["webmain"], function(madoko) {
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
