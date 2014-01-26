module.exports = function(hljs) {
  var js  = hljs.getLanguage("javascript");
  var xjs = Object.create(js);
  var kws = Object.create(xjs.keywords);
  kws.special = "alert";
  xjs.keywords = kws;
  return xjs;
}
