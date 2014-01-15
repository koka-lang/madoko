module process 

external import {
  js "child_process"
}

public external system( cmd : string, callback : (int,string,string) -> <io|e> (), timeout : int = 0, cwd : string = "") : <io|e> () {
  js inline "child_process.exec(#1,{timeout:#3,cwd:(#4!=''?#4:null)},function(err,stdout,stderr) { (#2)(err?err.code:0,stdout,stderr); });"
}
