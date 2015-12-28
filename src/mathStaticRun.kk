/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
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

// quote file and command names for shell execution
function quote( s : string ) : string {
  "\"" + s + "\""
}

// normalize a file name: needed for latex 
function norm( fname : string ) : string {
  fname.replaceAll("\\", "/");
}

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

public function runBibtex( bibFiles : list<string>, opts : options, continue : bool -> <io|e> ()) : <io|e> () {
  match(bibFiles) {
    Nil -> continue(False)
    Cons(bibFile,rest) -> {
      runBibtex1( bibFile, opts, fun(err) {
        runBibtex( rest, opts, if (err) then fun(_) { continue(True) } else continue )
      })
    }
  }
}

public function runBibtex1( bibFile : string, opts : options, continue : bool -> <io|e> ()) : <io|e> () {
  opts.print("running bibtex to generate bibliography...")
  val xbibFile = checkSandbox(bibFile)
  val bibtexCmd = opts.bibtex.quote + " " + xbibFile.basename.quote
  opts.print("> " + bibtexCmd,3)
  system(bibtexCmd, fun(err:int,stdout:string,stderr:string) {
    if (err!=0) {
      opts.printErr("error while running: > " + bibtexCmd)
      system(opts.bibtex.quote + " -version") fun(errx:int,stdoutx,stderrx) {
        if (errx!=0) {
          opts.printErr("error: could not find bibtex: \"" + bibtexCmd + "\"\n" +
                        "\n  hint: Set the 'BibTeX: ...' key or give the '--bib=<cmd>' command line option.\n")
        }
        else {
          val allout = stdout + stderr
          opts.printErr("error: bibtex:\n" + allout.indent(2))
          match (allout.find(rxBibtexNoStyle)) {
            Nothing -> ()
            Just(cap) -> opts.printErr("error: source line: " + cap.groups[3] + ":" + cap.groups[2] + 
                                        "\n  cannot find bibliography style file '" + cap.groups[1] + "'" +
                                        "\n  hint: perhaps put the file in the document directory and use the" + 
                                        "\n        'Bib style: " + cap.groups[1].noext + ".bst' metadata (with the '.bst' extension).\n");
          }
          allout.findAll(rxBibtexError).foreach( fun(cap) {
            opts.printErr("error: source line: " + cap.groups[3] + ":" + cap.groups[2] +
                          "\n  " + (cap.groups[1] + cap.groups[4].unindent).indent(2) + "\n" )
          })
        }
        continue(True)
      }
    }
    else {
      if(opts.verbose>=1 && !(stdout=="" && stderr=="")) opts.printErr(stdout + stderr)
      continue(False)
    }
  },opts.processTimeout,bibFile.dirname)
}

val rxBibtexLineinfo= @"---line *(\d+) *of file *(.*)"
val rxBibtexNoStyle = regex(@"^ *I couldn't open style file *(.*)\s*" + rxBibtexLineinfo, multiline=True)
val rxBibtexError   = regex(@"^ *(.+?)" + rxBibtexLineinfo + @"((?:\s*:.*)*)", multiline=True)

public function runPdfLaTeX( srcName : string, texFile : string, opts : options, content : string, continue : () -> io () ) {
  opts.print("running " + opts.getPdfLatex.stemname + " to generate pdf...")
  val notfound = "set the 'Pdf Latex: <cmd>' key in the metadata?"
  runLaTeX(srcName, texFile, opts.getPdfLatex, "", opts, content, notfound, 0, True,
    fun(err) { continue() } )  
}

val latexEnv = [
  ("max_print_line","1000"),
  ("error_line","250"),
  ("half_error_line","230"),
]

val latexSandboxEnv = [
  ("openin_any","p"),
  ("openout_any","p"),
  ("shell_escape","f"),
  ("parse_first_line","f"),
]

function runLaTeX( srcFile : string, texFile : string, texCmd : string, extraArgs : string,
                    opts : options, 
                    content : string,
                    notfound : string,
                    runCount : int = 0,
                    showWarnings : bool = True,
                    continue : (err : int) -> io () )
{
  val dir = texFile.dirname.norm
  val latexCmd = texCmd.quote + 
                  (if (extraArgs.bool) then " " + extraArgs else "") + 
                  " --output-directory=" + (if (dir=="") then "." else dir).quote + 
                       " --interaction=batchmode" + // --max-print-line=1000" + 
                       (if (opts.sandbox) then " --no-parse-first-line --no-shell-escape" else "") + // note: also need `openin_any:p` and `openout_any:p`: pass through environment instead
                       " " + texFile.norm.quote 

  if (runCount==0 && opts.rebuild) {
    tryUnlinkSync(texFile.changeExt(".aux"))
  }
  opts.print("> " + latexCmd,3)
  
  system(latexCmd, fun(err:int,stdout:string,stderr:string) {
    val logout = readTextFileDef(texFile.changeExt(".log"),"")
    if (err!=0) {
      opts.printErr("error while running: \n> " + latexCmd)
      //trace("error code: " + err.show + "\n" + stdout + stderr)
      //println(stdout + stderr)
      system(texCmd.quote + " -version") fun(errx:int,stdoutx,stderrx) {
        if (errx!=0) {
          opts.printErr("error: could not find program: \"" + texCmd + "\"")
          if (notfound != "") opts.printErr(notfound)
        }
        else {
          val errmsg = "error: latex:\n" + stdout + stderr
          match(logout.find(rxLatexErr)) {
            Just(cap) -> match(cap.matched.findLatexLineNo) {
              Just( (texlineNo, texerr) ) -> {
                val texContent = readTextFileDef(texFile,"")
                //trace(logout.substr(cap.index-100))
                match(findLatexPackage(logout.substr(0,cap.index))) {
                  Just(pkg) -> opts.printErr("error: source line: " + pkg + ":" + texlineNo.show)
                  Nothing   -> match (content.findLatexLine(texlineNo,texContent)) {
                    Just(lineNo) -> opts.printErr("error: source line: " + lineNo)
                    Nothing -> ()
                  }
                }                  
                opts.printErr(nicifyLatexErr(texerr))
              }
              Nothing -> {
                //trace("could not find lineo")
                opts.printErr(errmsg)    
              }
            }
            Nothing -> {
              //trace("could not find error")
              opts.printErr(errmsg)              
            }
          } 
          opts.printErr("log written at: " + texFile.changeExt(".log"))
        }      
        continue(err)       
      }
    }
    else {
      if (runCount <= 2 && logout.contains(rxLatexRerun)) {
        opts.print("rerun to resolve references...")
        runLaTeX( srcFile, texFile, texCmd, extraArgs, opts, content, notfound, runCount+1, showWarnings, continue)
      }
      else {
        if (showWarnings) then latexShowWarnings(texFile,logout,content,opts)
        continue(0)
      }
    }
   },
   opts.processTimeout,
   srcFile.dirname,
   std/env/env.list + latexEnv + (if (opts.sandbox) then latexSandboxEnv else [])
  )
} 
val rxLatexErr = regex(@"(?:^! LaTeX Error:.*|^\*\* ERROR .*|^(?:!|Runaway argument\?))[\s\S]*?(?=\r?\n\r?\n\r?\n|^\s*(?:Here is how much of \w*TeX's memory you used:|The control sequence))",multiline=True,ignoreCase=True)

val rxLatexRerun = regex(@"^((Package|Latex) .*?warning\b.*?|\(\w+\) +)Rerun\b",multiline=True,ignoreCase=True)

function nicifyLatexErr( err :string) : string {
  match(err.find(rxLatexSubErr)) {
    Nothing   -> err
    Just(cap) -> cap.matched + "\n"
  }
}
val rxLatexSubErr = regex(@"The font ""[^""\n\r]*"" cannot be found\.",multiline=True,ignoreCase=True)

public function runMathStatic( content : string, inName: string, outName : string,
                        texNamePlain : string, texNameFull : string,
                        plainPages : pages, fullPages : pages,
                        oldMathPlain : string, oldMathFull : string,
                        xopts : options, continue : (maybe<(dict<mathinfo>,string)>) -> io () ) : io ()
{
  mathSnippetsRender( Plain, xopts.getMathRender, xopts.getMathLatex(xopts.getMathRender), inName, texNamePlain, xopts, content, oldMathPlain, plainPages) fun(extplain) {
    if (extplain.isEmpty) return continue(Nothing)
    mathSnippetsRender( Full, xopts.getMathRenderFull, xopts.getMathLatexFull, inName, texNameFull, xopts, content, oldMathFull, fullPages) fun(extfull) {
      if (extfull.isEmpty) return continue(Nothing)
      mathToImg( texNamePlain.changeExt(extplain), texNameFull.changeExt(extfull), xopts, plainPages, fullPages ) fun(plainPageAdj,fullPageAdj){
        mathDimAnalyse( outName.changeExt(".dimx"), xopts, plainPages, fullPages, texNamePlain, texNameFull, plainPageAdj, fullPageAdj) fun(mbmath) {
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



function mathSnippetsRender( mode: mathkind, mrender : mathrender, texcmd: string,
                            srcName: string, texName : string, xopts : options, 
                            content : string, oldMath : string, 
                            pages : pages,
                            continue : (string) -> io () ) : io () 
{
  function rendermsg(ext) {
    xopts.print( "running " + texcmd.stemname + " on math... (" + 
                  mode.show + " -> " + ext.substr(1) + " -> " + mrender.show + ")"  )
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
      val dvipsCmd = xopts.dvips.quote + " -Ppdf -G0 " + (stem + ".dvi").quote
      val ps2pdfCmd = xopts.ps2pdf.quote + " " + (stem + ".ps").quote
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


function findLatexLineNo( texerr : string ) : maybe<(int,string)> {
  match(texerr.find(rxLatexLineNum)) {
    Nothing   -> Nothing
    Just(cap) -> match( cap.groups[1].parseInt ) {
                   Nothing -> Nothing
                   Just(i) -> Just( (i, texerr.substr(0,cap.next)) )
                 }
  }
}
val rxLatexLineNum = regex(@"(?:^|\n)l\.(\d+) +[\s\S]*?(?=\r?\n\r?\n|$)")

function findLatexLine( src : string, lineNo, texSrc : string ) : maybe<string> {
  val searchLines = texSrc.lines.list.take(lineNo-1).reverse
  //trace("latex lineno: " + lineNo.show + "\n" + searchLines.join("\n") + "\n\n")
  findLatexLineData(0, searchLines )
}
val rxLatexEndSnippet = regex(@"\\end{md(Inline|Display)?Snippet}")

function findLatexLineData( delta : int, lines : list<string> ) : maybe<string> {
  match(lines) {
    Nil -> Nothing
    Cons(line,rest) -> {
      match(line.find(rxLineData)) {
        Nothing -> {
          val newDelta = if (line.contains(rxEndComment)) then delta else delta+1
          findLatexLineData( newDelta, rest )
        }
        Just(cap) -> {
          val last = cap.groups[1].split(";").list.reverse.take(1).join()
          //trace(" found line info: " + cap.matched + ", last: " + last + ", delta: " + delta.show)
          match( last.find(rxLineNo) ) {
            Nothing -> Nothing
            Just(cap2) -> Just(cap2.groups[1]  + (cap2.groups[2].parseInt.maybe(0,id) + delta).show)
          }
        }
      }
    }
  }
}
val rxLineData    = regex( @"^(?:[^\\%]|\\.)*% *(?:mdk-)?data-line=\{([^\}]*)\} *$" )
val rxLineNo      = regex( @"^([^:]*:)?(\d+)$" )
val rxEndComment  = regex( @"^(?:[^\\%]|\\.)*%mdk.*$" )


function findLatexPackage( logout : string, pkgs : list<string> = [] ) : maybe<string> {
  match(logout.find(rxPackageLine)) {
    Nothing -> {
      match(pkgs) {
        Cons -> Just(pkgs.reverse.join(";"))
        _    -> Nothing
      }
    }
    Just(cap) -> {
      val newpkgs = 
        if (cap.groups[6] != "") {
          // loaded))
          pkgs.drop(cap.groups[6].count(")"))
        }
        else {
          val pkg = cap.groups[1] + cap.groups[4]
          val dropBefore = cap.groups[3].length
          val dropAfter  = cap.groups[2].length + cap.groups[5].length 
          //trace("flp: packages: " + pkgs.join(";"))
          //trace("     found: " + pkg + ", " + dropBefore.show + ", " + dropAfter.show)
          val pkgs0 = pkgs.drop(dropBefore)
          val pkgs1 = if (pkg.isEmpty) then pkgs0 else Cons(pkg,pkgs0)
          val pkgs2 = pkgs1.drop(dropAfter)
          pkgs2
        }
      findLatexPackage( logout.substr1(cap.next), newpkgs )
    }
  }
}

val rxPackage   = @"\((?:\./)?([^\)\n\r\t]+) *(?:(\)+) *)?"
val rxPackageEnd = @"(\)+) *(?:" + rxPackage + @")?"
val rxPackageEndLoaded = @"[^\(\r\n]*?((?: loaded\)+)+)"  // xypic package suffers from this
val rxPackageStart = rxPackage
val rxPackageLine = regex(@"^(?:\] *)?(?:" + rxPackageStart + "|" + rxPackageEnd + "|" + rxPackageEndLoaded + @")(?=$| *\[\d+(?:$|\]))", multiline=True)


public function latexStrip( s : string ) : string
{
  s.replaceAll(rxStrip,"")
}

val rxStrip = regex(@"(\\[\w/\-\r\n]*(\[[^\]\r\n]*\])?|\^\^.|'\w*|\}\{[lrct]\}|\]\{[^\]\r\n]*\}|[^a-zA-Z])+") // ;""!\*()/\+=/,~:

public function latexFindLineByMatch( texLine : string, source : string ) : maybe<string> {
  val stripLine = texLine.latexStrip.substr(0,16) // some arbitrary length... seems to work well in practice
  if (stripLine.length < 3) then Nothing else {
    match (source.findLines(stripLine)) {
      Cons(lineNo,rest) -> Just(lineNo.show + (if (rest.isNil) then "" else " (?)"))
      _ -> Nothing      
    }
    /*
    ilines = source.lines.list.mapIndexed(fun(idx,line) { (idx,line) })
    match(ilines.filter(fun(iline){ iline.snd.latexStrip.contains(stripLine) })) {
      Cons(iline,rest) -> Just((iline.fst+1).show + (if (rest.isNil) then "" else " (?)"))
      _ -> Nothing
    }
    */
  }
}

function findLines( source : string, pat : string ) : list<int> {
  val slines  = source.lines.list.map(fun(line) { line.latexStrip })
  val slens   = slines.map(fun(s){ s.length })
  val offsets = findOffsets( slines.join, pat )
  offsets.map fun(ofs) {
    var total := 0
    var current := 1
    slens.foreachUntil fun(len) {
      total := total + len
      if (total > ofs) then return Just(current) 
      current := current + 1
      Nothing
    }
    current
  }
}

function findOffsets( source : string, pat : string ) : list<int> {
  val i0 = source.indexOf(pat)
  val i1 = source.lastIndexOf(pat)
  if (i0 < 0) then []
  elif (i0 == i1) then [i0]
  else [i0,i1]
}

function latexShowWarnings(texFile:string,logout:string, content:string,opts:options) : io () 
{
  if (opts.verbose<2) then {
    if (opts.verbose>=1) {
      match(logout.find(rxLatexOutput)) {
        Just(cap) -> opts.print(cap.matched,1)
        Nothing -> ()
      }
    }
    return ()
  }

  val warnings = logout.findAll(rxLatexWarning).list.map(fun(cap) { (cap.index,cap.matched) })
  if (warnings.isNil) then return () 

  val texlines = readTextFileDef(texFile,"").lines
  println("")
  warnings.foreach fun(iw) {
    val (index,warning0) = iw
    val warning = warning0.replace(rxLatexBrackets,"")
    val warn = match(warning.find(rxLatexLine)) {
      Nothing   -> {
        // no line no: try to display page
        val pre = match(warning.find(rxLatexOutputActive)) { 
                Just -> {  // find a page
                  val page = match(logout.substr(0,index).findAll(rxLatexPage).list.reverse) {
                    Cons(pcap,_) -> (pcap.groups[1].parseInt.maybe(0,id)+1).show 
                    Nil -> "1"
                  }  
                  "> warning: page " + page + "\n"
                } 
                Nothing -> "" 
              }
        pre + warning
      }
      Just(cap) -> {
        val line = if (cap.groups[2].latexStrip != "") then cap.groups[2] 
                else {
                  val lineNo = cap.groups[1].parseInt.maybe(0,id)
                  texlines.latexFindLine(lineNo)
                }                
        val pre = match(latexFindLineByMatch(line,content)) {
          Nothing -> {
            if (opts.verbose >= 4) then opts.printErr("unable to find line: \n> " + line.latexStrip + "\n")
            ""
          }
          Just(srcLineNo) -> "> warning: source line: " + srcLineNo+ "\n"
        }

        pre + warning + (if (cap.groups[2]=="" && line!="") then "\n> " + line.substr(0,74) else "")
      }
    }
    opts.printErr(warn + "\n")
  }
  match(logout.find(rxLatexOutput)) {
    Just(cap) -> opts.printErr(cap.matched)
    Nothing   -> if (warnings.isCons) opts.printErr("end of latex warnings.")  
  }
}

val rxLatexLine = regex(@"lines?[\s:]*(\d+).*(?:\r?\n([\s\S]*))?") 
val rxLatexOutputActive = regex(@"\output is active\s*$") // only match single line 
val rxLatexPage = regex(@"\s\[(\d+)\s*\]")
val rxLatexOutput = regex(@"^Output written on .*", multiline=True)
val rxLatexBrackets = regex(@"(\s|[\[\]])+$")
val rxLatexWarning = regex(@"^(Overfull|Underfull|[\w ]*[Ww]arning:)[\s\S]*?\n *$", multiline=True)

function latexFindLine( src : vector<string>, lineNo : int, direction : int = 0 ) : div string
{
  val line = latexGetLine(src,lineNo)
  if (line.contains(rxEnd) && direction <= 0) {
    latexFindLine(src,lineNo-1,~1)
  }
  elif (line.contains(rxBegin) && direction >= 0) {
    latexFindLine(src,lineNo+1,1)
  }
  else {
    line
  }
}

val rxEnd = regex(@"^\\end|^\s*(\\?\}\s*)*$",multiline=True)
val rxBegin = regex(@"^\\begin|^\s*(\\?\{})*$",multiline=True)

function latexGetLine( src : vector<string>, lineNo : int ) : string
{
  if (lineNo <= 0 || lineNo > src.length) then "" else {
    catch( { src[lineNo-1] }, fun(_) { "" })
  }
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
  "-p " + pages.map( fun(rng) {
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
                      continue : (int,int) -> io () ) : io () 
{  
  val (plainconvCmd,plainPageAdj) 
    = mathConvImgCmd(Plain, namePlain, xopts.getMathRender, xopts, plainPages )
  val (fullconvCmd,fullPageAdj) 
    = mathConvImgCmd(Full, nameFull, xopts.getMathRenderFull, xopts, fullPages )

  // make sure the output directory exists
  val outDir = combine(namePlain.dirname,xopts.mathImgDir)
  if (!(fexistsSync(outDir))) {
    xopts.print("create image directory: " + outDir)
    mkdirp(outDir)
  }           

  checkCmdToImgVersion(xopts) {
    mathCmdToImg( plainconvCmd, namePlain.dirname, Plain, plainPages, xopts, fun(err1) {
      mathCmdToImg( fullconvCmd, nameFull.dirname, Full, fullPages, xopts, fun(err2) {
        if (err1==0 && err2==0) {
          continue(plainPageAdj,fullPageAdj)
        }
      })
    })
  }
}

function checkCmdToImgVersion( xopts : options, cont : () -> io () ) : io () {
  if (xopts.getMathRender.isSvg || xopts.getMathRenderFull.isSvg) {
    system("dvisvgm --version", fun(err,stdout,stderr) {
      val version = match(stdout.find(rxVersion)) {
        Nothing -> 0
        Just(cap) -> {
          (100*cap.groups[1].parseIntDefault(0)) + cap.groups[2].parseIntDefault(0)
        }
      }
      if (err!=0 || version < 114) {
        xopts.printErr("error: cannot use 'dvisvgm'; ensure you have at least version 1.14 installed")
        xopts.printErr("you can check the version using   : dvisvgm --version")
        xopts.printErr("the latest version is available at: http://dvisvgm.bplaced.net/downloads")
        xopts.printErr("for Windows with TexLive 2015, see: madoko.net/doc/reference.html#dvisvgm")
        xopts.printErr("(otherwise use png instead for math, using 'Math Render: png')")
      }
      else {
        cont()
      }
    })
  }
  else {
    cont()
  }
}
val rxVersion = regex(@"(\d+)(?:\.(\d+)?)?")

function mathConvImgCmd( mode : mathkind, fname : string, mrender : mathrender, xopts : options, pages : pages ) : (string,int) {
  val baseImg = combine(xopts.mathImgDir,fname.stemname)
  match (mrender) {
    Svg -> {
      // extension should be dvi or xdv
      val cmd = xopts.dvisvg.quote + 
                  (if (xopts.mathSvgUseFonts) then "" else " -n") +
                  " -e -j -v3 -d" + xopts.mathSvgPrec.show + " " +
                  dvisvgPages(pages) + 
                  " -o " + (baseImg + "-%1p.svg").quote +
                  " " + fname.basename.quote
      (cmd,0)
    }
    Png | fname.extname==".dvi" -> {
      val cmd = xopts.dvipng.quote + " -T tight -z9 -bg Transparent" + 
                  " -D" + xopts.mathDpi.show +
                  " " + dvipngPages(pages) + 
                  " -o " + (baseImg + "-%d.png").quote +
                  " " + fname.stemname.quote
      (cmd,0)
    }
    Png -> { // extension should be pdf
      val cmd = xopts.convert.quote + " -trim -density " + xopts.mathDpi.show + " " +
                  (fname.basename + pages.convertPages).quote + " " +
                  (baseImg + pages.convertSuffix + ".png").quote      
      (cmd,~1) 
    }
  }
}

function mathCmdToImg( cmd : string, dir : string, mode : mathkind, pages : pages, xopts : options, 
                       continue : (int) -> io () ) : io () 
{  
  if (pages.isNil) return continue(0)

  xopts.print("generating math images...  (" + mode.show + ") (" + pages.pagesShow + ")")
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
                         plainPageAdj : int, fullPageAdj : int,
                         continue : (maybe<(dict<mathinfo>,string)>) -> io () ) : io () {
  xopts.print("analyse and embed math images.")
  val dims2 = extendDim(plainPages, fullPages, texNamePlain, texNameFull, plainPageAdj, fullPageAdj, dimxName, xopts )
  val (mdim2,svgdefs,msg) = dims2.parseMathDim(xopts.mathImgDir, xopts.mathScale, xopts.mathBaseline,xopts.mathSvgShare)
  if (msg.bool) then xopts.print(msg)
  mathImageGC(mdim2,xopts.mathdim,dimxName.dirname)
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
                    plainPageAdj : int, fullPageAdj : int,
                    dimxFile : string, opts : options  ) : io string
{
  var imageSize := 0  
  var imageCount := 0
  var embedSize := 0
  var embedCount := 0  
  val dim = opts.mathdim

  function dimLine( render:mathrender, mode : mathkind, fname : string, 
                    pages : pages, pageAdj : int, line : string ) 
  {
    match(line.find(rxDimLine)) {
      Nothing   -> line
      Just(cap) -> { 
        val pageNo = cap.groups[2].parseInt.maybe(0,id)
        val digest = cap.groups[3]
        val imageStem = fname.stemname + "-" + (pageNo + pageAdj).show
        val imageName = combine(opts.mathImgDir, imageStem.changeExt(render.show) )
        val imageFile = combine(dimxFile.dirname,imageName)
        // trace("read image: " + pageNo.show + ": " + imageFile + ": " + imageFile)
                
        val (iwidth,iheight,size,embed) 
          = match(dim[digest]) {
              Just(mi) | !(pageNo.inside(pages)) 
                -> {                  
                  //trace("known image: " + pageNo.show + ": " + imageFile + ": " + digest)
                  (mi.iwidth,mi.iheight,mi.size,mi.imageData)
                }
              _ -> { 
                match(render) {
                  Png -> {
                    analyzeImagePng( imageFile, opts )
                  }
                  Svg -> {
                    analyzeImageSvg( imageFile, opts, mode )
                  }
                }
              }
            }
        val imageDigestFile = combine(imageFile.dirname,"math-" + digest + imageFile.extname)
        tryUnlinkSync(imageDigestFile)                              
        if (embed=="") then {
          // give robust name  
          rename(imageFile,imageDigestFile)
        }
        else {
          tryUnlinkSync(imageFile) // delete the image
        }

        //if (iwidth<=0.0 || iheight<=0.0) then line else 
        if (embed == "") then {
          imageSize  := imageSize + size
          imageCount := imageCount + 1            
        }
        else {
          embedSize  := embedSize + size
          embedCount := embedCount + 1
        }  
        cap.groups[1] + "," + iwidth.show + "pt," + iheight.show + "pt," +
          size.show + "," + render.showMime + (if (embed=="") then "" else (", " + embed))      
      }
    }
  }

  val plainDims = readTextFileDef(texNamePlain.changeExt(".dim"),"")
  val fullDims  = readTextFileDef(texNameFull.changeExt(".dim"),"")
  val dimsx   = plainDims.lines.list.map( fun(line) { 
                  dimLine(opts.getMathRender,Plain,texNamePlain,plainPages,plainPageAdj,line) }) +
                fullDims.lines.list.map( fun(line) { 
                  dimLine(opts.getMathRenderFull,Full,texNameFull,fullPages,fullPageAdj,line) })
  
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
      
      val ppt     = (if (opts.mathDpi > 0) then opts.mathDpi.double else 72.27) / 72.27
      val iheight = pxheight.double / ppt
      val iwidth  = pxwidth.double / ppt

      //trace("image " + cap.groups[2] + ": " + pxwidth.show + "," + pxheight.show)
      val pngprefix = "data:image/png;base64,"

      val embed = if (base64!="" && base64.length + pngprefix.length < opts.mathEmbedLimit)
                    then pngprefix + base64 else ""
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
      // trace("svg: height: " + iheight.show + ", width: " + iwidth.show)
      val embed = if (encoded.length < opts.mathEmbedLimit) then encoded else ""
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

