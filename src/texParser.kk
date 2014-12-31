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
import std/crypto
import std/path
import common
import entity
import texCommon

/* --------------------------------------
  Latex grammar 
---------------------------------------- */
alias texRule = rule<string,texContext>

val special = @"\\{}~*_\[\]#\$`%";

val texargg = @"(?:\{" + texargs + @"\})"

/* use entity for these commands */
val texEntities = [("LaTeX","LogoLaTeX"),("LaTeXe","LogoLaTeXe"),("BibTeX","LogoBibTeX"),("AmSTeX","LogoAmSTeX"),("TeX","LogoTeX")].dict
val texEntityCmd0 = @"(vfill|qed|eg|etal|ie|" + texEntities.keys.join("|") + ")"

/* Use TexRaw for the following commands */
val texRawCmd0 = @"(vfill)"
val texRawCmd1 = @"((?:this)pagestyle)"
val texRawCmd2 = @"(markboth)"

/* ignore the following commands and environments */
val texenv0  = @"(document)"
val texenv1  = @"(thebibliography)"
val texcmd0  = @"(leavevmode|protect|relax)"
val texcmd1  = @"(begin|end|newlength|setlength|bibfield|BibitemShut|protect)"
val texcmd2  = @"(newcommand|renewcommand|providecommand|bibitemdeclare)"

/* sections, sizes, etc */
val texsects = ["part","chapter","section","subsection","subsubsection","paragraph"]
val texsect  = "(" + texsects.join("|") + ")"

val texFontSizeMap = [("tiny","xx-small"),("scriptsize","x-small"),("footnotesize","small"),
                      ("small","small"),("normalsize","medium"),("large","large"),("Large","x-large"),
                      ("LARGE","xx-large"),("Huge","xx-large")].dict
val texFontSizes   = texFontSizeMap.keys.join("|")             

val eol = @"(?:[ \t]*(?:%.*)?\r?\n)?"

/* main grammar */
val texGrammar : grammar<string,texContext> = [
  Rule("texnormal",   regex(@"^(?:[^" + special + "])+"), texNormal ),

  /* Documents */
  Rule("texdocclass", regex(@"^\\documentclass\b\s*" + optarg + @"?\s*" + texarg + @"([\s\S]*)"), texDocClass ),

  /* Block elements */
  Rule("texsection",  regex(@"^\\" + texsect + @"\b(\*)?\s*" + texarg + @"(?:\s*\\label\b" + texarg + @")?" ), texSection ),

  Rule("texcomment1", regex(@"^\\begin{comment}([\s\S]*?)\\end{comment}"), texComment ),
  Rule("texcomment2", regex(@"^(\n *%.*\n(?: *%.*\n)*)"), texComment),
  Rule("texlcomment", regex(@"^(%.*)"), texComment),  
  Rule("texfigure",   regex(@"^\\begin{(figure|table)(\*)?}" + optarg + @"?([\s\S]*?)\\end{\1\*?}"), texCaptioned ),
  Rule("texlabeled",  regex(@"^\\begin{(definition|lemma|theorem|proposition|corollary|proof|example)(\*)?}" + optarg + @"?([\s\S]*?)\\end{\1\*?}"), texLabeled ),
  Rule("textabularx", regex(@"^\\begin\{(tabular[xy\*])\}\s*" + optarg + @"?\s*" + texarg + @"\s*" + texarg + @"([\s\S]*?)\\end\{\1\}"), texTabularX ),
  Rule("textabular",  regex(@"^\\begin{tabular}\s*" + optarg + @"?\s*" + texarg + @"([\s\S]*?)\\end{tabular}"), texTabular ),

  Rule("texitem",     regex(@"^\\item\b\s*" + optarg + @"?\s*"), texItem ),
  Rule("texlist",     regex(@"^\\begin\{(itemize|enumerate)\}\s*" + optarg + @"?\s*(\\item\b\s*" + optarg + @"\s*)?"), texList ),
  Rule("texendlist",  regex(@"^\\end\{(itemize|enumerate)\}\s*"), texEmptyLine ),

  Rule("texlisting",  regex(@"^\\begin\{(lstlisting|verbatim|code|alltt)\}\s*" + optarg + @"?([\s\S]*?)\\end\{\1\}\s*"), texListing ),

  Rule("texnoindent", regex(@"^\\noindent\b([\s\S]*?\n)[ \t]*\n"), texNoIndent ),

  Rule("texminipage", regex(@"^\\begin{minipage}\s*" + optarg + "?" + optarg + "?" + optarg + "?" + texarg ), texBeginMinipage ),
  Rule("texvspace",   regex(@"^\\vspace\b\*?\s*" + texarg), texVSpace ),
  Rule("texhspace",   regex(@"^\\hspace\b\*?\s*" + texarg), texHSpace ),
  Rule("texskip",     regex(@"^\\(?:big|med|small)skip\b\s*" + texarg), texSkip ),
  Rule("texmbox",     regex(@"^\\(m|make|f|frame)box\b\s*" + optarg + "?" + optarg + "?" + texargg ), texMBox ),
  Rule("texvskip",    regex(@"^\\vskip\b\s*" + texdim), texVSkip ),
  Rule("texhskip",    regex(@"^\\hskip\b\s*" + texdim), texHSkip ),
  
  /* Specials */
  Rule("texinclude",  regex(@"^\\(include(?:only)?|input)\b\s*" + texarg + eol), texInclude ),
  Rule("textitle",    regex(@"^\\maketitle\b" + eol), texMakeTitle ),
  Rule("texbib",      regex(@"^\\bibliography\b\s*" + texarg), texBibliography ),

  Rule("texclear",    regex(@"^\\(pagebreak|newpage|clearpage)\b\s*"), texPageBreak ),
  Rule("texappendix", regex(@"^\\appendix\b\s*"), texAppendix ),
  Rule("textoc",      regex(@"^\\tableofcontents\b\s*"), texToc ),
  Rule("textof",      regex(@"^\\tableoffigures\b\s*"), texTof ),
  Rule("texfootnote", regex(@"^\\footnote\b\s*" + texargg + @"([\s\S]*?)\n[ \t\r]*\n"), texFootnote),
  Rule("teximg",      regex(@"^\\includegraphics\b\s*" + optarg + "?" + texargg + @"([\s\S]*?)\n[ \t\r]*\n"), texImage ),
  Rule("texacks",     regex(@"^\\acks\b\s*"), texAcks ),

  /* Common inline elements */
  Rule("texref",      regex(@"^(~)?\\ref\b" + texargg), texRef ),
  Rule("texverb",     regex(@"^\\(?:verb|lstinline)\*?([!\+%\|\.\^#@])(.*?)\1"), texCode ),
  
  Rule("texmath1",    regex(@"^(?:\$(?:[^\\\$]|\\.)+\$|\\\((?:[^\\]|\\[^\)])*\\\))"), texMathInline ),
  Rule("texmath2",    regex(@"^(?:\$\$(?:[^\\\$]|\\.|\$(?!\$))*\$\$|\\\[(?:[^\\]|\\[^\]])*\\\])"), texMathDisplay ),
  Rule("texmathenv1",  regex(@"^\\begin\{(equation|displaymath)(\*)?\}([\s\S]*?)\\end{\1\2}"), texMathEnv ),
  Rule("texmathenv2",  regex(@"^\\begin\{(gather|align|alignat|multline|eqnarray|flalign)(\*)?\}" + texarg + @"?([\s\S]*?)\\end{\1\2}"), texMathSnippet ),

  Rule("biblio",      regex(@"^\\begin\{thebibliography\}\s*(?:\{([^}]+)\})?(?: *\n)*([\s\S]*?)\\end{thebibliography}"), texTheBibliography ),
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

  Rule("texsl",       regex(@"^\{\\(?:text)?sl\b" + texargs + @"\}"), texSlanted ),
  Rule("texsl2",      regex(@"^\\{\\slshape\b\s*" + texargs + @"\}"), texSlanted ),
  Rule("texsc",       regex(@"^\\textsc\b\s*" + texargs + @"\}"), texSmallcaps ),
  Rule("texsc2",      regex(@"^\{\\sc(?:shape)?\b\s*" + texargs + @"\}"), texSmallcaps ),
  Rule("texit",       regex(@"^\\(?:textit|emph)\b\s*" + texarg), texEmph ),
  Rule("texit2",      regex(@"^\{\\(?:itshape|em|it)\b\s*" + texargs + @"\}(\s)?"), texEmph ),
  Rule("texbf",       regex(@"^\\textbf\b\s*" + texarg), texStrong ),
  Rule("texbf2",      regex(@"^\{\\bfseries\b\s*" + texargs + @"\}(\s)?"), texStrong ),
  Rule("texcode",     regex(@"^\\(code|verb|lstinline)\b\s*" + texarg), texCode ),
  Rule("textt1",      regex(@"^\\texttt\b\s*" + texarg), texMonospace ),
  Rule("textt2",      regex(@"^\{\\tt(?:family)?\b\s*" + texargs + @"\}"), texMonospace ),
  Rule("texup",       regex(@"^\\textup\b" + texargs + @"\}"), texUpright ),
  Rule("texup2",      regex(@"^\\{\\upshape\b\s*" + texargs + @"\}"), texUpright ),
  Rule("texrm1",      regex(@"^\\textrm\b\s*" + texarg), texRoman ),
  Rule("texrm2",      regex(@"^\{\\rmfamily\b\s*" + texargs + @"\}"), texRoman ),
  Rule("texsf1",      regex(@"^\\textsf\b\s*" + texarg), texSans ),
  Rule("texsf2",      regex(@"^\{\\sffamily\b\s*" + texargs + @"\}"), texSans ),
  Rule("texquote",    regex(@"^\\enquote\b\s*" + texarg), texDquot ),
  Rule("texeol",      regex(@"^\\\\" + optarg + "?"), texLineBreak ),

  Rule("texinst",     regex(@"^\\(?:inst|IEEEauthorrefmark)\b\s*" + texarg), texInst ),


  Rule("texsize",     regex(@"^\{\\(" + texFontSizes + @")\b\s*" + texargs + @"\}"), texFontSize ),
  Rule("texaccent",   regex(@"^\\([`'^""~]|[vrc]\b)\s*" + texarg), texAccent ),

  // Rule("texchar",     regex(@"^\\(" + rxtexchar + @")\b"), texChar ),
  Rule("texitcmd",    regex(@"^\\/"), texIgnore ),

  Rule("texdquot",    regex(@"^``((?:[^'\\\n]|\\.|'(?!'))*)''"), texDquot ),
  Rule("texsquot",    regex(@"^`((?:[^'\\\n]|\\.)*)'"), texSquot ),
  Rule("texdquot1",   regex(@"^``"), texOther ),  

  Rule("texrule",     regex(@"^\\rule\b\s*" + optarg + "?" + texarg + texarg ), texRule ),

  /* environments */
  Rule("texenv0",     regex(@"^\\begin\{" + texenv0 + @"\}\s*" + optargs), texAlwaysIgnore ),
  Rule("texenv1",     regex(@"^\\begin\{" + texenv1 + @"\}\s*" + optargs + texarg), texAlwaysIgnore ),
  Rule("texenvx",     regex(@"^\\end\{(?:" + texenv0 + "|" + texenv1 + @")\}\s*"), texAlwaysIgnore ),
  Rule("texenvbegin", regex(@"^\\begin\{([a-zA-Z@]+)(\*)?\}\s*"), texEnvBegin),
  Rule("texenvend",   regex(@"^\\end\{([a-zA-Z@]+)\*?\}\s*"), texEnvEnd),


  /* Catch all's */
  Rule("texcsname",   regex(@"^\\csname\b[\s\S]*?\\endcsname\b"), texIgnore),

  Rule("texentity",   regex(@"^\\" + texEntityCmd0 + @"\b\s*"), texEntityCmd ),

  Rule("texraw0",     regex(@"^\\" + texRawCmd0 + @"\b\s*" + optargs), texRaw ),
  Rule("texraw1",     regex(@"^\\" + texRawCmd1 + @"\b\s*" + optargs + texarg), texRaw ),
  Rule("texraw2",     regex(@"^\\" + texRawCmd2 + @"\b\s*" + optargs + texarg + texarg), texRaw ),

  Rule("texgroup",    regex(@"^\{" + texargs + @"\}" ), texGroup ),  
  Rule("texcmd2",     regex(@"^\\(" + texcmd2 + @")\b\s*" + optargs + texarg + optargs + texarg), texIgnore ),
  Rule("texcmd1",     regex(@"^\\(" + texcmd1 + @")\b\s*" + optargs + texarg), texIgnore ),
  Rule("texcmd0",     regex(@"^\\(" + texcmd0 + @")\b\s*" + optargs), texIgnore ),
  Rule("texcmd",      regex(@"^(\\[a-zA-Z@]+)\b\s*(" + optargs + ")"), texGenericCommand ),

  Rule("texchar",     regex(@"^\\[^a-zA-Z]"), texChar ),
  
  Rule("texother",    regex(@"^[\s\S]"), texOther ),
]

/* --------------------------------------
 The context for latex elements 
---------------------------------------- */
public rectype texContext {
  // The parse context for latex elements. 
  TexContext( grammar : grammar<string,texContext> = texGrammar, citestyle : citestyle = citeAuto, ignore : bool = True )                 
}

/* --------------------------------------
 Latex document
---------------------------------------- */

struct mRule(
  regex: regex,
  keys  : list<string>,
  values: (cap:matched, context: texContext ) -> list<string>,
  replacer: (cap:matched) -> string
)


val metadataGrammar = [
  MRule(regex(@"% *\\"), [], metaNone, metaAddSpace ),
  MRule(regex(@"\\usepackage\b\s*" + optarg + @"?\s*" + texarg), ["Package"], metaOptionValue, metaEmpty ),
  MRule(regex(@"\\title\b\s*" + texargg), ["Title"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\subtitle\b\s*" + texargg), ["Sub Title"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\bibliographystyle\b\s*" + texargg), ["Bib Style"], metaValueBibStyle, metaEmpty ),  
  MRule(regex(@"\\bibliography\b\s*" + texargg), ["Bibliography"], metaValue, metaKeep ),
  MRule(regex(@"\\authorinfo\b\s*" + texargg + @"\s*" + texargg + @"\s*" + texargg), ["Author","Address","Email"], metaTexValue3, metaEmpty ),
  MRule(regex(@"\\(?:IEEEauthorblockN)\b\s*" + texargg), ["Author"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\(?:IEEEauthorblockA)\b\s*" + texargg), ["Address"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\(?:author)\b\s*" + texargg), ["Author"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\(?:address)\b\s*" + texargg), ["Address"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\email\b\s*" + texargg), ["Email"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\(?:institute|affiliation)\b\s*" + texargg), ["Affiliation"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\authorrunning\b\s*" + texargg), ["Author Running"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\titlerunning\b\s*" + texargg), ["Title Running"], metaTexValue, metaEmpty ),
]


function metaEmpty( cap : matched ) : string {
  " " 
}

function metaKeep( cap : matched ) : string {
  cap.matched
}

function metaAddSpace( cap : matched ) : string {
  cap.matched + " "
}

function metaNone( _cap : matched, _context ) : list<string> {
  []
}


function metaValue( cap : matched, _context ) : list<string> {
  [cap.groups[1].unbrace]
}

function metaValueBibStyle( cap : matched, _context ) : list<string> {
  val style = cap.groups[1].unbrace.trim
  [(if (style=="plain") then "plainnat" else style)]
}



function metaTexValue( cap : matched, context ) : list<string> {
  [cap.groups[1].parseTexX(context)]
}

function metaTexValue3( cap : matched, context ) : list<string> {
  list(1,3).map(fun(i) { cap.groups[i].parseTexX(context) })
}

function metaOptionValue( cap : matched, _context ) : list<string> {
  [(if (cap.groups[1].isEmpty) then "" else "[" + cap.groups[1] + "]") + cap.groups[2].unbrace.trim]
}


function texMeta( key, value ) {
  val rvalue = value.unbrace.replaceAll(rxMetaNL, "\n    ").trim
  if (rvalue=="") 
   then ""
   else key.unbrace.fill(13) + ": " + rvalue
}
val rxMetaNL = regex(@"\r?\n(?:[ ]{1,4}|\t)?")

function texDocClass( cap : matched, context ) : string {
  val mdata0 = zipWith(["Doc Class"], metaOptionValue(cap,context), texMeta)
  val (mdata,content) = extractMeta( cap.groups[3], context, mdata0 )
  mdata.join("\n") + "\nHeading Base : 2\nLogo         : True\n\n" + content.parseTexX(context)
}

function extractMeta( text0 : string, context, mdata0 : list<string> ) : (list<string>,string) {
  var mdata := mdata0
  val content = metadataGrammar.foldl( text0, fun(text,mrule) {
    text.replaceAll(mrule.regex, fun(cap) {
      val metas = zipWith(mrule.keys,(mrule.values)(cap,context),texMeta)
      mdata := mdata + metas
      (mrule.replacer)(cap)
    })
  })
  (mdata, content)
}

/* --------------------------------------
 Latex block functions 
---------------------------------------- */
function texInclude( cap : matched, _context ) {
  val fname = cap.groups[2].unbrace  
  "\n[INCLUDE=" + cap.groups[2].unbrace + "]\n"
}

function texMakeTitle( cap : matched, _context ) {
  "\n[TITLE]\n"
}

function texBibliography( cap : matched, _context ) {
  "\n# References {-}\n[BIB]\n"
}

function texPageBreak( _cap : matched, _context ) {
  "\n&pagebreak;\n"
}

function texAppendix( _cap : matched, _context ) {
  "\n# Appendix { @h1='A' }\n"
}

function texToc( _cap : matched, _context ) {
  "\n[TOC]\n"
}
function texTof( _cap : matched, _context ) {
  "\n[TOC=tof]\n"
}

function indent4( txt : string ) : string {
  txt.split("\n").map(fun(s) { "    " + s }).join("\n")
}

function texFootnote( cap : matched, context ) : string {
  val fn = "^fn-" + cap.groups[1].md5.substr(0,3)
  "[" + fn + "]" + cap.groups[2].parseTexX(context) + "\n\n[" + fn + "]: \n" + cap.groups[1].parseTexX(context).indent4 + "\n\n"
}

function toIdentifier(s) {
  s.unbrace.replaceAll(rxNonIdChar,"-")
}
val rxNonIdChar = regex(@"[^\w\-]+")

function texSection( cap : matched, context ) : string {
  val n = max(1, texsects.indexOf(fun(s) { s == cap.groups[1] }) - 1);
  val caption = parseTexX( cap.groups[3].unbrace, context )
  val attrs = (if (cap.groups[2]=="*") then " -" else "") + 
              (if (cap.groups[4] != "") then " #" + cap.groups[4].toIdentifier else "")

  string(n,'#') + " " + caption + (if (attrs!="") then " { " + attrs + " }" else "") + "\n"
}

function texFontSize( cap : matched, context ) : string {
  val cssSize = texFontSizeMap[cap.groups[1]].maybe("medium",id)
  "[" + cap.groups[2].parseTexX(context) + "]{font-size=" + cssSize + "}"
}

function texComment( cap : matched, _context ) : string {
  "<!--" + cap.groups[1] + "-->"
}

function texRef( cap : matched, _context ) : string {
   (if (cap.groups[1]=="~") then " " else cap.groups[1]) + "[#" + cap.groups[2].toIdentifier + "]" 
}

function capitalize( s ) {
  s.substr(0,1).toUpper + s.substr(1)
}

function texEnvBegin( cap : matched, _context ) : string {
  "~ Begin " + cap.groups[1].capitalize + "\n"
}

function texEnvEnd( cap : matched, _context ) : string {
  "\n~ End " + cap.groups[1].capitalize + "\n"
}

function texBeginMinipage( cap : matched, _context ) : string {
  val width  = texLength(cap.groups[4])
  val height = texLength(cap.groups[2])
  val attrs = [if (width.isEmpty) then "" else "width='" + width + "'",
               if (height.isEmpty) then "" else "height='" + height + "'"]
  "~ Begin Minipage {" + attrs.join(" ") + " }\n"             
}

function texItem( cap : matched, context ) : string {
  texItemX( "\n*", cap.groups[1], context )
}

function texItemX( bullet : string, caption : string, context ) : string {
  bullet + " " + (if (caption=="") then "" else "**" + parseTexX(caption,context) + "**")
}

function texList( cap: matched, context ) : string {
  val bullet = if (cap.groups[1]=="itemize") then "*" else "1."
  if (cap.groups[3]=="") then "\n" else {
    "\n" + texItemX( bullet, cap.groups[4], context )
  }
}

function texEmptyLine( _cap, _context ) : string {
  "\n"
}

function trimx( s : string, n : int ) : string {
  s.substr(n,s.length-(2*n))
}

function trimNL( s : string ) : string {
  s.replaceAll(rxNL0,"")
}

function quote( s : string ) : string {
  val hasdquot = s.contains("\"")
  val hassquot = s.contains("\'")
  if (s.contains("\"")) then {
    if (s.contains("\'")) 
     then "\"" + s.replaceAll("\"","&dquot;") + "\""
     else "'" + s + "'"
  }
  else "\"" + s + "\""
}

function makeAttr( key : string, value : string ) {
  if (value=="")
   then ""
   else key + "=" + value.replaceAll(rxNl,"&nl;").quote
}

function joinAttrs( keyvals : list<string> ) {
  val kvs = keyvals.remove(isEmpty).join(" ")
  if (kvs=="") then "" else " { " + kvs + " }"
}


val rxNL0 = regex(@"^[ \t]*\r?\n|\r?\n$")

function texMathDisplay( cap : matched, _context ) {
  "\n~ Math\n" + cap.matched.trimx(2).trim + "\n~\n"
}

function texMathInline( cap : matched, _context ) {
  "$" + cap.matched.trimx(1).replaceAll(rxMathNl," %\n") + "$"
}
val rxMathNl = regex(@"\r?\n")

function texMathEnv( cap : matched, context ) {
  val envName = cap.groups[1].capitalize
  val (content,labelCaption,pre,post) = cap.groups[3].extractLabelCaption(context)
  val attrs = ([if (cap.groups[2]=="*") then "-" else ""] + labelCaption).joinAttrs
  "~ " + envName + attrs + "\n" + pre +
  content.trimNL +
  post + "\n~\n"
}

function texMathSnippet( cap : matched, context ) {
  val (content,labelCaption,pre,post) = cap.matched.extractLabelCaption(context)
  val attrs = labelCaption.joinAttrs
  "\n<!-- tex conversion hint: try to use MathPre instead of Snippet -->\n~ Snippet" + attrs + "\n" +
  pre + content.trimNL + post + "\n~\n"
}

function texListing( cap : matched, context ) : string {
  val attrs = if (cap.groups[2]=="") then "" else {
    " { " + cap.groups[2].findAll(rxKeyVal).map( fun(kcap) { 
              val key = kcap.groups[1]
              val value = kcap.groups[2] 
              if (key=="language") then "language='" + value + "'"
              elif (key=="caption") then "caption='" + parseTexX( value.unbrace, context ) + "'"
              elif (key=="label") then "#" + value.toIdentifier
              else ""
            }).join(" ") + " }"
  }

  "```" + attrs + "\n" + cap.groups[3].trimNL + " \n```\n"
}
val rxKeyVal = regex(@"\b(\w+)=(\{[^\}]*\}|[^\s\}]*)")

function texListingEnd( _cap, _context ) : string {
  "```\n"
}

function texCaptioned( cap : matched, context ) : string {
  texCaptionedX( cap, if (cap.groups[2].isEmpty) then [] else [".wide"], context )
}
function texLabeled( cap : matched, context ) : string {
  texCaptionedX( cap, [], context )
}
function texCaptionedX( cap : matched, extraAttrs : list<string>, context ) : string {
  val (content,labelCaption,pre,post) = extractLabelCaption( cap.groups[4], context, cap.groups[3].parseTexX(context), "" )
  val attrs = (extraAttrs + labelCaption).joinAttrs
    "\n~ Begin " + cap.groups[1].capitalize + attrs + "\n" + pre +
  content.trimNL.parseTexX(context) +
  post + "\n~ End " + cap.groups[1].capitalize + "\n"
}

function extractLabelCaption( content : string, context, defCaption = "", defLabel = "" ) : (string,list<string>,string,string) {
  var label := defLabel
  var caption := defCaption
  var pre   := ""
  var post := ""
  val content1 = content.replace( rxCaption, fun(ccap) {
    caption := ccap.groups[1].parseTexX(context)
    ""
  }).replace( rxLabel, fun(lcap) {
    label := "#" + lcap.groups[1].toIdentifier
    ""
  }).replace( rxCentering, fun(ccap) {
    pre  := pre + "~ Begin Center\n"
    post := "\n~ End Center"
    ""
  })
  (content1, [label,makeAttr("caption",caption)], pre, post )
}

val rxCaption = regex(@"\\caption\b" + texarg)
val rxLabel   = regex(@"\\label\b" + texarg)
val rxCentering = regex(@"\\centering\b\s*")

function texNoIndent( cap : matched, context ) : string {
  cap.groups[1].parseTexX(context) + "{.noindent}\n\n"
}

/* --------------------------------------
 Tables
---------------------------------------- */

function texTabularX( cap : matched, context ) : string {
  texTabularDo( cap.groups[2], cap.groups[3], cap.groups[4], cap.groups[5], cap, context )
}

function texTabular( cap : matched, context ) : string {
  texTabularDo( cap.groups[1], "", cap.groups[2], cap.groups[3], cap, context )
}

function texLength( w ) {
  w.unbrace.replace(regex(@"0\.(\d\d?)\\(text|line)width\b"),fun(wcap) {
    val n = wcap.groups[1].parseInt().maybe(0,id)
    if (n < 10) then n.show + "0%" else n.show + "%"
  }).replace(regex(@"\\(text|line)width\b"), "100%");
}

function texTabularDo( pos :string, width: string, spec : string, content : string, cap: matched, context ) : string {
  function toColSpecs( xs : list<matched> ) {
    match(xs) {
      Nil -> [("|","","")]
      Cons(xcap,ys) -> {
        if (xcap.groups[1] == "") {
          // no explicit separator
          [("|",xcap.matched.substr(0,1).toLower,if (xcap.groups[2]=="") then "" else "{ width='" + xcap.groups[2].texLength + "' }")] + toColSpecs(ys)
        }
        else {
          // is separator
          match(ys) {
            Nil -> {
              // final separator
              [("+","","")]
            }
            Cons(ycap,zs) -> {
              [("+",ycap.matched.substr(0,1).toLower,if (ycap.groups[2]=="") then "" else "{ width='" + ycap.groups[2].texLength + "' }")] + toColSpecs(zs)
            }
          }
        }
      }
    }
  }

  function expand( cells : list<(int,string)>, n : int ) : list<string> {
    val (cs,xs) = cells.unzip
    xs + list(1,n - cs.sum).map(fun(i) { "" })
  }

  function makeLine( double : bool, columns : int ) : string {
    "|" + list(1,columns).map( fun(i) { if (double) then "===" else "---" } ).join("|") + "|"
  }

  val rxMultiColumn = regex(@"\\multicolumn\b\s*\{(\d+)\}\s*" + texarg + texarg)
  function renderCell( cell : string ) : (int,string) {
    match(cell.find(rxMultiColumn)) {
      Nothing    -> (1, cell.parseTexX(context))
      Just(ccap) -> {
        val n = ccap.groups[1].unbrace.parseInt.maybe(1,id)
        (n, ccap.groups[3].unbrace.parseTexX(context) + string(n-1,'|') )
      }
    }
  }
  
  function renderRow( row : string, columns : int) : string {
    val (line,rest) = match(row.find(rxHline)) {
      Nothing   -> ("",row)
      Just(rcap) -> (makeLine(rcap.groups[1]!="", columns), rcap.groups[3])
    }
    if (rest.trim == "") 
     then line
     else line + (if (line=="") then "" else "\n") + 
          "| " + rest.split("&").list.map( renderCell ).expand(columns).join("| ") + "|"
  }

  function rowSanitize( row : string ) {
    row.replaceAll(rxRowNl," ").replaceAll(rxNoAlign,"")
  }

  function createColumn( col ) {
    "\n~Begin Column\n" + col.parseTexX(context) + "\n~ End Column"
  }
  function createColumns( _colspecs, row ) {
    val cols = row.split("&")
    "\n~Begin Columns" + cols.map(createColumn).join() + "\n~ End Columns\n" 
  }

  // Split into rows
  val rawRows = content.split(rxRowEnd).list.remove(fun(row) { row.trim.isEmpty } )
  val rows = rawRows.map( fun(row) { row.rowSanitize } )


  // figure out where to place the table specification/header line
  val (topRows,headerSep,bodyRows) =
    match(rows) {
      Cons(row0,Cons(row1,rest)) -> match(row1.find(rxHline)) {
        Just(hcap) -> ([row0], if (hcap.groups[1].isEmpty) then "---" else "===", Cons(hcap.groups[3], rest) )
        Nothing    -> match(row0.find(rxHline)) {
          Just(hcap0) -> ([], if (hcap0.groups[1].isEmpty) then "---" else "===", Cons(hcap0.groups[3], Cons(row1,rest)) )
          Nothing     -> ([], "~~~", rows)
        }
      }
      Cons(row0,rest) -> match(row0.find(rxHline)) {
        Just(hcap0) -> ([], if (hcap0.groups[1].isEmpty) then "---" else "===", Cons(hcap0.groups[3], rest) )
        Nothing     -> ([], "~~~", rows)
      }
      Nil -> ([],"",[])
    }

  // Create a header line from the tabular specification
  val colspecs = spec.replaceAll(rxNoSpec,"").findAll(rxSpec).list.toColSpecs
  val header   = colspecs.map( fun(cspec) {
    val (sep,kind,attrs) = cspec
    if (kind=="") 
     then sep 
     else sep + (if (kind=="c" || kind=="l") then ":" else "") + headerSep + attrs + headerSep + (if (kind=="c" || kind=="r") then ":" else "")
  }).join("");
  val colcount = (if (colspecs.length > 1) then colspecs.length-1 else 1)

  // use 'column' block for single line tabular's with new lines in it
  if (rawRows.length==1 && rawRows.any(fun(row) { row.contains(rxRowNl) })) 
   then return createColumns(colspecs,rawRows.take(1).join)

  //trace("|rawrows| = " + rawRows.length.show + "\n[" + rawRows.join(",") + "]\n\n")

  
  // create attributes
  val attrs = "{ .textable " + 
                (if (width!="") then "width='" + width.texLength + "' " else "") + 
                (if (pos=="b") then "vertical-align=bottom " elif (pos=="t") then "vertical-align=top " else "") + "}"

  // render rows                
  function renderRows( rs ) {
    rs.map( fun(row) { renderRow( row, colcount ) } ).remove(isEmpty).join("\n")
  }

  val top  = topRows.renderRows
  val body = bodyRows.renderRows
  "\n" + (if (top.isEmpty) then "" else top + "\n") + header + "\n" + body + "\n" + attrs
}

val rxNoAlign= regex(@"\\noalign\b\s*" + texarg)
val rxHline  = regex(@"^\s*(?:\\(?:hline|firsthline|lasthline|toprule|bottomrule|midrule)\b\s*(\\hline\b\s*)?|\\(?:cline|cmidrule)\b(?:\(\w\))?" + texarg + @"\s*)([\s\S]*)")
val rxRowEnd = regex(@"\\\\(?:\[(?:[^\]\r\n]*)\])?[ \t]*(?:\r?\n)*")
val rxRowNl  = regex(@"\r?\n")
val rxSpec   = regex(@"(\|\|?)|[lcr]|[pmb]\{([^\}]*)\}")
val rxNoSpec = regex(@"\s|[^pmb](?=\{)" + texarg)


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
  if (char == "~") then @"\ "
  elif (char=="*") then @"\*"
  elif (char=="_") then @"\_"
  elif (char=="[") then @"\["
  elif (char=="]") then @"\]"  
  elif (char=="#") then @"\#"  
  elif (char=="`") then @"\`"  
  elif (char=="``") then "\""
  else char 
}


function texAccent( cap : matched, _context ) : string {
  val accent = cap.groups[1]
  val letter = cap.groups[2].unbrace
  match (texAccents[cap.groups[1]]) {
    Just(name) -> "&" + letter + name + ";"
    Nothing -> letter 
  }
}

function texRule( cap : matched, _context ) : string {
  val widthHeight = "width='" + texLength(cap.groups[2]) + "' height='" + texLength(cap.groups[3]) + "'"
  if (cap.groups[1] != "") then {
    "[ ]{ background-color=black vertical-align='" + texLength(cap.groups[1]) + "' " + widthHeight + " }"
  }
  else {
    "\n-------- { " + widthHeight + " }\n"
  }
}

function texLineBreak( cap : matched, _context ) : string {
  (if (cap.groups[1] != "") then "[ ]{margin-bottom='" + texLength(cap.groups[1]) + "'}" else "") + "&br;"
}

function texGenericCommand( cap : matched, context : texContext ) : string {
  val entity = texCmdToEntity(cap.groups[1])
  if (context.ignore) {
    if (cap.groups[2]!="") then "" else entity
  }
  elif (entity.isEmpty) then cap.matched else entity
}

function texGroup( cap : matched, context : texContext ) : string {
  val body = parseTexX( cap.groups[1], context )
  if (context.ignore || body=="") then body else "{" + body + "}"
}

function texCommandClass( cap : matched, context : texContext ) : string {
  "[]{." + cap.groups[1] + "}"
}

function texAttribute( cap : matched, context : texContext ) : string {
  "[]{" + cap.groups[1] + "=\"" + cap.groups[2] + "\"}"
}

function texAlwaysIgnore( cap : matched, context : texContext ) : string {
  ""
}

function texIgnore( cap : matched, context : texContext ) : string {
  if (context.ignore) then "" else cap.matched
}

function texEntityCmd( cap : matched, _context ) : string {
  val entity = match( texEntities[cap.groups[1]] ) {
    Nothing -> cap.groups[1]
    Just(v) -> v
  }
  "&" + entity + ";"
}


function texRaw( cap : matched, _context ) : string {
  "\n~ TexRaw\n" + cap.matched + "\n~\n"
}

function texVSpace( cap : matched, _context ) : string {
  "\n~ Empty { height='" + texLength(cap.groups[1]) + "' }\n\n~\n"
}

function texHSpace( cap : matched, _context ) : string {
  "[]{width='" + texLength(cap.groups[1]) + @"'}"
}

function texVSkip( cap : matched, _context ) : string {
  "\n~ Empty { height='" + texLength(cap.groups[1]) + "' }\n\n~\n"
}

function texHSkip( cap : matched, _context ) : string {
  "[]{width='" + texLength(cap.groups[1]) + @"'}"
}

function texSkip( cap : matched, _context ) : string {
  val height = if (cap.groups[1]=="big") then "12pt" elif (cap.groups[1]=="med") then "6pt" else "3pt"
  "\n~ Empty { height='" + height + "' }\n\n~\n"
}

function texAlign( s : string ) : string {
  if (s=="l") then "left"
  elif (s=="r") then "right"
  elif (s=="s") then "justify"
  elif (s=="c") then "center"
  else "left"
}

function texMBox( cap : matched, context ) : string {
  val width = if (cap.groups[2]=="") then "" else "width='" + texLength(cap.groups[2]) + "'"
  val pos   = if (cap.groups[3]=="") then "" else "text-align='" + texAlign(cap.groups[2]) + "'"
  val border = if (cap.groups[1].startsWith("f")) then ".framed" else ""
  "[" + cap.groups[4].parseTexX(context) + "]{" + [border,width,pos].join(" ") + "}"
}

function texImage( cap : matched, context ) : string {
  val kvs = cap.groups[1].findAll(rxKeyVal).list.map( fun(kcap) {
              val key = kcap.groups[1]
              val value = kcap.groups[2].unbrace
              if (key=="width") then "width=\"" + texLength(value) + "\""
              elif (key=="height") then "height=\"" + texLength(value) + "\""
              elif (key=="scale") then "transform=\"scale(" + value + ")\""
              elif (key=="angle") then "transform=\"rotate(" + value + "deg)\""              
              else ""
            }).join(" ")
  val fname = cap.groups[2].unbrace
  val imgname = if (fname.extname=="") then fname + ".eps" else fname
  val imgkey  = imgname.stemname.replaceAll(regex(@"[^\w\-]+"),"")
  "![" + imgkey + "]" + cap.groups[3].parseTexX(context) + "\n\n[" + imgkey + "]: " + imgname + " (image title) { " + kvs + " }\n"
}


function texInst( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1].unbrace.parseTexX(context)
  if (txt=="") then "" else "^" + txt.replaceAll(" ","\\ ") + "^"
}

function texAcks( cap : matched, context : texContext ) : string {
  "\n# Acknowledgements { - }\n\n"
}

function texEmph( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  val end = if (cap.groups[2] != "") then cap.groups[2] else "\\/"
  if (txt=="") then "" else "_" + txt.parseTexX(context) + "_" + end
}

function texSlanted( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parseTexX(context) + "]{font-style=oblique}"
}

function texSmallcaps( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parseTexX(context) + "]{font-variant=small-caps}"
}

function texUpright( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parseTexX(context) + "]{font-style=normal}"
}

function texRoman( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parseTexX(context) + "]{font-family=serif}"
}

function texSans( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parseTexX(context) + "]{font-family=sans-serif}"
}


function texStrong( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  val end = if (cap.groups[2] != "") then cap.groups[2] else "\\/"
  if (txt=="") then "" else "**" + txt.parseTexX(context) + "**" + end
}

function texCode( cap : matched, context : texContext ) : string {
  val txt = cap.groups[2]
  if (txt=="") then "" else "`" + txt + "`"
}

function texMonospace( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parseTexX(context) + "]{font-family=monospace}"
}


function texUrl( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1].unbrace
  val url = txt.urlEncode
  if (txt=="") then "" 
  elif (txt==url) then "<" + txt + ">"
  else ("[" + txt + "](" + txt.urlEncode + ")")
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

function texTheBibliography( cap : matched, context : texContext ) : string {
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
  val citations = cap.groups[9].unbrace.split(rxCiteSep)  
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
val rxCiteSep = ", *"

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
  val caption = (authors + "\n" + title).replaceAll(rxNewblock,"&nl;").replaceAll("\n"," ").replaceAll(rxSpaces," ").trim
                /*
                .replaceAll("\n"," ").replaceAll("'","&apos;").replaceAll("\\","&bslash;")
                .replaceAll(rxSpaces," ").trim
                */
                
  val search  = (title + "+" + authors).replaceAll(rxNonSearch," ").replaceAll(rxSpaces,"+")
  val label   = if (lab!="" && !(lab.contains(rxAuthorYear))) then lab else ""

  val attrs   = [makeAttr("id", key.definitionId),
                 makeAttr("cite-label", lab),
                 makeAttr("label", label),
                 makeAttr("caption", caption),
                 makeAttr("searchterm", search )].joinAttrs

  //trace("bibitem: lab: " + labx + " -> " + lab)
  "~ Begin Bibitem" + attrs + "\n" +
   md + 
   "\n~ End Bibitem\n"
}


val rxNewblock = regex(@"\[\s*\]\{\s*\.newblock\s*\}\s*")
val rxSpaces = regex(@"\s+")
val rxNonSearch = regex(@"(&#?\w+;|\]\{[^\}]*\}|[^\w\+\-])+|\b(?:\d\w+|[\w\+\-]{1,3}\b)")

val rxAuthorTitle = regex(@"^\s*(.*?(?:\n?\[\]\{\.newblock\}\s*))(.*?)(?:\n?\[\]\{\.newblock\})")

function unbrace(s : string ) : string {
  if (s.startsWith("{") && s.endsWith("}")) 
   then s.substr(1,s.length-2) else s
}


/* --------------------------------------
  Parse TeX  elements 
---------------------------------------- */


// Parse TeX elements and return Markdown
public function parseTex( txt : string, citestyle : citestyle = citeAuto, verbose : bool = False, ignore : bool = True  ) : string
{
  val normTxt = txt.replaceAll(regex(@"\r\n?"),"\n").replaceAll(regex(@"\t"),"   ")
                 /*
                 // strip initial comments
                 .replaceAll(regex(@"^(\s|%.*)+"),"") 
                 // strip off comments
                 // little conservative but % sometimes occurs inside url's
                 .replaceAll(rxTexComment, fun(cap) {
                    if (cap.groups[1] != "") { "\\begin{comment}\n" + cap.groups[1] + "\\end{comment}\n" }
                    elif (cap.groups[2] != "") { cap.groups[2] }
                    else ""  // end-of-line comment
                  })
                  */
  val md = parseTexX(normTxt,TexContext(texGrammar,citestyle,ignore))
  if (verbose) then trace( "TeX to Markdown:\n" + md )
  md
}

// val rxTexComment = regex(@"^((?:[ \t]*%.*\r?\n)+)|(\\%|\\url\{[^\}]*\})|%.*",multiline=True)


public function parseTexX( txt : string, context : texContext, newlineToSpace : bool = False) : string
{
  if (txt=="") then "" else {
    val res = parseTexAcc(context,builder(), txt.unbrace)
    if (!newlineToSpace) then res else res.replaceAll(rxNl," ")
  }
}
val rxNl = regex(@"\r?\n")



function parseTexAcc( context : texContext, acc : builder<h>, txt : string ) : st<h> string
{
  if (txt=="") return acc.string
  val (s,next,_) = matchRules(context.grammar,context,txt,id)
  parseTexAcc(context, acc.append(s), txt.substr1(next))  
}

