module process 

import std/path

external import {
  js "child_process"
}
external import {
  js "fs"
}
external import {
  js "mkdirp"
}

public external system( cmd : string, callback : (int,string,string) -> <io|e> (), timeout : int = 0, cwd : string = "") : <io|e> () {
  js inline "child_process.exec(#1,{timeout:#3,cwd:(#4!=''?#4:null)},function(err,stdout,stderr) { (#2)(err?err.code:0,stdout,stderr); });"
}

public type buffer

public external length( b : buffer ) : int {
  js inline "#1.length"
}

public external string( b : buffer, fmt : string ) : string
{
  js inline "#1.toString(#2)"
}

public external readInt1( b : buffer, ofs : int ) : int
{
  js inline "#1.readUInt8(#2)"
}

public external readInt4( b : buffer, ofs : int ) : int
{
  js inline "#1.readInt32BE(#2)"
}


public function tryReadFileSync( fname : string ) : io maybe<buffer> {
  catch({ b = readFileSync(fname); Just(b) },fun(_exn){ Nothing } )
}

public function searchFileSync( dirs : list<string>, fname : string ) : io maybe<string> {
  fnames = Cons("",dirs).map(fun(dir){ combine(dir,fname) })
  fnames.foreachWhile fun(f) {
    if (f.fexists) then Just(f) else Nothing
  }
}


public external readFileSync( fileName : string ) : io buffer
{
  js inline "fs.readFileSync(#1)"
}

public external unlink( fname : string ) : io ()
{
  js inline "fs.unlinkSync(#1)"
}

public external fexists( fname : string ) : io bool {
  js inline "(fs.existsSync(#1) != 0)"
}

public external mkdir( dir : string, mode : int = 0x1FF ) : io () {
  js inline "fs.mkdirSync(#1,#2)"
}

public external mkdirp( dir : string, mode : int = 0x1FF ) : io () {
  js inline "require('mkdirp').sync(#1,#2)"
}

public external rename( fnameOld : string, fnameNew : string ) : io () {
  js inline "fs.renameSync(#1,#2)"
}