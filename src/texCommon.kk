/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Common TeX entities

module texCommon

import std/dict
import std/regex
import common

public val texAccents = [
  ("`","grave"),
  ("'","acute"),
  ("^","circ"),
  ("\"","uml"),
  ("~","tilde"),
  ("r","ring"),
  ("c","cedil"),
  ("v","caron"),  
].dict

public val rxAuthorYear = regex(@"(.*?)(?:[,;](?: |&nbsp;|\\ )*\(?|(?: |&nbsp;|\\ )*\(?)(\d\d\d\d[\w\-]*)?\)?(?: *[,;] *)?(.*)$")


function texnest(s:string)  = @"(?:" + texval + @"|(?:\{" + s + @"\}))"
val texcmd   = @"\\[@a-zA-Z]+\b\s*"
val texval   = @"(?:[^\\{}]|" + texcmd + @"|\\.\s*)"
val texarg0  = texval + "*"
val texarg1  = texnest(texarg0) + "*"
val texarg2  = texnest(texarg1) + "*"
val texarg3  = texnest(texarg2) + "*"

public val texarg   = @"(" + texnest(texarg3) + @")"
public val texargs  = @"(" + texnest(texarg3) + "*)"

public val optarg   = @"(?:\[([^\]]*)\])"
public val optargs  = optarg + @"*"

// captures most tex commands
public val rxTexCmd = @"(?:\\(?:begin|end)\b\s*" + optargs + texarg + "|" + texcmd + optargs + ")"
