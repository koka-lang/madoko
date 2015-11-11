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
import texParserBase
import texParserItems

/* --------------------------------------
  Latex grammar 
---------------------------------------- */


/* Use TexRaw for the following commands */
val texRawCmd0 = @"(vfill|balance|leavevmode)"
val texRawCmd1 = @"((?:this)pagestyle)"
val texRawCmd2 = @"(markboth)"

/* keep these commands as is.. */
val texKeep2   = @"newcommand|defcommand|renewcommand|def|edef|gdef|providecommand"

/* ignore the following commands alwyas (and keep last argument) */
val texenv0  = @"(document)"
val texenv1  = @"(thebibliography)"
val texignore0 = @"relax"
val texignore1 = @"protect|date"
val texignore2 = @"scalebox"
val texignore3 = @"multirow|resizebox"

/* ignore the following commands and environments in bibliographies*/
val texcmd1  = @"(begin|end|newlength|setlength|bibfield|BibitemShut)"
val texcmd2  = @"(newcommand|renewcommand|providecommand|bibitemdeclare)"

val texenvcaption = "block|alertblock|exampleblock"

val bibitemBody = @"(?: *\n)*([\s\S]*?)\n(?= *\n|\\bibitem)"

val eol = @"(?:[ \t]*(?:%.*)?\r?\n)?"

/* main grammar */
val texGrammar : grammar<string,texContext> = [
  Rule("texnormal",   regex(@"^(?:[^" + special + "])+"), texNormal ),
  Rule("texspaces",   regex(@"^\n {4,}"), texIndent ),

  /* Documents */
  Rule("texdocclass", regex(@"^\\documentclass\b\s*" + optarg + @"?\s*" + texarg + @"([\s\S]*)"), texDocClass ),

  /* Block elements */
  Rule("texsection",  regex(@"^\\" + texsect + @"\b(\*)?\s*" + optarg + "?" + texarg + @"(?:\s*\\label\b" + texarg + @")?" ), texSection ),

  Rule("texcomment1", regex(@"^\\begin{comment}([\s\S]*?)\\end{comment}"), texComment ),
  Rule("texcomment2", regex(@"^(\n *%.*\n(?: *%.*\n)*)"), texComment),
  Rule("texlcomment", regex(@"^(%.*)"), texComment),  
  Rule("texfigure",   regex(@"^\\begin{(figure|table)(\*)?}" + optarg + @"?([\s\S]*?)\\end{\1\*?}"), texCaptioned ),
  Rule("texwfigure",  regex(@"^\\begin{wrapfigure}" + optarg + texarg + texarg + @"?([\s\S]*?)\\end{wrapfigure}"), texWrapFigure ),
  Rule("texlabeled",  regex(@"^\\begin{(definition|lemma|theorem|proposition|corollary|proof|example|thm|dfn)(\*)?}" + optarg + @"?([\s\S]*?)\\end{\1\*?}"), texLabeled ),
  Rule("textabularx", regex(@"^\\begin\{(tabular[xy\*])\}\s*" + optarg + @"?\s*" + texarg + @"\s*" + texarg + @"([\s\S]*?)\\end\{\1\}"), texTabularX ),
  Rule("textabular",  regex(@"^\\begin{tabular}\s*" + optarg + @"?\s*" + texarg + @"([\s\S]*?)\\end{tabular}"), texTabular ),

  Rule("texitemp",    regex(@"^(?:[ \t]*\r?\n)*\\pause\b\s*" + optarg + @"?\s*" + @"\\item\b\s*" + overlay + "?" + optarg + @"?\s*"), texItemPause ),
  Rule("texitem",     regex(@"^(?:[ \t]*\r?\n)*\\item\b\s*" + overlay + "?" + optarg + @"?\s*"), texItem ),
  Rule("texlist",     regex(@"^\\begin\{(itemize|enumerate)\}\s*" + optarg + @"?\s*((\\pause\b\s*)?\\item\b\s*" + overlay + "?" + optarg + @"?\s*)?"), texList ),
  Rule("texendlist",  regex(@"^\\end\{(itemize|enumerate)\}\s*"), texEmptyLine ),

  Rule("texlisting",  regex(@"^\\begin\{(lstlisting|verbatim|code|alltt)\}\s*" + optarg + @"?([\s\S]*?)\\end\{\1\}\s*"), texListing ),

  Rule("texnoindent", regex(@"^\\noindent\b([\s\S]*?\n) *\n"), texNoIndent ),
  Rule("texvspacex",  regex(@"^\\vspace\b\*?\s*" + texarg + @"(?=(?:\s|%.*)*[^\\\{\s])([\s\S]*?\n) *(?=\n|\\(?:end|item|begin|noindent)\b)"), texVSpacePara ),
  
  Rule("texminipage", regex(@"^\\begin{minipage}\s*" + optarg + "?" + optarg + "?" + optarg + "?" + texarg ), texBeginMinipage ),
  Rule("texvspace",   regex(@"^\\vspace\b\*?\s*" + texarg), texVSpace ),
  Rule("texhspace",   regex(@"^\\hspace\b\*?\s*" + texarg), texHSpace ),
  Rule("texskip",     regex(@"^\\(?:big|med|small)skip\b\s*" + texarg), texSkip ),
  Rule("texmbox",     regex(@"^\\(m|make|f|frame)box\b\s*" + optarg + "?" + optarg + "?" + texargg ), texMBox ),
  Rule("texparbox",   regex(@"^\\(par)box\b\s*" + optarg + "?" + optarg + "?" + optarg + "?" + texargg + texargg), texParBox ),
  Rule("texraisebox", regex(@"^\\(raise)box\b\s*" + texargg + optarg + "?" + optarg + "?" + texargg ), texRaiseBox ),
  Rule("texvskip",    regex(@"^\\vskip\b\s*" + texdim), texVSkip ),
  Rule("texhskip",    regex(@"^\\hskip\b\s*" + texdim), texHSkip ),

  /* beamer */
  Rule("texframe",    regex(@"^\\begin{(?:frame|slide)}\s*" + overlay + "?" + optarg + "?" + texargg + @"?\s*" + texargg + "?" + @"([\s\S]*?)\\end{frame}"), texFrame ),
  Rule("texframeCmd", regex(@"^\\frame\b\s*" + overlay + "?" + optarg + "?" + texargg), texFrameCmd ),
  Rule("texcolumn",   regex(@"^\\begin{column}\s*" + texargg), texColumn ),
  Rule("texonly",     regex(@"^\\(uncover|only|visible)\b\s*" + overlay + "?" + texargg), texUncover ),
  Rule("texbcblock",  regex(@"^\\begin{(" + texenvcaption + @")}\s*" + overlay + "?" + texargg), texBeginCaptionBlock ),
  Rule("texecblock",  regex(@"^\\end{(" + texenvcaption + @")}"), texEndCaptionBlock ),
  
  /* Specials */
  Rule("texinclude",  regex(@"^\\(include(?:only)?|input)\b\s*" + texarg + eol), texInclude ),
  Rule("textitle",    regex(@"^\\(?:maketitle|titlepage)\b" + eol), texMakeTitle ),
  Rule("texbib",      regex(@"^\\bibliography\b\s*" + texarg), texBibliography ),

  Rule("texclear",    regex(@"^\\(pagebreak|newpage|clearpage)\b\s*"), texPageBreak ),
  Rule("texappendix", regex(@"^\\appendix\b\s*"), texAppendix ),
  Rule("textoc",      regex(@"^\\tableofcontents\b\s*"), texToc ),
  Rule("textof",      regex(@"^\\tableoffigures\b\s*"), texTof ),
  Rule("texfootnote", regex(@"^\\footnote\b\s*" + texargg + @"([\s\S]*?)\n[ \t\r]*\n"), texFootnote),
  Rule("teximg",      regex(@"^\\includegraphics\b\s*" + overlay + "?" + optarg + "?" + texargg + @"([\s\S]*?)(?:\n[ \t\r]*\n|$)"), texImage ),
  Rule("texacks",     regex(@"^\\acks\b\s*"), texAcks ),
  Rule("textoday",    regex(@"^\\today\b\s*"), texToday ),
  Rule("texfname",    regex(@"^\\currfilename\b\s*"), texFilename ),

  /* Common inline elements */
  Rule("texref",      regex(@"^(~)?\\ref\b" + texargg), texRef ),
  Rule("texverb",     regex(@"^\\(?:verb|lstinline)\*?([!\+%\|\.\^#@])(.*?)\1"), texCode ),
  
  Rule("texmath1",    regex(@"^(?:\$(?:[^\\\$]|\\.)+\$|\\\((?:[^\\]|\\[^\)])*\\\))"), texMathInline ),
  Rule("texmath2",    regex(@"^(?:\$\$(?:[^\\\$]|\\.|\$(?!\$))*\$\$|\\\[(?:[^\\]|\\[^\]])*\\\])"), texMathDisplay ),
  Rule("texmathenv1",  regex(@"^\\begin\{(equation|displaymath)(\*)?\}([\s\S]*?)\\end{\1\2}"), texMathEnv ),
  Rule("texmathenv2",  regex(@"^\\begin\{(gather|align|alignat|multline|eqnarray|flalign)(\*)?\}" + texarg + @"?([\s\S]*?)\\end{\1\2}"), texMathSnippet ),
  Rule("textikz1",     regex(@"^\\begin\{tikzpicture\}([\s\S]*?)\\end{tikzpicture}"), texTikzEnv ),
  Rule("textikz2",     regex(@"^\\tikz\b\s*" + optarg + @"?\s*" + texarg), texTikzCmd ),

  Rule("biblio",      regex(@"^\\begin\{thebibliography\}\s*(?:\{([^}]+)\})?(?: *\n)*([\s\S]*?)\\end{thebibliography}"), texTheBibliography ),
  Rule("bibitemcite", regex(@"^\\bibitem\[(?:\\protect *)?\\citeauthoryear" + texarg + texarg + texarg + @"\]" + texarg + bibitemBody), texBibitemCite),
  Rule("bibitem",     regex(@"^\\bibitem\b\s*" + optarg + "?" + texarg + bibitemBody), texBibitem ),
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
  Rule("texsc",       regex(@"^\\textsc\b\s*" + texarg), texSmallcaps ),
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
  Rule("texccmd",     regex(@"^\\(alert)\b\s*" + texarg), texClassCmd ),  
  Rule("texeol",      regex(@"^\\\\" + optarg + "?"), texLineBreak ),
  Rule("texcolor1",   regex(@"^\\(?:text|cell)color\b\s*" + optarg + "?" + texargg + texargg), texTextColor ),
  Rule("texcolor2",   regex(@"^\{\s*\\color\b\s*" + optarg + "?" + texargg + texargs + @"\}"), texTextColor ),
  Rule("texcolor3",   regex(@"^\\(f)?colorbox\b\s*" + optarg + "?" + texargg + texargg), texColorBox ),

  Rule("texinst",     regex(@"^\\(?:inst|IEEEauthorrefmark)\b\s*" + texarg), texInst ),


  Rule("texsize",     regex(@"^\{\\(" + texFontSizes + @")\b\s*" + texargs + @"\}"), texFontSize ),
  Rule("texaccent",   regex(@"^\\([`'^""~]|[vrc]\b)\s*" + texarg), texAccent ),
  Rule("texdash",     regex(@"^---?"), texDash ),

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

  Rule("texkeep2",    regex(@"^\\(" + texKeep2 + @")\b\*?\s*" + optargs + texarg + optargs + texarg), texKeep ),

  Rule("texignore3",  regex(@"^\\(" + texignore3 + @")\b\s*" + optargs + texargg + texargg + texargg), texAlwaysIgnore5 ),
  Rule("texignore2",  regex(@"^\\(" + texignore2 + @")\b\s*" + optargs + texargg + texargg), texAlwaysIgnore4 ),
  Rule("texignore1",  regex(@"^\\(" + texignore1 + @")\b\s*" + optargs + texarg), texAlwaysIgnore3 ),
  Rule("texignore0",  regex(@"^\\(" + texignore0 + @")\b\s*" + optargs), texAlwaysIgnore ),
  
  Rule("texenvbegin", regex(@"^\\begin\{([a-zA-Z@]+)(\*)?\}\s*" + overlay + "?" + optarg + @"?\s*"), texEnvBegin),
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
  //Rule("texcmd0",     regex(@"^\\(" + texcmd0 + @")\b\s*" + optargs), texIgnore ),
  Rule("texcmd",      regex(@"^(\\[a-zA-Z@]+)\b\s*(" + optargs + ")"), texGenericCommand ),

  Rule("texchar",     regex(@"^\\[^a-zA-Z]"), texChar ),
  
  Rule("texother",    regex(@"^[\s\S]"), texOther ),
]

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
  val md = contextParse(TexContext(texGrammar,citestyle,ignore,contextParse), normTxt)
  if (verbose) then trace( "TeX to Markdown:\n" + md )
  md
}

// val rxTexComment = regex(@"^((?:[ \t]*%.*\r?\n)+)|(\\%|\\url\{[^\}]*\})|%.*",multiline=True)

function contextParse( context : texContext, txt : string ) : string {
  if (txt=="") then "" else {
    parseTexAcc(context,builder(), txt.unbrace)
    // if (!newlineToSpace) then res else res.replaceAll(rxNl," ")
  }
}

function parseTexAcc( context : texContext, acc : builder<h>, txt : string ) : st<h> string
{
  if (txt=="") return acc.build
  val (s,next,_) = matchRules(context.grammar,context,txt,id)
  parseTexAcc(context, acc.append(s), txt.substr1(next))  
}

