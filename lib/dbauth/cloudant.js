'use strict';
const url = require('url');
const BPromise = require('bluebird');
const request = require('superagent');
const util = require('./../util');

function CloudantAdapter(){

    const adapter = this;
// This is not needed with Cloudant
    adapter.storeKey = function() {
        return Promise.resolve();
    };

// This is not needed with Cloudant
    adapter.updateKey = function() {
        return Promise.resolve();
    };

// This is not needed with Cloudant
    adapter.removeKeys = function() {
        return Promise.resolve();
    };

// This is not needed with Cloudant
    adapter.initSecurity = function() {
        return Promise.resolve();
    };

    adapter.authorizeKeys = function(user_id, db, keys, permissions, roles) {
        var keysObj = {};
        if(!permissions) {
            permissions = ['_reader', '_replicator'];
        }
        permissions = util.trimStringArray(permissions.concat(roles || []));
        permissions.unshift('user:' + user_id);
        // If keys is a single value convert it to an Array
        keys = util.toArray(keys);
        // Check if keys is an array and convert it to an object
        if(keys instanceof Array) {
            keys.forEach(function(key) {
                keysObj[key] = permissions;
            });
        } else {
            keysObj = keys;
        }
        // Pull the current _security doc
        return getSecurityCloudant(db)
            .then(function(secDoc) {
                if(!secDoc._id) {
                    secDoc._id = '_security';
                }
                if(!secDoc.cloudant) {
                    secDoc.cloudant = {};
                }
                Object.keys(keysObj).forEach(function(key) {
                    secDoc.cloudant[key] = keysObj[key];
                });
                return putSecurityCloudant(db, secDoc);
            });
    };

    adapter.deauthorizeKeys = function(db, keys) {
        // cast keys to an Array
        keys = util.toArray(keys);
        return getSecurityCloudant(db)
            .then(function(secDoc) {
                let changes = false;
                if(!secDoc.cloudant) {
                    return Promise.resolve(false);
                }
                keys.forEach(function(key) {
                    if(secDoc.cloudant[key]) {
                        changes = true;
                        delete secDoc.cloudant[key];
                    }
                });
                if(changes) {
                    return putSecurityCloudant(db, secDoc);
                } else {
                    return Promise.resolve(false);
                }
            });
    };

    adapter.getAPIKey = function(db) {
        const parsedUrl = url.parse(db.getUrl());
        parsedUrl.pathname = '/_api/v2/api_keys';
        const finalUrl = url.format(parsedUrl);
        return BPromise.fromNode(function(callback) {
            request.post(finalUrl)
                .set(db.getHeaders())
                .end(callback);
        })
            .then(function(res) {
                const result = JSON.parse(res.text);
                if(result.key && result.password && result.ok === true) {
                    return Promise.resolve(result);
                } else {
                    return Promise.reject(result);
                }
            });
    };

    const getSecurityCloudant = adapter.getSecurityCloudant = function (db) {
        const finalUrl = getSecurityUrl(db);
        return BPromise.fromNode(function(callback) {
            request.get(finalUrl)
                .set(db.getHeaders())
                .end(callback);
        })
            .then(function(res) {
                return Promise.resolve(JSON.parse(res.text));
            });
    };

    const putSecurityCloudant = adapter.putSecurityCloudant = function (db, doc) {
        const finalUrl = getSecurityUrl(db);
        return BPromise.fromNode(function(callback) {
            request.put(finalUrl)
                .set(db.getHeaders())
                .send(doc)
                .end(callback);
        })
            .then(function(res) {
                return Promise.resolve(JSON.parse(res.text));
            });
    };

    function getSecurityUrl(db) {
        const parsedUrl = url.parse(db.getUrl());
        parsedUrl.pathname = parsedUrl.pathname + '_security';
        return url.format(parsedUrl);
    }

}

module.exports = CloudantAdapter;
