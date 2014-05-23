/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

function setCookie( name, value, maxAge ) {
  var date = new Date( Date.now() + maxAge * 1000 );
  document.cookie = name + "=" + encodeURIComponent(value) + ";path=/;secure;expires=" + date.toGMTString();
}

if (window && window.location && window.location.hash) {
  var cap = /[#&]access_token=([^=&#;]+)/.exec(window.location.hash);
  if (cap) {
    var token = cap[1];
    var year = 60*60*24*365;
    setCookie( "auth_dropbox", token, year );
  }
}

function onOpenFile(file) {
  console.log(file);
  setCookie( "dropbox-choose", file.link, 5 );
  end();
}

function end(err) {
  if (err) {
    setCookie("dropbox-error", err.toString(), 5 );
    console.log(err);
  }
  window.close();  
}

if (/\bdropbox-next=choose\b/.test(document.cookie)) {
  var button = Dropbox.createChooseButton({
    success: function(files) {
      if (!files || !files.length || files.length !== 1) end(new Error("Can only select a single file to open"));    
      onOpenFile(files[0] );
    },
    cancel: function() {
      end( new Error("dropbox dialog was cancelled") );
    },
    linkType: "direct",
    multiselect: false,
    extensions: [".mdk",".md",".mkdn",".markdown"],
  });
  var div = document.getElementById("choose-container");
  div.innerHTML = "Please choose a document to load: ";
  div.appendChild(button); 
}
else {
  end();
}