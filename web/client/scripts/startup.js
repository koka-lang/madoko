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
  Check browser etc.
-------------------------------------------------------------------------*/
var tickIval = 10000; // in milliseconds

function recentTick() {
  var s = localStorage.ticks;
  if (s == null) return 0;
  var time = Number(s);
  if (isNaN(time)) time = 0;
  var diff = time + tickIval - Date.now();
  return (diff < 0 ? 0 : diff);
}

function updateTick() {
  localStorage.ticks = Date.now().toString();
}

function removeTick() {
  localStorage.removeItem("ticks");
}
  
// test browser features 
if (typeof Worker === "undefined" || typeof localStorage === "undefined" || typeof(window.applicationCache) === "undefined") {
  document.getElementById("oldbrowser").style.display = "block";
}
// test for multiple instances
else if (recentTick()) {
  var delay = Math.ceil(Math.max(1000, recentTick())/1000)*1000;
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
  // we detect multiple instances by keeping a heart beat. 
  updateTick();
  setInterval( updateTick, tickIval/2 );  
  window.addEventListener( "unload", function() {
    removeTick();
  });
  
  document.getElementById("main").style.display = "block"; 
  start();
}
  
/*-------------------------------------------------------------------------
  Start the UI
-------------------------------------------------------------------------*/

function start() { 

  require([ "vs/editor/editor.main",
            "../scripts/util",
            "../scripts/runner"],
            function(_Editor,Util,Runner) 
  { 
    console.log("starting");
      // remove legacy cookies & storage
      if (localStorage.sessionid) localStorage.removeItem("sessionid");
      Util.setCookie("auth_dropbox","",0);   
      Util.setCookie("auth_onedrive","",0); 
      var picker = Util.getCookie("picker-data");
      if (picker) {
        Util.setCookie("picker-data","",0);
        localStorage.picker = picker;
      }
      // start
      require( ["../scripts/ui"], function(UI) {   // UI imports editor internal modules.
        var runner = new Runner();
        var ui     = new UI(runner);
        Util.message("ready", Util.Msg.Status );
      });        
  });
}


return {};

});