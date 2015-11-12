/*---------------------------------------------------------------------------
  Copyright 2013-2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

// The parsing and evaluation of expressions
module expression

import std/log
import std/dict
import std/regex
import std/string
import common

infixl 5 (<*), (*>), (<*>)
infixl 6 ($>), (<$>)

// --------------------------------------------------------------
// Evaluate expressions
// --------------------------------------------------------------

public type expr  {
  UnOp( op : string, expr : expr)
  BinOp( op: string, left : expr, right : expr )
  If( cond : expr, ethen : expr, eelse : expr )
  Const( c : constant )
  Var( v : string, display : string )
}

public type constant {  
  Int( i :int )
  Bool( b : bool )
  String( s : string )
  Regex( r : regex )
}



public function evaluate( expr : string, eval : expr -> <exn|e> a, default : a ) : e a {
  //trace("evaluate: '" + expr + "'")
  val mbres = unsafeTotal( fun() { parseExpr(expr) } )
  match(mbres) {
    Just(res) | res.snd.trim.isEmpty -> {
      catch( fun() { eval(res.fst) }, fun(exn) { 
        warning(exn.show)
        default
      })
    }
    _ -> {
      warning("invalid expression: '" + expr + "'")
      default
    }
  }
}

public function evalExpr( expr : expr, lookup : (string,string) -> <exn|e> constant ) : <exn|e> constant {
  match(expr) {
    Const(c) -> c
    Var(v,d) -> lookup(v,d)
    UnOp(op,arg) -> {
      if (op=="not" || op=="!") Bool( !(evalExpr(arg, lookup).bool) )
      elif (op=="regexp" || op=="regexpi") Regex( regex(evalExpr(arg,lookup).string, ignoreCase=(op=="regexpi")) )
      else error("invalid operator: " + op)
    }
    BinOp(op,arg1,arg2) -> {
      val x1 = evalExpr(arg1,lookup)
      val x2 = evalExpr(arg2,lookup)
      if (op=="and"  || op=="&&") Bool( x1.bool && x2.bool )
      elif (op=="or" || op=="||") Bool( x1.bool || x2.bool )
      elif (op==":"  || op=="==") Bool( binop(x1,x2,"==",fun(x,y) { x==y },fun(x,y) { x==y },fun(x,y) { x==y }) )
      elif (op=="!=") Bool( binop(x1,x2,"!=",fun(x,y) { x!=y },fun(x,y) { x!=y },fun(x,y) { x!=y }) )
      elif (op==">")  Bool( binop(x1.cint,x2.cint,">", fun(x,y) { x>y }, serr,berr) )
      elif (op==">=") Bool( binop(x1.cint,x2.cint,">=",fun(x,y) { x>=y },serr,berr) )
      elif (op=="<")  Bool( binop(x1.cint,x2.cint,"<", fun(x,y) { x<y }, serr,berr) )
      elif (op=="<=") Bool( binop(x1.cint,x2.cint,"<=",fun(x,y) { x<=y },serr,berr) )
      elif (op=="~=") {
        match(x2) {
          Regex(r) -> Bool( x1.string.contains(r) )
          _        -> error("first argument of '~' must be a regular expression")
        }
      }
      else error("invalid operator: " + op)
    }
    If(cond,ethen,eelse) -> {
      if (evalExpr(cond,lookup).bool)
        then evalExpr(ethen,lookup)
        else evalExpr(eelse,lookup)
    }
  }
}

function serr( s1 : string, s2 : string ) : exn a { error("cannot compare strings") }
function berr( b1 : bool, b2 : bool ) : exn a { error("cannot compare booleans") }

function binop( c1 : constant, c2: constant, op : string, iop : (int,int) -> exn a, sop : (string,string) -> exn a, bop : (bool,bool) -> exn a) : exn a {
  val msg = "comparing values of different types (" + op + ") on (" + c1.show + ") and (" + c2.show ")"
  match(c1) {
    Int(i1) -> match(c2) {
      Int(i2) -> iop(i1,i2)      
      _       -> error(msg)
    }
    String(s1) -> match(c2) {
      String(s2) -> sop(s1,s2)
      _          -> error(msg)
    }
    Bool(b1) -> match(c2) {
      Bool(b2) -> bop(b1,b2)
      _        -> error(msg)
    }
    _ -> error(msg)
  }
}

public function bool( c : constant ) : exn bool {
  match(c) {
    Bool(b)   -> b
    Int(i)    | i==0 || i==1 -> (i==1)
    String(s) -> {
      val t = s.trim.toLower
      if (t=="true" || t=="1") then True
      elif (t=="false" || t=="0") then False
      else error("cannot use string a boolean condition: " + s.show)
    }
    Regex(r)  -> error("cannot use regular expression as a boolean condition: /" + r.source + "/")
  }
}

public function string( c : constant ) : exn string {
  match(c) {
    Bool(b)   -> b.show
    Int(i)    -> i.show
    String(s) -> s
    Regex(r)  -> r.source
  }
}

public function cint( c : constant ) : exn constant {
  match(c) {
    String(s) -> match(s.trim.parseInt) {
      Just(i) -> Int(i)
      _       -> c
    }
    _ -> c
  }
}

public function show( c : constant ) : string {
  match(c) {
    Bool(b)   -> b.show
    Int(i)    -> i.show
    String(s) -> s.show
    Regex(r)  -> "/" + r.source + "/"
  }
}

// --------------------------------------------------------------
// Parse Expressions
// --------------------------------------------------------------

val parseExpr = unsafeTotal(parseIf)

function parseIf() : div parser<expr> {
  ( string(@"@if\b") *> parseBinary() <* string("@then") <*> parseAtom() <*> 
      ( (string(@"@else") *> parseAtom()) || succeed(Const(String(""))) ) )
    .map( fun(res) { If(res.fst.fst, res.fst.snd, res.snd) })
  ||
  parseBinary()
}
function parseBinary() : div parser<expr> {
  parseUnary() <$ 
  ( (string(@"(and\b|or\b|(~=|:|==|!=|>=|<=|>|<|&&|\|\|)(?=[\s\w/""']))") <*> (fun(s) { parseExpr(s) }))
      .map2( fun(op,arg2) { return fun(arg1) { BinOp(op,arg1,arg2) }} )
   || succeed( id )
  )
}

function parseUnary() : div parser<expr> {
  (string(@"(!|not\b|regexp\b)") <*> parseAtom()).map2( fun(f,e) { UnOp(f,e) } ) ||
  parseAtom()
}

function parseAtom() : div parser<expr> {
  parseModes || parseConst || parseVar || parseRegex ||
  (string(@"\(") *> (fun(s) { parseExpr(s) }) <* string(@"\)"))
}

val parseConst : parser<expr> =
   (parseBool || parseCInt || parseString).map(fun(c) { Const(c) })

val parseVar : parser<expr> =
  string(@"[\w\-]+").map( fun(s) { Var(s.normalizeId, s) } ) ||
  satisfy(@"&([\w\-]+);").map( fun(cap) { Var(cap.groups[1].normalizeId, cap.groups[1])} )

val parseCInt : parser<constant> = 
  string(@"\d+").map(fun(s) { Int(parseInt(s).maybe(0,id)) } )

val parseBool : parser<constant> = 
  string(@"true\b").map(fun(s) { Bool(True) } ) 
  ||  string(@"false\b").map(fun(s) { Bool(False) } )

val parseString : parser<constant> = 
  string(@"'(?:[^\\']|\\[.\n])*'|""(?:[^\\""]|\\[.\n])*""").map(fun(s) { String(s.unquote) } )

val parseRegex : parser<expr> = 
  satisfy(@"/((?:[^\\/\n]|\\.)*)/(i)?").map(fun(cap) { UnOp("regexp" + cap.groups[2], Const(String(cap.groups[1]))) })

val parseModes : parser<expr> =
  (parseMode <*> many(parseMode)).map2 fun(x,xs) {
    xs.foldl(x,fun(a,b) { BinOp("and",a,b) } )
  }


val parseMode : parser<expr> =
  satisfy(@"@(no)?([\w\-]*)").map fun(cap) {
    val v = Var(cap.groups[2].normalizeId, cap.groups[2])
    if (cap.groups[1].isEmpty) then v else UnOp("not",v)
  }

// --------------------------------------------------------------
// Parsers
// --------------------------------------------------------------

alias parser<a> = string -> div maybe<(a,string)>

function map( p : parser<a>, f : a -> b ) : parser<b> {
  return fun(s) { 
    match(p(s)) {
      Nothing -> Nothing
      Just(x) -> Just((f(x.fst),x.snd))
    }
  }
}

function map2( p : parser<(a,b)>, f : (a,b) -> c ) : e parser<c> {
  p.map( fun(x) { f(x.fst, x.snd)}) 
}


function (<$)( p1 : parser<a>, p2: parser<a -> b> ) : parser<b> {
  (p1 <*> p2).map2( fun(x,f) { f(x) } )
}

function (*>)( p1 : parser<a>, p2: parser<b> ) : parser<b> {
  (p1 <*> p2).map( fun(x) { x.snd } )
}

function (<*)( p1 : parser<a>, p2: parser<b> ) : parser<a> {
  (p1 <*> p2).map( fun(x) { x.fst } )
}

function ($>)( f : a -> b, p : parser<a> ) : parser<b>  {
  (succeed(f) <$> p)
}

function (<$>)( p1 : parser<a -> b>, p2 : parser<a> ) : parser<b>  {
  (p1 <*> p2).map( fun(x) { (x.fst)(x.snd) })
}

function (<*>)( p1 : parser<a>, p2 : parser<b> ) : parser<(a,b)> {
  return fun(s) {
    match(p1(s)) {
      Nothing -> Nothing
      Just(x) -> match(p2(x.snd)) {
        Nothing -> Nothing
        Just(y) -> Just(((x.fst,y.fst),y.snd))
      }
    }
  }
}

function (||)( p1 : parser<a>, p2 : parser<a> ) : parser<a> {
  return fun(s) {
    match(p1(s)) {
      Nothing -> p2(s)
      res     -> res
    }
  }
}

function many1( p : parser<a>) : parser<list<a>> {
  (p <*> many(p)).map2( fun(x,xs) { Cons(x,xs) } )
}

function many( p : parser<a> ) : parser<list<a>> {
  return fun(s) { unsafeTotal(fun() { manyx(p,s) }) }
}

function manyx( p : parser<a>, s : string ) : div maybe<(list<a>,string)> {
  match(p(s)) {
    Nothing -> Just(([],s))
    Just(resx) -> {
      val (x,restx) = resx
      if (restx.length>=s.length) // prevent infinite recursion
       then Nothing
       else match(manyx(p,restx)) {
              Nothing    -> Nothing
              Just(resy) -> Just((Cons(x,resy.fst),resy.snd))
            }
    }
  }
}

function string( r: string ) : parser<string> {
  satisfy("(" + r + ")").map( fun(cap) { cap.groups[1] })
}

function satisfy( r: string ) : parser<matched> {
  return fun(s) {
    match(s.find(regex(@"^\s*" + r, ignoreCase=True))) {
      Just(cap) -> {
        //trace("satisfy: " + cap.matched)
        Just((cap,s.substr1(cap.next)))
      }
      Nothing -> {
        //trace("satisfy fail: /" + r + "/ on: " + s.substr(0,8)) 
        Nothing
      }
    }
  }
}

function succeed( x : a ) : parser<a> {
  return fun(s) { Just((x,s)) }
}
