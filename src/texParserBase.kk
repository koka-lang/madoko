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
module texParserBase

import std/dict
import std/string
import std/regex
import std/crypto
import std/path
import common
import entity
import texCommon

/* --------------------------------------
 The context for latex elements 
---------------------------------------- */
public alias texRule = rule<string,texContext>

public rectype texContext {
  // The parse context for latex elements. 
  TexContext( grammar   : grammar<string,texContext>, 
              citestyle : citestyle = citeAuto, 
              ignore    : bool = True,
              texparse  : (context:texContext, input:string) -> string )                 
}


public function parse( txt : string, context : texContext ) : string
{
  (context.texparse)(context,txt)
}


public val special = @"\\{}~*_\[\]#\$`%\n\-";

public val texargg = @"(?:\{" + texargs + @"\})"

public val overlay = @"(?:<([^>\n]*)>)"

/* don't include these as packages */
public val stdPackages = ["iftex","etoolbox","xkeyval","xcolor","mdframed","graphicx","tablefootnote",
                   "css","array","longtable","enumitem","booktabs","hyperref","pdfcomment","wrapfig","madoko",
                   "amsmath","amsfonts","amssymb","stmaryrd","textcomp","pifont",
                   // the following should really not be included as they clash with the standard ones
                   "inputenc","fontenc","ae","aecompl","enumerate", 
                   // the next ones are just superfluous
                   "color",
                  ].join(";")

public function unbrace(s : string ) : string {
  if (s.startsWith("{") && s.endsWith("}")) 
   then s.substr(1,s.length-2) else s
}


public function quote( s : string ) : string {
  val hasdquot = s.contains("\"")
  val hassquot = s.contains("\'")
  if (s.contains("\"")) then {
    if (s.contains("\'")) 
     then "\"" + s.replaceAll("\"","&quot;") + "\""
     else "'" + s + "'"
  }
  else "\"" + s + "\""
}

public function indent4( txt : string ) : string {
  txt.split("\n").map(fun(s) { "    " + s }).join("\n")
}


public val rxNl = regex(@"\r?\n")

public function makeAttr( key : string, value : string ) {
  if (value=="")
   then ""
   else key + "=" + value.replaceAll(rxNl,"&nl;").quote
}

public function joinAttrs( keyvals : list<string> ) {
  val kvs = keyvals.remove(isEmpty).join(" ")
  if (kvs=="") then "" else "{ " + kvs + " }"
}

public function singleAttr( key : string, value : string ) : string {
  [makeAttr(key,value)].joinAttrs
}

public function trimx( s : string, n : int ) : string {
  s.substr(n,s.length-(2*n))
}

public function trimNL( s : string ) : string {
  s.replaceAll(rxNL0,"")
}

val rxNL0 = regex(@"^[ \t]*\r?\n|\r?\n$")


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
  MRule(regex(@"\\date\b\s*" + texargg), ["Title Note"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\bibliographystyle\b\s*" + texargg), ["Bib Style"], metaValueBibStyle, metaEmpty ),  
  MRule(regex(@"\\bibliography\b\s*" + texargg), ["Bibliography"], metaValueBib, metaKeep ),
  MRule(regex(@"\\authorinfo\b\s*" + texargg + @"\s*" + texargg + @"\s*" + texargg), ["Author","Address","Email"], metaTexValue3, metaEmpty ),
  MRule(regex(@"\\(?:IEEEauthorblockN)\b\s*" + texargg), ["Author"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\(?:IEEEauthorblockA)\b\s*" + texargg), ["Address"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\(?:author)\b\s*" + texargg), ["Author"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\(?:address)\b\s*" + texargg), ["Address"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\email\b\s*" + texargg), ["Email"], metaTexValue, metaEmpty ),
  MRule(regex(@"\\(?:institute|affiliation|affaddr)\b\s*" + texargg), ["Affiliation"], metaTexValue, metaEmpty ),
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

function metaValueBib( cap : matched, _context ) : list<string> {
  val bibs = cap.groups[1].unbrace.trim.split(",")
  [bibs.join(";")]
}



function metaTexValue( cap : matched, context ) : list<string> {
  [cap.groups[1].parse(context)]
}

function metaTexValue3( cap : matched, context ) : list<string> {
  list(1,3).map(fun(i) { cap.groups[i].parse(context) })
}

function metaOptionValue( cap : matched, _context ) : list<string> {
  val pkg = cap.groups[2].unbrace.trim
  if (stdPackages.contains(pkg)) then return []
  [(if (cap.groups[1].isEmpty) then "" else "[" + cap.groups[1] + "]") + cap.groups[2].unbrace.trim]
}


function texMeta( key, value ) {
  val rvalue = value.unbrace.replaceAll(rxMetaNL, "\n    ").trim
  if (rvalue=="") 
   then ""
   else key.unbrace.fill(12) + ": " + rvalue
}
val rxMetaNL = regex(@"\r?\n(?:[ ]{1,4}|\t)?")

function removeSections( txt : string ) : string {
  txt.replaceAll(rxSection,"")
}
val rxSection = regex(@"\\(sub)?section\b\*?\s*" + optarg + @"?" + texarg + @"\s*")

public function texDocClass( cap : matched, context : texContext ) : string {
  val docClass = cap.groups[2].unbrace.trim
  val comment  = [ "<!-- LaTeX conversion",
                   "  Drag&Drop further .tex/.bib/.cls/.sty/.bst or image files in the editor window",
                   "  Conversion reference at: http://research.microsoft.com/en-us/um/people/daan/madoko/doc/reference.html#texconv",
                   "-->"                                 
                 ].join("\n")
  val mdata0 = if (docClass=="beamer") 
                then ["[INCLUDE=presentation]","Reveal Theme: sky"] 
                else zipWith(["Doc Class"], metaOptionValue(cap,context), texMeta)
  val (mdata1,content0) = extractMeta( cap.groups[3], context, mdata0 )
  val mdata2 = mdata1 + [if (docClass == "book") then "" else "Heading Base: 2","Logo        : True"]
  val content = if (docClass=="beamer") then content0.removeSections else content0
  val (body,mdata) = match(content.find(rxDocument)) {
    Nothing    -> (content.parse(context), mdata2)
    Just(ccap) -> {
      val header = ccap.groups[1].trim
      val hdata = if (header.isEmpty) then []
                   else [["TeX Header  :\n    % Latex definitions. If you get errors in math- or PDF generation:",
                          "    % * Move commands that are not used in math under 'Tex Header*' metadata",
                          "    % * Move commands specific to math in a '~ MathDefs' block",
                          "    ",
                          header.trim.indent4].join("\n")] // 
                       //"\n<!-- LaTeX definitions; use ~ MathDefs for commands needed for mathematics -->" +
                       //"\n~ TexRaw\n" + header + "\n~\n\n" 
      (ccap.groups[2].parse(context), [comment] + mdata2 + hdata)
    }
  }
  mdata.join("\n") + "\n\n" + body
}
val rxDocument = regex(@"^([\s\S]*?)\n *\\begin{document}([\s\S]*?)\n *\\end{document}" )

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

