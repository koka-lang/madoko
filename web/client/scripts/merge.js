define( ["../scripts/promise"], function(Promise) {

var Side = { A:"a", B:"b", O:"o", None:"none" };

function lineCount(txt) {
  if (!txt) return 0;
  var i = txt.indexOf("\n");
  var n = 0;
  while( i >= 0 ) {
    n++;
    i = txt.indexOf("\n", i+1);
  }
  return n;
}

function convertDiff(side,d) {
  var diff = { 
    side: side, 
    ostart : d.originalStartLineNumber,
    oend   : d.originalEndLineNumber,
    mstart : d.modifiedStartLineNumber,
    mend   : d.modifiedEndLineNumber,
  };
  if (diff.oend < diff.ostart) {
    diff.ostart++;              // we consider insertion before the line (instead of after)
    diff.oend = diff.ostart-1;  // and end should be at most one less, (not a special value like 0)
  }
  else if (diff.ostart <= 0) {  // some diff algorithms return ostart=0, oend=0 for the first line
    diff.ostart = 1;            // again, we consider insertion before the line
  }
  if (diff.mend < diff.mstart) {
    diff.mend = diff.mstart-1;  // if end is less, it should be one less than the start
  }
  else if (diff.mstart <= 0) {
    diff.mstart = 1;            // again, fix if the start value happens to be 0
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
    var d1 = convertDiff(Side.A, adiff[i]);
    while( j < bdiff.length )  
    {
      var d2 = convertDiff(Side.B, bdiff[j]);
      if (d2.ostart > d1.ostart) break;
      if (d2.ostart === d1.ostart && d2.oend >= d1.oend) break;
      diffs.push(d2);      
      j++;
    }
    diffs.push(d1);
  }
  for( ; j < bdiff.length; j++) {
    diffs.push(convertDiff(Side.B,bdiff[j]));
  }

  // build up a sorted list of change 'chunks'
  var chunks = []; 
  var originalStart = 1;

  function chunksPush( c ) {
    chunks.push(c);
  }

  function pushOriginal(end) {
    if (end >= originalStart) {
      chunksPush( { side: Side.O, start: originalStart, end: end } );
      originalStart = end+1;
    }
  }

  // visit the ordered difss and create change chunks
  for(i = 0; i < diffs.length; ) {
    var d     = diffs[i];
    var start = d.ostart;
    var end   = d.oend;

    // add overlapping diff ranges
    j = i+1;
    while(j < diffs.length) {
      if (diffs[j].ostart > end) break; //  && diffs[j].oend > end
      end = Math.max(end,diffs[j].oend);
      j++;
    }

    // copy common lines 
    pushOriginal(start-1);

    if (i+1 === j) {
      // no overlap
      if (d.mend >= d.mstart) {
        // there is something added or changed
        chunksPush( { side: d.side, start: d.mstart, end: d.mend } );      
      }
      else {
        // there is something deleted
        chunksPush( { side: d.side, start: d.mstart, end: d.mend, ostart: d.ostart, oend: d.oend } );      
      }
    }
    else {
      // overlap among diffs
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
      var astart = Math.max(1, ad.mstart + (start - ad.ostart));
      var aend   = ad.mend + (end - ad.oend);
      var bstart = Math.max(1, bd.mstart + (start - bd.ostart));
      var bend   = bd.mend + (end - bd.oend);

      /* possible conflict: resolved in the next phase where we compare content */
      chunksPush( { 
          side: Side.None, 
          astart: astart, aend: aend, 
          start: start, end: end, 
          bstart: bstart, bend : bend 
      });
    }

    originalStart = end+1;
    i = j;
  }

  // push any remaining content
  pushOriginal( olen );
  return chunks;
}

function subtxt( xs, start, end ) {
  if (!xs) return [];
  end--;    // line number to array index
  start--;
  end   = (end >= xs.length ? xs.length-1 : end);
  start = (start < 0 ? 0 : start);
  var ys = xs.slice(start,end+1);  // +1 because slice is up-to but not including 'end'
  return ys.join("\n");
}

function mergeChunks( markers, cursorLine, olines, alines, blines, chunks ) 
{  
  var conflicts  = false;  // are there real conflicts?
  var merge      = [];     // array of text fragments that will be the merged text
  var mergeLines = 0;      // current line count of the merged content
  var newCursorLine = cursorLine; // the cursor line in the merged content.
  var mergeInfos = [];     // info records for display in the ui.

  function mergePush( s, type, content ) {
    var n = 0;
    if (s != null) {
      merge.push(s);
      n = 1 + lineCount(s);
    }
    if (type) {
      var info  = { 
        type: type, 
        startLine: mergeLines+1, 
        endLine: mergeLines + (n > 0 ? n : 1),
        content: content
      };
      mergeInfos.push(info);
    }
    mergeLines += n;
  }

  function adjustCursor( start, end ) {
    if (start <= cursorLine && end >= cursorLine) {
      newCursorLine = mergeLines - (end - cursorLine);  // adjust downward as we call adjust after push
    }
  }

  var lines = {};
  lines[Side.A] = alines;
  lines[Side.B] = blines;
  lines[Side.O] = olines;

  chunks.forEach( function(c) {
    if (c.end < c.start) {
      // something was deleted
      if (c.side === Side.A) {
        mergePush(null, "deleted", subtxt(olines,c.ostart,c.oend));
      }
    }
    else if (c.side !== Side.None) {
      mergePush( subtxt(lines[c.side], c.start, c.end ), (c.side===Side.A ? "insertion" : null) );
      if (c.side === Side.B) adjustCursor( c.start, c.end );
    }
    else {
      var otxt = subtxt( lines[Side.O], c.start, c.end );
      var atxt = subtxt( lines[Side.A], c.astart, c.aend );
      var btxt = subtxt( lines[Side.B], c.bstart, c.bend );
      if (c.aend < c.astart && c.bend < c.bstart) {
        /* both deleted */
      }
      else if (c.aend < c.astart && c.bend >= c.bstart) {
        mergePush( btxt, "deletion" ); // deletion in A, change in B
        adjustCursor( c.bstart, c.bend );      
      }
      else if (c.bend < c.bstart && c.aend >= c.astart) {
        mergePush( atxt, "change" ); // deletion in B, change in A
      }
      else if (otxt === btxt) {
        mergePush( atxt, "change" ); // just a change in A        
      }
      else if (otxt === atxt) {
        mergePush( btxt ); // just a change in B
        adjustCursor( c.bstart, c.bend );      
      }
      else if (atxt === btxt) {
        mergePush( atxt ); // false conflict
        adjustCursor( c.bstart, c.bend );      
      }
      else {
        // real conflict
        conflicts = true;
        if (markers.start) mergePush( markers.start );
        mergePush( atxt, "conflict" );
        if (markers.mid) mergePush( markers.mid );
        mergePush( btxt, "original" );
        adjustCursor( c.bstart, c.bend );      
        if (markers.end) mergePush( markers.end );      
      }
    }
  });

  return { merged: merge.join("\n"), cursorLine: newCursorLine, conflicts: conflicts, merges: mergeInfos };
}

// Perform a three-way merge.
// diff: ( original: string, modified: string, cont: (err, difference: IDiff[] ) -> void ) -> void
//        interface IDiff { originalStartLineNumber, originalEndLineNumber, modifiedStartLineNumber, modifiedEndLineNumber : int }
//   diff algorithm to call. The IDiff should use:
//   - line numbers start at 1
//   - end line numbers can be 0 to signify empty ranges
//   - if an original range is empty, it siginifies the modified content is inserted *after* the original start line
//   - the original start line can be 0 if the end line is 0 too (empty range). 
// markers: { start, mid, end: string } 
//   optional change markers inserted around real conflicts in the merge
// cursorLine: 
//   cursor line in the modified2 content; corresponding line in the final merge gets returned.
// original, m1, m2: string: 
//   original, and modified content.
// cont: (err, merged:string, conflicts:bool, newCursorLine:int) -> void
//   called afterwards. conflicts is true if there were any real merge conflicts. 
function merge3( diff, markers, cursorLine, original, m1, m2 ) {
  if (!markers) {
    markers = {
      start: "<!-- begin merge (remove this line to resolve the conflict) -->\n~ Begin Remote",
      mid: "~ End Remote",
      end: "<!-- end merge -->"
    };
  }
  return diff( original, m1 ).then( function(adiff) {
    return diff( original, m2 ).then( function(bdiff) {
      var olines = original.split("\n");
      var olen   = olines.length;
      var alines = m1.split("\n");
      var alen   = alines.length;
      var blines = m2.split("\n");
      var blen   = blines.length;
      var res = mergeChunks( markers, cursorLine, olines, alines, blines, diffChunks(olen,alen,blen,adiff,bdiff) );
      return { merged: res.merged, conflicts: res.conflicts, cursorLine: res.cursorLine, merges: res.merges };      
    });
  });
}

return {
  merge3: merge3
};

});