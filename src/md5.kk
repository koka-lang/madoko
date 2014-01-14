module md5 

external import {
  js "crypto"
}

public external md5( s : string ) : string {
  js inline "crypto.createHash('md5').update(#1).digest('hex')"
}
