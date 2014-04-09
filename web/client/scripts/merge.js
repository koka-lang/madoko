define( [], function() {

var Side = { A:"a", B:"b", O:"o", None:"none" };
var Change = { Add: "add", Delete: "del", Change: "chg" };


function convertDiff(side,d) {
  var diff = { 
    side: side, 
    ostart : d.originalStartLineNumber,
    oend   : d.originalEndLineNumber,
    mstart : d.modifiedStartLineNumber,
    mend   : d.modifiedEndLineNumber,
  };
  if (diff.oend < diff.ostart) {
    diff.ostart++;  // we consider insertion after the line
    diff.oend = diff.ostart-1;
  }
  if (diff.mend < diff.mstart) {
    //diff.mstart++;
    diff.mend = diff.mstart-1;
  }
  return diff;
}

function narrowDiff(target, d) {
  target.mstart = Math.min( d.mstart, target.mstart );
  target.mend   = Math.max( d.mend, target.mend );
  target.ostart = Math.min( d.ostart, target.ostart );
  target.oend   = Math.max( d.oend, target.oend );
}

function diffChunks( olen, alen, blen, adiff, bdiff ) 
{  
  // create a sorted list of diffs.
  var diffs = [];
  var j = 0;
  for(var i = 0; i < adiff.length; i++) {
    var d1 = adiff[i];
    while( j < bdiff.length && 
            (bdiff[j].originalStartLineNumber < d1.originalStartLineNumber ||
             (bdiff[j].originalStartLineNumber === d1.originalStartLineNumber && 
                (//d1.originalEndLineNumber === 0 ||
                 bdiff[j].originalEndLineNumber < d1.originalEndLineNumber))))
    {
      diffs.push( convertDiff(Side.B,bdiff[j]) );      
      j++;
    }
    diffs.push(convertDiff(Side.A,d1));
  }
  for( ; j < bdiff.length; j++) {
    diffs.push(convertDiff(Side.B,bdiff[j]));
  }

  var chunks = []; 
  var originalStart = 1;

  function pushOriginal(end) {
    if (end >= originalStart) {
      chunks.push( { side: Side.O, start: originalStart, end: end } );
      originalStart = end+1;
    }
  }

  // visit the ordered difss and create change chunks
  for(i = 0; i < diffs.length; ) {
    var d     = diffs[i];
    var start = d.ostart;
    var end   = d.oend;

    j = i+1;
    while(j < diffs.length) {
      if (diffs[j].ostart > end) break;
      //util.assert(diffs[j].oend >= end); // because of ordering
      end = diffs[j].oend;
      j++;
    }

    // copy common lines 
    pushOriginal(start-1);

    if (i === j+1) {
      // no overlap
      if (d.mend >= d.mstart) { // and there is something added or changed
        chunks.push( { side: d.side, start: d.mstart, end: d.mend } );
      }
    }
    else {
      // overlap
      var ad = { mstart: alen, mend: -1, ostart: olen, oend: -1 };
      var bd = { mstart: blen, mend: -1, ostart: olen, oend: -1 };

      // determine maximal diff for each side
      for(var h = i; h < j; h++) {
        d = diffs[h];
        
        if (d.side===Side.A) {
          narrowDiff(ad,d);          
        }
        else {
          narrowDiff(bd,d);
        }
      }

      // adjust (because each may have started or ended at another point in the original)
      var astart = ad.mstart + (start - ad.ostart);
      var aend   = ad.mend + (end - ad.oend);
      var bstart = bd.mstart + (start - bd.ostart);
      var bend   = bd.mend + (end - bd.oend);

      if (aend < astart && bend >= bstart) {
        // addition at b
        chunks.push( { side: Side.B, start: bstart, end: bend } );
      }
      else if (bend < bstart && aend >= astart) {
        // addition at a
        chunks.push( { side: Side.A, start: astart, end: aend } );
      }
      else if (bend < bstart && aend < astart) {
        /* both deleted */
      }
      else {
        /* possible conflict: resolved in the next phase where we compare content */
        chunks.push( { 
            side: Side.None, 
            astart: astart, aend: aend, 
            ostart: start, oend: end, 
            bstart: bstart, bend : bend 
        });
      }

      originalStart = end+1;
    }

    i = j;
  }

  pushOriginal( olen );
  return chunks;
}

function subarr( xs, start, end ) {
  if (!xs) return [];
  end--;
  start--;
  end   = (end >= xs.length ? xs.length-1 : end);
  start = (start < 0 ? 0 : start);

  var ys = [];
  for(var i = start; i <= end; i++) {
    ys.push(xs[i]);
  }
  return ys;
}

function mergeChunks( markers, olines, alines, blines, chunks ) {
  var merge = [];
  var lines = {};
  lines[Side.A] = alines;
  lines[Side.B] = blines;
  lines[Side.O] = olines;

  chunks.forEach( function(c) {
    if (c.side !== Side.None) {
      var ls = lines[c.side];
      merge.push( subarr(ls, c.start, c.end ).join("\n") );
    }
    else {
      var otxt = subarr( lines[Side.O], c.ostart, c.oend ).join("\n");
      var atxt = subarr( lines[Side.A], c.astart, c.aend ).join("\n");
      var btxt = subarr( lines[Side.B], c.bstart, c.bend ).join("\n");
      if (otxt === btxt) {
        merge.push( atxt ); // just a change in A        
      }
      else if (otxt === atxt) {
        merge.push( btxt ); // just a change in B
      }
      else if (atxt === btxt) {
        merge.push( atxt ); // false conflict
      }
      else {
        if (markers.start) merge.push( markers.start );
        merge.push( atxt );
        if (markers.mid) merge.push( markers.mid );
        merge.push( btxt );
        if (markers.end) merge.push( markers.end );      
      }
    }
  });

  return [].concat.apply([],merge).join("\n");
}

// Perform a three-way merge.
// diff: ( original: string, modified: string, cont: (err, difference: IDiff[] ) -> void ) -> void
//        interface IDiff { originalStartLineNumber, originalEndLineNumber, modifiedStartLineNumber, modifiedEndLineNumber : int }
// markers: optional change markers: { start, mid, end : string }
// original, m1, m2: string
// cont: (err, merged:string) -> void
function merge3( diff, markers, original, m1, m2, cont ) {
  if (!markers) {
    markers = {
      start: "<!-- begin merge -->\n~ Begin Remote",
      mid: "~ End Remote",
      end: "<!-- end merge -->"
    };
  }
  diff( original, m1, function(err1, adiff) {
    if (err1) cont(err1,null);
    diff( original, m2, function(err2, bdiff) {
      if (err2) cont(err2,null);
      try {
        var olines = original.split("\n");
        var olen   = olines.length;
        var alines = m1.split("\n");
        var alen   = alines.length;
        var blines = m2.split("\n");
        var blen   = blines.length;
        var txt = mergeChunks( markers, olines, alines, blines, diffChunks(olen,alen,blen,adiff,bdiff) );
        cont(0, txt)
      }
      catch(exn) {
        cont(exn, "");
      }
    });
  });
}

return {
  merge3: merge3
};

});