module process 

external import {
  js "child_process"
}
external import {
  js "fs"
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

public external readFileSync( fileName : string ) : io buffer
{
  js inline "fs.readFileSync(#1)"
}

public external unlink( fname : string ) : io ()
{
  js inline "fs.unlinkSync(#1)"
}