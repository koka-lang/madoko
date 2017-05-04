var madokoArrows = ((function () 
{
  //---------------------------------------------
  // arrow markers
  //---------------------------------------------
  var markerNone = {};
  var markers = {
    pointer:   { xrev: 0, x:2, width: 3, symbol:">", symbolrev:"<",  
                  draw:      [{elem:"path", d:"M 3 2 C 2 0.5, 1.2 0.25, 0 0 C 1.2 -0.25, 2 -0.5, 3 -2" }],
                  drawnorev: [{elem:"path", d:"M 0 0 L 2 0"}],
                  drawrev:   []
                },
    dpointer:  { xrev: 0, x:4, width: 5, symbol:">", symbolrev:"<",  
                  draw:      [{elem:"path", d:"M 3 2 C 2 0.5, 1.2 0.25, 0 0 C 1.2 -0.25, 2 -0.5, 3 -2" },
                              {elem:"path", d:"M 5 2 C 4 0.5, 3.2 0.25, 2 0 C 3.2 -0.25, 4 -0.5, 5 -2" },
                              {elem:"path", d:"M 0 0 L 2 0"}
                            ],
                  drawnorev: [{elem:"path", d:"M 2 0 L 4 0"}],
                  drawrev:   []
                },
    vector:    { xrev: 0, x:4, width: 4, symbol:"|>", symbolrev:"<|",
                  draw:      [{elem:"path", d: "M 3.75 1.5 C 2.75 0.75, 1.5 0.3, 0.6 0 C 1.5 -0.33, 2.75 -0.75, 3.75 -1.5 z" }],
                  drawnorev: [],
                  drawrev:   [{elem:"path", d:"M 0 0 L 2 0" }],
                  attributes:{fill:"currentColor", "stroke-linejoin":"miter"},
                },               
    triangle:  { xrev:0, x:4, width:4,
                  draw:      [{elem:"path",d:"M 0.5 0 L 3.75 1.6 3.75 -1.6 z",
                              fill:"currentColor", "stroke-linejoin":"miter" }],
                  drawrev:   [{elem:"path",d:"M 0 0 L 1 0"}],
                },               
    dot:       { xrev: 0, x:3, width: 3, symbol:"*",
                  draw:[{elem:"circle",cx:1.5,cy:0,r:1.5}],
                  attributes:{fill:"currentColor"},
                },
    circle:    { xrev: 0, x:3, width: 3, 
                  draw:[{elem:"circle",cx:1.5,cy:0,r:1.5}]
                },
    rcircle:   { xrev: 3, x:0, width: 3, 
                  draw:[{elem:"circle",cx:1.5,cy:0,r:1.5}]
                },
    none:      markerNone,
  };

  function newMarker( name, marker ) {
    if (marker==null || typeof marker !== "object") return false;
    if (typeof name !== "string") return false;
    markers[name] = marker;
    return true;
  }

  //---------------------------------------------
  // Convenience
  //---------------------------------------------
  function extend(obj,from) {
    if (from != null) {
      for(var prop in from) {
        if (from.hasOwnProperty(prop)) {
          obj[prop] = from[prop];
        }
      }
    }
    return obj;
  }

  function copy(obj,from) {
    return extend(extend({},obj),from);
  }

  function reverse(s) {
    return (s==null ? s : s.split("").reverse().join(""));
  }

  function startsWith(s,pre) {
    if (pre==null || pre.length===0 || s===pre) return true;
    return (s.substr(0,pre.length)===pre);
  }

  function sqr(x) {
    return x*x;
  }

  function pxToPt(px) {
    return px*0.75;  // 0.75 = 72/96
  }
  
  function ptToPx(pt) {
    return pt*1.33; // 1.3333 = 96/72
  }

  // invoke the callback at most every `ms` milliseconds
  function throttle( ms, callback ) {
    var running = false;
    var args = [];  
    return (function() {
      args = Array.prototype.slice.call(arguments); // save arguments   
      if (!running) {
        running = true;
        setTimeout( function() {
          running = false;        
          callback.apply(callback, args); 
          args = [];  // prevent space leak
        }, ms);    
      }
    });
  }
  

  //----------------------------------------------
  // Position and size functions
  //----------------------------------------------
  
  function getOffsetParentRect(elem) {
    var parent  = elem.offsetParent;            // so find the `offsetParent` and make it relative to that.
    if (!parent && elem.ownerSVGElement) parent = elem.ownerSVGElement.parentNode.offsetParent;
    if (!parent) parent = document.body;
    var position = (typeof window.getComputedStyle === "function" ? window.getComputedStyle(parent).position : "");
    if(position==="relative"||position==="absolute"||position==="fixed") { 
      // we found the real offsetParent, we can compute relative to its bounding client rectangle
      return parent.getBoundingClientRect();
    } 
    else {
      // otherwise the window is the offsetParent and we need to be relative to its scroll position
      return { 
        left: -(window.scrollX || window.pageXOffset || 0), 
        top: -(window.scrollY || window.pageYOffset || 0),
        width: document.body.clientWidth || 0,
        height: document.body.clientHeight || 0,
      };
    }
  }

  // Return the { x, y, width, height } of an element with `x` and `y` relative to `rel`. If `rel` 
  // is not given or `null`, it is relative to
  // the `offsetParent`, i.e. the closest containting parent element with the CSS position set.
  // This is the parent where absolute positining is relative to.
  function getElemBox(elem) {
    if (elem != null) {
      // usually we can use `offsetLeft` and friends.
      if (typeof elem.offsetLeft === "number" && typeof elem.clientWidth === "number") {
        return { 
          x : elem.offsetLeft, 
          y : elem.offsetTop,
          width: elem.clientWidth,
          height: elem.clientHeight,
        };
      }
      // but some cases, like elements inside SVG elements, we need to use other methods
      else if (typeof elem.getBoundingClientRect === "function") {
        var elembox = elem.getBoundingClientRect(); // getBoundingClientRect is relative to the viewport!
        var relbox = getOffsetParentRect(elem);
        return { 
          x : elembox.left - relbox.left,
          y : elembox.top - relbox.top,
          width: (typeof elembox.width === "number" ? elembox.width : elembox.left - elembox.right),
          height: (typeof elembox.height === "number" ? elembox.height : elembox.bottom - elembox.top),
        };
      }
    }  
    return { x : 0, y : 0, width : 0, height : 0 };  
  }

  function getElemBoxRelativeTo(elem, rel ) {
    var elembox = elem.getBoundingClientRect();
    var relbox  = getElemBox(rel);
    var relr    = rel.getBoundingClientRect();
    return { 
      x : relbox.x + (elembox.left - relr.left),
      y : relbox.y + (elembox.top - relr.top),
      width: (typeof elembox.width === "number" ? elembox.width : elembox.left - elembox.right),
      height: (typeof elembox.height === "number" ? elembox.height : elembox.bottom - elembox.top),
    };
  }
  
  function getSpanBox( box1, box2 ) {
    var x = Math.min(box1.x,box2.x);
    var y = Math.min(box1.y,box2.y);
    var width = Math.max(box1.x + box1.width, box2.x + box2.width) - x;
    var height= Math.max(box1.y + box1.height, box2.y + box2.height) - y;
    return {x:x,y:y,width:width,height:height};
  }
  
  function setAbsolutePos(elem,pos) {
    elem.style.top     = svgVal(pos.y) + "px";
    elem.style.left    = svgVal(pos.x) + "px";
    elem.style.display = "block";
  }
  
  //----------------------------------------------
  // Create SVG elements
  //----------------------------------------------
  var svgNs = "http://www.w3.org/2000/svg";
  var xmlnsNs = "http://www.w3.org/2000/xmlns/";
  
  function svgVal(x) {
    if (x==null) return ""
    else if (typeof x === "string") return x;
    else if (typeof x === "number") return x.toFixed(3).replace(/\.000$/,"");
    else return x;
  }
  
  function svgCreate(name, props) {
    var elem = document.createElementNS(svgNs, name||props.elem);
    for (var p in props) {
      if (p!=="elem") {
        var value = svgVal(props[p]);
        if (startsWith(p,"xlink")) {
          elem.setAttributeNS( svgNs, p, value );
        } 
        else if (startsWith(p,"xmlns")) {
          elem.setAttributeNS( xmlnsNs, p, value );
        } 
        else {
          elem.setAttribute(p, value);
        }
      }
    }
    return elem;
  }
  
  function svgDraw(svg,name,props,options) {
    options = options || {};
    var elem = svgCreate(name,props);
    if (options.prepend && svg.firstChild!=null) {
      svg.insertBefore( elem, svg.firstChild );
    }
    else {
      svg.appendChild( elem );
    } 
    return elem;
  }
  
  function svgDrawBezier(svg, bezier, props ) {
    var path = "M "  + svgVal(bezier.pos1.x) + " " + svgVal(bezier.pos1.y) +
                " C " + svgVal(bezier.cp1.x) + " " + svgVal(bezier.cp1.y)  + ", " + 
                        svgVal(bezier.cp2.x) + " " + svgVal(bezier.cp2.y) + ", " + 
                        svgVal(bezier.pos2.x) + " " + svgVal(bezier.pos2.y);
    props.d = path;
    svgDraw(svg,"path",props,{prepend:true});
  }
  

  //----------------------------------------------
  // Parse the style of an arrow
  //----------------------------------------------  
  function styleAdjustMarker(style, marker) {
    if (!marker.color) marker.color = style.color;
    if (isNaN(marker.distance)) marker.distance = style.markerDistance;
    if (isNaN(marker.scale)) marker.scale = style.markerScale;
    if (isNaN(marker.angle) || !marker.anchor) {
      var angle  = 0;
      var anchor = "right";
            if (marker.place==="right")       { angle = 0; anchor="right" }
      else if (marker.place==="right-top")   { angle = 45; anchor="right" }
      else if (marker.place==="top-right")   { angle = 45; anchor="top"; }
      else if (marker.place==="top")         { angle = 90; anchor="top"; }
      else if (marker.place==="top-left")    { angle = 135; anchor="top"; }
      else if (marker.place==="left-top")    { angle = 135; anchor="left"; }
      else if (marker.place==="left")        { angle = 180; anchor="left"; }
      else if (marker.place==="left-bottom") { angle = 225; anchor="left"; }
      else if (marker.place==="bottom-left") { angle = 225; anchor="bottom"; }
      else if (marker.place==="bottom")      { angle = 270; anchor="bottom"; }
      else if (marker.place==="bottom-right"){ angle = 315; anchor="bottom"; }
      else if (marker.place==="right-bottom"){ angle = 315; anchor="right"; }
      else if (marker.place==="center")      { anchor="center"; }
      else if (marker.place==="center-right"){ angle=0; anchor="center"; }
      else if (marker.place==="center-top")  { angle=90; anchor="center"; }
      else if (marker.place==="center-left") { angle=180; anchor="center"; }
      else if (marker.place==="center-bottom"){ angle=270; anchor="center"; }
      else {
        var cap = /^(right|top|left|bottom|center)(?:\-([\-\+]?\d+(?:\.\d+)?))?$/.exec(marker.place);
        if (cap) {
          anchor = cap[1];  
          if (cap[2]!=null) angle = Number(cap[2]);
        }
      }
      if (isNaN(marker.angle)) marker.angle = angle;
      if (!marker.anchor) marker.anchor = anchor;
      marker.angle = marker.angle % 360;
      if (marker.angle < 0) marker.angle += 360;
    }
    if (style.show.anchors) {
      style.show.markerAnchors = true;
      style.show.labelAnchor = true;
      style.show.nodeSpans   = true;
    } 
  }

  // Normalize css rgb colors to valid svg colors
  function svgColor(clr) {
    if (clr==null) return "";
    var cap = clr.match(/^\s*rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*\d+\s*)?\)\s*$/);
    if (cap != null) {
      function hex2(i) { 
        return ("0" + parseInt(cap[i],10).toString(16)).slice(-2); 
      }
      return ("#" + hex2(1) + hex2(2) + hex2(3));
    }
    return clr;
  }

  function styleGet( iarrow ) 
  {
    function get(s,def) {
      var x = iarrow.parentNode.getAttribute("data-" + s);
      if (x==null) x = iarrow.getAttribute("data-" + s);       
      return (x==null ? def : x.toLowerCase());
    }
    function getfloat(s,def) {
      var x = get(s,"");
      return (/^\s*[\+\-]?\d+(?:\.\d+)?\s*$/.test(x) ? Number(x) : def );
    }
    function getpoint(s,def) {
      var cap = /^\s*([\-\+]?\d+(?:\.\d+)?)(?:\s+([\-\+]?\d+(?:\.\d+)?))?\s*$/.exec(get(s,""));
      if (!cap) return def;
      var y = new Number(cap[1]);
      var x = cap[2] ? Number(cap[2]) : y;
      return { x:x, y:y};
    }
    function getbool(s,def) {
      var x = get(s,"");
      return (x==="" ? def : (x==="true"||x==="1"));
    }
    function getcolor(s,def) {
      var c = get(s,def);
      return svgColor(c);
    }
    var style = { 
      start: {style:    get("start-style",""),
              place:    get("start-place",""),
              angle:    getfloat("start-angle",NaN), 
              anchor:   get("start-anchor",""), 
              color:    getcolor("start-color",""), 
              scale:    getfloat("start-scale",NaN),
              distance: ptToPx(getfloat("start-distance",NaN)),
              reversed: getbool("start-reversed",null),
              start   : true,
              }, 
      end:   {style:    get("end-style",""),
              place:    get("end-place",""),
              angle:    getfloat("end-angle",NaN), 
              anchor:   get("end-anchor",""), 
              color:    getcolor("end-color",""), 
              scale:    getfloat("end-scale",NaN),
              distance: ptToPx(getfloat("end-distance",NaN)),
              reversed: getbool("end-reversed",null),
              start:    false,
              }, 
      edge:  {style:    get("edge-style",""), 
              color:    getcolor("edge-color",""),
              },
      label: {place:    get("label-placement", "_"),
              anchor:   getfloat("label-anchor",0.5), 
              shift:    getpoint("label-shift",{x:0,y:0}),
              distance: ptToPx(getfloat("label-distance",1)),
              },
      show:  {anchors      : getbool("show-anchors",false),
              markerAnchors: getbool("show-marker-anchors",false),
              nodeSpans    : getbool("show-node-spans",false),
              labelAnchor  : getbool("show-label-anchor",false),
              controlPoints: getbool("show-control-points",false),
              color        : getcolor("show-color","gray"),
              },
      scale:        getfloat("scale",1),
      strokeScale:  getfloat("stroke-scale",getfloat("width",1)),
      markerScale:  getfloat("marker-scale",1),
      markerDistance: ptToPx(getfloat("marker-distance",0)),
      color:        svgColor( iarrow.style.color || window.getComputedStyle(iarrow).color || ""),
      tension:      getfloat("looseness", getfloat("tension",1)),
      tensionAdjust:getfloat("tension-adjust",1),      
    };    
    var arrowStyle = get("style","-");
    var cap = /^([^=\.\-]*)(-[\=\-\.]?)([^=\-\.]*)$/.exec(arrowStyle);
    if (cap!=null) {
      if (style.start.style=="") style.start.style =cap[1];
      if (style.edge.style=="")  style.edge.style  =cap[2];
      if (style.end.style=="")   style.end.style   =cap[3];
    }
    // style.strokeScale *= 1.2; // to match LaTeX
    styleAdjustMarker(style,style.start);
    styleAdjustMarker(style,style.end);
    if (!style.edge.color) style.edge.color = style.color;
    return style;
  }


  //---------------------------------------------
  // Get SVG marker commands
  //---------------------------------------------
  function getSvgMarker(markerName /*:string*/, isstart/*:bool*/, reversed /*:bool*/ ) // : {name:string,reversed:bool,dx:number,width:number,id:string} 
  {
    // Find the marker definition
    var markerDef = null;
    var marker = null;
    for(var name in markers) {
      markerDef = markers[name];
      if (markerName===name || markerName===markerDef.symbol) {
        marker = {name:name,reversed: isstart};
        break;
      }
      if (markerName==="rev" + name || markerName===markerDef.symbolrev) {
        marker = {name:name,reversed: !isstart};
        break;
      }
    }
    if (marker==null) {
      markerDef = markerNone;
      marker = {name:"none",reversed:false};    
    }
    if (reversed!=null) {
      marker.reversed = (reversed==="true" || reversed==="1");
    }
    marker.dx    = (marker.reversed ? markerDef.xrev : markerDef.x ) || 0;
    //marker.width = markerDef.width || marker.dx;
    marker.distance= (marker.reversed ? markerDef.width - marker.dx : marker.dx);
    marker.id    = (isstart ? "start" : "end");

    var props = extend({ class: "marker-" + marker.name + " " + (marker.reversed?"marker-reversed":"") }, 
                        (markerDef.attributes || {}));
    var g = svgCreate("g", props);
    var draws = (markerDef.draw || []).concat( (marker.reversed ? markerDef.drawrev : markerDef.drawnorev) || [] ); 
    draws.forEach(function(draw) {
      svgDraw(g,null,draw);
    });    
    marker.drawGroup = g;
    return marker;
  }

  
  //----------------------------------------------
  // Get marker vectors
  //----------------------------------------------  
  function styleGetMarkerVector( marker, svgBox, elemBox) // :{x,y,dx,dy:number}
  {
    // relative in the svgBox
    var x = elemBox.x - svgBox.x;
    var y = elemBox.y - svgBox.y; 
    var w = elemBox.width;
    var h = elemBox.height;
    
    var torad = Math.PI/180;
    var dx = Math.cos(marker.angle*torad);
    var dy = -Math.sin(marker.angle*torad);
    var vec = { x:x, y:y, dx:dx, dy:dy }; 
    if (marker.anchor==="top") { vec.x += w/2; }
    else if (marker.anchor==="left") { vec.y += h/2; }
    else if (marker.anchor==="bottom") { vec.x += w/2; vec.y += h; }
    else if (marker.anchor==="center") { vec.x += w/2; vec.y += h/2; }
    else { vec.x += w; vec.y += h/2; }
    return vec;
  }
  
  function styleGetMarkerVectors( style, svgBox, startBox, endBox) {
    var startVec  = styleGetMarkerVector( style.start, svgBox, startBox );
    var endVec    = styleGetMarkerVector( style.end, svgBox, endBox );
    return {startVec:startVec, endVec:endVec};
  }

  //----------------------------------------------
  // Draw marker
  //----------------------------------------------  
  function posAlongVec(vec,len) {
    return { x : vec.x + vec.dx*len, y : vec.y + vec.dy*len };
  }

  function svgDrawMarker(svg, marker, vec, style) // : {x,y:number} 
  {
    var svgmarker = getSvgMarker(marker.style, marker.start, marker.reversed);
    var scale     = style.scale * Math.sqrt(style.strokeScale) * marker.scale * 2;
    var pos       = posAlongVec(vec, marker.distance + scale*svgmarker.distance );
    // Create group for drawing the marker
    var strokeWidth = (style.scale * style.strokeScale) / scale;               
    var transform="translate(" + svgVal(pos.x) + " " + svgVal(pos.y) + ") " +
                  "scale(" + svgVal(scale) + ") " +
                  "rotate(" + ((svgmarker.reversed ? 180 : 0) - marker.angle) + ") " +
                  "translate(" + svgVal(-svgmarker.dx) + " 0)" +
                  "scale(1,-1)";
    var g = svgDraw(svg,"g",{"stroke-width": strokeWidth, transform:transform, color:marker.color });
    g.appendChild(svgmarker.drawGroup);
    if (style.show.markerAnchors) {
      svgDraw(svg,"circle",{cx:svgVal(pos.x), cy:svgVal(pos.y), r:svgVal(scale*0.15), fill:style.show.color, stroke:"transparent" });
    }
    return pos;
  }
  
  
  
  //----------------------------------------------
  // Draw arrow
  //----------------------------------------------  

  function tensionAdjustDistance(pos1,pos2) {
    var dpx = Math.sqrt(sqr(pos1.x - pos2.x) + sqr(pos1.y - pos2.y));
    var d   = pxToPt(dpx); 
    return (d*0.4);
  }
  
  function svgDrawArrow( svg, style, startVec, endVec ) {
    var strokeWidth = style.scale * style.strokeScale;
    var g = svgDraw(svg,"g",{
              fill:"none",
              "stroke-width": strokeWidth,
              stroke:"currentColor",
              color: style.color,
              "stroke-linejoin":"round", "stroke-linecap":"round",
            });

    var startPos = svgDrawMarker(g, style.start, startVec, style );
    var endPos   = svgDrawMarker(g, style.end, endVec, style );
    var tension = style.tension * style.tensionAdjust * tensionAdjustDistance(startPos,endPos);
    var cp1 = posAlongVec(startVec, tension); 
    var cp2 = posAlongVec(endVec, tension); 
    var bezier = { pos1:startPos, cp1:cp1, pos2:endPos, cp2: cp2 };
    
    var props = { color:style.edge.color };
    if (style.edge.style==="-.") { props["stroke-dasharray"] = "" + strokeWidth*1.2 + " " + strokeWidth*3; }
    else if (style.edge.style==="--") { props["stroke-dasharray"] = "" + strokeWidth*4 + " " + strokeWidth*4; }
    
    svgDrawBezier(g, bezier, props );
    return bezier;
  }
  
  //----------------------------------------------
  // Draw label
  //----------------------------------------------  

  function linePoint(pos1,pos2,frac) {
    if (frac==null) frac = 0.5;
    return { x : pos1.x + frac*(pos2.x - pos1.x),
              y : pos1.y + frac*(pos2.y - pos1.y) };
  }
  function cbezierPoint(bezier,frac) {
    if (frac==null) frac = 0.5;
    var p1 = linePoint(bezier.pos1,bezier.cp1,frac);
    var p2 = linePoint(bezier.cp2,bezier.pos2,frac);
    var q  = linePoint(bezier.cp1,bezier.cp2,frac);
    var q1 = linePoint(p1,q,frac);
    var q2 = linePoint(q,p2,frac);
    return linePoint(q1,q2,frac);
    }
    
  function svgLabelPosition(bezier,label,labelRect) {
    var lpos = cbezierPoint(bezier,label.anchor);
    lpos.x += label.shift.x;
    lpos.y -= label.shift.y;    
    if (label.place==="right") {
      lpos.x += label.distance;        
      lpos.y -= labelRect.height / 2;
    }
    else if (label.place==="top-right" || label.place==="^") {
      lpos.x += label.distance 
      lpos.y -= label.distance + labelRect.height;
    }
    else if (label.place==="top") {
      lpos.x -= (labelRect.width / 2);
      lpos.y -= label.distance + labelRect.height;
    }
    else if (label.place==="top-left" || label.place==="^^") {
      lpos.x -= label.distance + labelRect.width;
      lpos.y -= label.distance + labelRect.height;
    }
    else if (label.place==="left") {
      lpos.x -= label.distance + labelRect.width;
      lpos.y -= labelRect.height/2;
    }
    else if (label.place==="bottom-left") {
      lpos.x -= label.distance + labelRect.width;
      lpos.y += label.distance;// + labelRect.height;
    }
    else if (label.place==="bottom") {
      lpos.x -= labelRect.width/2;
      lpos.y += label.distance;// + labelRect.height;
    }
    else if (label.place==="bottom-right" || label.place==="_") {
      lpos.x += label.distance;
      lpos.y += label.distance; //+ labelRect.height;
    }
    return lpos;
  }
  
  
  //----------------------------------------------
  // Draw arrow between source and target.
  //----------------------------------------------  
  function drawArrow( iarrow, source, target ) {
    // Calculate positions
    var parent = iarrow.parentNode;
    var box1 = getElemBoxRelativeTo(source,parent);
    var box2 = getElemBoxRelativeTo(target,parent);
    var box  = getSpanBox(box1,box2);
    if (box.width<=0 || box.height<=0) return;
    var style = styleGet( iarrow );
    var vecs = styleGetMarkerVectors(style,box,box1,box2);
    
    // Setup svg element
    var fuzz = Math.max(1,style.scale) * Math.max(30,(style.tension * 50)|0);
    var props = { 
      class:"svg-arrow", 
      width: box.width + 2*fuzz, 
      height: box.height + 2*fuzz,
      xmlns: svgNs,
    }
    props.viewBox = "" + svgVal(-fuzz) + " " + svgVal(-fuzz) + " " + svgVal(props.width) + " " + svgVal(props.height);
    var svg = svgCreate("svg", props );
    setAbsolutePos(svg,{x:box.x - fuzz, y:box.y - fuzz});

    // Draw the arrow
    var bezier = svgDrawArrow(svg,style,vecs.startVec,vecs.endVec);
    
    // only insert the svg now so drawing is at once
    parent.appendChild(svg); 
    
    // Draw label
    iarrow.style.display = "block"; // display first to get proper width and height
    var lpos   = svgLabelPosition(bezier,style.label,iarrow.getBoundingClientRect());
    lpos.x += box.x;
    lpos.y += box.y;
    setAbsolutePos(iarrow,lpos);
  }
  

  function getArrowTarget(iarrow, name, startEnd ) {
    var s = iarrow.getAttribute("data-" + name);
    if (s==null) return null;
    var cap = s.split(",");
    var targetName = cap[0];
    if (cap[1] && iarrow.getAttribute("data-" + name + "-place") == null) {
      iarrow.setAttribute("data-" + name + "-place", cap[1]);
    }
    return document.getElementById(targetName);
  }

  function redrawArrows() {
    // note: use querySelectorAll instead of getElementsByClassName since 
    // otherwise the removed elements are removed in-place from the iteration.
    [].forEach.call(document.querySelectorAll( ".svg-arrow" ), function(svgarrow) {
      svgarrow.parentNode.removeChild(svgarrow); 
    });
    [].forEach.call(document.querySelectorAll( ".inner-arrow" ), function(iarrow) {
      var source = getArrowTarget(iarrow, "start");
      var target = getArrowTarget(iarrow, "end");
      if (source && target) {
        drawArrow( iarrow, source, target )
      }
    });
  }

  
  //----------------------------------------------
  // Initialize
  //----------------------------------------------  
  var onresize = throttle(150, function() {
    redrawArrows(); 
  });
  window.addEventListener("resize", onresize );
  window.addEventListener("load", function() {
    redrawArrows();
  },{once:true});
  document.addEventListener("previewRefresh", function() {
    window.removeEventListener("resize", onresize);
  }, {once: true});
  
  return {
    redraw: redrawArrows,
    newMarker: newMarker,
  };
})());
