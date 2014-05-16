/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

if (window && window.location && window.location.hash) {
  var cap = /[#&]access_token=([^=&#;]+)/.exec(window.location.hash);
  if (cap) {
    var token = cap[1];
    var year = 60*60*24*365;
    document.cookie = "auth_dropbox=" + token + ";path=/;secure;max-age=" + year.toString();
  }
}
window.close();
