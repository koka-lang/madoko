/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Parsing and formatting of html entities (for TeX output)
module entity

import common  // warning

struct entity(
  ename : string,
  ecode : int,
  ecmd  : string,
  emath  : bool = False
)

// Convert an html entity to a LaTeX command.
// Takes as input the string between the `&` and `;` of a HTML entity.
public function entityToTex( entity : string ) : string 
{
  if (entity.startsWith("#")) {
    val num = if (entity.startsWith("#x") || entity.startsWith("#X")) 
           then "0" + entity.substr(1)
           else entity.substr(1)
    val i = num.parseInt.maybe(~1,id)
    match (entities.find(fun(e) { e.ecode == i })) {
      Nothing -> {
        warning( "unknown unicode point: &#" + num + ";", "texwarning")
        @"\mdUnicode{" + i.show + "}"
      }
      Just(e) -> e.entityCmd
    }       
  }
  else match(entities.find(fun(e) { e.ename == entity })) {
    Nothing -> {
      warning( "unknown entity: &" + entity + ";", "texwarning")
      @"\mdEntity{" + entity + "}"
    }
    Just(e) -> e.entityCmd
  }
}

public function entityNameAsNum( name : string ) : maybe<string> 
{
  if (name=="nl") then Just("\n")
  elif (name=="br") then Just("\\\n")
  elif (name=="null") then Just("")
  else match(entities.find(fun(e) { e.ename == name })) {
    Nothing -> Nothing
    Just(e) -> Just("&#" + e.ecode.show + ";")
  }  
}

public function entityNameToNum( name : string ) : string
{
  match(name.entityNameAsNum) {
    Just(e) -> e
    Nothing -> {
      warning( "unknown entity name: &" + name + ";")
      @"&" + name + ";"
    }
  }
}

function entityCmd( entity : entity ) : string {
  val cmd = "{" + entity.ecmd + "}"
  if (entity.emath) then @"\ensuremath" + cmd else cmd
}

// Translate a TeX command to an entity (or empty if unknown)
public function texCmdToEntity( cmd : string ) : string {
  match (entities.find( fun(e) { e.ecmd == cmd } )) {
    Nothing -> ""
    Just(e) -> "&" + e.ename + ";"
  }
}


// The entity table
val entities : list<entity> = [
  // named entities 
  Entity("quot", 34, @"""", False),
  Entity("hash", 35, @"\#", False),
  Entity("dollar", 36, @"\$", False),
  Entity("perc", 37, @"\%", False),
  Entity("amp", 38, @"\&", False),
  Entity("apos", 39, "'", False),  
  Entity("lpar", 40, "(", False),  
  Entity("rpar", 41, ")", False),  
  Entity("ast", 42, "*", False),  
  Entity("plus", 43, "+", False),  
  Entity("fslash", 47, "/", False),  
  Entity("lt", 60, @"\textless", False),
  Entity("gt", 62, @"\textgreater", False),
  Entity("bslash", 92,   @"\textbackslash", False),
  Entity("backslash", 92,   @"\textbackslash", False),
  Entity("caret", 94,   @"\textasciicircum", False),
  Entity("underscore", 95,   @"\_", False),
  Entity("grave", 96,   @"{`}", False),
  Entity("lcurly", 123,  @"\{", False),
  Entity("bar", 124,  @"\textbar", False),
  Entity("rcurly", 125,  @"\}", False),
  Entity("tilde", 126,  @"\textasciitilde", False),

  Entity("nbsp", 160, @"\mdNbsp", False),
  Entity("iexcl", 161, @"\textexclamdown", False),
  Entity("cent", 162, @"\textcent", False),
  Entity("pound", 163, @"\pounds", False),
  Entity("curren", 164, @"\textcurrency", False),
  Entity("yen", 165, @"\textyen", False),
  Entity("brvbar", 166, @"\textbrokenbar", False),
  Entity("sect", 167, @"\S", False),
  Entity("uml", 168, @"\textasciidieresis", False),
  Entity("copy", 169, @"\copyright", False),
  Entity("ordf", 170, @"\textordfeminine", False),
  Entity("laquo", 171, @"\guillemotleft", False),
  Entity("not", 172, @"\textlnot", False),
  Entity("shy", 173, @"\-", False),
  Entity("reg", 174, @"\circledR", False),
  Entity("macr", 175, @"\textasciimacron", False),
  Entity("deg", 176, @"\textdegree", False),
  Entity("plusmn", 177, @"\textpm", False),
  Entity("sup2", 178, @"\texttwosuperior", False),
  Entity("sup3", 179, @"\textthreesuperior", False),
  Entity("acute", 180, @"\textasciiacute", False),
  Entity("micro", 181, @"\textmu", False),
  Entity("para", 182, @"\P", False),
  Entity("middot", 183, @"\textperiodcentered", False),
  Entity("cedil", 184, @"\c{}", False),
  Entity("sup1", 185, @"\textonesuperior", False),
  Entity("ordm", 186, @"\textordmasculine", False),
  Entity("raquo", 187, @"\guillemotright", False),
  Entity("frac14", 188, @"\textonequarter", False),
  Entity("frac12", 189, @"\textonehalf", False),
  Entity("frac34", 190, @"\textthreequarters", False),
  Entity("iquest", 191, @"\textquestiondown", False),
  Entity("Agrave", 192, @"\`{A}", False), // accent
  Entity("Aacute", 193, @"\'{A}", False), // accent
  Entity("Acirc", 194,  @"\^{A}", False), // accent
  Entity("Atilde", 195, @"\~{A}", False), // accent
  Entity("Auml", 196,   @"\""{A}", False), // accent
  Entity("Aring", 197,  @"\r{A}", False), // accent
  Entity("AElig", 198, @"\AE", False),
  Entity("Ccedil", 199, @"\c{C}", False), // accent
  Entity("Egrave", 200, @"\`{E}", False), // accent
  Entity("Eacute", 201, @"\'{E}", False), // accent
  Entity("Ecirc", 202, @"\^{E}", False), // accent
  Entity("Euml", 203, @"\""{E}", False), // accent
  Entity("Igrave", 204, @"\`{I}", False), // accent
  Entity("Iacute", 205, @"\'{I}", False), // accent
  Entity("Icirc", 206, @"\c{I}", False), // accent
  Entity("Iuml", 207, @"\""{I}", False), // accent
  Entity("ETH", 208, @"\DH", False),
  Entity("Ntilde", 209, @"\~{N}", False), // accent
  Entity("Ograve", 210, @"\`{O}", False), // accent
  Entity("Oacute", 211, @"\'{O}", False), // accent
  Entity("Ocirc", 212, @"\^{O}", False), // accent
  Entity("Otilde", 213, @"\~{O}", False), // accent
  Entity("Ouml", 214, @"\""{O}", False), // accent
  Entity("times", 215, @"\times", True),
  Entity("Oslash", 216, @"\O", False),
  Entity("Ugrave", 217, @"\`{U}", False), // accent
  Entity("Uacute", 218, @"\'{U}", False), // accent
  Entity("Ucirc", 219, @"\^{U}", False), // accent
  Entity("Uuml", 220, @"\""{U}", False), // accent
  Entity("Yacute", 221, @"\'{Y}", False), // accent
  Entity("THORN", 222, @"\TH", False),
  Entity("szlig", 223, @"\ss", False),
  Entity("agrave", 224, @"\`{a}", False), // accent
  Entity("aacute", 225, @"\'{a}", False), // accent
  Entity("acirc", 226, @"\^{a}", False), // accent
  Entity("atilde", 227, @"\~{a}", False), // accent
  Entity("auml", 228, @"\""{a}", False), // accent
  Entity("aring", 229, @"\r{a}", False), // accent
  Entity("aelig", 230, @"\ae", False),
  Entity("ccedil", 231, @"\c{c}", False), // accent
  Entity("egrave", 232, @"\`{e}", False), // accent
  Entity("eacute", 233, @"\'{e}", False), // accent
  Entity("ecirc", 234, @"\^{e}", False), // accent
  Entity("euml", 235, @"\""{e}", False), // accent
  Entity("igrave", 236, @"\`{\i}", False), // accent
  Entity("iacute", 237, @"\'{\i}", False), // accent
  Entity("icirc", 238, @"\^{\i}", False), // accent
  Entity("iuml", 239, @"\""{\i}", False), // accent
  Entity("eth", 240, @"\dh", False),
  Entity("ntilde", 241, @"\~{n}", False), // accent
  Entity("ograve", 242, @"\`{o}", False), // accent
  Entity("oacute", 243, @"\'{o}", False), // accent
  Entity("ocirc", 244, @"\^{o}", False), // accent
  Entity("otilde", 245, @"\~{o}", False), // accent
  Entity("ouml", 246, @"\""{o}", False), // accent
  Entity("divide", 247, @"\div", True),
  Entity("oslash", 248, @"\o", False),
  Entity("ugrave", 249, @"\`{u}", False), // accent
  Entity("uacute", 250, @"\'{u}", False), // accent
  Entity("ucirc", 251, @"\^{u}", False), // accent
  Entity("uuml", 252, @"\""{u}", False), // accent
  Entity("yacute", 253, @"\'{y}", False), // accent
  Entity("thorn", 254, @"\th", False),
  Entity("yuml", 255, @"\""{y}", False), // accent
  Entity("Lstroke", 321, @"\L", False),  
  Entity("lstroke", 322, @"\l", False),  
  Entity("OElig", 338, @"\OE", False),
  Entity("oelig", 339, @"\oe", False),
  Entity("Scaron", 352, @"\u{S}", False), // accent
  Entity("scaron", 353, @"\u{s}", False), // accent
  Entity("Yuml", 376, @"\""{Y}", False), // accent
  Entity("fnof", 402, @"\textit{f}", False),
  Entity("circ", 710, @"\textasciicircum", False),
  Entity("tilde", 732, @"\textasciitilde", False),
  Entity("Alpha", 913, @"A", False ),
  Entity("Beta", 914, @"B", False ),
  Entity("Gamma", 915, @"\Gamma", True ),
  Entity("Delta", 916, @"\Delta", True ),
  Entity("Epsilon", 917, @"E", False),
  Entity("Zeta", 918, @"Z", False),
  Entity("Eta", 919, @"H", False),
  Entity("Theta", 920, @"\Theta", True),
  Entity("Iota", 921, @"I", False),
  Entity("Kappa", 922, @"K", False),
  Entity("Lambda", 923, @"\Lambda", True),
  Entity("Mu", 924, @"M", False),
  Entity("Nu", 925, @"N", False),
  Entity("Xi", 926, @"\Xi", True),
  Entity("Omicron", 927, @"O", False),
  Entity("Pi", 928, @"\Pi", True),
  Entity("Rho", 929, @"P", False),
  Entity("Sigma", 931, @"\Sigma", True),
  Entity("Tau", 932, @"T", False),
  Entity("Upsilon", 933, @"\Upsilon", True),
  Entity("Phi", 934, @"\Phi", True),
  Entity("Chi", 935, @"X", False),
  Entity("Psi", 936, @"\Psi", True),
  Entity("Omega", 937, @"\Omega", True),
  Entity("alpha", 945, @"\alpha", True),
  Entity("beta", 946, @"\beta", True),
  Entity("gamma", 947, @"\gamma", True),
  Entity("delta", 948, @"\delta", True),
  Entity("epsilon", 949, @"\epsilon", True),
  Entity("zeta", 950, @"\zeta", True),
  Entity("eta", 951, @"\eta", True),
  Entity("theta", 952, @"\theta", True),
  Entity("iota", 953, @"\iota", True),
  Entity("kappa", 954, @"\kappa", True),
  Entity("lambda", 955, @"\lambda", True),
  Entity("mu", 956, @"\mu", True),
  Entity("nu", 957, @"\nu", True),
  Entity("xi", 958, @"\xi", True),
  Entity("omicron", 959, @"o", True),
  Entity("pi", 960, @"\pi", True),
  Entity("rho", 961, @"\rho", True),
  Entity("sigmaf", 962, @"\varsigma", True),
  Entity("sigma", 963, @"\sigma", True),
  Entity("tau", 964, @"\tau", True),
  Entity("upsilon", 965, @"\upsilon", True),
  Entity("phi", 966, @"\varphi", True),
  Entity("chi", 967, @"\chi", True),
  Entity("psi", 968, @"\psi", True),
  Entity("omega", 969, @"\omega", True),
  Entity("thetasym", 977, @"\vartheta", True),
  Entity("upsih", 978, @"\Upsilon", True ),
  Entity("piv", 982, @"\varpi", True ),
  Entity("ensp", 8194, @"\enspace", False),
  Entity("emsp", 8195, @"\hspace{1em}", False),
  Entity("quad", 8195, @"\quad", False),
  Entity("thicksp", 8196, @"\;", True ),
  Entity("medsp", 8197, @"\:", True ),
  Entity("thinsp", 8201, @"\,", True ),
  Entity("strut", 8203, @"\strut", False ),
  Entity("pagebreak", 12, @"\newpage", False), //use form feed character
  Entity("zwnj", 8204, "", False),
  Entity("zwj", 8205, "", False),
  Entity("lrm", 8206, "", False),
  Entity("rlm", 8207, "", False),
  Entity("ndash", 8211, @"\textendash", False),
  Entity("mdash", 8212, @"\textemdash", False),
  Entity("lsquo", 8216, @"\textquoteleft", False),
  Entity("rsquo", 8217, @"\textquoteright", False),
  Entity("sbquo", 8218, @"\quotesinglbase", False),
  Entity("ldquo", 8220, @"\textquotedblleft", False),
  Entity("rdquo", 8221, @"\textquotedblright", False),
  Entity("bdquo", 8222, @"\quotedblbase", False),
  Entity("dagger", 8224, @"\dag", True ),
  Entity("Dagger", 8225, @"\ddag", True ),
  Entity("bull", 8226, @"\textbullet", False),
  Entity("hellip", 8230, @"\dots", False),
  Entity("permil", 8240, @"\textperthousand", False),
  Entity("prime", 8242, @"\prime", True),
  Entity("Prime", 8243, @"\prime\prime", True),
  Entity("lsaquo", 8249, @"\guilsinglleft", False),
  Entity("rsaquo", 8250, @"\guilsinglright", False),
  Entity("oline", 8254, "-", False), //TODO
  Entity("frasl", 8260, @"\textfraction", False),
  Entity("euro", 8364, @"\texteuro", False),
  Entity("image", 8465, @"\Im", True ),
  Entity("weierp", 8472, @"\wp", True ),
  Entity("real", 8476, @"\Re", True ),
  Entity("CC", 8450, @"\mathbb{C}", True ),
  Entity("NN", 8469, @"\mathbb{N}", True ),
  Entity("PP", 8473, @"\mathbb{P}", True ),
  Entity("QQ", 8474, @"\mathbb{Q}", True ),
  Entity("RR", 8477, @"\mathbb{R}", True ),
  Entity("ZZ", 8484, @"\mathbb{Z}", True ),
  Entity("trade", 8482, @"\texttrademark", False),
  Entity("alefsym", 8501, @"\aleph", True),
  Entity("larr", 8592, @"\leftarrow", True),
  Entity("uarr", 8593, @"\uparrow", True),
  Entity("rarr", 8594, @"\rightarrow", True),
  Entity("darr", 8595, @"\downarrow", True),
  Entity("harr", 8596, @"\leftrightarrow", True),
  Entity("crarr", 8629, @"\hookleftarrow", True),
  Entity("lArr", 8656, @"\Leftarrow", True),
  Entity("uArr", 8657, @"\Uparrow", True),
  Entity("rArr", 8658, @"\Rightarrow", True),
  Entity("dArr", 8659, @"\Downarrow", True),
  Entity("hArr", 8660, @"\Leftrightarrow", True),
  Entity("forall", 8704, @"\forall", True),
  Entity("part", 8706, @"\partial", True),
  Entity("exist", 8707, @"\exists", True),
  Entity("empty", 8709, @"\varnothing", True),
  Entity("nabla", 8711, @"\nabla", True),
  Entity("isin", 8712, @"\in", True),
  Entity("notin", 8713, @"\notin", True),
  Entity("ni", 8715, @"\ni", True),
  Entity("prod", 8719, @"\prod", True),
  Entity("sum", 8721, @"\sum", True),
  Entity("minus", 8722, @"{-}", True),
  Entity("lowast", 8727, @"\ast", True),
  Entity("radic", 8730, @"\surd", True),
  Entity("prop", 8733, @"\propto", True),
  Entity("infin", 8734, @"\infty", True),
  Entity("ang", 8736, @"\angle", True),
  Entity("and", 8743, @"\wedge", True),
  Entity("or", 8744, @"\vee", True),
  Entity("cap", 8745, @"\cap", True),
  Entity("cup", 8746, @"\cup", True),
  Entity("int", 8747, @"\intop", True),
  Entity("there4", 8756, @"\therefore", True),
  Entity("sim", 8764, @"\sim", True),
  Entity("cong", 8773, @"\cong", True),
  Entity("asymp", 8776, @"\approx", True),
  Entity("ne", 8800, @"\neq", True),
  Entity("equiv", 8801, @"\equiv", True),
  Entity("le", 8804, @"\leq", True),
  Entity("ge", 8805, @"\geq", True),
  Entity("sub", 8834, @"\subset", True),
  Entity("sup", 8835, @"\supset", True),
  Entity("nsub", 8836, @"\subsetneq", True),
  Entity("sube", 8838, @"\subseteq", True),
  Entity("supe", 8839, @"\supseteq", True),
  Entity("oplus", 8853, @"\oplus", True),
  Entity("otimes", 8855, @"\otimes", True),
  Entity("perp", 8869, @"\bot", True),
  Entity("sdot", 8901, @"\cdot", True),
  Entity("vellip", 8942, @"\vdots", True),
  Entity("lceil", 8968, @"\lceil", True),
  Entity("rceil", 8969, @"\rceil", True),
  Entity("lfloor", 8970, @"\lfloor", True),
  Entity("rfloor", 8971, @"\rfloor", True),
  Entity("lang", 9001, @"\langle", True),
  Entity("rang", 9002, @"\rangle", True),
  Entity("loz", 9674, @"\lozenge", True),
  Entity("spades", 9824, @"\spadesuit", True),
  Entity("clubs", 9827, @"\clubsuit", True),
  Entity("hearts", 9829, @"\heartsuit", True),
  Entity("diams", 9830, @"\diamondsuit", True),

  // unnamed entities
  Entity("hooklarr", 8617, @"\hookleftarrow", True ),  
  Entity("bbox", 8718, @"\blacksquare", True ),  
  Entity("box", 9633, @"\Box", True ),
  Entity("ballotbox", 9744, @"\Box", True ),
  Entity("ballotc", 9745, @"\mdUnicode{9745}", False ),
  Entity("ballotx", 9746, @"\mdUnicode{9746}", False ),
  Entity("checkmark", 10003, @"\ding{51}", False ),
  Entity("bcheckmark", 10004, @"\ding{52}", False ),   
  Entity("xmark", 10007, @"\ding{55}", False ),
  Entity("bxmark", 10008, @"\ding{56}", False ),   
  Entity("mglass", 128270, @"\mdUnicode{128270}", False )
]

