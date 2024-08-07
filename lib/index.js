'use strict';
const events = require('events');
const express = require('express');
const seed = require('pouchdb-seed-design');

const Configure = require('./configure');
const User = require('./user');
const Oauth = require('./oauth');
const loadRoutes = require('./routes');
const localConfig = (require('./local'));
const Middleware = require('./middleware');
const Mailer = require('./mailer');
const util = require('./util');
const extend = require('extend');
const _passport = require('passport');

const PouchDB = require("pouchdb")

const defaultConfig = require('../config/default.config');


/**
 * @param configData
 * @param passport
 * @param {PouchDB | null} userDB (sl-users)
 * @param {PouchDB | null} couchAuthDB (_users)
 */

module.exports = function (configData, passport, userDB, couchAuthDB)
{

    const config = new Configure(configData, defaultConfig);
    /**
     *
     * @type {express.Router}
     */
    const router = /** @type {express.Router}**/ express.Router();

    const emitter = new events.EventEmitter();

    if (!passport || typeof passport !== 'object')
    {
        passport = _passport;
    }
    const middleware = new Middleware(passport);

    // Some extra default settings if no config object is specified
    if (!configData)
    {
        config.setItem('testMode.noEmail', true);
        config.setItem('testMode.debugEmail', true);
    }

    // Create the DBs if they weren't passed in
    if (!userDB && config.getItem('dbServer.userDB'))
    {
        userDB = util.createPouchDB(util.getFullDBURL(config.getItem('dbServer'), config.getItem('dbServer.userDB')));
    }
    if (!couchAuthDB && config.getItem('dbServer.couchAuthDB') && !config.getItem('dbServer.cloudant'))
    {
        couchAuthDB = util.createPouchDB(util.getFullDBURL(config.getItem('dbServer'), config.getItem('dbServer.couchAuthDB')));
    }
    if (!userDB || typeof userDB !== 'object')
    {
        throw new Error('userDB must be passed in as the third argument or specified in the config file under dbServer.userDB');
    }

    const mailer = new Mailer(config);
    const user = new User(config, userDB, couchAuthDB, mailer, emitter);
    const oauth = new Oauth(router, passport, user, config);

    // Seed design docs for the superlogin user database
    // clone instance to enable multiple independent instances of superLogin
    let userDesign = extend(true, {}, require('../designDocs/user-design'));
    userDesign = util.addProvidersToDesignDoc(config, userDesign);

    const _initPromise = (async () =>{
        await seed(userDB, userDesign);
        await user.init();
    })();

    // Configure Passport local login and api keys
    localConfig(config, passport, user);

    const superlogin = {
        initialized: function ()
        {
            return _initPromise;
        },
        config: config,
        router: router,
        mailer: mailer,
        passport: passport,
        userDB: userDB,
        couchAuthDB: couchAuthDB,
        registerProvider: oauth.registerProvider,
        registerOAuth2: oauth.registerOAuth2,
        registerTokenProvider: oauth.registerTokenProvider,
        validateUsername: user.validateUsername,
        validateEmail: user.validateEmail,
        validateEmailUsername: user.validateEmailUsername,
        getUser: user.get,
        createUser: user.create,
        onCreate: user.onCreate,
        onLink: user.onLink,
        socialAuth: user.socialAuth,
        hashPassword: util.hashPassword,
        verifyPassword: util.verifyPassword,
        createSession: user.createSession,
        changePassword: user.changePassword,
        changeEmail: user.changeEmail,
        resetPassword: user.resetPassword,
        forgotPassword: user.forgotPassword,
        verifyEmail: user.verifyEmail,
        addUserDB: user.addUserDB,
        removeUserDB: user.removeUserDB,
        logoutUser: user.logoutUser,
        logoutSession: user.logoutSession,
        logoutOthers: user.logoutOthers,
        removeUser: user.remove,
        confirmSession: user.confirmSession,
        removeExpiredKeys: user.removeExpiredKeys,
        sendEmail: mailer.sendEmail,
        quitRedis: user.quitRedis,
        // authentication middleware
        requireAuth: middleware.requireAuth,
        requireRole: middleware.requireRole,
        requireAnyRole: middleware.requireAnyRole,
        requireAllRoles: middleware.requireAllRoles
    };

    // Load the routes
    loadRoutes(config, router, passport, superlogin, user);

    // Inherit emitter
    for (let key in emitter)
    {
        superlogin[key] = emitter[key];
    }
    return superlogin;

};
