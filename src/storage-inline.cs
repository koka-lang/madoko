/*---------------------------------------------------------------------------
  Copyright 2013-2015 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

public static class BitReader
{
  public static int readInt32( object _buffer, int offset, bool bigEndian ) {
    byte[] buffer = (byte[])(_buffer);
    if (buffer.Length <= offset + 3) {
      return 0;
    }
    else if (BitConverter.IsLittleEndian && !bigEndian) {
      return BitConverter.ToInt32( buffer, offset );
    }
    else {
      byte[] buf = { buffer[offset+3], buffer[offset+2], buffer[offset+1], buffer[offset] };
      return BitConverter.ToInt32( buf, 0 );
    }
  }
}