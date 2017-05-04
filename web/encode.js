var crypto = require("crypto");

function encrypt(secret,value) {
  var cipher = crypto.createCipher('aes256', secret);
  var encrypted = cipher.update(value, 'utf8', 'base64') + cipher.final('base64');
  return encrypted;
}

function decrypt(secret,value) {
  var decipher = crypto.createDecipher('aes256', secret);
  var decrypted = decipher.update(value, 'base64', 'utf8') + decipher.final('utf8');
  return decrypted;
}

var secret = process.argv[2];
var value = process.argv[3];

var encrypted = encrypt(secret,value);
console.log("encrypting: '" + value + "'\n   encrypt: '" + encrypted + "'\n   decrypt: '" + decrypt(secret,encrypted) + "'");