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

public function braced( s : string ) : string {
  if (s.startsWith("{") && s.endsWith("}")) then s else "{" + s + "}"
}

public function cssColorCmd( v : string ) : string {
  "\\color[HTML]" + v.cssColor.braced
}

public function cssColorArg( v : string ) : string {
  v.cssColor.braced
}

public function cssColor( v0 : string ) : string {
  val v = v0.cssNormalize
  match(v.find(rxRgbX)) {
    Just(cap) -> {
      if (cap.groups[4]=="")
       then [1,1,2,2,3,3].map( fun(i) { cap.groups[i] } ).join.toUpper
       else v.trim.toUpper
    }
    Nothing -> match(v.find(rxRgb)) {
      Just(cap) -> {
        val rgb = [cap.groups[1],cap.groups[3],cap.groups[4]].map( fun(c) { c.parseIntDefault(0) } )
        val hrgb = if (cap.groups[2]=="%") then rgb.map( fun(p) { (p.double * 2.55).int } ) else rgb
        hrgb.map(fun(c) { c.showHex(2) } ).join
      }
      Nothing   -> match(v.find(rxHsl)) {
        Just(cap) -> {
          val (r,g,b) = hslToRgb( cap.groups[1].parseIntDefault(0), cap.groups[2].parseIntDefault(0), cap.groups[3].parseIntDefault(0) )
          [r,g,b].map( fun(c) { c.showHex(2) } ).join
        }
        Nothing -> match(cssNamedColors[v.toLower]) {
          Nothing -> {
            warning("unknown named css color: " + v)
            "000000"
          }
          Just(clr) -> clr
        }
      }
    }
  }
}

public function cssWidth( v0 : string ) : string {
  val v = v0.cssNormalize
  match(v.find(rxPerc)) {
    Just(cap) -> {
      val perc = cap.groups[1].parseInt().maybe(100,id).double / 100.0
      perc.showFixed(2) + "\\linewidth"
    }
    Nothing -> match(v.find(rxPixels)) {
      Just(cap) -> cap.groups[1] + "\\px"
      Nothing   -> cssValue(v)
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

val cssNamedColors : dict<string> = [
  ("black", "000000"),   
  ("silver", "C0C0C0"),   
  ("gray", "808080"),
  ("grey", "808080"),   
  ("white", "FFFFFF"),   
  ("maroon", "800000"),   
  ("red", "FF0000"),   
  ("purple", "800080"),   
  ("fuchsia", "FF00FF"),   
  ("green", "008000"),   
  ("lime", "00FF00"),   
  ("olive", "808000"),   
  ("yellow", "FFFF00"),   
  ("navy", "000080"),   
  ("blue", "0000FF"),   
  ("teal", "008080"),   
  ("aqua", "00FFFF"),   
  ("orange", "FFA500"),   
  ("aliceblue", "F0F8FF"),   
  ("antiquewhite", "FAEBD7"),   
  ("aquamarine", "7FFFD4"),   
  ("azure", "F0FFFF"),   
  ("beige", "F5F5DC"),   
  ("bisque", "FFE4C4"),   
  ("blanchedalmond", "FFE4C4"),   
  ("blueviolet", "8A2BE2"),   
  ("brown", "A52A2A"),   
  ("burlywood", "DEB887"),   
  ("cadetblue", "5F9EA0"),   
  ("chartreuse", "7FFF00"),   
  ("chocolate", "D2691E"),   
  ("coral", "FF7F50"),   
  ("cornflowerblue", "6495ED"),   
  ("cornsilk", "FFF8DC"),   
  ("crimson", "DC143C"),   
  ("darkblue", "00008B"),   
  ("darkcyan", "008B8B"),   
  ("darkgoldenrod", "B8860B"),   
  ("darkgray", "A9A9A9"),
  ("darkgrey", "A9A9A9"),   
  ("darkgreen", "006400"),   
  ("darkgray", "A9A9A9"),   
  ("darkgrey", "A9A9A9"),   
  ("darkkhaki", "BDB76B"),   
  ("darkmagenta", "8B008B"),   
  ("darkolivegreen", "556B2F"),   
  ("darkorange", "FF8C00"),   
  ("darkorchid", "9932CC"),   
  ("darkred", "8B0000"),   
  ("darksalmon", "E9967A"),   
  ("darkseagreen", "8FBC8F"),   
  ("darkslateblue", "483D8B"),   
  ("darkslategray", "2F4F4F"),
  ("darkslategrey", "2F4F4F"),   
  ("darkturquoise", "00CED1"),   
  ("darkviolet", "9400D3"),   
  ("deeppink", "FF1493"),   
  ("deepskyblue", "00BFFF"),   
  ("dimgray", "696969"),
  ("dimgrey", "696969"),   
  ("dodgerblue", "1E90FF"),   
  ("firebrick", "B22222"),   
  ("floralwhite", "FFFAF0"),   
  ("forestgreen", "228B22"),   
  ("gainsboro", "DCDCDC"),   
  ("ghostwhite", "F8F8FF"),   
  ("gold", "FFD700"),   
  ("goldenrod", "DAA520"),   
  ("greenyellow", "ADFF2F"),   
  ("grey", "808080"),   
  ("honeydew", "F0FFF0"),   
  ("hotpink", "FF69B4"),   
  ("indianred", "CD5C5C"),   
  ("indigo", "4B0082"),   
  ("ivory", "FFFFF0"),   
  ("khaki", "F0E68C"),   
  ("lavender", "E6E6FA"),   
  ("lavenderblush", "FFF0F5"),   
  ("lawngreen", "7CFC00"),   
  ("lemonchiffon", "FFFACD"),   
  ("lightblue", "ADD8E6"),   
  ("lightcoral", "F08080"),   
  ("lightcyan", "E0FFFF"),   
  ("lightgoldenrodyellow", "FAFAD2"),   
  ("lightgray", "D3D3D3"),
  ("lightgrey", "D3D3D3"),   
  ("lightgreen", "90EE90"),   
  ("lightpink", "FFB6C1"),   
  ("lightsalmon", "FFA07A"),   
  ("lightseagreen", "20B2AA"),   
  ("lightskyblue", "87CEFA"),   
  ("lightslategray", "778899"),
  ("lightslategrey", "778899"),   
  ("lightsteelblue", "B0C4DE"),   
  ("lightyellow", "FFFFE0"),   
  ("limegreen", "32CD32"),   
  ("linen", "FAF0E6"),   
  ("mediumaquamarine", "66CDAA"),   
  ("mediumblue", "0000CD"),   
  ("mediumorchid", "BA55D3"),   
  ("mediumpurple", "9370DB"),   
  ("mediumseagreen", "3CB371"),   
  ("mediumslateblue", "7B68EE"),   
  ("mediumspringgreen", "00FA9A"),   
  ("mediumturquoise", "48D1CC"),   
  ("mediumvioletred", "C71585"),   
  ("midnightblue", "191970"),   
  ("mintcream", "F5FFFA"),   
  ("mistyrose", "FFE4E1"),   
  ("moccasin", "FFE4B5"),   
  ("navajowhite", "FFDEAD"),   
  ("oldlace", "FDF5E6"),   
  ("olivedrab", "6B8E23"),   
  ("orangered", "FF4500"),   
  ("orchid", "DA70D6"),   
  ("palegoldenrod", "EEE8AA"),   
  ("palegreen", "98FB98"),   
  ("paleturquoise", "AFEEEE"),   
  ("palevioletred", "DB7093"),   
  ("papayawhip", "FFEFD5"),   
  ("peachpuff", "FFDAB9"),   
  ("peru", "CD853F"),   
  ("pink", "FFC0CB"),   
  ("plum", "DDA0DD"),   
  ("powderblue", "B0E0E6"),   
  ("rosybrown", "BC8F8F"),   
  ("royalblue", "4169E1"),   
  ("saddlebrown", "8B4513"),   
  ("salmon", "FA8072"),   
  ("sandybrown", "F4A460"),   
  ("seagreen", "2E8B57"),   
  ("seashell", "FFF5EE"),   
  ("sienna", "A0522D"),   
  ("skyblue", "87CEEB"),   
  ("slateblue", "6A5ACD"),   
  ("slategray", "708090"),
  ("slategrey", "708090"),   
  ("snow", "FFFAFA"),   
  ("springgreen", "00FF7F"),   
  ("steelblue", "4682B4"),   
  ("tan", "D2B48C"),   
  ("thistle", "D8BFD8"),   
  ("tomato", "FF6347"),   
  ("turquoise", "40E0D0"),   
  ("violet", "EE82EE"),   
  ("wheat", "F5DEB3"),   
  ("whitesmoke", "F5F5F5"),   
  ("yellowgreen", "9ACD32"),   
  ("rebeccapurple", "663399"), 
].dict

