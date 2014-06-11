/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// Align code blocks
module codeAlign

import std/log
import std/regex
import std/dict
import common
import attributes

struct codeTable(
  columns: int,
  rows: list<crow>
)

alias crow = list<ccell>;

struct ccell(
  span: int,
  center: bool,
  content: string 
)

public function show( ct : codeTable ) : string {
  "\\begin{tabular}{" + string(ct.columns,'l') + "}\n" +
   ct.rows.map( fun(row) { row.map(show).join(" & ") }).join("\\\\\n") +
     "\n\\end{tabular}"
}

function show( ccell : ccell ) : string {
  val align = if (ccell.center) then "c|" else "l|"
  "\\mc{" + ccell.span.show + "}{" + align + "}{" + ccell.content.replaceAll(" ","~") + "}"
}


public function codeAlign( txt : string, sep : int = 2 ) : codeTable
{
  val rxSep = regex( @" {" + sep.show + ",}" )
  val ls    = txt.lines.list
  val colss = ls.map fun(line){ findAlignColumns(line,rxSep) }
  val acols = colss.merge 
  val rows  = zipWith(ls,colss) fun(line,cols){ makeRow(acols,line,cols) }
  CodeTable( acols.length + 1, rows )
}


public function findAlignColumns( line : string, rxSep : regex) : list<int>
{
  line.findAll(rxSep).list.map fun(cap) {
    cap.index + cap.matched.length
  }
}

function merge( alignss : list<list<int>> ) : list<int>
{
  function insert(xs : list<int>, y : int) : list<int> {
    match(xs) {
      Nil -> [y]
      Cons(x,xx) -> {
        if (x < y) then Cons(x,insert(xx,y))
        elif (x == y) then xs
        else Cons(y,xs)
      }
    }
  }
  alignss.concat().foldl([],insert)
}

function makeRow( acols : list<int>, line : string, lineCols : list<int> ) : list<ccell>
{
  val parts = splitColumns( line, 0, lineCols )
  alignParts( acols, parts )
}

function alignParts( acols : list<int>, parts : list<(int,string)> ) : list<ccell> {
  match( parts ) {
    Nil -> Nil
    Cons((_,text),rest) -> {
      val nextcol = match(rest) {
                      Nil -> 999
                      Cons((c,_),_) -> c
                    }
      val (span,afterCols) = acols.getSpan(nextcol)
      Cons( Ccell(span,False,text), alignParts(afterCols, rest))
    }
  }
}

function getSpan( acols : list<int>, col : int, span : int = 1 ) : (int,list<int>) {
  match(acols) {
    Nil -> (span,Nil)
    Cons(acol,rest) -> {
      if (acol >= col) then (span,rest) else getSpan( rest, col, span+1 )
    }
  }
}

function splitColumns( line : string, col : int, lineCols : list<int> ) : list<(int,string)> {
  match(lineCols) {
    Nil -> [(col,line.substr(col))]
    Cons(next,rest) -> {
      Cons( (col,line.substr(col, next - col)), splitColumns( line, next, rest ) )
    }
  }
}