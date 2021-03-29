'use strict';

const BPromise = require('bluebird');
const URLSafeBase64 = require('urlsafe-base64');
const uuid = require('uuid');
const crypto = require('crypto');
const pwdGenerator = require('generate-password');

const keylen = 20;
const size = 16;
const iterations = 10;
const encoding = 'hex';
const digest = 'SHA1';

exports.URLSafeUUID = function() {
  return URLSafeBase64.encode(uuid.v4(null, new Buffer(16)));
};

exports.generateOneTimePassword = function(size) {
  return pwdGenerator.generate({
    length: size || 8,
    numbers: true,
    uppercase: true,
    lowercase: false,
    symbols: false,
    excludeSimilarCharacters: true,
  });
};

exports.hashToken = function(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
};

exports.hashPassword = function (password) {
  return new BPromise(function (resolve, reject) {
    crypto.randomBytes(size, function(err, salt) {
      if (err) return reject(err);

      salt = salt.toString('hex');

      crypto.pbkdf2(password, salt, iterations, keylen, digest, function(err, hash){
        if (err) return reject(err);

        return resolve({ salt: salt, derived_key: hash.toString(encoding)});
      });
    });
  });
};

exports.verifyPassword = function (hashObj, password) {
  var salt = hashObj.salt;
  var iterations = hashObj.iterations || 10;

  var derived_key = hashObj.derived_key;
  if(!salt || !derived_key) {
    return BPromise.reject(false);
  }

  return new BPromise(function (resolve, reject) {
    crypto.pbkdf2(password, salt, iterations, keylen, digest, function(err, hash) {
      if (err) {
        return reject(false);
      }

      if (hash.toString(encoding) === derived_key) {
        return resolve(true);
      } else {
        return reject(false);
      }
    });
  });
};

/**
 * @typedef {Object} DBConfig
 * @property {string} host
 * @property {string} protocol
 * @property {string} [user]
 * @property {string} [password]
 */

/**
 *
 * @param {DBConfig} db
 * @return {string}
 */
exports.getDBURL = function(db) {
  if(db.user) {
    return db.protocol + encodeURIComponent(db.user) + ':' + encodeURIComponent(db.password) + '@' + db.host;
  } else {
    return db.protocol + db.host;
  }
};

/**
 *
 * @param {DBConfig} dbConfig
 * @param {string} dbName
 * @return {string}
 */
exports.getFullDBURL = function(dbConfig, dbName) {
  return exports.getDBURL(dbConfig) + '/' + dbName;
};

exports.toArray = function(obj) {
  if(!(obj instanceof Array)) {
    obj = [obj];
  }
  return obj;
};

/**
 *
 * @param {Array<string>} array
 * @return {Array<string>}
 */
exports.trimStringArray = function(array) {
  return exports.arrayRemoveDuplicates(array.filter((value)=>{
    return !!value;
  }))
};

exports.getSessions = function(userDoc) {
  var sessions = [];
  if(userDoc.session) {
    Object.keys(userDoc.session).forEach(function(mySession) {
      sessions.push(mySession);
    });
  }
  return sessions;
};

exports.getExpiredSessions = function(userDoc, now) {
  var sessions = [];
  if(userDoc.session) {
    Object.keys(userDoc.session).forEach(function(mySession) {
      if(userDoc.session[mySession].expires <= now) {
        sessions.push(mySession);
      }
    });
  }
  return sessions;
};

// Takes a req object and returns the bearer token, or undefined if it is not found
exports.getSessionToken = function(req) {
  if (req.headers && req.headers.authorization) {
    var parts = req.headers.authorization.split(' ');
    if (parts.length === 2) {
      var scheme = parts[0];
      var credentials = parts[1];
      if (/^Bearer$/i.test(scheme)) {
        var parse = credentials.split(':');
        if(parse.length < 2) {
          return;
        }
        return parse[0];
      }
    }
  }
};

// Generates views for each registered provider in the user design doc
exports.addProvidersToDesignDoc = function(config, ddoc) {
  var providers = config.getItem('providers');
  if(!providers) {
    return ddoc;
  }
  var ddocTemplate =
    "function(doc) {\n" +
    "  if(doc['%PROVIDER%'] && doc['%PROVIDER%'].profile) {\n" +
    "    emit(doc['%PROVIDER%'].profile.id, null);\n" +
    "  }\n" +
    "}";
  Object.keys(providers).forEach(function(provider) {
    ddoc.auth.views[provider] = {map:ddocTemplate.replace(new RegExp('%PROVIDER%', 'g'), provider)};
  });
  return ddoc;
};

// Capitalizes the first letter of a string
exports.capitalizeFirstLetter = function(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

/**
 * Access nested JavaScript objects with string key
 * http://stackoverflow.com/questions/6491463/accessing-nested-javascript-objects-with-string-key
 *
 * @param {object} obj The base object you want to get a reference to
 * @param {string} str The string addressing the part of the object you want
 * @return {object|undefined} a reference to the requested key or undefined if not found
 */

exports.getObjectRef = function(obj, str) {
  str = str.replace(/\[(\w+)\]/g, '.$1'); // convert indexes to properties
  str = str.replace(/^\./, '');           // strip a leading dot
  var pList = str.split('.');
  while (pList.length) {
    var n = pList.shift();
    if (n in obj) {
      obj = obj[n];
    } else {
      return;
    }
  }
  return obj;
};

/**
 * Dynamically set property of nested object
 * http://stackoverflow.com/questions/18936915/dynamically-set-property-of-nested-object
 *
 * @param {object} obj The base object you want to set the property in
 * @param {string} str The string addressing the part of the object you want
 * @param {*} val The value you want to set the property to
 * @return {*} the value the reference was set to
 */

exports.setObjectRef = function(obj, str, val) {
  str = str.replace(/\[(\w+)\]/g, '.$1'); // convert indexes to properties
  str = str.replace(/^\./, '');           // strip a leading dot
  var pList = str.split('.');
  var len = pList.length;
  for(var i = 0; i < len-1; i++) {
    var elem = pList[i];
    if( !obj[elem] ) {
      obj[elem] = {};
    }
    obj = obj[elem];
  }
  obj[pList[len-1]] = val;
  return val;
};

/**
 * Dynamically delete property of nested object
 *
 * @param {object} obj The base object you want to set the property in
 * @param {string} str The string addressing the part of the object you want
 * @return {boolean} true if successful
 */

exports.delObjectRef = function(obj, str) {
  str = str.replace(/\[(\w+)\]/g, '.$1'); // convert indexes to properties
  str = str.replace(/^\./, '');           // strip a leading dot
  var pList = str.split('.');
  var len = pList.length;
  for(var i = 0; i < len-1; i++) {
    var elem = pList[i];
    if( !obj[elem] ) {
      return false;
    }
    obj = obj[elem];
  }
  delete obj[pList[len-1]];
  return true;
};

/**
 * Concatenates two arrays and removes duplicate elements
 *
 * @param {array} a First array
 * @param {array} b Second array
 * @return {array} resulting array
 */

exports.arrayUnion = function (a, b) {
  return exports.arrayRemoveDuplicates(a.concat(b));
};

/**
 * removes duplicate elements
 *
 * @param {array} a First array
 * @return {array} resulting array
 */

exports.arrayRemoveDuplicates = function (result) {
  for(var i=0; i<result.length; ++i) {
    for(var j=i+1; j<result.length; ++j) {
      if(result[i] === result[j])
        result.splice(j--, 1);
    }
  }
  return result;
};

/**
 *
 * @param {array} a
 * @param {array} b
 * @return {boolean}
 */
exports.arrayEquals = function (a, b) {
  if(!a && !b)
    return true;
  if(!a || !b)
    return false;
  if(a.length !== b.length)
    return false;
  for(var i=0; i<a.length; ++i) {
    if(a[i] !== b[i])
      return false;
  }
  return true;
};
