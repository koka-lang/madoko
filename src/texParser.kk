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
val texval   = @"(?:[^\\{}]|\\[@a-zA-Z]+|\\.)"
val texarg0  = texval + "*"
val texarg1  = texnest(texarg0) + "*"
val texarg2  = texnest(texarg1) + "*"
val texarg3  = texnest(texarg2) + "*"
val texarg   = @"(" + texnest(texarg3) + @")"
val texargs  = @"(" + texnest(texarg3) + "*)"

val optarg   = @"(?:\[([^\]]*)\])"
val optargs  = optarg + @"*"
val texenv1  = @"(thebibliography)"
val texcmd1  = @"(begin|end|newlength|setlength|bibinfo)"
val texcmd2  = @"(newcommand|renewcommand|providecommand|bibitemdeclare)"

val texGrammar : grammar<string,texContext> = [
  Rule("texnormal",   regex(@"^(?:[^" + special + "])+"), texNormal ),
  
  Rule("texmath1",    regex(@"^(?:\$(?:[^\\\$]|\\.)+\$|\\\((?:[^\\]|\\[^\)])*\\\))"), texNormal ),
  Rule("texmath2",    regex(@"^(?:\$\$(?:[^\\\$]|\\.|\$(?!\$))*\$\$|\\\[(?:[^\\]|\\[^\]])*\\\])"), texNormal ),

  Rule("biblio",      regex(@"^\\begin\{thebibliography\}(?:\{([^}]+)\})?(?: *\n)*([\s\S]*?)\\end{thebibliography}"), texBibliography ),
  Rule("bibitem",     regex(@"^\\bibitem\b" + optarg + "?" + texarg + @"(?: *\n)*([\s\S]*?)\n *\n"), texBibitem ),

  Rule("newblock",    regex(@"^\\(newblock|nobreak)\b"), texCommandClass ),
  Rule("citeay",      regex(@"^\\citeauthoryear\b" + texarg + texarg + texarg), texCiteAuthorYear ),
  Rule("url",         regex(@"^\\(?:url|email)\b" + texarg), texUrl ),
  Rule("penalty",     regex(@"^\\(penalty)\b\s*(-?\d+|" + texarg + ")"), texAttribute ),
  Rule("doi",         regex(@"^\\doi\b" + texarg), texDoi ),
  Rule("urlprefix",   regex(@"^\\urlprefix\b"), texUrlPrefix ),

  Rule("texemph",     regex(@"^\{\\em\b" + texargs + @"\}"), texEmph ),
  Rule("texsl",       regex(@"^\{\\sl\b" + texargs + @"\}"), texSlanted ),
  Rule("texit",       regex(@"^\\(?:textit|emph)\b" + texarg), texEmph ),
  Rule("texbf",       regex(@"^\{\\bffamily\b" + texargs + @"\}"), texStrong ),
  Rule("texbold",     regex(@"^\\textbf\b" + texarg), texStrong ),
  Rule("textt1",      regex(@"^\{\\ttfamily\b" + texargs + @"\}"), texCode ),
  Rule("textt2",      regex(@"^\\texttt\b" + texarg), texCode ),

  Rule("texaccent",   regex(@"^\\([`'^""~vrc])\b(?:\{\\?(.+?)\}|\\?(.))"), texAccent ),
  // Rule("texchar",     regex(@"^\\(" + rxtexchar + @")\b"), texChar ),
  Rule("texitcmd",    regex(@"^\\/"), texIgnore ),
  
  Rule("texdquot",    regex(@"^``((?:[^'\\]|\\.|'(?!'))*)''"), texDquot ),
  Rule("texsquot",    regex(@"^`((?:[^'\\]|\\.)*)'"), texSquot ),

  Rule("texcsname",   regex(@"^\\csname\b[\s\S]*?\\endcsname\b"), texIgnore),

  Rule("texgroup",    regex(@"^\{" + texargs + @"\}" ), texGroup ),  
  Rule("texenv1",     regex(@"^\\begin\{" + texenv1 + @"\}" + optargs + texarg), texIgnore ),
  Rule("texcmd2",     regex(@"^\\(" + texcmd2 + @")" + optargs + texarg + optargs + texarg), texIgnore ),
  Rule("texcmd1",     regex(@"^\\(" + texcmd1 + @")" + optargs + texarg), texIgnore ),
  Rule("texcmd",      regex(@"^(\\[a-zA-Z@]+)(" + optargs + ")"), texGenericCommand ),

  Rule("texchar",     regex(@"^\\[^a-zA-Z]"), texChar ),
  
  Rule("texother",    regex(@"^[\s\S]"), texOther ),
]

/* --------------------------------------
 The context for latex elements 
---------------------------------------- */
public rectype texContext {
  // The parse context for latex elements. 
  TexContext( grammar : grammar<string,texContext> = texGrammar, citestyle : citestyle = Auto )                 
}

/* --------------------------------------
 Latex grammar functions 
---------------------------------------- */

function texNormal( cap : matched, _context ) : string {
  cap.matched 
}

function texChar( cap : matched, _context ) : string {
  ent = texCmdToEntity(cap.matched)
  if (ent=="") then cap.matched.substr(1) else ent
}


function texOther( cap : matched, _context ) : string {
  char = cap.matched
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
  accent = cap.groups[1]
  letter = cap.groups[2] + cap.groups[3]
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
  "[]{" + cap.groups[1] + "='" + cap.groups[2] + "'}"
}

function texIgnore( cap : matched, context : texContext ) : string {
  ""
}

function texEmph( cap : matched, context : texContext ) : string {
  txt = cap.groups[1]
  if (txt=="") then "" else "_" + txt.parseTexX(context) + "_"
}

function texSlanted( cap : matched, context : texContext ) : string {
  txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parseTexX(context) + "]{font-style=oblique}"
}

function texStrong( cap : matched, context : texContext ) : string {
  txt = cap.groups[1]
  if (txt=="") then "" else "**" + txt.parseTexX(context) + "**"
}

function texCode( cap : matched, context : texContext ) : string {
  txt = cap.groups[1]
  if (txt=="") then "" else "`" + txt.parseTexX(context) + "`"
}

function texUrl( cap : matched, context : texContext ) : string {
  txt = cap.groups[1].unbrace
  if (txt=="") then "" else ("[" + txt + "](" + txt + ")")
}

function texUrlPrefix( cap : matched, context : texContext ) : string {
  "Available at "
}


function texDoi( cap : matched, context : texContext ) : string {
  txt = cap.groups[1].unbrace
  if (txt=="") then "" else ("doi:[" + txt + "](http://dx.doi.org/" + txt + ")")
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
  "~~ Bibliography { caption=\"" + cap.groups[1].unbrace + "\"}\n" + cap.groups[2].parseTexX(context) + "\n~~\n"
}

function texCiteAuthorYear( cap : matched, context : texContext ) : string {
  (cap.groups[2] + "," + cap.groups[3] + "," + cap.groups[1]).parseTexX(context,True)
}

function texBibitem( cap : matched, context : texContext ) : string {
  key = cap.groups[2].unbrace
  lab = cap.groups[1].parseTexX(context,True)  
  //trace("bibitem: lab: " + cap.groups[1] + " -> " + lab)
  content = cap.groups[3]
  "~~~ Bibitem { id='" + key.definitionId + "' " + (if (lab=="" || context.citestyle.isNumeric) then "" else "label='" + lab + "' ") +
                  (if (context.citestyle.isNumeric || (context.citestyle.isAuto && lab.contains(rxNumCite)))
                    then ".has-before " else @"before=clear " ) + "}\n" +
   content.parseTexX(context) + 
   "\n~~~\n"
}

val rxNumCite    = regex(@"^([-\w&#;]*\d+)?$")

function unbrace(s : string ) : string {
  if (s.startsWith("{") && s.endsWith("}")) 
   then s.substr(1,s.length-2) else s
}


/* --------------------------------------
  Parse TeX  elements 
---------------------------------------- */


// Parse TeX elements and return Markdown
public function parseTex( txt : string, citestyle : citestyle = Auto, verbose : bool = False  ) : string
{
  md = parseTexX(txt,TexContext(texGrammar,citestyle))
  if (verbose) then trace( "TeX to Markdown:\n" + md )
  md
}

public function parseTexX( txt : string, context : texContext, newlineToSpace : bool = False) : string
{
  if (txt=="") then "" else {
    res = parseTexAcc(context,builder(), txt)
    if (!newlineToSpace) then res else res.replaceAll(rxNl," ")
  }
}
val rxNl = regex(@"\n")



function parseTexAcc( context : texContext, acc : builder<h>, txt : string ) : st<h> string
{
  if (txt=="") return acc.string
  val (s,next) = matchRules(context.grammar,context,txt,id)
  parseTexAcc(context, acc.append(s), txt.substr1(next))  
}

