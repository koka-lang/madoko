/*---------------------------------------------------------------------------
  Copyright 2013-2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

using System;

public static class BitReader
{
  public static int readInt32( byte[] buffer, int offset, bool bigEndian ) {
    if (buffer.Length <= offset + 3) {
      return 0
    }
    else if (BitConverter.isLittleEndian && !bigEndian) {
      return BitConverter.toInt32( buffer, offset );
    }
    else {
      var buf = { buffer[offset+3], buffer[offset+2], buffer[offset+1], buffer[offset] };
      return BitConverter.toInt32( buf, 0 );
    }
  }
}