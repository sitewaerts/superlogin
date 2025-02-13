'use strict';

const url = require('url');
const Model = require('sofa-model');
const extend = require('extend');
const Session = require('./session');
const util = require('./util');
const DBAuth = require('./dbauth');
const PouchDB = require("pouchdb")

// regexp from https://github.com/angular/angular.js/blob/master/src/ng/directive/input.js#L4
const EMAIL_REGEXP = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}$/;
// see AuthenticationService.js
// TODO: configurable
const USER_REGEXP = /^[a-z0-9_.-]{3,16}$/;

/**
 *
 * @param {Object} sessionData
 * @return {boolean}
 */
function isSessionExpired(sessionData){
  if(!sessionData)
    return false;
  if(sessionData.ends > 0)
    return Math.min(sessionData.ends, sessionData.expires) < Date.now();
  return sessionData.expires < Date.now();
}

/**
 * @param config
 * @param {PouchDB} userDB (sl-users)
 * @param {PouchDB} couchAuthDB (_users)
 * @param mailer
 * @param emitter
 */
module.exports = function User(config, userDB, couchAuthDB, mailer, emitter) {

  const self = this;
  const dbAuth = new DBAuth(config, userDB, couchAuthDB);
  const session = new Session(config);
  const onCreateActions = [];
  const onLinkActions = [];

  this.init = function(){
    return dbAuth.init();
  }

  // Token valid for 24 hours by default
  // Forget password token life
  const tokenLife = config.getItem('security.tokenLife') || 86400;
  // Session token life, may be reset via refresh
  const sessionLife = config.getItem('security.sessionLife') || 86400;
  // hard limit for session validity. cannot be reset by refresh
  const sessionMaxLife = config.getItem('security.sessionMaxLife') || 0;

  const emailUsername = config.getItem('local.emailUsername');

  this.getAllRolesFromUserDoc = function(userDoc){
    const roles = util.trimStringArray([].concat(userDoc.roles));
    function _addRole(role){
      if(!role || role.length === 0)
        return;
      if(role.startsWith("_"))
      {
          console.warn("cannot process role with leading '_'. prepending UNDERSCORE", role);
          role = "UNDERSCORE" + role;
      }
      if(roles.indexOf(role)<0)
        roles.push(role);
    }
    if(userDoc.providers)
    {
      userDoc.providers.forEach(function (providerName)
      {
        const providerData = userDoc[providerName];
        if (providerData)
        {
          _addRole('provider.' + providerName);
          if (providerData.profile && providerData.profile.roles)
            providerData.profile.roles.forEach(_addRole)
        }
      });
    }
    if(userDoc.localRoles)
      userDoc.localRoles.forEach(_addRole);
    return roles;
  }

  this.validateUsername = function (username) {
    if (!username) {
      return Promise.resolve();
    }
    if (!username.match(USER_REGEXP) && !username.match(EMAIL_REGEXP)) {
      return Promise.resolve('invalid');
    }
    return userDB.query('auth/username', {key: username})
      .then(function (result) {
        if (result.rows.length === 0) {
          // Pass!
          return Promise.resolve();
        }
        else {
          return Promise.resolve('already in use');
        }
      }, function (err) {
        throw new Error(err);
      });
  };

  this.validateEmail = function (email) {
    if (!email) {
      return Promise.resolve();
    }
    email = email.toLowerCase();
    if (!email.match(EMAIL_REGEXP)) {
      return Promise.resolve('invalid');
    }
    return userDB.query('auth/email', {key: email})
      .then(function (result) {
        if (result.rows.length === 0) {
          // Pass!
          return Promise.resolve();
        }
        else {
          return Promise.resolve('already in use');
        }
      }, function (err) {
        throw new Error(err);
      });
  };

  this.validateEmailUsername = function (email) {
    if (!email) {
      return Promise.resolve();
    }
    email = email.toLowerCase();
    if (!email.match(EMAIL_REGEXP)) {
      return Promise.resolve('invalid');
    }
    return userDB.query('auth/emailUsername', {key: email})
      .then(function (result) {
        if (result.rows.length === 0) {
          return Promise.resolve();
        }
        else {
          return Promise.resolve('already in use');
        }
      }, function (err) {
        throw new Error(err);
      });
  };

  // Validation function for ensuring that two fields match
  this.matches = function(value, option, key, attributes) {
    if (attributes && attributes[option] !== value) {
      return "does not match " + option;
    }
  };

  let passwordConstraints = {
    presence: true,
    length: {
      minimum: 6,
      message: "must be at least 6 characters"
    },
    matches: 'confirmPassword'
  };

  passwordConstraints = extend(true, {}, passwordConstraints, config.getItem('local.passwordConstraints'));

  const userModel = {
    async: true,
    whitelist: [
      'name',
      'username',
      'email',
      'password',
      'confirmPassword'
    ],
    customValidators: {
      validateEmail: self.validateEmail,
      validateUsername: self.validateUsername,
      validateEmailUsername: self.validateEmailUsername,
      matches: self.matches
    },
    sanitize: {
      name: ['trim'],
      username: ['trim', 'toLowerCase'],
      email: ['trim', 'toLowerCase']
    },
    validate: {
      email: {
        presence: true,
        validateEmail: true
      },
      username: {
        presence: true,
        validateUsername: true
      },
      password: passwordConstraints,
      confirmPassword: {
        presence: true
      }
    },
    static: {
      type: 'user',
      roles : util.trimStringArray([].concat(config.getItem('security.defaultRoles'), config.getItem("local.defaultRoles"))),
      providers: ['local']
    },
    rename: {
      username: '_id'
    }
  };

  if(emailUsername) {
    delete userModel.validate.username;
    delete userModel.validate.email.validateEmail;
    delete userModel.rename.username;
    userModel.validate.email.validateEmailUsername = true;
  }

  const resetPasswordModel = {
    async: true,
    customValidators: {
      matches: self.matches
    },
    validate: {
      token: {
        presence: true
      },
      password: passwordConstraints,
      confirmPassword: {
        presence: true
      }
    }
  };

  const changePasswordModel = {
    async: true,
    customValidators: {
      matches: self.matches
    },
    validate: {
      newPassword: passwordConstraints,
      confirmPassword: {
        presence: true
      }
    }
  };

  this.onCreate = function(fn) {
    if(typeof fn === 'function') {
      onCreateActions.push(fn);
    } else {
      throw new TypeError('onCreate: You must pass in a function');
    }
  };

  this.onLink = function(fn) {
    if(typeof fn === 'function') {
      onLinkActions.push(fn);
    } else {
      throw new TypeError('onLink: You must pass in a function');
    }
  };

  function processTransformations(fnArray, userDoc, provider) {
    var promise;
    fnArray.forEach(function(fn) {
      if(!promise) {
        promise = fn.call(null, userDoc, provider);
      } else {
        if(!promise.then || typeof promise.then !== 'function') {
          throw new Error('onCreate function must return a promise');
        }
        promise.then(function(newUserDoc) {
          return fn.call(null, newUserDoc, provider);
        });
      }
    });
    if(!promise) {
      promise = Promise.resolve(userDoc);
    }
    return promise;
  }

  this.get = function (login) {
    var query;
    if(emailUsername) {
      query = 'emailUsername';
    } else {
      query = EMAIL_REGEXP.test(login) ? 'emailUsername' : 'username';
    }
    return userDB.query('auth/' + query, {key: login, include_docs: true})
      .then(function (results) {
        if (results.rows.length > 0) {
          return Promise.resolve(results.rows[0].doc);
        } else {
          return Promise.resolve(null);
        }
      });
  };

  this.create = function (form, req) {
    req = req || {};
    var finalUserModel = userModel;
    var newUserModel = config.getItem('userModel');
    if(typeof newUserModel === 'object') {
      var whitelist;
      if(newUserModel.whitelist) {
        whitelist = util.arrayUnion(userModel.whitelist, newUserModel.whitelist);
      }
      finalUserModel = extend(true, {}, userModel, config.getItem('userModel'));
      finalUserModel.whitelist = whitelist || finalUserModel.whitelist;
    }
    var UserModel = new Model(finalUserModel);
    var user = new UserModel(form);
    var newUser;
    return user.process()
      .then(function (result) {
        newUser = result;
        newUser.email = newUser.email?.toLowerCase();
        if(emailUsername) {
          newUser._id = newUser.email;
        }
        if(config.getItem('local.sendConfirmEmail')) {
          newUser.unverifiedEmail = {
            email: newUser.email,
            token: util.generateOneTimePassword(config.getItem('local.tokenLength'))
          };
          delete newUser.email;
        }
        return util.hashPassword(newUser.password);
      }, function(err) {
        return Promise.reject({error: 'Validation failed', validationErrors: err, status: 400});
      })
      .then(function (hash) {
        // Store password hash
        newUser.local = {};
        newUser.local.salt = hash.salt;
        newUser.local.derived_key = hash.derived_key;
        delete newUser.password;
        delete newUser.confirmPassword;
        newUser.signUp = {
          provider: 'local',
          timestamp: new Date().toISOString(),
          ip: req.ip
        };
        return addUserDBs(newUser);
      })
      .then(function(newUser) {
        return self.logActivity(newUser._id, 'signup', 'local', req, newUser);
      })
      .then(function(newUser) {
        return processTransformations(onCreateActions, newUser, 'local');
      })
      .then(function(finalNewUser) {
        return userDB.put(finalNewUser);
      })
      .then(function(result) {
        newUser._rev = result.rev;
        if(!config.getItem('local.sendConfirmEmail')) {
          return Promise.resolve();
        }
        return mailer.sendEmail('confirmEmail', newUser.unverifiedEmail.email, {req: req, user: newUser, lang: getLang(form, req)});
      })
      .then(function () {
        emitter.emit('signup', newUser, 'local');
        return Promise.resolve(newUser);
      });
  };

  function getLang(form, req){
    // TODO: get from req headers if not specified in body
    const defaultLang =  'de';
    const locale = form?.locale || form?.lang || req?.body?.locale || req?.body?.lang || req.query?.locale || req.query?.lang || defaultLang;
    return locale.split('_')[0] || defaultLang;
  }

  /**
   * @param {string} provider
   * @param {{access_token?:string, refresh_token?:string}} auth
   * @param {any} profile
   * @param {any} req
   * @return {Promise<any>}
   */
  this.socialAuth = function(provider, auth, profile, req) {
    var configRef = 'providers.' + provider;

    const emailUsername = config.getItem(configRef + ".emailUsername")
    const errorOnDuplicate = config.getItem(configRef + ".errorOnDuplicate")

    var user;
    var newAccount = false;
    var action;
    var baseUsername;
    req = req || {};
    var ip = req.ip;

    if(!profile.id)
      return Promise.reject("missing profile.id in " + JSON.stringify(profile));

    return Promise.resolve()
      .then(function() {
        return userDB.query('auth/' + provider, {key: profile.id.toLowerCase(), include_docs: true});
      })
      .then(function(results) {
        if (results.rows.length > 0) {
          user = results.rows[0].doc;
          return Promise.resolve();
        } else {
          newAccount = true;
          user = {};
          user[provider] = {};
          if(profile.emails) {
            user.email = profile.emails[0].value;
          }
          user.providers = [provider];
          user.type = 'user';
          user.roles = util.trimStringArray([].concat(config.getItem('security.defaultRoles'), config.getItem(configRef + ".defaultRoles")));
          user.signUp = {
            provider: provider,
            timestamp: new Date().toISOString(),
            ip: ip
          };
          var emailFail = function() {
            return Promise.reject({
              error: 'Email already in use',
              message: 'Your email is already in use. Try signing in first and then linking this account.',
              status: 409
            });
          };
          // Now we need to generate a username
          if(emailUsername) {
            if(!user.email){
              if(profile.username && EMAIL_REGEXP.test(profile.username))
                user.email = profile.username;
            }
            if(!user.email) {
              return Promise.reject({
                error: 'No email provided',
                message: 'An email is required for registration, but ' + provider + ' didn\'t supply one.',
                status: 400
              });
            }
            return self.validateEmailUsername(user.email)
              .then(function(err) {
                if(err) {
                  return emailFail();
                }
                return Promise.resolve(user.email.toLowerCase());
              });
          } else {
            if(profile.username) {
              baseUsername = profile.username.toLowerCase();
            } else {
              // If a username isn't specified we'll take it from the email
              if(user.email) {
                var parseEmail = user.email.split('@');
                baseUsername = parseEmail[0].toLowerCase();
              } else if(profile.displayName) {
                baseUsername = profile.displayName.replace(/\s/g, '').toLowerCase();
              } else {
                baseUsername = profile.id.toLowerCase();
              }
            }
            return self.validateEmail(user.email)
              .then(function(err) {
                if(err) {
                  return emailFail();
                }
                return generateUsername(baseUsername, errorOnDuplicate);
              });
          }
        }
      })
      .then(function(finalUsername) {
        if(finalUsername) {
          user._id = finalUsername;
        }
        user[provider].auth = auth;
        user[provider].profile = profile;
        if(!user.name) {
          user.name = profile.displayName;
        }
        delete user[provider].profile._raw;
        if(newAccount) {
          return addUserDBs(user);
        } else {
          return Promise.resolve(user);
        }
      })
      .then(function(userDoc) {
        action = newAccount ? 'signup' : 'login';
        return self.logActivity(userDoc._id, action, provider, req, userDoc);
      })
      .then(function(userDoc) {
        if(newAccount) {
          return processTransformations(onCreateActions, userDoc, provider);
        } else {
          return processTransformations(onLinkActions, userDoc, provider);
        }
      })
      .then(function(finalUser) {
        return userDB.put(finalUser);
      })
      .then(function() {
        if(action === 'signup') {
          emitter.emit('signup', user, provider);
        }
        return Promise.resolve(user);
      })
        .catch((error)=>{
          // log profile for better debugging
          console.error("socialAuth failed. provider="+provider, profile, error);
          return Promise.reject(error);
        });
  };

  /**
   * @param {string} user_id
   * @param {string} provider
   * @param {{access_token?:string, refresh_token?:string}} auth
   * @param {{}} profile
   * @param {any} req
   * @return {Promise<{}>}
   */

  this.linkSocial = function(user_id, provider, auth, profile, req) {
    const emailUsername = config.getItem(configRef + ".emailUsername")

    req = req || {};
    var user;
    // Load user doc
    return Promise.resolve()
      .then(function() {
        return userDB.query('auth/' + provider, {key: profile.id.toLowerCase()});
      })
      .then(function(results) {
        if(results.rows.length === 0) {
          return Promise.resolve();
        } else {
          if(results.rows[0].id !== user_id) {
            return Promise.reject({
              error: 'Conflict',
              message: 'This ' + provider + ' profile is already in use by another account.',
              status: 409
            });
          }
        }
      })
      .then(function() {
        return userDB.get(user_id);
      })
      .then(function(theUser) {
        user = theUser;
        // Check for conflicting provider
        if(user[provider] && (user[provider].profile.id.toLowerCase() !== profile.id.toLowerCase())) {
          return Promise.reject({
            error: 'Conflict',
            message: 'Your account is already linked with another ' + provider + 'profile.',
            status: 409
          });
        }
        // Check email for conflict
        if(!profile.emails) {
          return Promise.resolve({rows: []});
        }
        if(emailUsername) {
          return userDB.query('auth/emailUsername', {key: profile.emails[0].value});
        } else {
          return userDB.query('auth/email', {key: profile.emails[0].value});
        }
      })
      .then(function(results) {
        var passed;
        if(results.rows.length === 0) {
          passed = true;
        } else {
          passed = true;
          results.rows.forEach(function(row) {
            if(row.id !== user_id) {
              passed = false;
            }
          });
        }
        if(!passed) {
          return Promise.reject({
            error: 'Conflict',
            message: 'The email ' + profile.emails[0].value + ' is already in use by another account.',
            status: 409
          });
        } else {
          return Promise.resolve();
        }
      })
      .then(function() {
        // Insert provider info
        user[provider] = {};
        user[provider].auth = auth;
        user[provider].profile = profile;
        if(!user.providers) {
          user.providers = [];
        }
        if(user.providers.indexOf(provider) === -1) {
          user.providers.push(provider);
        }
        if(!user.name) {
          user.name = profile.displayName;
        }
        delete user[provider].profile._raw;
        return self.logActivity(user._id, 'link', provider, req, user);
      })
      .then(function(userDoc) {
        return processTransformations(onLinkActions, userDoc, provider);
      })
      .then(function(finalUser) {
        return userDB.put(finalUser);
      })
      .then(function() {
        return Promise.resolve(user);
      });
  };

  this.unlink = function(user_id, provider) {
    var user;
    return userDB.get(user_id)
      .then(function(theUser) {
        user = theUser;
        if(!provider) {
          return Promise.reject({
            error: 'Unlink failed',
            message: 'You must specify a provider to unlink.',
            status: 400
          });
        }
        // We can only unlink if there are at least two providers, or if they have a password separately set up
        if(!user.derived_key && (!user.providers || !(user.providers instanceof Array) || user.providers.length < 2)) {
          return Promise.reject({
            error: 'Unlink failed',
            message: 'You can\'t unlink your only provider!',
            status: 400
          });
        }
        // We cannot unlink local
        if(provider === 'local') {
          return Promise.reject({
            error: 'Unlink failed',
            message: 'You can\'t unlink local.',
            status: 400
          });
        }
        // Check that the provider exists
        if(!user[provider] || typeof user[provider] !== 'object') {
          return Promise.reject({
            error: 'Unlink failed',
            message: 'Provider: ' + util.capitalizeFirstLetter(provider) + ' not found.',
            status: 404
          });
        }
        delete user[provider];
        // Remove the unlinked provider from the list of providers
        user.providers.splice(user.providers.indexOf(provider), 1);
        return userDB.put(user);
      })
      .then(function() {
        return Promise.resolve(user);
      });
  };

  this.createSession = function(user_id, provider, req) {
    const me = self;
    var user;
    var newToken;
    var newSession;
    var password;
    req = req || {};
    var ip = req.ip;
    return userDB.get(user_id)
      .then((record) => {
        user = record;
        return generateSession(user._id, me.getAllRolesFromUserDoc(user));
      })
      .then(function(token) {
        password = token.password;
        newToken = token;
        newToken.provider = provider;
        return session.storeToken(newToken);
      })
      .then(function() {
        // create couch db user in _users
        return dbAuth.storeKey(user_id, newToken.key, password, newToken.expires, newToken.refreshed, newToken.roles);
      })
      .then(function() {
        // authorize the new session across all dbs
        if(!user.personalDBs) {
          return Promise.resolve();
        }
        return dbAuth.authorizeUserSessions(user_id, user.personalDBs, newToken.key, newToken.roles);
      })
      .then(function() {
        if(!user.session) {
          user.session = {};
        }
         newSession = {
          issued: newToken.issued,
          refreshed: newToken.refreshed,
          expires: newToken.expires,
          ends: newToken.ends,
          provider: provider,
          ip: ip
        };
        user.session[newToken.key] = newSession;
        // Clear any failed login attempts
        if(provider === 'local') {
          if(!user.local) user.local = {};
          user.local.failedLoginAttempts = 0;
          delete user.local.lockedUntil;
        }
        return self.logActivity(user._id, 'login', provider, req, user);
      })
      .then(function(userDoc) {
        // Clean out expired sessions on login
        return self.logoutUserSessions(userDoc, 'expired');
      })
      .then(function(finalUser) {
        user = finalUser;
        return userDB
            .put(finalUser)
            .catch(function (err)
            {
              console.error("cannot store new session for user", finalUser, err);
              return Promise.reject({
                message: "cannot store new  session for user",
                doc: finalUser,
                cause: err
              });
            });
      })
      .then(function() {
        newSession.token = newToken.key;
        newSession.password = password;
        newSession.user_id = user._id;
        newSession.roles = me.getAllRolesFromUserDoc(user);
        // Inject the list of userDBs
        if(typeof user.personalDBs === 'object') {
          var userDBs = {};
          var publicURL;
          if(config.getItem('dbServer.publicURL')) {
            var dbObj = url.parse(config.getItem('dbServer.publicURL'));
            dbObj.auth = newSession.token + ':' + newSession.password;
            publicURL = dbObj.format();
          } else {
            publicURL = config.getItem('dbServer.protocol') + newSession.token + ':' + newSession.password + '@' +
              config.getItem('dbServer.host') + '/';
          }
          Object.keys(user.personalDBs).forEach(function(finalDBName) {
            userDBs[user.personalDBs[finalDBName].name] = publicURL + finalDBName;
          });
          newSession.userDBs = userDBs;
        }
        if(user.profile) {
          newSession.profile = user.profile;
        }
        emitter.emit('login', newSession, provider);
        return Promise.resolve(newSession, provider);
      });
  };

  this.handleFailedLogin = function(user, req) {
    req = req || {};
    var maxFailedLogins = config.getItem('security.maxFailedLogins');
    if(!maxFailedLogins) {
      return Promise.resolve();
    }
    if(!user.local) {
      user.local = {};
    }
    if(!user.local.failedLoginAttempts) {
      user.local.failedLoginAttempts = 0;
    }
    user.local.failedLoginAttempts++;
    if(user.local.failedLoginAttempts > maxFailedLogins) {
      user.local.failedLoginAttempts = 0;
      user.local.lockedUntil = Date.now() + config.getItem('security.lockoutTime') * 1000;
    }
    return self.logActivity(user._id, 'failed login', 'local', req, user)
      .then(function(finalUser) {
        return userDB.put(finalUser);
      })
      .then(function() {
        return Promise.resolve(!!user.local.lockedUntil);
      });
  };

  this.logActivity = function(user_id, action, provider, req, userDoc, saveDoc) {
    var logSize = config.getItem('security.userActivityLogSize');
    if(!logSize) {
      return Promise.resolve(userDoc);
    }
    var promise;
    if(userDoc) {
      promise = Promise.resolve(userDoc);
    } else {
      if(saveDoc !== false) {
        saveDoc = true;
      }
      promise = userDB.get(user_id);
    }
    return promise
      .then(function(theUser) {
        userDoc = theUser;
        if(!userDoc.activity || !(userDoc.activity instanceof Array)) {
          userDoc.activity = [];
        }
        var entry = {
          timestamp: new Date().toISOString(),
          action: action,
          provider: provider,
          ip: req.ip
        };
        userDoc.activity.unshift(entry);
        while(userDoc.activity.length > logSize) {
          userDoc.activity.pop();
        }
        if(saveDoc) {
          return userDB
              .put(userDoc)
              .catch(function (err)
              {
                console.error("cannot log user activity", userDoc, err);
                return Promise.reject({
                  message: "cannot log user activity",
                  doc: userDoc,
                  cause: err
                });
              })
            .then(function() {
              return Promise.resolve(userDoc);
            });
        } else {
          return Promise.resolve(userDoc);
        }
      });
  };

  this.refreshSession = function (key) {
    return this.updateSession(key, true, true);
  };

  this.syncSessionRoles = function (key) {
    // do not cleanup sessions as this was done before (avoid conflicts)
    return this.updateSession(key, false, false);
  };

  // TODO
  // setup change listener
  userDB.changes({since: 'now', live: true, include_docs: true})
      .on('change', function (change)
      {
          if (change.deleted)
          {
              userDB.get(change.id, {revs: true, open_revs: 'all'})
                  .then(function (infos)
                  {
                      console.log('userDB.changes: deleted', {change, infos});
                      const revs = infos[0].ok._revisions;
                      const lastRev = (revs.start - 1) + '-' + revs.ids[1];
                      return userDB.get(change.id, {rev: lastRev})
                          .then(function (user)
                          {
                              function _deleteDBS()
                              {
                                  if (user.personalDBs && typeof user.personalDBs === 'object')
                                  {
                                      return Promise.all(Object.keys(user.personalDBs).map(function (db)
                                      {
                                          var dbConfig = dbAuth.getDBConfig(db);
                                          // TODO: what about "if(db.type === 'private')" ??
                                          if (dbConfig.deleteWithUser)
                                              return dbAuth.removeDB(db);
                                          return Promise.resolve();
                                      }));
                                  }
                                  return Promise.resolve();
                              }

                              return _deleteDBS()
                                  .then(function ()
                                  {
                                      return self.logoutUserSessions(user, 'all');
                                  });
                          });
                  });
          }
          // else
          // {
          //   // to avoid conflicts during login, just wait some seconds before triggering cleanup/sync
          //   var userDoc = change.doc;
          //   setTimeout(function(){
          //     self.cleanupSessions(userDoc)
          //         .then(
          //             function (finalUser)
          //             {
          //               if (userDoc !== finalUser)
          //               {
          //                 // user doc was updated, so we will get triggered later again ...
          //                 return null;
          //               }
          //               else
          //                 return userDoc = finalUser;
          //             },
          //             function (error)
          //             {
          //               console.error('userDB.changes: cannot cleanup sessions (' +  userDoc._id + ')', error, userDoc);
          //             })
          //         .then(function(userDoc){
          //           if(!userDoc)
          //             return;  // user doc was updated, so we will get triggered later again ...
          //
          //           if(userDoc.session)
          //             sequential(Object.keys(userDoc.session).map(function (key)
          //             {
          //               return function()
          //               {
          //                 return self.syncSessionRoles(key)
          //                     .catch(function (error)
          //                     {
          //                       console.error('userDB.changes: cannot sync session roles (' + key + ')', error, userDoc);
          //                     });
          //               }
          //             })).catch(function (error)
          //             {
          //               console.error('userDB.changes: cannot sync session roles', error);
          //             });
          //         });
          //   }, 10000);
          // }
      });

  this.cleanupSessions = function(userDoc, op, forceSave){
    var oldSessions = Object.keys(userDoc.session = userDoc.session || []);
    op = op || 'expired';
    return self.logoutUserSessions(userDoc, op)
        .then(function(finalUser){
          if(forceSave || !util.arrayEquals(oldSessions, Object.keys(finalUser.session)))
            return userDB
                .put(finalUser)
                .catch(function (err)
                {
                  err = {
                    message: "cannot update user doc",
                    doc: finalUser,
                    cause: err
                  };
                  console.error(err);
                  return Promise.reject(err);
                });
          return finalUser;
        });
  }

  this.updateSession = function (key, refresh, cleanup) {
    const me = this;
    let user;
    let changed = false;
    let refreshed = false;
    let rolesChanged = false;
    return session.fetchToken(key)
      .then(function(oldToken) {
        const newSession = oldToken;

        if(!newSession)
            return refresh ? Promise.reject('no session for key "' + key + '"') : null;

        if(isSessionExpired(newSession))
        {
          return session.deleteTokens([key]).then(()=>{
            return Promise.reject('session for key "' + key + ' already expired"');
          })
        }

        if(refresh)
        {
          if(newSession.ends > 0)
          {
            const expires = Math.min(newSession.ends, Date.now() + sessionLife * 1000);
            refreshed = changed = newSession.expires !== expires;
            if(changed)
            {
              newSession.expires = expires;
              newSession.refreshed = Date.now();
            }
          }
          else {
            refreshed = changed = true;
            newSession.expires = Date.now() + sessionLife * 1000;
            newSession.refreshed = Date.now();
          }
        }

        return userDB.get(newSession._id)
            .then(function(userDoc)
            {
              if (!userDoc.session[key])
              {
                console.warn("session found in session store but not in user doc. trying to repair.", {
                  session: newSession,
                  userDoc: userDoc
                });
                userDoc.session[key] = newSession;
                return userDB.put(userDoc).then((result)=>{userDoc._rev = result.rev; return userDoc});
              }
              return userDoc;
            })
            .then(function(userDoc){

              const allRoles = me.getAllRolesFromUserDoc(userDoc);
              if(!util.arrayEquals(newSession.roles, allRoles))
              {
                changed = true;
                rolesChanged = true;
                newSession.roles = allRoles;
              }
              if(changed)
                return session.storeToken(newSession)
                    .then(function(){
                      return userDoc;
                    });
              else
                return userDoc;
            })
            .then(function(userDoc) {
              user = userDoc;
              if(refreshed)
              {
                userDoc.session[key].expires = newSession.expires;
                userDoc.session[key].refreshed = newSession.refreshed;
              }
              if(cleanup)
                return self.cleanupSessions(userDoc, null, refresh)
                    .then(function(finalUser){
                      user = finalUser;
                      return finalUser;
                    });
              else
                return userDoc;
            })
            .then(function() {
              if(refreshed)
              {
                // if only roles were changed, the next step will propagate that anyway

                // pass new roles, expires, refreshed to dbAuth (couch)
                return dbAuth.updateKey(key, newSession.expires, newSession.refreshed, newSession.roles);
              }
            })
            .then(function() {
              if(rolesChanged)
              {
                // pass new roles to dbAuth
                //  - authorize session across all dbs using the possibly modified roles (cloudant)
                //  - update roles (couch)
                if (user.personalDBs && user.session)
                  return dbAuth.authorizeUserSessions(user._id, user.personalDBs, [key], newSession.roles);
              }
            })
            .then(function() {
              delete newSession.password;
              newSession.token = newSession.key;
              delete newSession.key;
              newSession.user_id = newSession._id;
              delete newSession._id;
              delete newSession.salt;
              delete newSession.derived_key;
              if(changed)
                emitter.emit('refresh', newSession);
              return Promise.resolve(newSession);
            });
      });

  };

  this.resetPassword = function (form, req) {
    req = req || {};
    var ResetPasswordModel = new Model(resetPasswordModel);
    var passwordResetForm = new ResetPasswordModel(form);
    var user;
    return passwordResetForm.validate()
      .then(function () {
        var tokenHash = util.hashToken(form.token);
        return userDB.query('auth/passwordReset', {key: tokenHash, include_docs: true});
      }, function(err) {
        return Promise.reject({
          error: 'Validation failed',
          validationErrors: err,
          status: 400
        });
      })
      .then(function (results) {
        if (!results.rows.length) {
          return Promise.reject({status: 400, error: 'Invalid token'});
        }
        user = results.rows[0].doc;
        if(user.forgotPassword.expires < Date.now()) {
          return Promise.reject({status: 400, error: 'Token expired'});
        }
        return util.hashPassword(form.password);
      })
      .then(function(hash) {
        if(!user.local) {
          user.local = {};
        }
        user.local.salt = hash.salt;
        user.local.derived_key = hash.derived_key;
        if(user.providers.indexOf('local') === -1) {
          user.providers.push('local');
        }
        // logout user completely
        return self.logoutUserSessions(user, 'all');
      })
      .then(function(userDoc) {
        user = userDoc;
        delete user.forgotPassword;
        return self.logActivity(user._id, 'reset password', 'local', req, user);
      })
      .then(function(finalUser) {
        return userDB.put(finalUser);
      })
      .then(function() {
        emitter.emit('password-reset', user);
        return Promise.resolve(user);
      });
  };

  this.changePasswordSecure = function(user_id, form, req) {
    req = req || {};
    var ChangePasswordModel = new Model(changePasswordModel);
    var changePasswordForm = new ChangePasswordModel(form);
    var user;
    return changePasswordForm.validate()
      .then(function () {
        return userDB.get(user_id);
      }, function(err) {
        return Promise.reject({error: 'Validation failed', validationErrors: err, status: 400});
      })
      .then(function() {
        return userDB.get(user_id);
      })
      .then(function(userDoc) {
        user = userDoc;
        if(user.local && user.local.salt && user.local.derived_key) {
          // Password is required
          if(!form.currentPassword){
            return Promise.reject({error: 'Password change failed', message: 'You must supply your current password in order to change it.', status: 400});
          }
          return util.verifyPassword(user.local, form.currentPassword);
        } else {
          return Promise.resolve();
        }
      })
      .then(function() {
        return self.changePassword(user._id, form.newPassword, user, req);
      }, function(err) {
        return Promise.reject(err || {error: 'Password change failed', message: 'The current password you supplied is incorrect.', status: 400});
      })
      .then(function() {
        if(req.user && req.user.key) {
          return self.logoutOthers(req.user.key);
        } else {
          return Promise.resolve();
        }
      });
  };

  this.changePassword = function(user_id, newPassword, userDoc, req) {
    req = req || {};
    var promise, user;
    if (userDoc) {
      promise = Promise.resolve(userDoc);
    } else {
      promise = userDB.get(user_id);
    }
    return promise
      .then(function(doc) {
        user = doc;
        return util.hashPassword(newPassword);
      }, function() {
        return Promise.reject({
          error: 'User not found',
          status: 404
        });
      })
      .then(function(hash) {
        if(!user.local) {
          user.local = {};
        }
        user.local.salt = hash.salt;
        user.local.derived_key = hash.derived_key;
        if(user.providers.indexOf('local') === -1) {
          user.providers.push('local');
        }
        return self.logActivity(user._id, 'changed password', 'local', req, user);
      })
      .then(function(finalUser) {
        return userDB.put(finalUser);
      })
      .then(function() {
        emitter.emit('password-change', user);
      });
  };

  this.forgotPassword = function(email, req) {
    req = req || {};

    if(!email)
      return Promise.reject({
        error: 'Email not specified',
        status: 400
      });

    email = email.toLowerCase();

    var user, token, tokenHash;
    return userDB.query('auth/email', {key: email, include_docs: true})
      .then(function(result) {
        if(!result.rows.length) {
          return Promise.reject({
            error: 'User not found',
            status: 404
          });
        }
        user = result.rows[0].doc;
        token = util.generateOneTimePassword(config.getItem('local.tokenLength'));
        tokenHash = util.hashToken(token);
        user.forgotPassword = {
          token: tokenHash, // Store secure hashed token
          issued: Date.now(),
          expires: Date.now() + tokenLife * 1000
        };
        return self.logActivity(user._id, 'forgot password', 'local', req, user);
      })
      .then(function(finalUser) {
        return userDB.put(finalUser);
      })
      .then(function() {
        return mailer.sendEmail('forgotPassword', user.email || user.unverifiedEmail.email,
          {user: user, req: req, token: token, lang: getLang(null, req)}); // Send user the unhashed token
      }).then(function() {
        emitter.emit('forgot-password', user);
        return Promise.resolve(user.forgotPassword);
      });
  };

  this.verifyEmail = function(token, req) {
    req = req || {};
    var user;
    return userDB.query('auth/verifyEmail', {key: token, include_docs: true})
      .then(function(result) {
        if(!result.rows.length) {
          return Promise.reject({error: 'Invalid token', status: 400});
        }
        user = result.rows[0].doc;
        user.email = user.unverifiedEmail.email;
        delete user.unverifiedEmail;
        emitter.emit('email-verified', user);
        return self.logActivity(user._id, 'verified email', 'local', req, user);
      })
      .then(function(finalUser) {
        return userDB.put(finalUser);
      });
  };

  this.changeEmail = function(user_id, newEmail, req) {
    req = req || {};
    if(!req.user) {
      req.user = {provider: 'local'};
    }
    var user;
    return self.validateEmail(newEmail)
      .then(function(err) {
        if(err) {
          return Promise.reject(err);
        }
        return userDB.get(user_id);
      })
      .then(function(userDoc) {
        user = userDoc;
        newEmail = newEmail.toLowerCase();
        if(config.getItem('local.sendConfirmEmail')) {
          user.unverifiedEmail = {
            email: newEmail,
            token: util.generateOneTimePassword(config.getItem('local.tokenLength'))
          };
          return mailer.sendEmail('confirmEmail', user.unverifiedEmail.email,
              {req: req, user: user, lang: getLang(null, req)});
        } else {
          user.email = newEmail;
          return Promise.resolve();
        }
      })
      .then(function() {
        emitter.emit('email-changed', user);
        return self.logActivity(user._id, 'changed email', req.user.provider, req, user);
      })
      .then(function(finalUser) {
        return userDB.put(finalUser);
      });
  };

  this.addUserDB = function(user_id, dbName, type, designDocs, permissions) {
    var userDoc;
    var dbConfig = dbAuth.getDBConfig(dbName, type || 'private');
    dbConfig.designDocs = designDocs || dbConfig.designDocs || '';
    dbConfig.permissions = permissions || dbConfig.permissions;
    return userDB.get(user_id)
      .then(function(result) {
        userDoc = result;
        return dbAuth.addUserDB(userDoc, dbName, dbConfig.designDocs, dbConfig.type, dbConfig.permissions,
          dbConfig.adminRoles, dbConfig.memberRoles);
      })
      .then(function(finalDBName) {
        if(!userDoc.personalDBs) {
          userDoc.personalDBs = {};
        }
        delete dbConfig.designDocs;
        // If permissions is specified explicitly it will be saved, otherwise will be taken from defaults every session
        if(!permissions) {
          delete dbConfig.permissions;
        }
        delete dbConfig.adminRoles;
        delete dbConfig.memberRoles;
        const modified = !userDoc.personalDBs[finalDBName] || JSON.stringify(userDoc.personalDBs[finalDBName]) !== JSON.stringify(dbConfig);
        userDoc.personalDBs[finalDBName] = dbConfig;
        emitter.emit('user-db-added', user_id, dbName);
        if(!modified)
          return Promise.resolve({ok: true, id: userDoc._id, rev: userDoc._rev});
        return userDB.put(userDoc);
      });
  };

  this.removeUserDB = function(user_id, dbName, deletePrivate, deleteShared) {
    var user;
    var update = false;
    return userDB.get(user_id)
      .then(function(userDoc) {
        user = userDoc;
        if(user.personalDBs && typeof user.personalDBs === 'object') {
          Object.keys(user.personalDBs).forEach(function(db) {
            if(user.personalDBs[db].name === dbName) {
              var type = user.personalDBs[db].type;
              delete user.personalDBs[db];
              update = true;
              if(type === 'private' && deletePrivate) {
                return dbAuth.removeDB(dbName);
              }
              if(type === 'shared' && deleteShared) {
                return dbAuth.removeDB(dbName);
              }
            }
          });
        }
        return Promise.resolve();
      })
      .then(function() {
        if(update) {
          emitter.emit('user-db-removed', user_id, dbName);
          return userDB.put(user);
        }
        return Promise.resolve();
      });
  };

  this.logoutUser = function(user_id, session_id) {
    var promise, user;
    if(user_id) {
      promise = userDB.get(user_id);
    } else {
      if(!session_id) {
        return Promise.reject({
          error: 'unauthorized',
          message: 'Either user_id or session_id must be specified',
          status: 401
        });
      }
      promise = userDB.query('auth/session', {key: session_id, include_docs: true})
        .then(function(results) {
          if(!results.rows.length) {
            return Promise.reject({
              error: 'unauthorized',
              status: 401
            });
          }
          return Promise.resolve(results.rows[0].doc);
        });
    }
    return promise
      .then(function(record) {
        user = record;
        user_id = record._id;
        return self.logoutUserSessions(user, 'all');
      })
      .then(function() {
        emitter.emit('logout', user_id);
        emitter.emit('logout-all', user_id);
        return userDB
            .put(user)
            .catch(function (err)
            {
              console.error("cannot logout user", user, err);
              return Promise.reject({
                message: "cannot logout user",
                doc: user,
                cause: err
              });
            });
      });
  };

  this.logoutSession = function(session_id) {
    let user;
    let startSessions = 0;
    let endSessions = 0;
    return userDB.query('auth/session', {key: session_id, include_docs: true})
      .then(function(results) {
        if(!results.rows.length) {
          return Promise.reject({
            error: 'unauthorized',
            status: 401
          });
        }
        user = results.rows[0].doc;
        if(user.session) {
          startSessions = Object.keys(user.session).length;
          if(user.session[session_id]) {
            delete user.session[session_id];
          }
        }
        const promises = [];
        // Delete the session from our session store
        promises.push(session.deleteTokens(session_id));
        // Remove the key from our couchDB auth database
        promises.push(dbAuth.removeKeys(session_id));
        if(user) {
          // Deauthorize key from each personal database
          promises.push(dbAuth.deauthorizeUser(user, session_id));
        }
        return Promise.all(promises);
      })
      .then(function() {
        // Clean out expired sessions
        return self.logoutUserSessions(user, 'expired');
      })
      .then(function(finalUser) {
        user = finalUser;
        if(user.session) {
          endSessions = Object.keys(user.session).length;
        }
        emitter.emit('logout', user._id);
        if(startSessions !== endSessions) {
          return userDB
              .put(user)
              .catch(function (err)
              {
                  console.error("cannot remove sessions user doc", user, err);
                  return Promise.reject({
                      message: "cannot remove sessions from user doc",
                      doc: user,
                      cause: err
                  });
              });
        } else {
          return Promise.resolve(false);
        }
      });
  };

  this.logoutOthers = function(session_id) {
    let user;
    return userDB.query('auth/session', {key: session_id, include_docs: true})
      .then(function(results) {
        if(results.rows.length) {
          user = results.rows[0].doc;
          if(user.session && user.session[session_id]) {
            return self.logoutUserSessions(user, 'other', session_id);
          }
        }
        return Promise.resolve();
      })
      .then(function(finalUser) {
        if(finalUser) {
          return userDB
              .put(finalUser)
              .catch(function (err)
              {
                console.error("cannot remove sessions from user db", finalUser, err);
                return Promise.reject({
                  message: "cannot remove sessions from user db",
                  doc: finalUser,
                  cause: err
                });
              });
        } else {
          return Promise.resolve(false);
        }
      });
  };

  this.logoutUserSessions = function(userDoc, op, currentSession) {
    // When op is 'other' it will logout all sessions except for the specified 'currentSession'
    const promises = [];
    let sessions;
    if(op === 'all' || op === 'other') {
      sessions = util.getSessions(userDoc);
    } else if(op === 'expired') {
      sessions = util.getExpiredSessions(userDoc, Date.now());
    }
    if(op === 'other' && currentSession) {
      // Remove the current session from the list of sessions we are going to delete
      const index = sessions.indexOf(currentSession);
      if(index > -1) {
        sessions.splice(index, 1);
      }
    }
    if(sessions.length) {
      // Delete the sessions from our session store
      promises.push(session.deleteTokens(sessions));
      // Remove the keys from our couchDB auth database
      promises.push(dbAuth.removeKeys(sessions));
      // Deauthorize keys from each personal database
      promises.push(dbAuth.deauthorizeUser(userDoc, sessions));
      if(op === 'expired' || op === 'other') {
        sessions.forEach(function(session) {
          delete userDoc.session[session];
        });
      }
    }
    if(op ==='all') {
      delete userDoc.session;
    }
    return Promise.all(promises)
      .then(function() {
        return Promise.resolve(userDoc);
      });
  };

  this.remove = function(user_id, destroyDBs) {
    // TODO: just delete the user from userDB, everything else will be handled by listener
    let user;
    const promises = [];
    return userDB.get(user_id)
      .then(function(userDoc) {
        return self.logoutUserSessions(userDoc, 'all');
      })
      .then(function(userDoc) {
        user = userDoc;
        if(destroyDBs !== true || !user.personalDBs) {
          return Promise.resolve();
        }
        Object.keys(user.personalDBs).forEach(function(userdb) {
          if(user.personalDBs[userdb].type === 'private') {
            promises.push(dbAuth.removeDB(userdb));
          }
        });
        return Promise.all(promises);
      })
      .then(function() {
        return userDB.remove(user);
      });
  };

  this.removeExpiredKeys = dbAuth.removeExpiredKeys.bind(dbAuth);

  this.confirmSession = function(key, password) {
    return session.confirmToken(key, password);
  };

  this.quitRedis = function () {
    return session.quit();
  };

  function generateSession(username, roles) {
    let getKey;
    if(config.getItem('dbServer.cloudant')) {
      getKey = require('./dbauth/cloudant').getAPIKey(userDB);
    } else {
      var token = util.URLSafeUUID();
      // Make sure our token doesn't start with illegal characters
      while(token[0] === '_' || token[0] === '-') {
        token = util.URLSafeUUID();
      }
      getKey = Promise.resolve({
        key: token,
        password: util.URLSafeUUID()
      });
    }
    return getKey
      .then(function(key) {
        const now = Date.now();
        return Promise.resolve({
          _id: username,
          key: key.key,
          password: key.password,
          issued: now,
          refreshed: now,
          expires: sessionMaxLife > 0 ? Math.min(now + sessionLife * 1000, now + sessionMaxLife * 1000) : now + sessionLife * 1000,
          ends: sessionMaxLife > 0 ? now + sessionMaxLife * 1000 : 0,
          roles: roles
        });
      });
  }

  // Adds numbers to a base name until it finds a unique database key
  function generateUsername(base, errorOnDuplicate) {
    base = base.toLowerCase();
    const entries = [];
    let finalName;
    return userDB.allDocs({startkey: base, endkey: base + '\uffff', include_docs: false})
      .then(function(results){
        if(results.rows.length === 0) {
          return Promise.resolve(base);
        }
        for(let i=0; i<results.rows.length; i++) {
          entries.push(results.rows[i].id);
        }
        if(entries.indexOf(base) === -1) {
          return Promise.resolve(base);
        }

        if(errorOnDuplicate)
          return Promise.reject('account name already exists: ' + base);
        let num = 0;
        while(!finalName) {
          num++;
          if(entries.indexOf(base+num) === -1) {
            finalName = base + num;
          }
        }
        return Promise.resolve(finalName);
      });
  }

  function addUserDBs(newUser) {
    // Add personal DBs
    if(!config.getItem('userDBs.defaultDBs')) {
      return Promise.resolve(newUser);
    }
    const promises = [];
    newUser.personalDBs = {};

    const processUserDBs = function(dbList, type) {
      dbList.forEach(function(userDBName) {
        const dbConfig = dbAuth.getDBConfig(userDBName);
        promises.push(
          dbAuth.addUserDB(newUser, userDBName, dbConfig.designDocs, type, dbConfig.permissions, dbConfig.adminRoles,
            dbConfig.memberRoles)
            .then(function(finalDBName) {
              delete dbConfig.permissions;
              delete dbConfig.adminRoles;
              delete dbConfig.memberRoles;
              delete dbConfig.designDocs;
              dbConfig.type = type;
              newUser.personalDBs[finalDBName] = dbConfig;
            }));
      });
    };

    // Just in case defaultDBs is not specified
    let defaultPrivateDBs = config.getItem('userDBs.defaultDBs.private');
    if(!Array.isArray(defaultPrivateDBs)) {
      defaultPrivateDBs = [];
    }
    processUserDBs(defaultPrivateDBs, 'private');
    let defaultSharedDBs = config.getItem('userDBs.defaultDBs.shared');
    if(!Array.isArray(defaultSharedDBs)) {
      defaultSharedDBs = [];
    }
    processUserDBs(defaultSharedDBs, 'shared');

    return Promise.all(promises).then(function() {
      return Promise.resolve(newUser);
    });
  }

  return this;

};
