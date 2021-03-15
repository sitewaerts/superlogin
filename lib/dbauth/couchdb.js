'use strict';
const BPromise = require('bluebird');
const util = require('../util');

const PouchDB = require('pouchdb');
const securityPlugin = require("pouchdb-security-helper");
PouchDB.plugin(securityPlugin);

/**
 *
 * @param {PouchDB} couchAuthDB
 */
module.exports = function (couchAuthDB)
{

    /**
     *
     * @param {string} username
     * @param {string} key
     * @param {string} password
     * @param {number} expires
     * @param {number} refreshed
     * @param {Array<string>} roles
     * @return {Promise<void>}
     */
    this.storeKey = function (username, key, password, expires, refreshed, roles)
    {
        if (roles instanceof Array)
        {
            // Clone roles to not overwrite original
            roles = roles.slice(0);
        }
        else
        {
            roles = [];
        }
        roles.unshift('user:' + username);
        const newKey = {
            _id: 'org.couchdb.user:' + key,
            type: 'user',
            name: key,
            user_id: username,
            password: password,
            expires: expires,
            refreshed: refreshed,
            roles: roles
        };
        return couchAuthDB.put(newKey)
            .then(function ()
            {
                newKey._id = key;
                return BPromise.resolve();
            });
    };

    /**
     * @param {string} key
     * @param {number | null} [expires]
     * @param {number | null} [refreshed]
     * @param {Array<string> | null} [roles]
     * @return {Promise<void>}
     */
    this.updateKey = function (key, expires, refreshed, roles)
    {
        if(roles)
            roles = roles.filter(function(role){
                return !role.startsWith('user:');
            });

        const id = 'org.couchdb.user:' + key;

        let changed = false;

        return couchAuthDB.get(id)
            .then(function (newKey)
            {
                if(!roles && !expires && !refreshed)
                    return BPromise.resolve();

                if(expires && newKey.expires !== expires)
                {
                    changed = true;
                    newKey.expires = expires;
                }
                if(refreshed && newKey.refreshed !== refreshed)
                {
                    changed = true;
                    newKey.refreshed = refreshed;
                }
                if(roles && !util.arrayEquals(newKey.roles, roles))
                {
                    changed = true;
                    newKey.roles = roles;
                }
                if(changed)
                    return couchAuthDB.put(newKey)
                        .then(function ()
                        {
                            newKey._id = key;
                            return BPromise.resolve();
                        })
                        .catch(function (err)
                        {
                            console.error("cannot update key at couch auth db", newKey, err);
                            return Promise.reject({
                                message: "cannot update key at couch auth db",
                                doc: newKey,
                                cause: err
                            });
                        });
                else
                {
                    newKey._id = key;
                    return BPromise.resolve();
                }
            }, function(error){
                if(error.status === 404)
                    return BPromise.resolve(); // entry for session in authDB already destroyed
                return BPromise.reject({cause: error, message: "cannot access couch auth db entry for session key", key: key});
            });
    };

    /**
     *
     * @param {Array<string> | string} keys
     * @return {Promise<void>}
     */
    this.removeKeys = function (keys)
    {
        keys = util.toArray(keys);
        const keylist = [];
        // Transform the list to contain the CouchDB _user ids
        keys.forEach(function (key)
        {
            keylist.push('org.couchdb.user:' + key);
        });
        const toDelete = [];
        return couchAuthDB.allDocs({keys: keylist})
            .then(function (keyDocs)
            {
                keyDocs.rows.forEach(function (row)
                {
                    if (!row.error && !row.value.deleted)
                    {
                        const deletion = {
                            _id: row.id,
                            _rev: row.value.rev,
                            _deleted: true
                        };
                        toDelete.push(deletion);
                    }
                });
                if (toDelete.length)
                {
                    return couchAuthDB
                        .bulkDocs(toDelete)
                        .then(function(){
                            // void
                        })
                        .catch(function (err)
                        {
                            console.error("cannot delete from couch auth db", toDelete, err);
                            return Promise.reject({
                                message: "cannot delete from at couch auth db",
                                docs: toDelete,
                                cause: err
                            });
                        });
                }
                else
                {
                    return BPromise.resolve();
                }
            });
    };

    this.initSecurity = function (db, adminRoles, memberRoles)
    {
        let changes = false;
        return db.get('_security')
            .then(function (secDoc)
            {
                if (!secDoc.admins)
                {
                    secDoc.admins = {names: [], roles: []};
                }
                if (!secDoc.admins.roles)
                {
                    secDoc.admins.roles = [];
                }
                if (!secDoc.members)
                {
                    secDoc.members = {names: [], roles: []};
                }
                if (!secDoc.members.roles)
                {
                    secDoc.admins.roles = [];
                }
                adminRoles.forEach(function (role)
                {
                    if (secDoc.admins.roles.indexOf(role) === -1)
                    {
                        changes = true;
                        secDoc.admins.roles.push(role);
                    }
                });
                memberRoles.forEach(function (role)
                {
                    if (secDoc.members.roles.indexOf(role) === -1)
                    {
                        changes = true;
                        secDoc.members.roles.push(role);
                    }
                });
                if (changes)
                {
                    return putSecurityCouch(db, secDoc);
                }
                else
                {
                    return BPromise.resolve(false);
                }
            });
    };

    /**
     *
     * @param {string} user_id
     * @param db
     * @param {Array<string> | Record<string, any>} keys
     * @param permissions
     * @param {Array<string> | null} roles
     * @return {Promise<void>}
     */
    this.authorizeKeys = function (user_id, db, keys, permissions, roles)
    {
        const self = this;
        let secDoc;
        // Check if keys is an object and convert it to an array
        if (typeof keys === 'object' && !(keys instanceof Array))
        {
            const keysArr = [];
            Object.keys(keys).forEach(function (theKey)
            {
                keysArr.push(theKey);
            });
            keys = keysArr;
        }
        // Convert keys to an array if it is just a string
        keys = util.toArray(keys);
        return db.get('_security')
            .then(function (doc)
            {
                secDoc = doc;
                if (!secDoc.members)
                {
                    secDoc.members = {names: [], roles: []};
                }
                if (!secDoc.members.names)
                {
                    secDoc.members.names = [];
                }
                let changes = false;
                keys.forEach(function (key)
                {
                    const index = secDoc.members.names.indexOf(key);
                    if (index === -1)
                    {
                        secDoc.members.names.push(key);
                        changes = true;
                    }
                });
                if (changes)
                {
                    return putSecurityCouch(db, secDoc);
                }
                else
                {
                    return BPromise.resolve(false);
                }
            })
            .then(function(){
                return Promise.all(keys.map(function(key){
                    return self.updateKey(key, null, null, roles);
                }));
            });
    };

    this.deauthorizeKeys = function (db, keys)
    {
        let secDoc;
        keys = util.toArray(keys);
        return db.get('_security')
            .then(function (doc)
            {
                secDoc = doc;
                if (!secDoc.members || !secDoc.members.names)
                {
                    return BPromise.resolve(false);
                }
                let changes = false;
                keys.forEach(function (key)
                {
                    const index = secDoc.members.names.indexOf(key);
                    if (index > -1)
                    {
                        secDoc.members.names.splice(index, 1);
                        changes = true;
                    }
                });
                if (changes)
                {
                    return putSecurityCouch(db, secDoc);
                }
                else
                {
                    return BPromise.resolve(false);
                }
            });
    };

    /**
     *
     * @param {PouchDB} db
     * @param doc
     * @return {Promise<void>}
     */
    function putSecurityCouch(db, doc)
    {
        const security = db.security();
        security.fetch().then(() => {
            security.members.set(doc.members);
            security.admins.set(doc.admins);
            return security.save();
        })
        .catch(function (err)
        {
            console.error("cannot putSecurityCouch", db, doc, err);
            return Promise.reject({
                message: "cannot putSecurityCouch",
                db: db,
                doc: doc,
                cause: err
            });
        });
    }

    return this;

};
