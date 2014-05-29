/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/promise","../scripts/util", 
        "../scripts/remote-dropbox",
        "../scripts/remote-onedrive",
        ], function(Promise,Util,Dropbox,Onedrive) {

function setup() {

}

function choose() {
  console.log("hi");
  var options = {
    root: "",
  };
  var remote = new Dropbox.Dropbox(options.root);
  var folder = "";
  var listing = document.getElementById("listing");
  remote.listing(folder).then( function(items) {
    console.log(items);
    var html = items.map( function(item) {
      return "<div class='item item-" + item.type + "' data-path='" + Util.escape(item.path) + "'>" + 
                "<input type='checkbox' class='item-select'></input>" +
                "<img class='item-icon' src='images/icon-" + item.type + ".png'/>" +
                "<span class='item-name'>" + Util.escape(Util.basename(item.path)) + "</span>" +
             "</div>";

    });
    listing.innerHTML = html.join("\n");
  });
}

return {
  choose: choose,
}

});