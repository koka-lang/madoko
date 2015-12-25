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
public function parseMathDim( txt : string, imgPrefix : string, imgScale : int, imgBaseline : int  ) : dict<mathinfo> {
  val mi = mdict()
  val scale = imgScale.double / 100.0
  val baseline = imgBaseline.double / 100.0
  txt.findAll(rxDimLine).foreach fun(cap) {
    val ext       = if (cap.groups[15] == "image/svg+xml") then ".svg" else ".png"
    val imageName = imgPrefix + "/math-" + cap.groups[3] + ext
    val page      = cap.groups[2].parseInt.maybe(0,id)
    val ptwidth   = dimension(cap.groups[4],cap.groups[5])
    val ptheight  = dimension(cap.groups[6],cap.groups[7])
    val ptdepth   = dimension(cap.groups[8],cap.groups[9])
    val iwidth    = dimension(cap.groups[10],cap.groups[11]) 
    val iheight   = dimension(cap.groups[12],cap.groups[13])
    val size      = cap.groups[14].parseInt.maybe(0,id)
    val embed     = cap.groups[16]

    val height = if (iheight > 0.0) then iheight else ptheight
    val width  = if (iwidth > 0.0) then iwidth else ptwidth
    val depth  = ptdepth * (height / ptheight)

    //trace("found: " + cap.groups[2] + ": " + cap.groups[3])
    mi[cap.groups[3]] := Mathinfo(imageName,page,scale*height,scale*width,(scale*depth) + baseline,
                                    iheight,iwidth,size,embed)
  }
  return mi.freeze()
} 

public val rxDimLine = regex(@"^((\d+) *, *([a-zA-Z0-9]+) *" + 
                          rxDim + rxDim + rxDim + ")" +
                           "(?:" + rxDim + rxDim + rxNum + rxMime + rxEmbed + ")?$", multiLine=True)
val rxDim = @", *(\d+)(?:\.(\d+))? *pt\b *"
val rxEmbed = @"(?:, *(data:.*))?"
val rxNum   = @", *(\d+) *"
val rxMime  = @", *(image/[\w\+]+) *"

public function dimension( whole : string, fraction : string ) : double {
  val w = whole.parseInt.maybe(0,id).double
  val f = (fraction + "00000").substr(0,5).parseInt.maybe(0,id).double / 100000.0
  return (w+f)
}

public function containsSnippet( txt : string ) : bool {
  txt.contains(rxDigest)
}

public val rxDigest = regex(@"\\begin{md(?:Inline|Display)Snippet}[\[\{]([a-fA-F0-9]{32})[\}\]]")


// return all tex content outside snippets and line comments
public function unsnippet( txt : string, which : string ) : string {
  val res = txt.replaceAll( rxSnippet, "" ).replaceAll( rxComment, "" ).replaceAll(rxLines, "\n")
  //trace("**** unsnippet pre " + which + " ****\n" + txt + "\n*******")
  //trace("**** unsnippet " + which + " ****\n" + res.replaceAll("\n","-") + "\n*******")
  res
}

val rxSnippet = regex( @"\\begin{md(?:Inline|Display)Snippet}[\s\S]*?\\end{md(?:Inline|Display)Snippet}" )
val rxComment = regex( @"\r?\n[ \t]*%[^\r\n]*" )
val rxLines   = regex( @"(?:\r?\n)+")