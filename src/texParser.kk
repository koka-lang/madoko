/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// The parsing and formatting of TeX blocks.
//
// The capabilities are fairly limited and mostly geared to be able to
// parse bibtex entries. Accent and special character commands are quite well
// recognized in order to allow author names with correct accent characters.
module texParser

import std/dict
import std/string
import std/regex
import common
import entity

/* --------------------------------------
  Latex grammar 
---------------------------------------- */
alias texRule = rule<string,texContext>

val special = @"\\{}~*_\[\]#\$`";



function texnest(s:string)  = @"(?:" + texval + @"|(?:\{" + s + @"\}))"
val texcmd   = @"\\[@a-zA-Z]+\b\s*"
val texval   = @"(?:[^\\{}]|" + texcmd + @"|\\.\s*)"
val texarg0  = texval + "*"
val texarg1  = texnest(texarg0) + "*"
val texarg2  = texnest(texarg1) + "*"
val texarg3  = texnest(texarg2) + "*"
val texarg   = @"(" + texnest(texarg3) + @")"
val texargs  = @"(" + texnest(texarg3) + "*)"

val optarg   = @"(?:\[([^\]]*)\])"
val optargs  = optarg + @"*"
val texenv1  = @"(thebibliography)"
val texcmd1  = @"(begin|end|newlength|setlength|bibfield|BibitemShut)"
val texcmd2  = @"(newcommand|renewcommand|providecommand|bibitemdeclare)"

// captures most tex commands
public val rxTexCmd = @"(?:\\(?:begin|end)\b\s*" + optargs + texarg + "|" + texcmd + optargs + ")"

val texGrammar : grammar<string,texContext> = [
  Rule("texnormal",   regex(@"^(?:[^" + special + "])+"), texNormal ),
  
  Rule("texmath1",    regex(@"^(?:\$(?:[^\\\$]|\\.)+\$|\\\((?:[^\\]|\\[^\)])*\\\))"), texNormal ),
  Rule("texmath2",    regex(@"^(?:\$\$(?:[^\\\$]|\\.|\$(?!\$))*\$\$|\\\[(?:[^\\]|\\[^\]])*\\\])"), texNormal ),

  Rule("biblio",      regex(@"^\\begin\{thebibliography\}\s*(?:\{([^}]+)\})?(?: *\n)*([\s\S]*?)\\end{thebibliography}"), texBibliography ),
  Rule("bibitem",     regex(@"^\\bibitem\b\s*" + optarg + "?" + texarg + @"(?: *\n)*([\s\S]*?)\n(?= *\n|\\bibitem)"), texBibitem ),
  Rule("harvarditem", regex(@"^\\harvarditem\b\s*" + optarg + "?" + texarg + texarg + texarg + @"(?: *\n)*([\s\S]*?)\n *\n"), texHarvarditem ),

  Rule("newblock",    regex(@"^\\(newblock|nobreak)\b"), texCommandClass ),
  Rule("citeay",      regex(@"^\\citeauthoryear\b" + texarg + texarg + texarg), texCiteAuthorYear ),
  Rule("url",         regex(@"^\\(?:url|email)\b" + texarg), texUrl ),
  Rule("penalty",     regex(@"^\\(penalty)(?![a-zA-Z])\s*(-?\d+|" + texarg + ")"), texAttribute ),
  Rule("doi",         regex(@"^\\doi\b" + texarg), texDoi ),
  Rule("urlprefix",   regex(@"^\\urlprefix\b"), texUrlPrefix ),
  Rule("cite",        regex(@"^\\(short)?[Cc]ite(?:(author)|(year(?:par)?)|(al)?([pt]|A?N?P?)?(\*)?)\b" + optarg + "?" + optarg + "?" + texarg), texCite),
  Rule("bibinfo",     regex(@"^\\bibinfo\b\s*" + texarg + @"\s*" + texarg), texBibinfo ),

  Rule("texemph",     regex(@"^\{\\em\b" + texargs + @"\}"), texEmph ),
  Rule("texsl",       regex(@"^\{\\sl\b" + texargs + @"\}"), texSlanted ),
  Rule("texit",       regex(@"^\\(?:textit|emph)\b\s*" + texarg), texEmph ),
  Rule("texbf",       regex(@"^\{\\bffamily\b\s*" + texargs + @"\}"), texStrong ),
  Rule("texbold",     regex(@"^\\textbf\b\s*" + texarg), texStrong ),
  Rule("textt1",      regex(@"^\{\\ttfamily\b\s*" + texargs + @"\}"), texCode ),
  Rule("textt2",      regex(@"^\\texttt\b\s*" + texarg), texCode ),
  Rule("texquote",    regex(@"^\\enquote\b\s*" + texarg), texDquot ),

  Rule("texaccent",   regex(@"^\\([`'^""~]|[vrc]\b)\s*" + texarg), texAccent ),
  // Rule("texchar",     regex(@"^\\(" + rxtexchar + @")\b"), texChar ),
  Rule("texitcmd",    regex(@"^\\/"), texIgnore ),
  
  Rule("texdquot",    regex(@"^``((?:[^'\\]|\\.|'(?!'))*)''"), texDquot ),
  Rule("texsquot",    regex(@"^`((?:[^'\\]|\\.)*)'"), texSquot ),

  Rule("texcsname",   regex(@"^\\csname\b[\s\S]*?\\endcsname\b"), texIgnore),

  Rule("texgroup",    regex(@"^\{" + texargs + @"\}" ), texGroup ),  
  Rule("texenv1",     regex(@"^\\begin\{" + texenv1 + @"\}\s*" + optargs + texarg), texIgnore ),
  Rule("texcmd2",     regex(@"^\\(" + texcmd2 + @")\b\s*" + optargs + texarg + optargs + texarg), texIgnore ),
  Rule("texcmd1",     regex(@"^\\(" + texcmd1 + @")\b\s*" + optargs + texarg), texIgnore ),
  Rule("texcmd",      regex(@"^(\\[a-zA-Z@]+)\b\s*(" + optargs + ")"), texGenericCommand ),

  Rule("texchar",     regex(@"^\\[^a-zA-Z]"), texChar ),
  
  Rule("texother",    regex(@"^[\s\S]"), texOther ),
]

/* --------------------------------------
 The context for latex elements 
---------------------------------------- */
public rectype texContext {
  // The parse context for latex elements. 
  TexContext( grammar : grammar<string,texContext> = texGrammar, citestyle : citestyle = citeAuto )                 
}

/* --------------------------------------
 Latex grammar functions 
---------------------------------------- */

function texNormal( cap : matched, _context ) : string {
  cap.matched 
}

function texChar( cap : matched, _context ) : string {
  val ent = texCmdToEntity(cap.matched)
  if (ent=="") then cap.matched.substr(1) else ent
}


function texOther( cap : matched, _context ) : string {
  val char = cap.matched
  if (char == "~") then @"&nbsp;"
  elif (char=="*") then @"\*"
  elif (char=="_") then @"\_"
  elif (char=="[") then @"\["
  elif (char=="]") then @"\]"  
  elif (char=="#") then @"\#"  
  elif (char=="`") then @"\`"  
  else char 
}

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


function texAccent( cap : matched, _context ) : string {
  val accent = cap.groups[1]
  val letter = cap.groups[2].unbrace
  match (texAccents[cap.groups[1]]) {
    Just(name) -> "&" + letter + name + ";"
    Nothing -> letter 
  }
}

function texGenericCommand( cap : matched, context : texContext ) : string {
  if (cap.groups[2]!="") then ""      // ignore
   else texCmdToEntity(cap.groups[1])
}

function texGroup( cap : matched, context : texContext ) : string {
  parseTexX( cap.groups[1], context )
}

function texCommandClass( cap : matched, context : texContext ) : string {
  "[]{." + cap.groups[1] + "}"
}

function texAttribute( cap : matched, context : texContext ) : string {
  "[]{" + cap.groups[1] + "=\"" + cap.groups[2] + "\"}"
}

function texIgnore( cap : matched, context : texContext ) : string {
  ""
}

function texEmph( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "_" + txt.parseTexX(context) + "_"
}

function texSlanted( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parseTexX(context) + "]{font-style=oblique}"
}

function texStrong( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "**" + txt.parseTexX(context) + "**"
}

function texCode( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "`" + txt.parseTexX(context) + "`"
}

function texUrl( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1].unbrace
  if (txt=="") then "" else ("[" + txt + "](" + txt.urlEncode + ")")
}

function texUrlPrefix( cap : matched, context : texContext ) : string {
  "Available at "
}


function texDoi( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1].unbrace
  if (txt=="") then "" else ("doi:[" + txt + "](http://dx.doi.org/" + urlEncode(txt) + ")")
}

function urlEncode(txt) : string {
  txt.replaceAll(rxUrlReserved, fun(cap) {
    cap.matched.list.map( fun(c) { "%" + c.int.showHex(2) } ).join
  })
}

val rxUrlReserved = regex(@"[\s>)\'\""(<\[\]]")

function texBibinfo( cap : matched, context : texContext ) : string {
  "[" + cap.groups[2].parseTexX(context) + "]{ .bibinfo field=\"" + cap.groups[1].unbrace + "\"}"
}

function texDquot( cap : matched, context : texContext ) : string {
  texQuot("\"",cap,context)
}
function texSquot( cap : matched, context : texContext ) : string {
  texQuot("'",cap,context)
}
function texQuot( quot : string, cap : matched, context : texContext ) : string {
  quot + cap.groups[1].parseTexX(context) + quot
}

function texBibliography( cap : matched, context : texContext ) : string {
  val numcite = if (context.citestyle.isNumCite) then ".bib-numeric" else ".bib-authoryear"
  "~ Begin Bibliography { " + numcite +
    " caption=\"" + cap.groups[1].unbrace + "\"}\n" + (cap.groups[2] + "\n\n").parseTexX(context) + 
    "\n~ End Bibliography\n"
}

function texCiteAuthorYear( cap : matched, context : texContext ) : string {
  (cap.groups[2] + "," + cap.groups[3] + "," + cap.groups[1]).parseTexX(context,True)
}

function texCite( cap : matched, context : texContext ) : string {
  // handles various natbib and chicago style citations
  // groups: 1: short? 2: author? 3: year|yearpar?, 4: al?,  5: p or t?, or A?N?P? 
  //         6: *?, 7: optarg1, 8: optarg2, 9: citations
  val citations = cap.groups[9].unbrace.split(",")  
  val modifier  = if (cap.groups[6]=="*") then "+" 
                  elif (cap.groups[2]=="author" || cap.groups[5].contains("A")) then "!"
                  elif (cap.groups[3].startsWith("year") || cap.groups[1]=="short") then "-"               
                  else ""
  function bracket(s) { 
    if (cap.groups[3]=="year" || cap.groups[2]=="author" ||
         cap.groups[5] == "t" || cap.groups[5].contains("N")) 
     then s else "[" + s + "]" 
  }
  val classes = if (cap.groups[4]=="al"||cap.groups[5]=="NP") then "{.free}" else ""
  
  val (pre,post)
    = if (cap.groups[8]!="") then (cap.groups[7] + " ", "," + cap.groups[8])
       elif (cap.groups[7] != "") then ("","," + cap.groups[7])
       else ("","")

  bracket( pre +  citations.list.map(fun(c){ modifier + "@" + c }).join(";") + post) + classes
}

function texHarvarditem( cap : matched, context : texContext ) : string {
  val key  = cap.groups[4]
  val year = "(" + cap.groups[3] + ")"
  val lab  = if (cap.groups[1]!="") 
              then cap.groups[1] + year + cap.groups[2] 
              else cap.groups[2] + year         
  val content = cap.groups[5]
  context.makeBibitem(key,lab,content)
}

function texBibitem( cap : matched, context : texContext ) : string {
  context.makeBibitem( cap.groups[2], cap.groups[1], cap.groups[3] )
}

function makeBibitem( context : texContext, keyx : string, labx : string, content : string ) : string {
  val key = keyx.unbrace
  val lab = labx.unbrace.parseTexX(context,True)  
  val md  = content.parseTexX(context)
  val (authors,title) = match(md.find(rxAuthorTitle)) {
              Just(cap) -> (cap.groups[1],cap.groups[2])
              Nothing   -> ("",md)
            }
  val caption = (authors + "\n" + title).replaceAll(rxNewblock,"&nl;")
                .replaceAll("\n"," ").replaceAll("'","&apos;").replaceAll("\\","&bslash;")
                .replaceAll(rxSpaces," ").trim
  val search  = (title + "+" + authors).replaceAll(rxNonSearch," ").replaceAll(rxSpaces,"+")

  //trace("bibitem: lab: " + labx + " -> " + lab)
  "~ Begin Bibitem { id=\"" + key.definitionId + "\" " + 
                  (if (lab=="") then "" else "cite-label=\"" + lab + "\" " ) +
                  (if (lab!="" && !(lab.contains(rxAuthorYear))) then "label=\"" + lab + "\" " else "") +
                   "caption='" + caption + "' searchterm=\"" + search + "\" " +
                  "}\n" +
   md + 
   "\n~ End Bibitem\n"
}


val rxNewblock = regex(@"\[\s*\]\{\s*\.newblock\s*\}\s*")
val rxSpaces = regex(@"\s+")
val rxNonSearch = regex(@"(&#?\w+;|\]\{[^\}]*\}|[^\w\+\-])+|\b(?:\d\w+|[\w\+\-]{1,3}\b)")

val rxAuthorTitle = regex(@"^\s*(.*?(?:\n?\[\]\{\.newblock\}\s*))(.*?)(?:\n?\[\]\{\.newblock\})")

public val rxAuthorYear = regex(@"(.*?)(?:[,;](?: |&nbsp;|\\ )*\(?|(?: |&nbsp;|\\ )*\(?)(\d\d\d\d[\w\-]*)\)?(?: *[,;] *)?(.*)$")

function unbrace(s : string ) : string {
  if (s.startsWith("{") && s.endsWith("}")) 
   then s.substr(1,s.length-2) else s
}


/* --------------------------------------
  Parse TeX  elements 
---------------------------------------- */


// Parse TeX elements and return Markdown
public function parseTex( txt : string, citestyle : citestyle = citeAuto, verbose : bool = False  ) : string
{
  val normTxt = txt.replaceAll(regex(@"\r\n?"),"\n")
                 .replaceAll(regex(@"\t"),"   ")
                 // strip off comments
                 // little conservative but % sometimes occurs inside url's
                 .replaceAll(regex(@"(^|[^\\])%[^\n}]*"),@"$1") 
  val md = parseTexX(normTxt,TexContext(texGrammar,citestyle))
  if (verbose) then trace( "TeX to Markdown:\n" + md )
  md
}

public function parseTexX( txt : string, context : texContext, newlineToSpace : bool = False) : string
{
  if (txt=="") then "" else {
    val res = parseTexAcc(context,builder(), txt)
    if (!newlineToSpace) then res else res.replaceAll(rxNl," ")
  }
}
val rxNl = regex(@"\n")



function parseTexAcc( context : texContext, acc : builder<h>, txt : string ) : st<h> string
{
  if (txt=="") return acc.string
  val (s,next,_) = matchRules(context.grammar,context,txt,id)
  parseTexAcc(context, acc.append(s), txt.substr1(next))  
}

