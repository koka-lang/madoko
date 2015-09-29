/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Formatting of CSS values in LaTex
module cssFormatter

import std/dict
import std/string
import std/regex
import common


public function cssIsBlock( kvs : dict<string> ) : bool {
  match (kvs["display"]) {
    Nothing -> False
    Just(value) -> {
      val display = value.cssNormalize.toLower
      (display=="block" || display.startsWith("table"))
    }
  }
}

public function cssIsInlineBlock( kvs : dict<string> ) : bool {
  match (kvs["display"]) {
    Nothing -> False
    Just(value) -> {
      val display = value.cssNormalize.toLower
      (display=="inline-block")
    }
  }
}

// Expand keys that stand for multiple keys; i.e. `margin` is a shorthand for `margin-(top|right|bottom|left)`.
public function cssExpandKeys( kvs0 : dict<string> ) : dict<string> {
  val kvs = kvs0.cssExpandMultiKeys
  val xs = [
    kvs.cssExpandTRBL("margin"),
    kvs.cssExpandTRBL("padding"),
    kvs.cssExpandTRBL("border-style"),
    kvs.cssExpandTRBL("border-width"),
    kvs.cssExpandTRBL("border-color"),
    kvs.cssExpandTRBL("border-radius"),    
  ].concat 
  xs.dict + kvs 
}

function cssExpandTRBL( kvs : dict<string>, key : string  ) : list<(string,string)> {
  val i = key.lastIndexOf('-')
  val (pre,post) = if (i < 0) then (key,"") else (key.substr(0,i),key.substr(i))
  match(kvs[key]) {
    Nothing -> []
    Just(value) -> {
      val vs = match(value.cssSplitValues) {
                 [v]           -> [v,v,v,v]
                 [ver,hor]     -> [ver,hor,ver,hor]
                 [top,hor,bot] -> [top,hor,bot]
                 res -> res
      }
      val ks = ["top","right","bottom","left"].map(fun(side) { pre + "-" + side + post })
      val zs = zip(ks,vs)
      if (zs.length == 4) then zs else {
        warning("Unable to parse CSS values: " + value)
        []
      }
    }
  }
}


// Expand keys that define multiple values at once; ie. border may have `border-(width|color|style)` values.
function cssExpandMultiKeys( kvs : dict<string> ) : dict<string> {
  val xss = [
    kvs.cssExpandBorder,
    kvs.cssExpandBorder("-top"),
    kvs.cssExpandBorder("-right"),
    kvs.cssExpandBorder("-bottom"),
    kvs.cssExpandBorder("-left"),
  ] 
  xss.concat.dict + kvs
}

function cssExpandBorder( kvs : dict<string>, post = "" ) : list<(string,string)> {
  match(kvs["border" + post]) {
    Nothing -> []
    Just(value) -> {
      val terms = cssSplitValues(value)
      terms.map( fun(term) {
        if (term.cssIsLength) then ("border" + post + "-width",term)
        elif (term.cssIsColor) then ("border" + post + "-color",term)
        else ("border" + post + "-style",term)
      })
    }
  }
}

public function cssIsLength( term : string ) : bool {
  term.contains(rxLen)
}
val regNum = @"([\-\+]?(?:\d+|\d*\.\d+)(?:[eE]\d+)?)"
val rxNum = regex(regNum)
val rxLen = regex(regNum + @"(em|ex|ch|rem|vh|vw|vmin|vmax|px|mm|cm|in|pt|pc)\b")


function cssIsColor( term : string ) : bool {
  term.contains(rxRgbX) || term.contains(rxRgb) || term.contains(rxHsl) || cssNamedColors.containsKey(term.cssNormalize.toLower)
}


public function cssSplitValues( s : string ) : list<string> {
  s.findAll(rxCssTerm).list.map(fun(cap) { cap.matched.cssNormalize })
}

val rxEsc   = @"\\(?:[0-9a-fA-F]{1,6}\s*|.)"
val rxCssTerm = regex(@"(?:'(?:[^\n\\']|" + rxEsc + @")*'|""(?:[^\n\\""]|" + rxEsc + @")*""|-?[a-zA-Z_]\w*\([^\)]*\)|(?:[^'""\\\s]|" + rxEsc + ")+)")


public function braced( s : string ) : string {
  if (s.isBraced) then s 
  else {
    val nl = if (s.contains(rxEndComment)) then "\n" else ""
    "{" + s + nl + "}"
  } 
}
val rxEndComment = regex(@"(^|[^\\])%.*$")

public function isBraced( s : string ) : bool {
  s.startsWith("{") && s.endsWith("}")
}

public function cssColorCmd( v : string ) : string {
  if (v=="") then "" else "\\mdcolor{" + v.cssColor + "}"
}

public function cssColorArg( v : string ) : string {
  if (v=="") then "{}" else "{" + v.cssColor + "}"
}

public function cssColor( v0 : string ) : string {
  val v = v0.cssNormalize.toLower
  match(v.find(rxRgbX)) {
    Just(cap) -> {
      val rgbx = (1,2,3).map( fun(i) { if (cap.groups[4]=="") then cap.groups[i] + cap.groups[i] else cap.matched.substr(1 + 2*(i-1), 2) } )
      val rgb  = rgbx.map( fun(s) { s.parseIntDefault(0,hex=True) } )
      cssRgb(rgb)
    }
    Nothing -> match(v.find(rxRgb)) {
      Just(cap) -> {
        val rgb0 = (cap.groups[1],cap.groups[3],cap.groups[4]).map( fun(c) { c.parseIntDefault(0) } )
        val rgb = if (cap.groups[2]=="%") then rgb0.map( fun(p) { (p.double * 2.55).int } ) else rgb0
        cssRgb(rgb)
      }
      Nothing -> match(v.find(rxHsl)) {
        Just(cap) -> {
          val rgb = hslToRgb( cap.groups[1].parseIntDefault(0), cap.groups[2].parseIntDefault(0), cap.groups[3].parseIntDefault(0) )
          cssRgb(rgb)
        }
        Nothing -> match(cssStdNames[v]) {
          Just    -> if (v=="transparent") then "" else v
          Nothing -> match(cssNamedColors[v]) { 
            Just(clr) -> clr
            Nothing   -> {
              warning("unknown named css color: " + v)
              v
            }
          }
        }
      }
    }
  }
}

function cssRgb(rgb : (int,int,int) ) : string {
  function hex(i) {
    i.min(255).max(0).showHex(2)
  }
  val (r,g,b) = rgb
  if (r==0 && g==0 && b==0) then "black"
  elif (r>=255 && g>=255 && b>=255) then "white"
  else "\\#" + r.hex + g.hex + b.hex

  /*
  function mix(i,clr) {
    clr + "," + (i.min(255).max(0)).show
  }
  val (r,g,b) = rgb
  if (r==0 && g==0 && b==0) then "black"
  elif (r>=255 && g>=255 && b>=255) then "white"
  elif (r==g && g==b && r >= 0 && r <= 255) then {
    ("rgb,255:" + r.mix("white")).braced
  }
  else {
    ("rgb,255:" + [r.mix("red"), g.mix("green"), b.mix("blue")].join(";")).braced
  }
  */
}

public function cssBool( v0 : string ) : string {
  val v = v0.cssNormalize.toLower
  if (v=="true" || v=="1") then "true" else "false"
}

public function cssFontLength( v : string ) : string {
  cssWidth(v,"","font", "em")
}

public function cssHeight( v : string, auto : string = "" ) : string {
  cssWidth(v,auto,"height", "px")
}

public function cssWidth( v0 : string, auto : string = "", percOf : string = "width", defunit = "px" ) : string {
  val v = v0.cssNormalize.toLower
  match(v.find(rxPerc)) {
    Just(cap) -> {
      val perc = cap.groups[1].parseInt().maybe(100,id).double / 100.0
      "\\dim" + percOf + perc.showFixed(2).braced
    }
    Nothing -> match(v.find(rxLen)) {
      Just(cap) -> {
        if (cssUnits.containsKey(cap.groups[2])) 
         then "\\dim" + cap.groups[2] + cap.groups[1].braced
         else cssValue(v)
      }
      Nothing -> match(v.find(rxNum)) {
        Just -> {
          if (cssUnits.containsKey(defunit))
           then "\\dim" + defunit + cssValue(v).braced
           else cssValue(v) + defunit
        }
        Nothing -> 
          if (v=="auto") then auto 
          elif (v=="normal") then "1" + defunit
          else cssValue(v)
      }
    }
  }
}




public function cssValue( v : string ) : string {
  v.cssNormalize
}

function cssNormalize( v : string ) : string {
  v.trim.replaceAll(rxCssEscape, fun(cap) {
    if (cap.groups[2].bool) {
      val i = parseIntDefault(cap.groups[2],default=32,hex=True)
      string(1,i.char)
    }
    else {
      cap.groups[1]
    }
  }).replaceAll(rxCssIgnore,"")
}
val rxCssEscape = regex(@"\\(?:([a-fA-F0-9]{1,6})\s?|([^\r\n\fa-fA-F0-9]))")
val rxCssIgnore = regex(@"\s*!important$")

val rxPerc = regex(@"^\s*(\d{1,3})%\s*$")
val rxPixels = regex(@"^\s*(\d+(?:\.\d+)?)px\s*$")

val rxRgbX = regex(@"^\s*#([a-fA-F0-9])([a-fA-F0-9])([a-fA-F0-9])([a-fA-F0-9]{3})?")
val rxRgb = regex(@"^\s*rgba?\((\d+)(%)?,(\d+)%?,(\d+)%?(?:,\d+%?)?\)\s*$")
val rxHsl = regex(@"^\s*hsla?\((\d+),(\d+)%?,(\d+)%?(?:,\d+%?)?\)\s*$")

function hslToRgb(hi, si, li){
  val h = (hi%360).double / 360.0;
  val s = si.double * 0.01;
  val l = li.double * 0.01;

  if (s==0.0) {
    val x = (l*255.0).int
    return (x,x,x)
  }

  val q = if (l < 0.5) then l * (1.0 + s) else l + (s - (l * s));
  val p = (2.0 * l) - q;
  
  function hue2rgb(t0) {
    val t = if (t0 < 0.0) then t0+1.0 elif (t0 > 1.0) then t0-1.0 else t0;
    val c = if (t < 1.0/6.0) then p + (q - p) * 6.0 * t
            elif (t < 0.5) then q
            elif (t < 2.0/3.0) then p + (q - p) * (2.0/3.0 - t) * 6.0
            else p
    (c * 255.0).int            
  }

  (hue2rgb(h + 1.0/3.0), hue2rgb(h), hue2rgb(h - 1.0/3.0))
}

val cssUnits : dict<bool> = ["px","rem","vh","vw","vmin","vmax","ch"].map(fun(s) { (s,True) }).dict

val cssStdNames : dict<bool> = cssStdNamesList.map(fun(s) { (s,True) }).dict
val cssStdNamesList : list<string> = [
  "red", "lime", "blue", "yellow", "cyan", "magenta", "navy", "maroon", "green", "teal", "purple", "olive",   
  "black", "dimgray", "gray", "darkgray", "silver", "lightgray", "gainsboro", "floralwhite", "ivory", "white", 
  "orange", "aqua", "fuchsia",
  "transparent","currentcolor",
]

val cssNamedColors : dict<string> = cssNamedColorsList.map( fun(kv) { (kv.fst,kv.snd.cssRgb) }).dict
val cssNamedColorsList : list<(string,(int,int,int))> = [
  ("black", (0x00,0x00,0x00)),   
  ("silver", (0xC0,0xC0,0xC0)),   
  ("gray", (0x80,0x80,0x80)),
  ("grey", (0x80,0x80,0x80)),   
  ("white", (0xFF,0xFF,0xFF)),   
  ("maroon", (0x80,0x00,0x00)),   
  ("red", (0xFF,0x00,0x00)),   
  ("purple", (0x80,0x00,0x80)),   
  ("fuchsia", (0xFF,0x00,0xFF)),   
  ("green", (0x00,0x80,0x00)),   
  ("lime", (0x00,0xFF,0x00)),     
  ("olive", (0x80,0x80,0x00)),   
  ("yellow", (0xFF,0xFF,0x00)),   
  ("navy", (0x00,0x00,0x80)),   
  ("blue", (0x00,0x00,0xFF)),   
  ("teal", (0x00,0x80,0x80)),   
  ("aqua", (0x00,0xFF,0xFF)),   
  ("orange", (0xFF,0xA5,0x00)),   
  ("aliceblue", (0xF0,0xF8,0xFF)),   
  ("antiquewhite", (0xFA,0xEB,0xD7)),   
  ("aquamarine", (0x7F,0xFF,0xD4)),   
  ("azure", (0xF0,0xFF,0xFF)),   
  ("beige", (0xF5,0xF5,0xDC)),   
  ("bisque", (0xFF,0xE4,0xC4)),   
  ("blanchedalmond", (0xFF,0xE4,0xC4)),   
  ("blueviolet", (0x8A,0x2B,0xE2)),   
  ("brown", (0xA5,0x2A,0x2A)),   
  ("burlywood", (0xDE,0xB8,0x87)),   
  ("cadetblue", (0x5F,0x9E,0xA0)),   
  ("chartreuse", (0x7F,0xFF,0x00)),   
  ("chocolate", (0xD2,0x69,0x1E)),   
  ("coral", (0xFF,0x7F,0x50)),   
  ("cornflowerblue", (0x64,0x95,0xED)),   
  ("cornsilk", (0xFF,0xF8,0xDC)),   
  ("crimson", (0xDC,0x14,0x3C)),   
  ("darkblue", (0x00,0x00,0x8B)),   
  ("darkcyan", (0x00,0x8B,0x8B)),   
  ("darkgoldenrod", (0xB8,0x86,0x0B)),   
  ("darkgray", (0xA9,0xA9,0xA9)),
  ("darkgrey", (0xA9,0xA9,0xA9)),   
  ("darkgreen", (0x00,0x64,0x00)),   
  ("darkgray", (0xA9,0xA9,0xA9)),   
  ("darkgrey", (0xA9,0xA9,0xA9)),   
  ("darkkhaki", (0xBD,0xB7,0x6B)),   
  ("darkmagenta", (0x8B,0x00,0x8B)),   
  ("darkolivegreen", (0x55,0x6B,0x2F)),   
  ("darkorange", (0xFF,0x8C,0x00)),   
  ("darkorchid", (0x99,0x32,0xCC)),   
  ("darkred", (0x8B,0x00,0x00)),   
  ("darksalmon", (0xE9,0x96,0x7A)),   
  ("darkseagreen", (0x8F,0xBC,0x8F)),   
  ("darkslateblue", (0x48,0x3D,0x8B)),   
  ("darkslategray", (0x2F,0x4F,0x4F)),
  ("darkslategrey", (0x2F,0x4F,0x4F)),   
  ("darkturquoise", (0x00,0xCE,0xD1)),   
  ("darkviolet", (0x94,0x00,0xD3)),   
  ("deeppink", (0xFF,0x14,0x93)),   
  ("deepskyblue", (0x00,0xBF,0xFF)),   
  ("dimgray", (0x69,0x69,0x69)),
  ("dimgrey", (0x69,0x69,0x69)),   
  ("dodgerblue", (0x1E,0x90,0xFF)),   
  ("firebrick", (0xB2,0x22,0x22)),   
  ("floralwhite", (0xFF,0xFA,0xF0)),   
  ("forestgreen", (0x22,0x8B,0x22)),   
  ("gainsboro", (0xDC,0xDC,0xDC)),   
  ("ghostwhite", (0xF8,0xF8,0xFF)),   
  ("gold", (0xFF,0xD7,0x00)),   
  ("goldenrod", (0xDA,0xA5,0x20)),   
  ("greenyellow", (0xAD,0xFF,0x2F)),   
  ("grey", (0x80,0x80,0x80)),   
  ("honeydew", (0xF0,0xFF,0xF0)),   
  ("hotpink", (0xFF,0x69,0xB4)),   
  ("indianred", (0xCD,0x5C,0x5C)),   
  ("indigo", (0x4B,0x00,0x82)),   
  ("ivory", (0xFF,0xFF,0xF0)),   
  ("khaki", (0xF0,0xE6,0x8C)),   
  ("lavender", (0xE6,0xE6,0xFA)),   
  ("lavenderblush", (0xFF,0xF0,0xF5)),   
  ("lawngreen", (0x7C,0xFC,0x00)),   
  ("lemonchiffon", (0xFF,0xFA,0xCD)),   
  ("lightblue", (0xAD,0xD8,0xE6)),   
  ("lightcoral", (0xF0,0x80,0x80)),   
  ("lightcyan", (0xE0,0xFF,0xFF)),   
  ("lightgoldenrodyellow", (0xFA,0xFA,0xD2)),   
  ("lightgray", (0xD3,0xD3,0xD3)),
  ("lightgrey", (0xD3,0xD3,0xD3)),   
  ("lightgreen", (0x90,0xEE,0x90)),   
  ("lightpink", (0xFF,0xB6,0xC1)),   
  ("lightsalmon", (0xFF,0xA0,0x7A)),   
  ("lightseagreen", (0x20,0xB2,0xAA)),   
  ("lightskyblue", (0x87,0xCE,0xFA)),   
  ("lightslategray", (0x77,0x88,0x99)),
  ("lightslategrey", (0x77,0x88,0x99)),   
  ("lightsteelblue", (0xB0,0xC4,0xDE)),   
  ("lightyellow", (0xFF,0xFF,0xE0)),   
  ("limegreen", (0x32,0xCD,0x32)),   
  ("linen", (0xFA,0xF0,0xE6)),   
  ("mediumaquamarine", (0x66,0xCD,0xAA)),   
  ("mediumblue", (0x00,0x00,0xCD)),   
  ("mediumorchid", (0xBA,0x55,0xD3)),   
  ("mediumpurple", (0x93,0x70,0xDB)),   
  ("mediumseagreen", (0x3C,0xB3,0x71)),   
  ("mediumslateblue", (0x7B,0x68,0xEE)),   
  ("mediumspringgreen", (0x00,0xFA,0x9A)),   
  ("mediumturquoise", (0x48,0xD1,0xCC)),   
  ("mediumvioletred", (0xC7,0x15,0x85)),   
  ("midnightblue", (0x19,0x19,0x70)),   
  ("mintcream", (0xF5,0xFF,0xFA)),   
  ("mistyrose", (0xFF,0xE4,0xE1)),   
  ("moccasin", (0xFF,0xE4,0xB5)),   
  ("navajowhite", (0xFF,0xDE,0xAD)),   
  ("oldlace", (0xFD,0xF5,0xE6)),   
  ("olivedrab", (0x6B,0x8E,0x23)),   
  ("orangered", (0xFF,0x45,0x00)),   
  ("orchid", (0xDA,0x70,0xD6)),   
  ("palegoldenrod", (0xEE,0xE8,0xAA)),   
  ("palegreen", (0x98,0xFB,0x98)),   
  ("paleturquoise", (0xAF,0xEE,0xEE)),   
  ("palevioletred", (0xDB,0x70,0x93)),   
  ("papayawhip", (0xFF,0xEF,0xD5)),   
  ("peachpuff", (0xFF,0xDA,0xB9)),   
  ("peru", (0xCD,0x85,0x3F)),   
  ("pink", (0xFF,0xC0,0xCB)),   
  ("plum", (0xDD,0xA0,0xDD)),   
  ("powderblue", (0xB0,0xE0,0xE6)),   
  ("rosybrown", (0xBC,0x8F,0x8F)),   
  ("royalblue", (0x41,0x69,0xE1)),   
  ("saddlebrown", (0x8B,0x45,0x13)),   
  ("salmon", (0xFA,0x80,0x72)),   
  ("sandybrown", (0xF4,0xA4,0x60)),   
  ("seagreen", (0x2E,0x8B,0x57)),   
  ("seashell", (0xFF,0xF5,0xEE)),   
  ("sienna", (0xA0,0x52,0x2D)),   
  ("skyblue", (0x87,0xCE,0xEB)),   
  ("slateblue", (0x6A,0x5A,0xCD)),   
  ("slategray", (0x70,0x80,0x90)),
  ("slategrey", (0x70,0x80,0x90)),   
  ("snow", (0xFF,0xFA,0xFA)),   
  ("springgreen", (0x00,0xFF,0x7F)),   
  ("steelblue", (0x46,0x82,0xB4)),   
  ("tan", (0xD2,0xB4,0x8C)),   
  ("thistle", (0xD8,0xBF,0xD8)),   
  ("tomato", (0xFF,0x63,0x47)),   
  ("turquoise", (0x40,0xE0,0xD0)),   
  ("violet", (0xEE,0x82,0xEE)),   
  ("wheat", (0xF5,0xDE,0xB3)),   
  ("whitesmoke", (0xF5,0xF5,0xF5)),   
  ("yellowgreen", (0x9A,0xCD,0x32)),   
  ("rebeccapurple", (0x66,0x33,0x99)), 
]

