module backports

// backporting null from newer Koka versions:

// Abstract type used for passing `null` values to external functions
public type null<a>

// Transform a `:maybe` type to a `:null` type (using `null` for `Nothing`).
public external null(x : maybe<a>) : null<a> {
  cs inline "(#1.tag_ == __std_core._maybe_Tag.Nothing ? default(##1) : #1.@value)"
  js inline "(#1==null ? null : #1.unJust)"
}

// Transform a `:null` type to a `:maybe` type. Note that it is not
// always the case that `id(x) == maybe(null(x))` (e.g. when `x = Just(Nothing)`).
public external maybe( n : null<a> ) : maybe<a> {
  cs inline "(EqualityComparer<##1>.Default.Equals(#1,default(##1)) ? __std_core._maybe<##1>.Nothing_ : new __std_core._maybe<##1>(#1))"
  js inline "(#1==null ? $std_core.Nothing : $std_core.Just(#1))"
}

function unjust( m : maybe<a> ) : exn a {
  match(m) {
    Just(x) -> x
  }
}

function (||)( m1 : maybe<a>, m2: maybe<a> ) : maybe<a> {
  match(m1) {
    Nothing -> m2
    _       -> m1
  }
}
