module.exports = function(hljs) {
  var js  = hljs.getLanguage("javascript");   // extend js
  var js5 = hljs.inherit(js);				  // copy
  js5.keywords = hljs.inherit(js.keywords);   // copy
  js5.keywords.keyword += " module export";   // add  
  return js5;
}
