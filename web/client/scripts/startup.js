/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define([],function() {

require.config({
  baseUrl: "lib",
});


/*-------------------------------------------------------------------------
  Test browser and multiple instances.
-------------------------------------------------------------------------*/
  
// test browser features 
if (typeof Worker === "undefined" || typeof localStorage === "undefined" || typeof(window.applicationCache) === "undefined") {
  document.getElementById("oldbrowser").style.display = "block";
}
else {
  require(["../scripts/tabStorage"], function(TabStorage) {
    // test for multiple instances
    if (!TabStorage.initialize()) {
      var delay = 10000;
      setTimeout( function() { location.reload(); }, delay );
      // display nice reload counter
      var secondsElem = document.getElementById("reload-delay");
      var seconds = Math.ceil(delay/1000);
      secondsElem.innerHTML = seconds.toString();
      setInterval( function() {
        seconds--;
        secondsElem.innerHTML = seconds.toString();
      }, 1000 );
      // show the multi instance message..
      document.getElementById("multibrowser").style.display = "block";  
    }
    // we are good to go 
    else {
      document.getElementById("main").style.display = "block"; 
      TabStorage.createTabDb().then( function(tabDb) {
        start(tabDb);
      });
    }
  });
}

/*-------------------------------------------------------------------------
  Start the UI
-------------------------------------------------------------------------*/

function start(tabDb) { 
  require([ "vs/editor/editor.main",
            "../scripts/util",
            "../scripts/runner"],
            function(_Editor,Util,Runner) 
  { 
    console.log("starting");
    // remove legacy cookies & storage
    if (localStorage.sessionid) localStorage.removeItem("sessionid");
    if (localStorage.ticks) localStorage.removeItem("ticks");
    Util.setCookie("auth_dropbox","",0);   
    Util.setCookie("auth_onedrive","",0); 
    var picker = Util.getCookie("picker-data");
    if (picker) {
      Util.setCookie("picker-data","",0);
      window.tabStorage.picker = picker;
    }
    ["panels","picker","settings","pinned"].forEach( function(key) {
      var value = Util.jsonParse( localStorage.getItem(key), null );
      if (value) {
        localStorage.removeItem(key);
        window.tabStorage.setItem(key,value);
      }
    });
    // start
    require( ["../scripts/ui"], function(UI) {   // UI imports editor internal modules.
      var runner = new Runner();
      var ui     = new UI(runner,tabDb);
      Util.message("ready", Util.Msg.Status );
    });
  });
}


return {};

});