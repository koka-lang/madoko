/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/
function dispatchEvent( elem, eventName ) {
  var event;
  // we should use "new Event(eventName)" for HTML5 but how to detect that?
  if (document.createEvent) {
      event = document.createEvent('Event');
      event.initEvent(eventName,true,true);
  }
  else if (document.createEventObject) { // IE < 9
      event = document.createEventObject();
      event.eventType = eventName;
  }
  event.eventName = eventName;
  if (elem.dispatchEvent) {
      elem.dispatchEvent(event);
  }
  else if (elem.fireEvent) { 
      elem.fireEvent('on' + eventName, event);
  }
  else if (elem[eventName]) {
      elem[eventName]();
  } 
  else if (elem['on' + eventName]) {
      elem['on' + eventName]();
  }
}

(function() {

  var origin = window.location.origin || window.location.protocol + "//" + window.location.host;
  
  function findLocation( root, elem ) {
    while (elem && elem !== root) {
      var dataline = elem.getAttribute("data-line");
      if (dataline) {
        cap = /(?:^|;)(?:([^:;]+):)?(\d+)$/.exec(dataline);
        if (cap) {
          var line = parseInt(cap[2]);
          if (line && line !== NaN) {
            return { path: cap[1], line: line };
          } 
        }
      }
      elem = elem.parentNode;
    }
    return null;
  }

  document.body.ondblclick = function(ev) {
    var res = findLocation(document.body,ev.target);
    if (res) {
      res.eventType = 'previewSyncEditor';
      window.parent.postMessage( JSON.stringify(res), origin);
      console.log('posted: ' + JSON.stringify(res));
    }
  };


  function px(s) {
    if (typeof s === "number") return s;
    var cap = /^(\d+(?:\.\d+)?)(em|ex|pt|px|pc|in|mm|cm)?$/.exec(s);
    if (!cap) return 0;
    var i = parseInt(cap[1]);
    if (isNaN(i)) return 0;
    if (cap[2] && cap[2] !== "px") {
      var dpi = 96;
      var empx = 12;
      if (cap[2]==="em") {
        i = (i * empx);
      }
      else if (cap[2]==="ex") {
        i = (i * empx * 0.5);
      }
      else if (cap[2]==="pt") {
        i = (i/72) * dpi;
      }
      else if (cap[2]==="pc") {
        i = (i/6) * dpi;
      }
      else if (cap[2]==="in") {
        i = i * dpi;
      }
      else if (cap[2]==="mm") {
        i = (i/25.6) * dpi;
      }
      else if (cap[2]==="cm") {
        i = (i/2.56) * dpi;
      }
    }
    return i;
  }

  function offsetOuterTop(elem) {
    var delta = 0;
    if (window.getComputedStyle) {
      var style = window.getComputedStyle(elem);
      if (style) {
        delta = px(style.marginTop) + px(style.paddingTop) + px(style.borderTopWidth);
      }   
    }
    return (elem.offsetTop - delta);
  }

  function getScrollTop( elem ) {
    if (!elem) return 0;
    if (elem.contentWindow) {
      // iframe
      if (elem.contentWindow.pageYOffset) return elem.contentWindow.pageYOffset;
      var doc = elem.contentDocument;
      if (!doc) return 0;
      return (doc.documentElement || doc.body.parentNode || doc.body).scrollTop;
    }
    else if (typeof elem.pageYOffset !== "undefined") {
      return elem.pageYOffset;
    }
    else {
      return elem.scrollTop;
    }
  }

  function setScrollTop( elem, top ) {
    if (!elem) return;
    if (elem.contentWindow) {
      elem = elem.contentWindow;
    }
    if (elem.scroll) {
      elem.scroll( elem.pageXOffset || 0, top );
    }
    else {
      elem.scrollTop = top;
    }
  }

  function animateScrollTop( elem, top, duration, steps ) {
    var top0 = getScrollTop(elem);
    if (top0 === top) return;
    if (duration <= 50 || Math.abs(top - top0) <= 2) {
      duration = 1;
      steps = 1;
    }

    var n = 0;
    var action = function() {
      n++;
      var top1 = top;
      if (n >= steps) {
        if (elem.animate) {
          clearInterval(elem.animate);
          delete elem.animate;
        }
      }
      else {
        top1 = top0 + ((top - top0) * (n/steps));
      }
      //console.log( "  scroll step " + n + " to " + top1 + ", " + top0 + ", " + steps);
      setScrollTop(elem,top1);
    };

    var ival = (steps && steps > 0 ? duration / steps : 50);
    steps = (duration / ival) | 0;
    
    action();    
    if (steps > 1) {
      if (elem.animate) {
        clearInterval(elem.animate);
      }    
      elem.animate = setInterval( action, ival);    
    }
  }


  function findElemAtLine( elem, line, fname ) 
  {
    if (!elem || !line || line < 0) return null;

    var children = elem.children; 
    if (!children || children.length <= 0) return null;

    var current  = 0;
    var currentLine = 0;
    var next     = children.length-1;
    var nextLine = line;
    var found    = false;
    
    for(var i = 0; i < children.length; i++) {
      var child = children[i];
      var dataline = child.getAttribute("data-line");
      if (dataline && child.style.display.indexOf("inline") < 0) {
        if (fname) {
          var idx = dataline.indexOf(fname + ":");
          if (idx >= 0) {
            dataline = dataline.substr(idx + fname.length + 1)
          }
          else {
            dataline = ""  // gives NaN to cline
          }
        }
        var cline = parseInt(dataline);
        if (!isNaN(cline)) {
          if (cline <= line) {
            found = true;
            currentLine = cline;
            current = i;
          }
          if (cline > line) {
            found = true;
            nextLine = cline;
            next = i;
            break;
          }
        }
      }
    }

    // go through all children of our found range
    var res = { elem: children[current], elemLine: currentLine, next: children[next], nextLine: nextLine };
    for(var i = current; i <= next; i++) {
      var child = children[i];
      if (child.children && child.children.length > 0) {
        var cres = findElemAtLine(child,line,fname);
        if (cres) {
          found = true;
          res.elem = cres.elem;
          res.elemLine = cres.elemLine;
          if (cres.nextLine > line) { // && cres.nextLine <= res.nextLine) {
            res.next = cres.next;
            res.nextLine = cres.nextLine;
          }
          break; 
        }
      }
    }

    if (!found) return null; // no data-line at all.
    return res;
  }

  var lastScrollTop = -1;

  function scrollToLine( info )
  {
    var scrollTop = 0;
    if (info.textLine > 1) {
      var res = findElemAtLine( document.body, info.textLine, info.sourceName );
      if (!res) return false;

      scrollTop = offsetOuterTop(res.elem); 
      
      // adjust for line delta: we only find the starting line of an
      // element, here we adjust for it assuming even distribution up to the next element
      if (res.elemLine < info.textLine && res.elemLine < res.nextLine) {
        var scrollTopNext = offsetOuterTop(res.next); 
        if (scrollTopNext > scrollTop) {
          var delta = 0;
          /*
          if (slines) {
            // wrapping enabled, translate to view lines and calculate the offset
            var elemViewLine = slines.convertInputPositionToOutputPosition(res.elemLine,0).lineNumber;
            var nextViewLine = slines.convertInputPositionToOutputPosition(res.nextLine,0).lineNumber;
            delta = (info.viewLine - elemViewLine) / (nextViewLine - elemViewLine + 1);
          } 
          else {
          */
            // no wrapping, directly calculate 
            delta = (info.textLine - res.elemLine) / (res.nextLine - res.elemLine + 1);
          //}
          if (delta < 0) delta = 0;
          if (delta > 1) delta = 1;
          scrollTop += ((scrollTopNext - scrollTop) * delta);
        }
      }

      // we calculated to show the right part at the top of the view,
      // now adjust to actually scroll it to the middle of the view or the relative cursor position.
      var relative = (info.viewLine - info.viewStartLine) / (info.viewEndLine - info.viewStartLine + 1);
      scrollTop = Math.max(0, scrollTop - (info.height != null ? info.height : document.body.clientHeight) * relative ) | 0; // round it
    }

    // exit if we are still at the same scroll position
    if (scrollTop === lastScrollTop && !info.force) return false;
    lastScrollTop = scrollTop;

    // otherwise, start scrolling
    animateScrollTop(window, scrollTop, info.duration != null ? info.duration : 500);
    return true;
  }


  function findTextNode( elem, text ) {
    if (!elem || !text) return null;
    if (elem.nodeType===3) {
      if (elem.textContent === text) return elem;      
    }
    else {
      for( var child = elem.firstChild; child != null; child = child.nextSibling) {
        var res = findTextNode(child,text);
        if (res) return res;
      }
    }
    return null;  
  }


  function loadContent(info) {
    if (info.oldText) {
      //console.log("  try quick update:\n old: " + info.oldText + "\n new: " + info.newText);
      var elem = findTextNode( document.body, info.oldText );
      if (elem) {
        // yes!
        console.log("preview: quick view update" );
        elem.textContent = info.newText;        
        return;
      }
    }
    // do a full update otherwise
    document.body.innerHTML = info.content;
    // append script to detect onload event
    var loaded = document.createElement("script");
    loaded.type = "text/javascript";
    var code = "dispatchEvent(document,'load');";
    loaded.appendChild( document.createTextNode(code));
    document.body.appendChild(loaded);    
  }

  document.addEventListener("load", function(ev) {
    window.parent.postMessage(JSON.stringify({eventType:'previewContentLoaded'}),origin);
    var refs = document.getElementsByTagName("a");
    for(var i = 0; i < refs.length; i++) {
      var ref = refs[i];
      if (!/\blocalref\b/.test(ref.className) && origin !== ref.protocol + "//" + ref.host && !ref.target) {
        ref.target = "_blank"; // make all non-relative links open in a new window
      }
    }
  });

  window.addEventListener("message", function(ev) {
    // check origin and source element so no-one else can send us messages
    if (ev.origin !== origin) return;
    if (ev.source !== window.parent) return;

    var info = JSON.parse(ev.data);
    if (!info || !info.eventType) return;
    if (info.eventType==="scrollToLine") {
      //console.log("scroll to line: " + info.textLine.toString() + " in " + info.duration);
      scrollToLine(info);
    }
    else if (info.eventType==="scrollToY") {
      setScrollTop(window,info.scrollY);
    }
    else if (info.eventType==="loadContent") {      
      loadContent(info);
      //ev.source.postMessage('contentLoaded',ev.origin);
    }
  });

  /*
  var req = new XMLHttpRequest();
  var url = "https://madoko.cloudapp.net:8080/styles/madoko.css";
  req.open("GET", url, true );
  req.onload = function(res) {
    console.log("WARNING: can access root domain!!");
  };
  req.onerror = function(res) {
    console.log("OK: cannot access root domain");    
  }
  req.send(null);

  try {
    localStorage.getItem( "local/" + fname );
    console.log("WARNING: can access local storage for root domain!!")
  }
  catch(exn) {
    console.log("OK: cannot access local storage for root domain.")
  }
  
  try {
    var cookie = document.cookie;
    console.log( "WARNING: could accesss cookie for root domain!!");
  }
  catch(exn) {
    console.log("OK: cannot access cookies of root domain.")
  }
  */

  //console.log("previewjs loaded: " + origin);
})();
