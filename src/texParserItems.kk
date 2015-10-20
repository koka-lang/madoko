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
public module texParserItems

import std/dict
import std/string
import std/regex
import std/crypto
import std/path
import common
import entity
import texCommon
import texParserBase

/* use entity for these commands */
val texEntities = [("LaTeX","LogoLaTeX"),("LaTeXe","LogoLaTeXe"),("BibTeX","LogoBibTeX"),("AmSTeX","LogoAmSTeX"),("TeX","LogoTeX")].dict
val texEntityCmd0 = @"(vfill|qed|eg|etal|ie|" + texEntities.keys.join("|") + ")"


val texFontSizeMap = [("tiny","xx-small"),("scriptsize","x-small"),("footnotesize","small"),
                      ("small","small"),("normalsize","medium"),("large","large"),("Large","x-large"),
                      ("LARGE","xx-large"),("Huge","xx-large")].dict
val texFontSizes   = texFontSizeMap.keys.join("|")             

/* sections, sizes, etc */
val texsects = ["part","chapter","section","subsection","subsubsection","paragraph"]
val texsect  = "(" + texsects.join("|") + ")"


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


function texFootnote( cap : matched, context ) : string {
  val fn = "^fn-" + cap.groups[1].md5.substr(0,3)
  "[" + fn + "]" + cap.groups[2].parse(context) + "\n\n[" + fn + "]: \n" + cap.groups[1].parse(context).indent4 + "\n\n"
}

function toIdentifier(s) {
  s.unbrace.replaceAll(rxNonIdChar,"-")
}
val rxNonIdChar = regex(@"[^\w\-]+")

function texSection( cap : matched, context ) : string {
  val n = max(1, texsects.indexOf(fun(s) { s == cap.groups[1] }) - 1);
  val caption = parse( cap.groups[4].unbrace, context )
  val attrs = [if (cap.groups[2]=="*") then " -" else "",
               if (cap.groups[5] != "") then " #" + cap.groups[5].toIdentifier else "",
               makeAttr("toc-line", cap.groups[3])
              ].joinAttrs

  string(n,'#') + " " + caption + " " + attrs + "\n"
}

function texFontSize( cap : matched, context ) : string {
  val cssSize = texFontSizeMap[cap.groups[1]].maybe("medium",id)
  "[" + cap.groups[2].parse(context) + "]{font-size=" + cssSize + "}"
}

function texComment( cap : matched, _context )  : string {
  val comment = cap.groups[1]
  val com = if (comment.startsWith("\n")) then "\n<!--" + comment.substr(1) else "<!--" + comment
  if (com.endsWith("\n"))
   then com.substr(0,com.length-1) + "-->\n"
   else com + "-->"
}

function texRef( cap : matched, _context ) : string {
   (if (cap.groups[1]=="~") then " " else cap.groups[1]) + "[#" + cap.groups[2].toIdentifier + "]" 
}


function texEnvBegin( cap : matched, _context ) : string {
  val attrs = [if (cap.groups[3].isEmpty) then "" else ".fragment"].joinAttrs
  "\n~ Begin " + cap.groups[1].capitalize + " " + attrs + "\n"
}

function texEnvEnd( cap : matched, _context ) : string {
  "\n~ End " + cap.groups[1].capitalize + "\n"
}

function texBeginMinipage( cap : matched, _context ) : string {
  val width  = texLength(cap.groups[4])
  val height = texLength(cap.groups[2])
  val attrs = [makeAttr("width",width),
               makeAttr("height",height)].joinAttrs
  "\n~ Begin Minipage " + attrs + "\n"             
}

function texItemPause( cap : matched, context ) : string {
  texItemX( "\n\n* {.fragment}", cap.groups[2], context )
}

function texItem( cap : matched, context ) : string {
  val bullet = if (cap.groups[1].isEmpty) then "\n\n*" else "\n\n* {.fragment}"
  texItemX( bullet, cap.groups[2], context )
}

function texItemX( bullet : string, caption : string, context ) : string {
  bullet + " " + (if (caption=="") then "" else "**" + parse(caption,context) + "**")
}

function texList( cap: matched, context ) : string {
  val bullet = if (cap.groups[1]=="itemize") then "*" else "1."
  if (cap.groups[3]=="") then "\n" else {
    val post = if (cap.groups[4].isEmpty && cap.groups[5].isEmpty) then "" else " {.fragment}"
    "\n\n" + texItemX( bullet + post, cap.groups[6], context )
  }
}

function texEmptyLine( _cap, _context ) : string {
  "\n"
}


function texMathDisplay( cap : matched, _context ) {
  "\n~ Math\n" + cap.matched.trimx(2).trim + "\n~\n"
}

function texMathInline( cap : matched, _context ) {
  "$" + cap.matched.trimx(1).replaceAll(rxMathNl," %\n") + "$"
}
val rxMathNl = regex(@"\r?\n")

function texMathEnv( cap : matched, context ) {
  val (content,labelCaption,pre,post) = cap.groups[3].extractLabelCaption(context)
  val attrs = labelCaption.joinAttrs
  val envName = if (cap.groups[2]=="*") then "Math" else "Equation"
  "~ " + envName + " " + attrs + "\n" + pre +
  content.trimLines +
  post + "\n~\n"
}

function texMathSnippet( cap : matched, context ) {
  val env = cap.groups[1]
  val lenv = 
    if (env=="gather") then "gathered"
    elif (env=="align" || env=="multline" || env=="flalign" || env=="eqnarray") then "aligned"
    else ""
  val (pre,post) = if (lenv.bool) then ("\\begin{" + lenv + "}\n","\n\\end{" + lenv + "}") else ("","")
  val (content,labelCaption,_pre,_post) = cap.groups[4].extractLabelCaption(context)
  val attrs = labelCaption.joinAttrs
  val envName = if (lenv.isEmpty) then "Snippet" elif (cap.groups[2]=="*") then "Math" else "Equation"
  "~ " + envName + " " + attrs + "\n" + pre +
  content.trimLines +
  post + "\n~\n"
}

function texTikzEnv( cap : matched, context ) {
  "~ Snippet\n\\begin{tikzpicture}" + cap.groups[1] + "\\end{tikzpicture}\n~\n"
}
function texTikzCmd( cap : matched, context ) {
  "$\\tikz[" + cap.groups[1] + "]{" + cap.groups[2] + "}${math-needpdf=true}"
}


function texListing( cap : matched, context ) : string {
  val attrs = if (cap.groups[2]=="") then "" else {
    " { " + cap.groups[2].findAll(rxKeyVal).map( fun(kcap) { 
              val key = kcap.groups[1]
              val value = kcap.groups[2] 
              if (key=="language") then "language='" + value + "'"
              elif (key=="caption") then "caption='" + parse( value.unbrace, context ) + "'"
              elif (key=="label") then "#" + value.toIdentifier
              else ""
            }).join(" ") + " }"
  }

  "```" + attrs + "\n" + cap.groups[3].trimNL + " \n```\n"
}
val rxKeyVal = regex(@"\b(\w+)=(\{[^\}]*\}|[^;,\s\}]*)")

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
  val env = if (cap.groups[1]=="table") then "tableFigure" else cap.groups[1]
  texCaptionedXX( env, cap.groups[4], cap.groups[3], extraAttrs, context )
}
function texWrapFigure( cap : matched, context ) : string {
  val attrs  = [makeAttr("width", cap.groups[3].texLength),
                makeAttr("lines", cap.groups[1]),
                if (cap.groups[2]=="r" || cap.groups[2]=="R" || cap.groups[2]=="o" || cap.groups[2]=="O")
                 then "float=right margin-left=1em"
                 else "float=left margin-right=1em"
               ]  
  texCaptionedXX( "figure", cap.groups[4], "", attrs, context )
}

function texCaptionedXX( env :string, body: string, caption:string, extraAttrs : list<string>, context ) : string {
  val (content,labelCaption,pre,post) = extractLabelCaption( body, context, caption.parse(context), "" )
  val attrs = (extraAttrs + labelCaption).joinAttrs  
    "\n~ Begin " + env.capitalize + " " + attrs + "\n" + pre +
  content.trimNL.parse(context) +
  post + "\n~ End " + env.capitalize + "\n"
}

function extractLabelCaption( content : string, context, defCaption = "", defLabel = "" ) : (string,list<string>,string,string) {
  var label := defLabel
  var caption := defCaption
  var pre   := ""
  var post := ""
  val content1 = content.replace( rxCaption, fun(ccap) {
    caption := ccap.groups[1].parse(context)
    ""
  }).replace( rxLabel, fun(lcap) {
    label := "#" + lcap.groups[1].toIdentifier
    ""
  }).replace( rxCentering, fun(ccap) {
    pre  := pre + "~ Begin Center\n"
    post := "\n~ End Center" + post
    ""
  })
  (content1, [label,makeAttr("caption",caption)], pre, post )
}

val rxCaption = regex(@"\\caption\b" + texarg)
val rxLabel   = regex(@"\\label\b" + texarg)
val rxCentering = regex(@"\\centering\b\s*")

function texNoIndent( cap : matched, context ) : string {
  cap.groups[1].parse(context) + "{.noindent}\n\n"
}

function texVSpacePara( cap : matched, context ) : string {
  cap.groups[2].parse(context) + "{ margin-top=" + cap.groups[1].texLength.quote + "}\n\n"
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
  val textwidth = @"(textwidth|linewidth|columnwidth|hsize)"
  w.unbrace.replace(regex(@"0\.(\d\d?)\\" + textwidth + @"\b\s*"),fun(wcap) {
    val n = wcap.groups[1].parseInt().maybe(100,id)
    if (n < 10) then n.show + "0%" else n.show + "%"
  }).replace(regex(@"\\" + textwidth + @"\b\s*"), "100%");
}

function texTabularDo( pos :string, width: string, spec : string, content : string, cap: matched, context ) : string {
  function toColSpecs( xs : list<matched> ) {
    match(xs) {
      Nil -> [("|","","")]
      Cons(xcap,ys) -> {
        if (xcap.groups[1] == "") {
          // no explicit separator
          [("|",xcap.matched.substr(0,1).toLower, singleAttr("width",xcap.groups[2].texLength))] + toColSpecs(ys)
        }
        else {
          // is separator
          match(ys) {
            Nil -> {
              // final separator
              [("+","","")]
            }
            Cons(ycap,zs) -> {
              [("+",ycap.matched.substr(0,1).toLower, singleAttr("width",ycap.groups[2].texLength))] + toColSpecs(zs)
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
      Nothing    -> (1, cell.parse(context))
      Just(ccap) -> {
        val n = ccap.groups[1].unbrace.parseInt.maybe(1,id)
        (n, ccap.groups[3].parse(context) + string(n-1,'|') )
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
    "\n~Begin Column\n" + col.parse(context) + "\n~ End Column"
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
  val attrs = [".textable", makeAttr("width",width.texLength),
              (if (pos=="b") then "vertical-align=bottom" 
               elif (pos=="t") then "vertical-align=top" 
               else "")].joinAttrs

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
val rxSpec   = regex(@"(\|\|?)|[lcrX]|[pmb]\{([^\}]*)\}")
val rxNoSpec = regex(@"\s|[^pmb](?=\{)" + texarg)


/* --------------------------------------
 Beamer
---------------------------------------- */

function beamerOptions( opts : string ) : (string,list<string>) {
  var title := ""
  val attrs = opts.findAll(rxKeyVal).list.map( fun(cap) {
    val key = cap.groups[1]
    val value = cap.groups[2]
    if (key=="label") then "#" + value.toIdentifier
    elif (key=="title") then {
      title := value
      ""
    }
    elif (key=="squeeze" || key=="shrink" || key=="plain") {
      ".smaller"
    }
    else ""
  })
  (title,attrs)
}

function beamerExtract( content : string, context ) : (string,string,list<string>,string,string) {
  var label   := ""
  var title   := ""
  var pre := ""
  var post := ""
  val content1 = content.replace( rxFrameTitle, fun(tcap) {
    title := tcap.groups[1]
    ""
  }).replace( rxLabel, fun(lcap) {
    label := "#" + lcap.groups[1].toIdentifier
    ""
  }).replace( rxCentering, fun(ccap) {
    pre  := pre + "~ Begin Center\n"
    post := "\n~ End Center" + post
    ""
  })
  (content1, title, [label], pre, post )
}
val rxFrameTitle = regex(@"\\frametitle\b\s*" + texargg )

function texFrame( cap : matched, context : texContext ) : string {
  texFrameX( cap.groups[2], cap.groups[3], cap.groups[4], cap.groups[5], context )
}

function texFrameCmd( cap : matched, context : texContext ) : string {
  texFrameX( cap.groups[2], "", "", cap.groups[3], context )
}

function texFrameX( options : string, argTitle : string, argSubtitle : string, body : string, context : texContext ) : string {  
  val (title0,attrs0) = options.beamerOptions
  val (content,title1,attrs1,pre,post) = body.beamerExtract(context)
  val title = argTitle.unbrace || title1 || title0
  val subtitle = if (argSubtitle.isEmpty) then "" else " - " + argSubtitle.unbrace
  val rtitle   = (title + subtitle).parse(context)
  val ftitle   = rtitle.trim || @"\/" 
  "\n# " + ftitle + " " + (attrs0 + attrs1).joinAttrs + "\n" + pre + content.parse(context) + post + "\n" 
}

function texColumn( cap : matched, context ) : string {
  val attrs = singleAttr("width", cap.groups[1].texLength )
  "~ Begin Column " + attrs
}

function texUncover( cap : matched, context ) : string {
  "[" + cap.groups[3].parse(context) + "]{.fragment}"
}

function texBeginCaptionBlock( cap : matched, context ) : string {
  val attrs = ["." + cap.groups[1],
               if (cap.groups[2].isEmpty) then "" else ".fragment",
               makeAttr("caption", cap.groups[3].parse(context)) 
              ].joinAttrs
  "\n~ Begin Captioned " + attrs + "\n"
}

function texEndCaptionBlock( cap : matched, context ) : string {
  "\n~ End Captioned\n"
}

/* --------------------------------------
 Latex grammar functions 
---------------------------------------- */

function texNormal( cap : matched, _context ) : string {
  cap.matched 
}

function texIndent( cap : matched, _context ) : string {
  "\n   "
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
  val letter = cap.groups[2].replaceAll(rxNonLetter,"")
  match (texAccents[cap.groups[1]]) {
    Just(name) -> "&" + letter + name + ";"
    Nothing -> letter 
  }
}
val rxNonLetter = regex(@"[^\w]+");

function texRule( cap : matched, _context ) : string {
  val widthHeight = [makeAttr("width",texLength(cap.groups[2])),
                     makeAttr("height",texLength(cap.groups[3]))]
  if (cap.groups[1] != "") then {
    "[ ]" + (["background-color=black",makeAttr("vertical-align",texLength(cap.groups[1]))] + widthHeight).joinAttrs
  }
  else {
    "\n------------ " + widthHeight.joinAttrs + "\n"
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
  val body = parse( cap.groups[1], context )
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

function texAlwaysIgnore3( cap : matched, context : texContext ) : string {
  cap.groups[3].parse(context)
}
function texAlwaysIgnore4( cap : matched, context : texContext ) : string {
  cap.groups[4].parse(context)
}
function texAlwaysIgnore5( cap : matched, context : texContext ) : string {
  cap.groups[5].parse(context)
}

function texIgnore( cap : matched, context : texContext ) : string {
  if (context.ignore) then "" else cap.matched
}

function texKeep( cap : matched, context : texContext ) : string {
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
  elif (s=="") then ""
  else "left"
}

function texVAlign( s : string ) : string {
  if (s=="c") then "middle"
  elif (s=="t") then "top"
  elif (s=="b") then "bottom"
  elif (s=="") then ""
  else "baseline"
}

function texMBox( cap : matched, context ) : string {
  val attrs = [makeAttr("width", texLength(cap.groups[2])),
               makeAttr("text-align", texAlign(cap.groups[2])),
               if (cap.groups[1].startsWith("f")) then ".framed" else ""].joinAttrs
  "[" + cap.groups[4].parse(context) + "]" + attrs
}

function texParBox( cap : matched, context ) : string {
  val attrs = [makeAttr("width", texLength(cap.groups[5])),
               makeAttr("text-align", texAlign(cap.groups[2])),
               makeAttr("height", texLength(cap.groups[3])),
               makeAttr("vertical-align", texVAlign(cap.groups[4])),
              ].joinAttrs              
  "\n~ Parbox " + attrs + "\n" + cap.groups[4].parse(context).trimNL + "\n~\n"
}

function texRaiseBox( cap : matched, context ) : string {
  val attrs = [makeAttr("height", texLength(cap.groups[3])),
               makeAttr("vertical-align", texLength(cap.groups[2])),
              ].joinAttrs              
  "[" + cap.groups[4].parse(context) + "]" + attrs
}


function texImage( cap : matched, context ) : string {
  val kvs0 = cap.groups[2].findAll(rxKeyVal).list.map( fun(kcap) {
              val key = kcap.groups[1]
              val value = kcap.groups[2].unbrace
              if (key=="width") then "width=\"" + texLength(value) + "\""
              elif (key=="height") then "height=\"" + texLength(value) + "\""
              elif (key=="scale") then "transform=\"scale(" + value + ")\""
              elif (key=="angle") then "transform=\"rotate(" + value + "deg)\""              
              else ""
             })
  val kvs1 = if (cap.groups[1].isEmpty) then [] else [".fragment"]  
  val fname = cap.groups[3].unbrace
  val imgname = if (fname.extname=="") then fname + ".eps" else fname
  val imgkey  = imgname.stemname.replaceAll(regex(@"[^\w\-]+"),"")
  "![" + imgkey + "]" + cap.groups[4].parse(context) + "\n\n[" + imgkey + "]: " 
    + imgname + " \"image title\" { " + (kvs0 + kvs1).join(" ") + " }\n"
}


function texInst( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1].unbrace.parse(context)
  if (txt=="") then "" else "^" + txt.replaceAll(" ","\\ ") + "^"
}

function texAcks( cap : matched, context : texContext ) : string {
  "\n# Acknowledgements { - }\n\n"
}

function texToday( cap : matched, context : texContext ) : string {
  "&date;"
}

function texFilename( cap : matched, context : texContext ) : string {
  "&filename;"
}

function texClassCmd( cap : matched, context : texContext ) : string {
  "[" + cap.groups[2].parse(context) + "]{." + cap.groups[1].toIdentifier + "}"
}


function parseColor( c : string ) : string {
  val n = c.parseIntDefault(0)
  if (n < 0 || n > 255) 
   then "00"
   else n.showHex(2)   
}

function parseFloatColor( c : string ) : string {
  val n = c.parseFixedDefault()
  if (n < 0.0 || n > 1.0)
   then "00"
   else catch({(n * 255.0).floor.int.showHex(2)},fun(_exn) { "00" })
}

function parseColors(r,g,b) : string {
  "#" + parseColor(r) + parseColor(g) + parseColor(b) 
}

function parseFloatColors(r,g,b) : string {
  "#" + parseFloatColor(r) + parseFloatColor(g) + parseFloatColor(b) 
}


function extractColorX( model : string, value : string ) : string {
  if (model=="") then {
    return value.toIdentifier
  }
  val (r,g,b) = match(value.split(",").list) {
    Cons(x,Nil) -> (x,x,x)
    Cons(x,Cons(y,Cons(z,Nil))) -> (x,y,z)
    _ -> ("","","")
  }

  if (model=="gray") {
    parseFloatColors(r,r,r)
  }
  elif (model=="rgb") {
    parseFloatColors(r,g,b)
  }
  elif (model=="RGB") {
    parseColors(r,g,b)
  }
  elif (model=="HTML") {
    "#" + r + g + b
  }
  else "black"
}

function extractColor( model : string, value : string  ) : list<string> {
  [makeAttr("color",extractColorX(model,value))]  
}

function texTextColor( cap : matched, context ) : string {
  val attrs = extractColor(  cap.groups[1], cap.groups[2] )
  "[" + cap.groups[3].parse(context) + "]" + attrs.joinAttrs
}

function texColorBox( cap : matched, context ) : string {
  val attrs = [makeAttr("background-color", extractColorX(  cap.groups[2], cap.groups[3] )),
               if (cap.groups[1].isEmpty) then "" else ".framed"]
  "[" + cap.groups[3].parse(context) + "]" + attrs.joinAttrs
}



function texEmph( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  val end = if (cap.groups[2] != "") then cap.groups[2] else "\\/"
  if (txt=="") then "" else "_" + txt.parse(context) + "_" + end
}

function texSlanted( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parse(context) + "]{font-style=oblique}"
}

function texSmallcaps( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parse(context) + "]{font-variant=small-caps}"
}

function texUpright( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parse(context) + "]{font-style=normal}"
}

function texRoman( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parse(context) + "]{font-family=serif}"
}

function texSans( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parse(context) + "]{font-family=sans-serif}"
}


function texStrong( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  val end = if (cap.groups[2] != "") then cap.groups[2] else "\\/"
  if (txt=="") then "" else "**" + txt.parse(context) + "**" + end
}

function texCode( cap : matched, context : texContext ) : string {
  val txt = cap.groups[2]
  if (txt=="") then "" else "`" + txt + "`"
}

function texMonospace( cap : matched, context : texContext ) : string {
  val txt = cap.groups[1]
  if (txt=="") then "" else "[" + txt.parse(context) + "]{font-family=monospace}"
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
  "[" + cap.groups[2].parse(context) + "]{ .bibinfo field=\"" + cap.groups[1].unbrace + "\"}"
}

function texDquot( cap : matched, context : texContext ) : string {
  texQuot("\"",cap,context)
}
function texSquot( cap : matched, context : texContext ) : string {
  texQuot("'",cap,context)
}
function texQuot( quot : string, cap : matched, context : texContext ) : string {
  quot + cap.groups[1].parse(context) + quot
}

function texTheBibliography( cap : matched, context : texContext ) : string {
  val numcite = if (context.citestyle.isNumCite) then ".bib-numeric" else ".bib-authoryear"
  "~ Begin Bibliography { " + numcite +
    " caption=\"" + cap.groups[1].unbrace + "\"}\n" + (cap.groups[2] + "\n\n").parse(context) + 
    "\n~ End Bibliography\n"
}

function texCiteAuthorYear( cap : matched, context : texContext ) : string {
  (cap.groups[2] + "," + cap.groups[3] + "," + cap.groups[1]).parse(context).replaceAll(rxNl," ")
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
val rxCiteSep = regex(@", *")

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
  val lab = labx.unbrace.parse(context)  
  val md  = content.parse(context)
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
                 makeAttr("tex-cite-label", labx.unbrace ),
                 makeAttr("label", label),
                 makeAttr("caption", caption),
                 makeAttr("searchterm", search )].joinAttrs

  //trace("bibitem: labx: " + labx + ", lab: " + lab + ", label: " + label)
  "~ Begin Bibitem " + attrs + "\n" +
   md + 
   "\n~ End Bibitem\n"
}


val rxNewblock = regex(@"\[\s*\]\{\s*\.newblock\s*\}\s*")
val rxSpaces = regex(@"\s+")
val rxNonSearch = regex(@"(&#?\w+;|\]\{[^\}]*\}|[^\w\+\-])+|\b(?:\d\w+|[\w\+\-]{1,3}\b)")

val rxAuthorTitle = regex(@"^\s*(.*?(?:\n?\[\]\{\.newblock\}\s*))(.*?)(?:\n?\[\]\{\.newblock\})")
