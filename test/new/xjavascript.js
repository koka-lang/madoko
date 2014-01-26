module.exports = function(hljs) {
  var js  = hljs.getLanguage("javascript");
  var xjs = Object.create(js);
  xjs.keywords = "alert " + xjs.keywords;
  return xjs;
}
