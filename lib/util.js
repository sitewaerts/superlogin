'use strict';

const URLSafeBase64 = require('urlsafe-base64');
const uuid = require('uuid').v4;
const crypto = require('crypto');
const pwdGenerator = require('generate-password');
const PouchDB = require("pouchdb");

const keylen = 20;
const size = 16;
const iterations = 10;
const encoding = 'hex';
const digest = 'SHA1';

const logPouch = true;

const util = {};

util.URLSafeUUID = function ()
{
    return URLSafeBase64.encode(uuid(null, new Buffer(16)));
};

util.generateOneTimePassword = function (size)
{
    return pwdGenerator({
        length: size || 8,
        numbers: true,
        uppercase: true,
        lowercase: false,
        symbols: false,
        excludeSimilarCharacters: true,
    });
};

util.hashToken = function (token)
{
    return crypto.createHash('sha256').update(token).digest('hex');
};

util.hashPassword = function (password)
{
    return new Promise(function (resolve, reject)
    {
        crypto.randomBytes(size, function (err, salt)
        {
            if (err) return reject(err);

            salt = salt.toString('hex');

            crypto.pbkdf2(password, salt, iterations, keylen, digest, function (err, hash)
            {
                if (err) return reject(err);

                return resolve({salt: salt, derived_key: hash.toString(encoding)});
            });
        });
    });
};

util.verifyPassword = function (hashObj, password)
{
    const salt = hashObj.salt;
    const iterations = hashObj.iterations || 10;

    const derived_key = hashObj.derived_key;
    if (!salt || !derived_key)
    {
        return Promise.reject(false);
    }

    return new Promise(function (resolve, reject)
    {
        crypto.pbkdf2(password, salt, iterations, keylen, digest, function (err, hash)
        {
            if (err)
            {
                return reject(false);
            }

            if (hash.toString(encoding) === derived_key)
            {
                return resolve(true);
            }
            else
            {
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
util.getDBURL = function (db)
{
    if (db.user)
    {
        return db.protocol + encodeURIComponent(db.user) + ':' + encodeURIComponent(db.password) + '@' + db.host;
    }
    else
    {
        return db.protocol + db.host;
    }
};

/**
 *
 * @param {DBConfig} dbConfig
 * @param {string} dbName
 * @return {string}
 */
util.getFullDBURL = function (dbConfig, dbName)
{
    return util.getDBURL(dbConfig) + '/' + dbName;
};

util.toArray = function (obj)
{
    if (!(obj instanceof Array))
    {
        obj = [obj];
    }
    return obj;
};

/**
 *
 * @param {Array<string>} array
 * @return {Array<string>}
 */
util.trimStringArray = function (array)
{
    return util.arrayRemoveDuplicates(array.filter((value) =>
    {
        return !!value;
    }))
};

util.getSessions = function (userDoc)
{
    const sessions = [];
    if (userDoc.session)
    {
        Object.keys(userDoc.session).forEach(function (mySession)
        {
            sessions.push(mySession);
        });
    }
    return sessions;
};

util.getExpiredSessions = function (userDoc, now)
{
    const sessions = [];
    if (userDoc.session)
    {
        Object.keys(userDoc.session).forEach(function (mySession)
        {
            if (userDoc.session[mySession].expires <= now)
            {
                sessions.push(mySession);
            }
        });
    }
    return sessions;
};

// Takes a req object and returns the bearer token, or undefined if it is not found
util.getSessionToken = function (req)
{
    if (req.headers && req.headers.authorization)
    {
        const parts = req.headers.authorization.split(' ');
        if (parts.length === 2)
        {
            const scheme = parts[0];
            const credentials = parts[1];
            if (/^Bearer$/i.test(scheme))
            {
                const parse = credentials.split(':');
                if (parse.length < 2)
                {
                    return;
                }
                return parse[0];
            }
        }
    }
};

// Generates views for each registered provider in the user design doc
util.addProvidersToDesignDoc = function (config, ddoc)
{
    const providers = config.getItem('providers');
    if (!providers)
    {
        return ddoc;
    }
    const ddocTemplate =
        "function(doc) {\n" +
        "  if(doc['%PROVIDER%'] && doc['%PROVIDER%'].profile) {\n" +
        "    emit(doc['%PROVIDER%'].profile.id, null);\n" +
        "  }\n" +
        "}";
    Object.keys(providers).forEach(function (provider)
    {
        ddoc.auth.views[provider] = {map: ddocTemplate.replace(new RegExp('%PROVIDER%', 'g'), provider)};
    });
    return ddoc;
};

// Capitalizes the first letter of a string
util.capitalizeFirstLetter = function (string)
{
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

util.getObjectRef = function (obj, str)
{
    str = str.replace(/\[(\w+)]/g, '.$1'); // convert indexes to properties
    str = str.replace(/^\./, '');           // strip a leading dot
    const pList = str.split('.');
    while (pList.length)
    {
        const n = pList.shift();
        if (n in obj)
        {
            obj = obj[n];
        }
        else
        {
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

util.setObjectRef = function (obj, str, val)
{
    str = str.replace(/\[(\w+)]/g, '.$1'); // convert indexes to properties
    str = str.replace(/^\./, '');           // strip a leading dot
    const pList = str.split('.');
    const len = pList.length;
    for (let i = 0; i < len - 1; i++)
    {
        const elem = pList[i];
        if (!obj[elem])
        {
            obj[elem] = {};
        }
        obj = obj[elem];
    }
    obj[pList[len - 1]] = val;
    return val;
};

/**
 * Dynamically delete property of nested object
 *
 * @param {object} obj The base object you want to set the property in
 * @param {string} str The string addressing the part of the object you want
 * @return {boolean} true if successful
 */

util.delObjectRef = function (obj, str)
{
    str = str.replace(/\[(\w+)]/g, '.$1'); // convert indexes to properties
    str = str.replace(/^\./, '');           // strip a leading dot
    const pList = str.split('.');
    const len = pList.length;
    for (let i = 0; i < len - 1; i++)
    {
        const elem = pList[i];
        if (!obj[elem])
        {
            return false;
        }
        obj = obj[elem];
    }
    delete obj[pList[len - 1]];
    return true;
};

/**
 * Concatenates two arrays and removes duplicate elements
 *
 * @param {array} a First array
 * @param {array} b Second array
 * @return {array} resulting array
 */

util.arrayUnion = function (a, b)
{
    return util.arrayRemoveDuplicates(a.concat(b));
};

/**
 * removes duplicate elements
 *
 * @param {array} a First array
 * @return {array} resulting array
 */

util.arrayRemoveDuplicates = function (result)
{
    for (let i = 0; i < result.length; ++i)
    {
        for (let j = i + 1; j < result.length; ++j)
        {
            if (result[i] === result[j])
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
util.arrayEquals = function (a, b)
{
    if (!a && !b)
        return true;
    if (!a || !b)
        return false;
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; ++i)
    {
        if (a[i] !== b[i])
            return false;
    }
    return true;
};

/**
 * @param {string} dbUrl
 * @return {PouchDB} pouchDB
 */
util.createPouchDB = function (dbUrl)
{
    if(logPouch)
        console.log("Superlogin: creating new PouchDB(" + dbUrl + ")");
    return new PouchDB(dbUrl);
}

/**
 *
 * @param {PouchDB} pouchDB
 */
util.closePouchDB = function (pouchDB)
{
    try
    {
        if (pouchDB)
        {
            if(logPouch)
                console.log("Superlogin: closing PouchDB(" + pouchDB.name + ")");
            pouchDB.close((e) =>
            {
                if (e)
                    console.error("Superlogin: error while closing PouchDB(" + pouchDB.name + ")", e);
            });
        }
    } catch (e)
    {
        console.error("Superlogin: cannot close PouchDB(" + pouchDB.name + ")", e);
    }
}


module.exports = util;


