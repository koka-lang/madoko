/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Parse math dimension file
module mathParse

import std/regex
import std/dict
import common


// parse a dimension file written by latex snippets
public function parseMathDim( txt : string, imgPrefix : string, imgDpi : int, imgScale : int  ) : dict<mathinfo> {
  mi = mdict()
  scale = imgScale.double / 100.0
  txt.findAll(rxDimLine).foreach fun(cap) {
    imageName = imgPrefix + "/math-" + cap.groups[3] + ".png"
    page      = cap.groups[2].parseInt.maybe(0,id)
    ptwidth   = dimension(cap.groups[4],cap.groups[5])
    ptheight  = dimension(cap.groups[6],cap.groups[7])
    ptdepth   = dimension(cap.groups[8],cap.groups[9])
    pxwidth   = cap.groups[10].parseInt.maybe(-1,id)
    pxheight  = cap.groups[11].parseInt.maybe(-1,id)
    dpi       = cap.groups[12].parseInt.maybe(imgDpi,id)
    size      = cap.groups[13].parseInt.maybe(0,id)
    
    ppt    = dpi.double/72.27
    height = if (pxheight >= 0) then pxheight.double / ppt else ptheight
    width  = if (pxwidth >= 0) then pxwidth.double / ppt else ptwidth
    depth  = ptdepth * (height / ptheight)

    //trace("found: " + cap.groups[2] + ": " + cap.groups[3])
    mi[cap.groups[3]] := Mathinfo(imageName,page,scale*height,scale*width,scale*depth,
                                    pxwidth,pxheight,size,cap.groups[14])
  }
  return mi.freeze()
} 

public val rxDimLine = regex(@"^((\d+) *, *([a-zA-Z0-9]+) *" + 
                          rxDim + rxDim + rxDim + ")" +
                           "(?:" + rxPix + rxPix + rxDpi + rxNum + rxEmbed + ")?$", multiLine=True)
val rxDim = @", *(\d+)(?:\.(\d+))? *pt\b *"
val rxPix = @", *(\d+) *(?:px\b *)?"
val rxDpi = @"(?:, *(\d+) *dpi\b *)?"
val rxEmbed = @"(?:, *(data:.*))?"
val rxNum   = @", *(\d+) *"

function dimension( whole : string, fraction : string ) : double {
  w = whole.parseInt.maybe(0,id).double
  f = (fraction + "00000").substr(0,5).parseInt.maybe(0,id).double / 100000.0
  return (w+f)
}

public function containsSnippet( txt : string ) : bool {
  txt.contains(rxDigest)
}

public val rxDigest = regex(@"\\begin{md(?:Inline|Display)Snippet}[\[\{]([a-fA-F0-9]{32})[\}\]]")
