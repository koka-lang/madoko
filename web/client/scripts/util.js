define(["std_core"],function(stdcore) {

  // Call for messages
  function message( txt ) {
    stdcore.println(txt);
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

  // extend target with all fields of obj.
  function extend(target, obj) {
    properties(obj).forEach( function(prop) {
      target[prop] = obj[prop];
    });
  }

  function contains( xs, s ) {
    if (!xs) return false;
    if (!s) return true;
    if (xs instanceof Array) {
      for(var i = 0; i < xs.length; i++) {
        if (xs[i] === s) return true;
      }
    }
    else if (typeof xs === "string") {
      if (xs.indexOf(s) >= 0) return true;
    }
    return false;
  }

  function hasClassName( elem, cname ) {    
    var names = elem.className.split(/\s+/);
    return contains(names,cname);
  }

  function toggleClassName( elem, cname ) {
    if (hasClassName(elem,cname)) {
      removeClassName(elem,cname);
    }
    else {
      addClassName(elem,cname);
    }
  }

  function removeClassName( elem, cname ) {
    var cnames = elem.className;
    var names = cnames.split(/\s+/);
    var newnames = names.filter( function(n) { return (n !== cname); });
    if (names.length !== newnames.length) {
      elem.className = newnames.join(" ");
    }
  }

  function addClassName( elem, cname ) {
    var cnames = elem.className;
    var names = cnames.split(/\s+/);
    if (!contains(names,cname)) {
      elem.className = cnames + " " + cname;
    }    
  }

  function changeExt( fname, newext ) {
    var ext = extname(fname);
    if (ext=="") {
      return fname + newext;
    }
    else {
      return fname.substr(0,fname.length - ext.length) + newext;
    }
  }

  function extname( fname ) {
    var match = /\.[^\\\/\.]+$/.exec(fname);
    return (match ? match[0] : "");
  }

  function startsWith(s,pre) {
    if (!pre) return true;
    if (!s) return false;
    return (s.substr(0,pre.length).indexOf(pre) === 0);
  }

  function endsWith(s,post) {
    if (!post) return true;
    if (!s) return false;
    var i = s.indexOf(post);
    return (i >= 0 && (s.length - post.length) == i);
  }

  function toggleButton( elemName, text0, text1, action ) {
    var button = (typeof elemName === "string" ? document.getElementById(elemName) : elemName);
    var toggled = true;
    function toggle() {
      toggled = !toggled;
      button.innerHTML = (toggled ? text1 : text0);
    }
    toggle();
    button.onclick = function(ev) {
      toggle();
      action(ev,toggled);
    }
  }



  return {
    properties: properties,
    extend: extend,
    contains: contains,
    hasClassName: hasClassName,
    toggleClassName: toggleClassName,
    removeClassName: removeClassName,
    addClassName:addClassName,
    changeExt: changeExt,
    extname: extname,
    startsWith: startsWith,
    endsWith: endsWith,
    toggleButton: toggleButton,
    message: message,
  }
});