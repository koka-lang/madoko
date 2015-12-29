/*---------------------------------------------------------------------------
  Copyright 2013-2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Process math statically as LaTeX generated snippets
module mathStaticRun

import std/string
import std/regex
import std/path
import std/dict
import std/env
import common
import options
import texFormatter
import storage
import process
import mathParse
import mathStatic
import runLatex

function concurrent( tasks : list<(cont:(int) -> io ()) -> io ()>, continue : (int) -> io () ) : io () {
  if (tasks.isNil) return continue(0)

  var count   := tasks.length
  var lasterr := 0

  function taskContinue( err : int ) {
    count := count-1
    if (err != 0) lasterr := err
    if (count<=0) continue(lasterr)
  }

  tasks.foreach fun(task) {
    onFail( { count := count-1 }, { task(taskContinue) } )
  }
}


public function runMathStatic( content : string, inName: string, outName : string,
                        texNamePlain : string, texNameFull : string,
                        plainPages : pages, fullPages : pages,
                        oldMathPlain : string, oldMathFull : string,
                        opts0 : options, continue : (maybe<(dict<mathinfo>,string)>) -> io () ) : io ()
{
  opts0.checkDviSvgVersion(texNamePlain, texNameFull) fun(xopts) {
    mathSnippetsRender( Plain, xopts.math.getMathRender, xopts.getMathLatex(xopts.math.getMathRender), inName, texNamePlain, xopts, content, oldMathPlain, plainPages) fun(extplain) {
      if (extplain.isEmpty) return continue(Nothing)
      mathSnippetsRender( Full, xopts.math.getMathRenderFull, xopts.getMathLatexFull, inName, texNameFull, xopts, content, oldMathFull, fullPages) fun(extfull) {
        if (extfull.isEmpty) return continue(Nothing)
        mathToImg( texNamePlain.changeExt(extplain), texNameFull.changeExt(extfull), xopts, plainPages, fullPages ) fun(plainPageAdj,plainBboxAdj,fullPageAdj,fullBboxAdj) {
          mathDimAnalyse( outName.changeExt(".dimx"), xopts, plainPages, fullPages, texNamePlain, texNameFull, plainPageAdj, plainBboxAdj, fullPageAdj, fullBboxAdj) fun(mbmath) {
            if (mbmath.isJust) {
              val texNameFinalPlain = texNamePlain.changeExt(".final.tex")
              val texNameFinalFull  = texNameFull.changeExt(".final.tex")
              tryRename(texNamePlain,texNameFinalPlain); // save result to prevent rebuilds
              tryRename(texNameFull,texNameFinalFull);
            }
            continue(mbmath)
          }
        }
      }
    }
  }      
}

function checkDviSvgVersion( opts : options, texNamePlain, texNameFull, cont : (options) -> io () ) : io () {
  if (opts.math.getMathRender.isSvg || opts.math.getMathRenderFull.isSvg) {
    system("dvisvgm --version", fun(err,stdout,stderr) {
      val version = match(stdout.find(rxVersion)) {
        Nothing -> 0
        Just(cap) -> {
          (100*cap.groups[1].parseIntDefault(0)) + cap.groups[2].parseIntDefault(0)
        }
      }
      if (err!=0 || version < 113) {
        opts.printErr("warning: cannot use 'dvisvgm'; ensure you have at least version 1.14")
        opts.printErr(" the latest version is available at: http://dvisvgm.bplaced.net/downloads")
        opts.printErr(" for Windows with TexLive 2015, see: madoko.net/doc/reference.html#dvisvgm")
        opts.printErr(" switching to use png images for math (instead of svg)")
        fileRenderPng(texNamePlain)
        fileRenderPng(texNameFull)
        cont(opts(math=(opts.math)(render=Just(Png),renderFull=Just(Png))))
      }
      else {
        cont(opts)
      }
    })
  }
  else {
    cont(opts)
  }
}
val rxVersion = regex(@"(\d+)(?:\.(\d+)?)?")

// fix up the tex file if we switch to PNG mode so PS specials are rendered correctly in TikZ/Pgf
function fileRenderPng( fname : string ) : io () {
  val content = readTextFileDef(fname,"",False)
  if (content.notEmpty) {
    val contentPng = content.replaceAll("\\mdmathrender{svg}","\\mdmathrender{png}")
    tryWriteTextFile(fname,contentPng)
    ()
  }
}


function mathSnippetsRender( mode: mathkind, mrender : mathrender, texcmd: string,
                            srcName: string, texName : string, xopts : options, 
                            content : string, oldMath : string, 
                            pages : pages,
                            continue : (string) -> io () ) : io () 
{
  function rendermsg(ext) {
    xopts.print( "running " + (texcmd.stemname + " on math...").fill(19) + "(" + 
                  mode.show.fill(5) + " -> " + ext.substr(1) + " -> " + mrender.show + ")"  )
  }
  if (mrender.isSvg) {
    // run for svg: we need a dvi or xdv
    val (texargs,dviext) = texcmd.texToDvi
    if (pages.isNil) return continue(dviext)
    rendermsg(dviext)
    runLaTeX( srcName, texName, texcmd, texargs, xopts, content, "", 0, False, fun(err) {
      continue(if (err != 0) then "" else dviext) 
    })
  }
  // run for png;
  elif (!(mode.isFull && texcmd.isPlainLatex)) {
    // if we are not running in pdf with empty pdf latex 
    val pdfext = if (texcmd.isPlainLatex) then ".dvi" else ".pdf"
    if (pages.isNil) return continue(pdfext)
    rendermsg(pdfext)
    runLaTeX( srcName, texName, texcmd, "", xopts, content, "", 0, False, fun(err) {
      continue(if (err!=0) then "" else pdfext) 
    })
  }
  else {
    // run for png; but we run plain latex so continue with dvips and ps2pdf
    if (pages.isNil) return continue(".pdf")
    // use dvips and ps2pdf to get a pdf
    val notfound = "set either the 'Math Mode: Mathjax' or the 'Latex: <cmd>' key in the metadata"
    val (texargs,dviext) = texcmd.texToDvi // induce it to produce .dvi
    rendermsg(dviext + " -> ps -> pdf")
    runLaTeX( srcName, texName, texcmd, texargs, xopts, content, notfound, 0, False, fun(err1) {
      if (err1!=0) continue("")
      val dir = texName.dirname
      val stem = texName.stemname
      val dvipsCmd = xopts.math.dvips.quote + " -Ppdf -G0 " + (stem + ".dvi").quote
      val ps2pdfCmd = xopts.math.ps2pdf.quote + " " + (stem + ".ps").quote
      xopts.print("generating pdf from dvi...")
      xopts.print(">" + dvipsCmd, 3)
      system(dvipsCmd,fun(err,stdout,stderr) {
        if (err != 0) {
          xopts.printErr("> " + dvipsCmd)
          xopts.printErr("error: failure while typesetting math: \n" + stdout + stderr)      
          continue("")
        }
        else {
          xopts.print(">" + ps2pdfCmd, 3)
          system(ps2pdfCmd, fun(err2,stdout2,stderr2) {
            if (err2 != 0) {
              xopts.printErr("> " + ps2pdfCmd)
              xopts.printErr("error: failure while typesetting math: \n" + stdout2 + stderr2)      
              continue("")
            }
            else {
              continue(".pdf")
            }
          },xopts.processTimeout,dir)
        }
      },xopts.processTimeout,dir)
    })
  }  
}

function texToDvi( texcmd : string ) : (string,string) {
  if (texcmd.isXelatex)    then (" --no-pdf", ".xdv") 
  elif (texcmd.isFulllatex) then (" --output-format=dvi", ".dvi")
  elif (texcmd.isLualatex) then (" --output-format=dvi", ".dvi")
                           else ("", ".dvi")
}

function isXelatex( path : string ) : bool {
  path.stemname == "xelatex"
}

function isLualatex( path : string ) : bool {
  path.stemname == "lualatex"
}

function isFulllatex( path : string ) : bool {
  path.stemname == "pdflatex"
}

function isPlainLatex( path : string ) : bool {
  path.stemname == "latex"
}


function pagesShow( pages : pages ) : string {
  pages.map( fun(rng) {
    val (lo,hi) = rng
    lo.show + (if (lo>=hi) then "" else "-" + hi.show)
    }).join(",")
}        

function dvipngPages( pages : pages ) : string {
  pages.map( fun(rng) {
    val (lo,hi) = rng
    "-pp " + lo.show + (if (lo>=hi) then "" else "-" + hi.show)
    }).join(" ")
}        

function dvisvgPages( pages : pages ) : string {
  "-p" + pages.map( fun(rng) {
    val (lo,hi) = rng
    lo.show + (if (lo>=hi) then "" else "-" + hi.show)
  }).join(",")
}       

function convertPages( pages : pages ) : string {
  "[" + pages.map( fun(rng) {
    val (lo,hi) = rng
    (lo-1).show + (if (lo>=hi) then "" else "-" + (hi-1).show)
    }).join(",") + "]"
}

function convertSuffix( pages : pages ) : string {
  match(pages) {
    Cons((lo,hi)) | lo==hi -> "-" + (lo-1).show
    _ -> ""
  }
}


function mathToImg( namePlain : string, nameFull : string, xopts : options, 
                      plainPages : pages, fullPages : pages,  
                      continue : (int,double,int,double) -> io () ) : io () 
{  
  val (plainconvCmd,plainPageAdj,plainBboxAdj) 
    = mathConvImgCmd(Plain, namePlain, xopts.math.getMathRender, xopts.math, plainPages )
  val (fullconvCmd,fullPageAdj,fullBboxAdj) 
    = mathConvImgCmd(Full, nameFull, xopts.math.getMathRenderFull, xopts.math, fullPages )

  // make sure the output directory exists
  val outDir = combine(namePlain.dirname,xopts.math.imgDir)
  if (!(fexistsSync(outDir))) {
    xopts.print("create image directory: " + outDir)
    mkdirp(outDir)
  }           

  mathCmdToImg( plainconvCmd, namePlain.dirname, Plain, plainPages, xopts, fun(err1) {
    mathCmdToImg( fullconvCmd, nameFull.dirname, Full, fullPages, xopts, fun(err2) {
      if (err1==0 && err2==0) {
        continue(plainPageAdj,plainBboxAdj,fullPageAdj,fullBboxAdj)
      }
    })
  })
}


function mathConvImgCmd( mode : mathkind, fname : string, mrender : mathrender, opts : mathoptions, pages : pages ) : (string,int,double) {
  val baseImg = combine(opts.imgDir,fname.stemname)
  match (mrender) {
    Svg -> {
      // extension should be dvi or xdv
      // use 0.3pt (~0.1mm) margin around the boundingbox for better display
      val fuzz = 0.3
      val cmd = opts.dvisvg.quote + 
                  (if (opts.svgUseFonts) then "" else " -n") +
                  " -b" + fuzz.showFixed(1) + "pt -e -j -v3 -d" + opts.svgPrec.show + " " +
                  dvisvgPages(pages) + 
                  " -o " + (baseImg + "-%1p.svg").quote +
                  " " + fname.basename.quote
      (cmd,0,fuzz)
    }
    Png | fname.extname==".dvi" -> {
      val cmd = opts.dvipng.quote + " -T tight -z9 -bg Transparent" + 
                  " -D" + opts.dpi.show +
                  " " + dvipngPages(pages) + 
                  " -o " + (baseImg + "-%d.png").quote +
                  " " + fname.stemname.quote
      (cmd,0,0.0)
    }
    Png -> { // extension should be pdf
      val cmd = opts.convert.quote + " -trim -density " + opts.dpi.show + " " +
                  (fname.basename + pages.convertPages).quote + " " +
                  (baseImg + pages.convertSuffix + ".png").quote      
      (cmd,~1,0.0) 
    }
  }
}

function mathCmdToImg( cmd : string, dir : string, mode : mathkind, pages : pages, xopts : options, 
                       continue : (int) -> io () ) : io () 
{  
  if (pages.isNil) return continue(0)

  xopts.print("generating math images...  (" + mode.show.fill(5) + ") (" + pages.pagesShow + ")")
  xopts.print("> " + cmd,3)
  system(cmd,fun(err2,stdout2,stderr2) {
    //trace("done system cmd")
    val output = stdout2 + stderr2      
    if (err2 != 0) {
      xopts.printErr("> " + cmd)
      xopts.printErr("error: failure while typesetting math: \n" + output)      
      if (output.contains("Invalid Parameter -")) then {
        xopts.printErr("hint: perhaps you forgot to install ImageMagick?\n      (http://www.imagemagick.org/script/binary-releases.php)")
      }
      continue( if (output.contains(rxPSWarning)) then 0 else err2 )
    }
    else {
      if (xopts.verbose >= 4) xopts.print(output)
      continue(0)
    }
  },xopts.processTimeout,dir)
}
val rxPSWarning = regex(@"^(warning: .*\r\n)+$",ignoreCase=True)


function mathDimAnalyse( dimxName : string, xopts : options, plainPages : pages, fullPages : pages,
                         texNamePlain : string, texNameFull : string,
                         plainPageAdj : int, plainBboxAdj : double,
                         fullPageAdj : int, fullBboxAdj : double, 
                         continue : (maybe<(dict<mathinfo>,string)>) -> io () ) : io () {
  xopts.print("analyse and embed math images.")
  val dims2 = extendDim(plainPages, fullPages, texNamePlain, texNameFull, plainPageAdj, plainBboxAdj, fullPageAdj, fullBboxAdj, dimxName, xopts )
  val (mdim2,svgdefs,msg) = dims2.parseMathDim(xopts.math.imgDir, xopts.math.scale, xopts.math.baseline,xopts.math.svgShare)
  if (msg.bool) then xopts.print(msg)
  mathImageGC(mdim2,xopts.math.dim,dimxName.dirname)
  continue( Just((mdim2,svgdefs)) )
}

function mathImageGC( newDim : dict<mathinfo>, oldDim : dict<mathinfo>, outDir : string ) : io ()
{
  oldDim.list.foreach fun(kv) {
    val (digest,mi) = kv
    match(newDim[digest]) {
      Just -> ()
      Nothing -> {
        val imageFile = combine(outDir,mi.imageName)
        tryUnlinkSync(imageFile)
      }
    }
  }
}

function extendDim( plainPages : pages, fullPages : pages, 
                    texNamePlain : string, texNameFull : string,
                     plainPageAdj : int, plainBboxAdj : double,
                     fullPageAdj : int, fullBboxAdj : double, 
                     dimxFile : string, opts : options  ) : io string
{
  var imageSize := 0  
  var imageCount := 0
  var embedSize := 0
  var embedCount := 0  
  val dim = opts.math.dim
  
  function dimLine( render:mathrender, mode : mathkind, fname : string, 
                    pages : pages, pageAdj : int, bboxAdj : double, line : string ) 
  {
    match(line.find(rxDimLine)) {
      Nothing   -> line
      Just(cap) -> { 
        val pageNo = cap.groups[2].parseInt.maybe(0,id)
        val digest = cap.groups[3]
        val imageStem = fname.stemname + "-" + (pageNo + pageAdj).show
        val imageName = combine(opts.math.imgDir, imageStem.changeExt(render.show) )
        val imageFile = combine(dimxFile.dirname,imageName)
        //trace("read image: " + pageNo.show + ": " + imageFile + ": " + imageFile)
                
        val (iwidth,iheight,size,embed) 
          = match(dim[digest]) {
              Just(mi) | !(pageNo.inside(pages)) 
                -> {                  
                  //trace("known image: " + pageNo.show + ": " + imageFile + ": " + digest)
                  (mi.iwidth,mi.iheight,mi.size,mi.originalData)
                }
              _ -> { 
                val res =
                  match(render) {
                    Png -> {
                      analyzeImagePng( imageFile, opts )
                    }
                    Svg -> {
                      analyzeImageSvg( imageFile, opts, mode )
                    }
                  }
                val imageDigestFile = combine(imageFile.dirname,"math-" + digest + imageFile.extname)
                tryUnlinkSync(imageDigestFile)                              
                if (res.field4=="") then {
                  // give robust name  
                  rename(imageFile,imageDigestFile)
                }
                else {
                  tryUnlinkSync(imageFile) // delete the image
                }
                res
              }
            }
        
        if (embed == "") then {
          imageSize  := imageSize + size
          imageCount := imageCount + 1            
        }
        else {
          embedSize  := embedSize + size
          embedCount := embedCount + 1
        }  
        cap.groups[1] + "," + iwidth.show + "pt," + iheight.show + "pt," + bboxAdj.show + "pt," +
          size.show + "," + render.showMime + (if (embed=="") then "" else (", " + embed))      
      }
    }
  }

  val plainDims = readTextFileDef(texNamePlain.changeExt(".dim"),"")
  val fullDims  = readTextFileDef(texNameFull.changeExt(".dim"),"")
  val dimsx   = plainDims.lines.list.map( fun(line) { 
                  dimLine(opts.math.getMathRender,Plain,texNamePlain,plainPages,plainPageAdj,plainBboxAdj,line) }) +
                fullDims.lines.list.map( fun(line) { 
                  dimLine(opts.math.getMathRenderFull,Full,texNameFull,fullPages,fullPageAdj,fullBboxAdj, line) })
  
  val txt = dimsx.join("\n")
  tryWriteTextFile( dimxFile, txt )
  if (opts.verbose >= 2) {
    val totalCount = imageCount + embedCount
    val totalSize = imageSize + embedSize
    opts.print(" math images  : " + imageCount.show.align(4) + " in " + imageSize.showSize, 2 )
    opts.print(" math embedded: " + embedCount.show.align(4) + " in " + embedSize.showSize, 2 )
    opts.print(" math total   : " + totalCount.show.align(4) + " in " + totalSize.showSize, 2 )
  }
  txt
}

function analyzeImagePng( imageFile, opts : options ) : io (double, double, int, string ) {
  match( tryReadFileSync( imageFile )) {
    Nothing   -> {
      opts.printErr("error: cannot read: " + imageFile)
      (0.0,0.0,0,"") // should not happen?
    }
    Just(buf) -> {
      val base64  = buf.toBase64()
      val pxwidth = buf.readInt4(16,True)
      val pxheight= buf.readInt4(20,True)
      
      val ppt     = (if (opts.math.dpi > 0) then opts.math.dpi.double else 72.27) / 72.27
      val iheight = pxheight.double / ppt
      val iwidth  = pxwidth.double / ppt

      //trace("image " + imageFile + ": " + pxwidth.show + "," + pxheight.show)
      val pngprefix = "data:image/png;base64,"

      val embed = if (base64!="" && base64.length + pngprefix.length < opts.math.embedLimit)
                    then pngprefix + base64 else ""
      //trace("embed: " + embed.length.show + ", " + opts.math.embedLimit.show)                    
      val size = if (embed.isEmpty) then buf.length else embed.length                    
      (iwidth,iheight,size,embed)
    }
  }
}

function analyzeImageSvg( imageFile, opts : options, mode : mathkind ) : io (double, double, int, string ) {
  match( tryReadTextFile( imageFile )) {
    Left   -> {
      opts.printErr("error: cannot read: " + imageFile)
      (0.0,0.0,0,"") // should not happen?
    }
    Right(svg1) -> {
      val (iheight,svg2) = svg1.svgExtractDim(rxSvgHeight)
      val (iwidth,svg3)  = svg2.svgExtractDim(rxSvgWidth)
      val svg            = svg3.svgCompress()
      val encoded        = "data:image/svg+xml;charset=utf8," + svg.encodeGlyphIds(mode) 
      //trace("svg: " + imageFile + ", height: " + iheight.show + ", width: " + iwidth.show)
      val embed = if (encoded.length < opts.math.embedLimit) then encoded else ""
      //trace("embed: " + embed.length.show + ", " + opts.math.embedLimit.show)                    
      val size  = if (embed.isEmpty) then svg.length else embed.length                    
      (iwidth,iheight,size,embed)
    }
  }
}


// The following routines depend quite a bit on the particular dvisvgm output... :-(

// In order for glyphs to not be shared across pdf/dvi runs, we need to prefix
// identifiers so they are distinct and do not become shared paths.
// Glyph id's are of the form "g<fontid>-<charid>"
function encodeGlyphIds( svg : string, mode : mathkind ) {
  if (mode.isPlain) return svg
  svg.replaceAll( rxSvgId, fun(cap) { cap.matched + mode.show + "-" } )
}
val rxSvgId = regex(@"\b(id=['""]g|xlink:href=['""]#g)(?=\d)")

// Remove unnecessary parts of an svg to reduce the size (important since there
// can be thousands in math-heavy documents)
function svgCompress( svg : string ) : string {
  svg.replaceAll(rxComment,"").replaceAll(rxNl,"").replaceAll(rxSpaces," ").trim
}
val rxNl      = regex(@"( *\r?\n)+(?=[ <])")
val rxSpaces  = regex(@"\s+")
val rxComment = regex(@"<!--[\s\S]*?-->|<\?xml[\s\S]*?\?>|\bversion='1.1'|\bxmlns='http://www.w3.org/2000/svg'|\bxmlns:xlink='http://www.w3.org/1999/xlink'")


function svgExtractDim( svg : string, rx : regex ) : (double, string) {
  match(svg.find(rx)) {
    Nothing -> (0.0, svg) 
    Just(cap) -> (dimension(cap.groups[1],cap.groups[2]), svg.substr(0,cap.index) + svg.substr(cap.next))
  }
}

val rxSvgHeight = regex(@"\bheight='(\d+)(?:\.(\d+))?(pt)?'")
val rxSvgWidth  = regex(@"\bwidth='(\d+)(?:\.(\d+))?(pt)?'")

