/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Parsing and formatting of html entities (for TeX output)
module entity

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
    num = if (entity.startsWith("#x") || entity.startsWith("#X")) 
           then "0" + entity.substr(1)
           else entity.substr(1)
    i = num.parseInt.maybe(-1,id)
    match (entities.find(fun(e) { e.ecode == i })) {
      Nothing -> {
        trace("warning: tex output: unknown unicode point: &#" + i.show + ";")
        @"\mdUnicode{" + i.show + "}"
      }
      Just(e) -> e.entityCmd
    }       
  }
  else match(entities.find(fun(e) { e.ename == entity })) {
    Nothing -> {
      trace("warning: tex output: unknown entity: &" + entity + ";")
      @"\mdEntity{" + entity + "}"
    }
    Just(e) -> e.entityCmd
  }
}

public function entityNameToNum( name : string ) : string
{
  match(entities.find(fun(e) { e.ename == name })) {
    Nothing -> {
      trace("warning: unknown entity name: &" + name + ";")
      @"&" + name + ";"
    }
    Just(e) -> "&#" + e.ecode.show + ";"
  }
}

function entityCmd( entity : entity ) : string {
  cmd = "{" + entity.ecmd + "}"
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
  Entity("backslash", 92,   @"\textbackslash", False),
  Entity("caret", 94,   @"\textasciicircum", False),
  Entity("underscore", 95,   @"\_", False),
  Entity("grave", 96,   @"{`}", False),
  Entity("lcurly", 123,  @"\{", False),
  Entity("bar", 124,  @"\textbar", False),
  Entity("rcurly", 124,  @"\}", False),
  Entity("tilde", 126,  @"\textasciitilde", False),

  Entity("nbsp", 160, @"\mdNbsp", False),
  Entity("iexcl", 161, @"\textexclamdown", False),
  Entity("cent", 162, @"\textcent", False),
  Entity("pound", 163, @"\pounds", False),
  Entity("curren", 164, @"\textcurrency", False),
  Entity("yen", 165, @"\textyen", False),
  Entity("brvbar", 166, @"\textbrokenbar", False),
  Entity("sect", 167, @"\S", False),
  Entity("uml", 168, @"\textasciidiaeresis", False),
  Entity("copy", 169, @"\copyright", False),
  Entity("ordf", 170, @"\ordfeminine", False),
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
  Entity("frac34", 190, @"\textthreequarter", False),
  Entity("iquest", 191, @"\textquestiondown", False),
  // Entity("Agrave", 192, @"\", False),
  // Entity("Aacute", 193, "", False),
  // Entity("Acirc", 194, "", False),
  // Entity("Atilde", 195, "", False),
  // Entity("Auml", 196, "", False),
  // Entity("Aring", 197, "", False),
  Entity("AElig", 198, @"\AE", False),
  // Entity("Ccedil", 199, "", False),
  // Entity("Egrave", 200, "", False),
  // Entity("Eacute", 201, "", False),
  // Entity("Ecirc", 202, "", False),
  // Entity("Euml", 203, "", False),
  // Entity("Igrave", 204, "", False),
  // Entity("Iacute", 205, "", False),
  // Entity("Icirc", 206, "", False),
  // Entity("Iuml", 207, "", False),
  Entity("ETH", 208, @"\DH", False),
  // Entity("Ntilde", 209, "", False),
  // Entity("Ograve", 210, "", False),
  // Entity("Oacute", 211, "", False),
  // Entity("Ocirc", 212, "", False),
  // Entity("Otilde", 213, "", False),
  // Entity("Ouml", 214, "", False),
  Entity("times", 215, @"\times", True),
  Entity("Oslash", 216, @"\O", False),
  // Entity("Ugrave", 217, "", False),
  // Entity("Uacute", 218, "", False),
  // Entity("Ucirc", 219, "", False),
  // Entity("Uuml", 220, "", False),
  // Entity("Yacute", 221, "", False),
  Entity("THORN", 222, @"\TH", False),
  Entity("szlig", 223, @"\ss", False),
  // Entity("agrave", 224, "", False),
  // Entity("aacute", 225, "", False),
  // Entity("acirc", 226, "", False),
  // Entity("atilde", 227, "", False),
  // Entity("auml", 228, "", False),
  // Entity("aring", 229, "", False),
  Entity("aelig", 230, @"\ae", False),
  // Entity("ccedil", 231, "", False),
  // Entity("egrave", 232, "", False),
  // Entity("eacute", 233, "", False),
  // Entity("ecirc", 234, "", False),
  // Entity("euml", 235, "", False),
  // Entity("igrave", 236, "", False),
  // Entity("iacute", 237, "", False),
  // Entity("icirc", 238, "", False),
  // Entity("iuml", 239, "", False),
  Entity("eth", 240, @"\dh", False),
  // Entity("ntilde", 241, "", False),
  // Entity("ograve", 242, "", False),
  // Entity("oacute", 243, "", False),
  // Entity("ocirc", 244, "", False),
  // Entity("otilde", 245, "", False),
  // Entity("ouml", 246, "", False),
  Entity("divide", 247, @"\div", True),
  Entity("oslash", 248, @"\o", False),
  // Entity("ugrave", 249, "", False),
  // Entity("uacute", 250, "", False),
  // Entity("ucirc", 251, "", False),
  // Entity("uuml", 252, "", False),
  // Entity("yacute", 253, "", False),
  Entity("thorn", 254, @"\th", False),
  // Entity("yuml", 255, "", False),
  Entity("OElig", 338, @"\OE", False),
  Entity("oelig", 339, @"\oe", False),
  // Entity("Scaron", 352, "", False),
  // Entity("scaron", 353, "", False),
  // Entity("Yuml", 376, "", False),
  Entity("fnof", 402, @"\textit{f}", False),
  Entity("circ", 710, @"\\textasciicircum", False),
  Entity("tilde", 732, @"\textasciitilde", False),
  Entity("Alpha", 913, @"\Alpha", True ),
  Entity("Beta", 914, @"\Beta", True ),
  Entity("Gamma", 915, @"\Gamma", True ),
  Entity("Delta", 916, @"\Delta", True ),
  Entity("Epsilon", 917, @"\Epsilon", True),
  Entity("Zeta", 918, @"\Zeta", True),
  Entity("Eta", 919, @"\Eta", True),
  Entity("Theta", 920, @"\Theta", True),
  Entity("Iota", 921, @"\Iota", True),
  Entity("Kappa", 922, @"\Kappa", True),
  Entity("Lambda", 923, @"\Lambda", True),
  Entity("Mu", 924, @"\Mu", True),
  Entity("Nu", 925, @"\Nu", True),
  Entity("Xi", 926, @"\Xi", True),
  Entity("Omicron", 927, @"\Omicron", True),
  Entity("Pi", 928, @"\Pi", True),
  Entity("Rho", 929, @"\Rho", True),
  Entity("Sigma", 931, @"\Sigma", True),
  Entity("Tau", 932, @"\Tau", True),
  Entity("Upsilon", 933, @"\Upsilon", True),
  Entity("Phi", 934, @"\Phi", True),
  Entity("Chi", 935, @"\Chi", True),
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
  Entity("omicron", 959, @"\omicron", True),
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
  Entity("thetasym", 977, @"\thetasym", True),
  Entity("upsih", 978, @"\Upsilon", True ),
  Entity("piv", 982, @"\varpi", True ),
  Entity("ensp", 8194, @"\hspace{1ex}", False),
  Entity("emsp", 8195, @"\hspace{1em}", False),
  Entity("thinsp", 8201, @"\;", True ),
  Entity("strut", 8203, @"\strut", False ),
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
  Entity("prime", 8242, @"\prime", False),
  Entity("Prime", 8243, @"\doubleprime", False),
  Entity("lsaquo", 8249, @"\guilsingleleft", False),
  Entity("rsaquo", 8250, @"\guilsingleright", False),
  Entity("oline", 8254, "-", False), //TODO
  Entity("frasl", 8260, @"\textfraction", False),
  Entity("euro", 8364, @"\texteuro", False),
  Entity("image", 8465, @"\Im", True ),
  Entity("weierp", 8472, @"\wp", True ),
  Entity("real", 8476, @"\Re", True ),
  Entity("trade", 8482, @"\texttrademark", True),
  Entity("alefsym", 8501, @"\aleph", True),
  Entity("larr", 8592, @"\leftarrow", True),
  Entity("uarr", 8593, @"\uparrow", True),
  Entity("rarr", 8594, @"\rightarrow", True),
  Entity("darr", 8595, @"\downarrow", True),
  Entity("harr", 8596, @"\leftrightarrow", True),
  Entity("crarr", 8629, @"\carriagereturn", True),
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
  Entity("notin", 8713, @"\nin", True),
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
  Entity("nsub", 8836, @"\nsubset", True),
  Entity("sube", 8838, @"\subseteq", True),
  Entity("supe", 8839, @"\supseteq", True),
  Entity("oplus", 8853, @"\oplus", True),
  Entity("otimes", 8855, @"\otimes", True),
  Entity("perp", 8869, @"\bot", True),
  Entity("sdot", 8901, @"\cdot", True),
  Entity("vellip", 8942, @"\vdots", True),
  Entity("lceil", 8968, @"\lceiling", True),
  Entity("rceil", 8969, @"\rceiling", True),
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
  Entity("", 321, @"\L", False),  
  Entity("", 322, @"\l", False),  
  Entity("", 8617, @"\hookleftarrow", True ),  
  Entity("", 8718, @"\Box", True ),  
  Entity("", 9633, @"\Box", True ),
  Entity("checkmark", 10003, @"\checkmark", False ),
  Entity("", 10004, @"\checkmark", False ),   
]

