/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Parse math dimension file
module mathParse

import std/string
import std/regex
import std/dict
import common


// parse a dimension file written by latex snippets
public function parseMathDim( txt : string, imgPrefix : string, imgScale : int, imgBaseline : int, sharePaths : bool  ) : (dict<mathinfo>,string,string) {
  val mi = mdict()
  val paths = mdict()
  var svgsize    : int := 0
  var svgreduced : int := 0

  val scale = imgScale.double / 100.0
  val baseline = imgBaseline.double / 100.0

  txt.findAll(rxDimLine).foreach fun(cap) {    
    val page      = cap.groups[2].parseInt.maybe(0,id)
    val ptwidth   = dimension(cap.groups[4],cap.groups[5])
    val ptheight  = dimension(cap.groups[6],cap.groups[7])
    val ptdepth   = dimension(cap.groups[8],cap.groups[9])
    val iwidth    = dimension(cap.groups[10],cap.groups[11]) 
    val iheight   = dimension(cap.groups[12],cap.groups[13])
    val size      = cap.groups[14].parseInt.maybe(0,id)
    val mime      = cap.groups[15]
    val imageData = cap.groups[16]
    val ext       = match (mime.find(rxMimePre)) {
                      Just(mcap) -> "." + mcap.groups[1]
                      Nothing    -> ".png"
                    }
    val imageName = imgPrefix + "/math-" + cap.groups[3] + ext

    val height = if (iheight > 0.0) then iheight else ptheight
    val width  = if (iwidth > 0.0) then iwidth else ptwidth
    val depth  = if (ptheight != 0.0) then ptdepth * (height / ptheight) else 0.0

    val embed = if (!sharePaths || mime!="image/svg+xml") then imageData else {
      svgsize := svgsize + imageData.length
      val svg = imageData.replaceAll(rxSvgPath, fun(pcap) {
        val pathid = pcap.groups[1]
        match(paths[pathid]) {
          Just(path) -> {
            //trace("share path: " + pathid)
            if (path==pcap.matched) 
              then {
                svgreduced := svgreduced + pcap.matched.length
                "" 
              }
              else {
                trace(" unequal path: " + pathid + " (not sharing)")
                pcap.matched // keep this path locally
              }
          }
          Nothing -> {
            paths[pathid] := pcap.matched
            //trace("extract path: " + pathid)
            ""
          }
        }
      })
      svg.replaceAll("<defs></defs>","")
    }

 
    //trace("found: " + cap.groups[2] + ": " + cap.groups[3])
    mi[cap.groups[3]] := Mathinfo(imageName,page,scale*height,scale*width,(scale*depth) + baseline,
                                    iheight,iwidth,size,embed)
  }

  val msg = if (svgreduced <= 0) then ""
             else " math reduced :  " + (100.0 * svgreduced.double / svgsize.double).int.show.fill(2,'0') + "% to " + 
                      (svgsize - svgreduced).showSize + " (due to path sharing)"
  val svgpaths = paths.list.map(snd).join("\n")
  val svgdefs  = if (svgpaths.isEmpty) then "" else 
    "\n<svg id='math-svg-paths' style='display:none' version='1.1' viewBox='0 0 0 0' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'>\n" +
    "<defs>\n" + svgpaths + "\n</defs>\n</svg>\n"

  return (mi.freeze(), svgdefs, msg)
} 
val rxMimePre = regex(@"^image/(\w+)")
val rxSvgPath = regex(@"<path\b(?:[^/>]|/(?![^>]))*?\bid='([^']+)'(?:[^/>]|/(?![^>]))*?/>")

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

public function showSize( size : int ) : string {
  val kb = 1024
  if (size < 10*kb) 
   then (size.double / kb.double).showFixed(1).align(4) + " kb"
   else ((size + kb - 1)/kb).show.align(4) + " kb"
}
