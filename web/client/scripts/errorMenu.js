/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/map","../scripts/util","../scripts/promise"],
        function(Map,Util,Promise) {

var ErrorMenu = (function() {
  function ErrorMenu(gotoNext) {
    var self = this;
    self.gotoNext = gotoNext;
    self.message = null;
    self.range = null;
    self.text = null;
    self.info = null;
  }

  ErrorMenu.prototype.getClassName = function() {
    return "menu hover errormenu";
  }  

  ErrorMenu.prototype.triggerOn = function( elem, range, text, info ) {
    return (elem==null || Util.hasClassName(elem,"glyph-error") || Util.hasClassName(elem,"glyph-warning"));
  }
  
  ErrorMenu.prototype.setContext = function( elem, range, text, info ) {
    var self = this;
    self.range = range;
    self.text = text;
    self.info = info;
  }

  ErrorMenu.prototype.getContent = function() {
    var self = this;
    var message = self.info && self.info.options ? self.info.options.htmlMessage : "<unknown error>";
    return ("<div class='info'>" + message + "</div><hr>" + 
            "<div class='button' data-cmd='next'><span class='shortcut info'>(Alt-N)</span><span class='info'>Jump to next error</span></div>");
  }

  ErrorMenu.prototype.asyncGetContent = function() {
    var self = this;
    return "";
  }

  ErrorMenu.prototype.onClick = function(ev) {
    var self = this;
    var target = ev.target;
    while( target && target.nodeName !== "DIV" ) target = target.parentNode;
    if (!target || !Util.hasClassName(target,"button")) return;

    var cmd = target.getAttribute("data-cmd");
    if (cmd==="next" && self.gotoNext) {
      self.gotoNext(self.range.getStartPosition());
    }
  }

  ErrorMenu.prototype.onKeyDown = function(ev) {
    var self = this;
  }

  return ErrorMenu;
})();          

// module:
return {
  ErrorMenu: ErrorMenu,
};

});