module includes 

import std/log
import std/regex
import std/path
import std/dict
import common
import options
import block    // for lineMap
import storage

struct snippet(
  fileName : string,
  startLine: int,
  content  : string
)

public function include( text : string, fast : bool, inName : string, outName : string, dirs : list<string>, options : options, action : (string,lineMap) -> <io|e> a ) : <io|e> a {
  if (fast) then return action(text,End) 

  val includes : mdict<global,string> = mdict()
  val snippets : mdict<global,snippet> = mdict()
  val rxSnippetStart = regex(options.extractStart, multiline=True, ignoreCase=True)
  val rxSnippetEnd = regex(options.extractEnd, multiline=True, ignoreCase=True)

  function warning( msg, lineNo = 0, fileName = "") {
    options.printErr( "warning: " + 
             (if (fileName != "" || lineNo > 0)
               then fileName + (if (lineNo > 0) then " (" + lineNo.show + ")" else "") + ": "
               else "") +
             msg )
  }

  function extractSnippet( name, content, fname, lineNo, acc = [] ) : io (list<string>,int) {
    match(content) {
      Nil -> {
        warning("unclosed snippet: " + name, lineNo, fname )
        (Nil,lineNo)
      }
      Cons(line,lines) -> {
        match(line.find(rxSnippetEnd)) {
          Nothing -> match(line.find(rxSnippetStart)) {
            Nothing -> {
              extractSnippet( name, lines, fname, lineNo+1,  Cons(line,acc))
            }
            Just(cap) -> {
              // embedded snippet: extract separately 
              extractSnippet( cap.groups[1].toLower(), lines, fname, lineNo+1 )
              // and for this snippet, ignore this line
              extractSnippet( name, lines, fname, lineNo+1, acc )
            }
          }
          Just(cap) -> {
            val cname = cap.groups[1].toLower()
            if (name == cname) {
              // end of snippet
              if (snippets[name].isJust) {
                warning( "snippet " + name + " is redefined", lineNo, fname )
              }
              snippets[name] := Snippet(fname, lineNo, acc.reverse.join("\n"))
              (lines,lineNo+1)
            }
            else {
              // end of another snippet, ignore it
              extractSnippet( name, lines, fname, lineNo+1, acc )
            }
          }
        }
      }
    }
  }

  function findSnippets( content : list<string>, fname : string, lineNo : int = 1) : io () {
    match(content) {
      Nil -> ()
      Cons(line,lines) -> {
        //trace("find snippet: " + line)
        match(line.find(rxSnippetStart)) {
          Nothing -> findSnippets( lines, fname, lineNo+1 )
          Just(cap) -> {
            val name = cap.groups[1].toLower()
            val (rest, endLineNo) = extractSnippet( name, lines, fname, lineNo+1 )
            findSnippets( rest, fname, endLineNo )
          }
        }
      }
    }
  }

  function readInclude( fname : string, srcname, lineNo ) : io (string,string) 
  {
    if (fname=="") then {
      ("","\n")  // happens for snippet only includes
    }
    elif (fname.startsWith("BIB=")) then {
      val bblName  = if (fname=="BIB=") then outName.appendStem("-bib") else fname.substr(4)
      val fileName = bblName.changeExt(".bbl")
      match (includes[fileName]) {
        Just(content) -> (fname,content)
        Nothing -> {
          val bbl = readTextFileDef( fileName, "", True)  
          val content = ("~ Begin Bib { filename: \"" + fileName.noext + "\" }\n" + 
                         (if (bbl=="") then "\\begin{thebibliography}{00}\n\\end{thebibliography}\n" 
                                       else bbl) + 
                         "\n~ End Bib\n")
          includes[fileName] := content
          (fileName,content)
        }
      }
    }
    else {
      // avoid including recursively
      val searchName = if (fname.extname == "") then fname + ".mdk" else fname;
      val searchDirs = if (inName.basename != searchName) then dirs 
                        else dirs.filter( fun(dir) { dir != inName.dirname });
      // .. and search
      match (trySearchReadTextFile(fname,searchDirs,".mdk")) {
        Nothing -> {
          val fileName = if (extname(fname)=="") then fname + ".mdk" else fname
          log("files", fileName)
          warning("unable to read include: " + fname, lineNo, srcname )
          (fileName,"")
        }
        Just((fileName,content)) -> {
          match(includes[fileName]) {
            Just -> ()
            Nothing -> {
              includes[fileName] := content
              content.lines.list.findSnippets(fileName) // record snippets only once
            }
          }
          (fileName,content)
        } 
      }
    }
  }

  val rxRange = regex(@"^(\d+)(?:--?(\d+))?$")
  val rxSnippetName = regex(@"^(\w+)$")
  function findRange( incfile: string, incline: string, range : string, content : string, fname : string, lineNo : int ) : io (string,int,string)
  {
    if (range=="") return (incfile, 1,content)
    match(range.find(rxRange)) {
      Nothing -> {
        match(range.find(rxSnippetName)) {
          Nothing -> {
            warning( "invalid include range: " + incline, lineNo, fname )
            (incfile,1,content)
          }
          Just(cap) -> {
            // snippet name
            match(snippets[cap.groups[1].toLower()]) {
              Nothing -> {
                warning( "unknown snippet name: " + cap.groups[1], lineNo, fname )
                (incfile,1,content)
              }
              Just(Snippet(fileName,start,fragment)) -> {
                (fileName,start,fragment)
              }
            }
          }
        }
      }
      Just(cap) -> {
        val start = cap.groups[1].parseInt().maybe(1,id)
        if (start<=0) return (incfile,0,"")
        val end   = max(start,cap.groups[2].parseInt().maybe(start,id))
        val fragment = content.lines.list.drop(start-1).take((end - start) + 1).join("\n")
        //trace("include: " + start.show + "," + end.show + ":\n" + fragment)
        (incfile,start,fragment)
      }
    }
  }

  function processIncludes( txt : string, fname : string ) : io (int,lineMap,string)
  {
    val prelude = match(txt.findAll(rxPrelude).list.reverse) { // find last prelude definition
      Cons(cap) -> {
        val value = cap.groups[1]
        val lvalue = value.toLower()
        if (lvalue=="none" || lvalue=="clear" || lvalue=="false") then "" else value
      }
      Nil -> options.prelude
    }
    processIncludesRec(txt,fname,1,prelude)
  }

  function processIncludeLine( fname : string, line : string, lineMap, lineNo : int, extra : int = 0 ) : io (string,lineMap,int)
  {
    val mbincname = match (line.find(rxInclude)) {
      Just(cap) -> Just((cap.matched,cap.groups.firstMatched(1,3),cap.groups[4]))
      Nothing -> match(line.find(rxBib)) {
        Just(cap) -> Just((cap.matched,"BIB=" + cap.groups.firstMatched(1,3), ""))
        Nothing   -> Nothing 
      }
    }
    match(mbincname) { 
      Nothing -> (line,lineMap,1)
      Just((matched,incname,range)) -> {
        val (fileName0,content) = readInclude(incname,fname,lineNo)
        val (fileName,istart,fragment) = fileName0.findRange(matched, range, content, fname, lineNo);
        if (istart<=0) 
         then ("",lineMap,1)
         else {
          val (lcount,lmap,icontent) = processIncludesRec( fragment, fileName, istart )
          val lineMapNew = Include(lineNo,istart,lcount+extra,fileName,lmap,lineMap)
          //lineCount := lineCount + lcount - 1
          //trace("include: " + lineNo.show + ", " + lcount.show + ", " + lineCount.show)
          (icontent, lineMapNew, lcount)
        }
      }
    }
  }

  function processIncludesRec( txt : string, fname : string, start : int = 1, prelude : string = ""  ) : io (int,lineMap,string)
  {
    if (start<=0) return (0,End,"")
    var lineNo := start-1
    var lineCount := 0
    var lineMap := End
    val preludeTxt = 
      if (prelude != "") {
        val (icontent,lmap,lcount) = processIncludeLine(fname,"[INCLUDE=\"" + prelude + "\"]",lineMap,lineNo,1)
        lineCount := lineCount + lcount 
        lineMap   := lmap
        icontent + "\n"
      }
      else ""
    val ls = txt.lines.map fun(line) {
      lineNo := lineNo + 1;
      //lineCount := lineCount + 1;
      val (icontent,lmap,lcount) = processIncludeLine(fname,line,lineMap,lineNo)
      lineCount := lineCount + lcount
      lineMap   := lmap
      icontent
      /*
      match (line.find(rxInclude)) {
        Nothing -> line
        Just(cap) -> {
          val incname = cap.groups.firstMatched(1,4)
          val (fileName0,content) = readInclude(incname,fname,lineNo)
          val (fileName,istart,fragment)  = fileName0.findRange(cap.matched, cap.groups[5], content, fname, lineNo);
          if (istart<=0) then "" else {
            val (lcount,lmap,icontent) = processIncludesRec( fragment, fileName, istart )
            lineMap := Include(lineNo,istart,lcount,fileName,lmap,lineMap)
            lineCount := lineCount + lcount - 1
            //trace("include: " + lineNo.show + ", " + lcount.show + ", " + lineCount.show)
            icontent
          }
        }
      }
      */
    }

    (lineCount, lineMap.reverse, preludeTxt + ls.unlines)
  }

  val (_lcount,lmap,content) = processIncludes(text,inName)
  action(content,lmap)
}
val rxInclude = regex(@"^ {0,3}\[(?:INCLUDE *(?:= *(?:""([^""\n]+)""|'([^'\n]+)'|([^\s:=\]]+)) *)?(?:[:] *([\w\-]+))?)\] *(?=\n|$)",multiline=True)
val rxBib     = regex(@"^ {0,3}\[BIB *(?:= *(?:""([^""\n]+)""|'([^'\n]+)'|([^\s:=\]]+)) *)?\] *(?=\n|$)",multiline=True)
val rxPrelude = regex(@"^ {0,3}[Pp]relude[ \t]*:[ \t]*(\S*)[ \t\r]*(\n|$)",multiline=True)

public function searchReadTextFileDef( fname : string, def : string, dirs : list<string>, ext : string = "", required : bool = True ) : io string {
  match(trySearchReadTextFile(fname,dirs,ext,required)) {
    Nothing -> def
    Just((_,content)) -> content
  } 
}

public function trySearchReadTextFile( fname : string, dirs : list<string>, ext : string = "", required : bool = True  ) : io maybe<(string,string)> {
  match(searchFileSync(dirs,fname)) {
    Nothing -> {
      if (ext=="" || fname.extname != "") then Nothing else {
        match (searchFileSync(dirs,fname.changeExt(ext))) {
          Nothing -> Nothing
          Just(fullname) -> tryReadTextFile(fullname,required).maybe.maybe(Nothing,fun(txt){ Just((fullname,txt)) })
        }
      }
    } 
    Just(fullname) -> tryReadTextFile(fullname,required).maybe.maybe(Nothing,fun(txt){ Just((fullname,txt)) })
  }
}
