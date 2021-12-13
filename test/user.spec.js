'use strict';
const events = require('events');
const path = require('path');
const PouchDB = require('pouchdb');
const BPromise = require('bluebird');
const chai = require('chai');
const sinon = require('sinon');
const expect= chai.expect;

chai.use(require('sinon-chai'));

const Configure = require('../lib/configure');
const User = require('../lib/user');
const Mailer = require('../lib/mailer');
const util = require('../lib/util');
const seed = require('pouchdb-seed-design');
const request = require('superagent');
const config = require('./test.config.js');
const userDesign = require('../designDocs/user-design');

const dbUrl = util.getDBURL(config.dbServer);

const userDB = new PouchDB(dbUrl + "/superlogin_test_users");
const keysDB = new PouchDB(dbUrl + "/superlogin_test_keys");

function checkDBExists(dbname) {
  const finalUrl = dbUrl + '/' + dbname;

  return BPromise.fromCallback(function(callback) {
    request.get(finalUrl).end(callback);
  }).then(function(res) {
    const result = JSON.parse(res.text);
    if(result.db_name) {
      return Promise.resolve(true);
    }
  }, function(err) {
    if(err.status === 404) {
      return Promise.resolve(false);
    }
  });
}

const testUserForm = {
  name: 'Super',
  username: 'superuser',
  email: 'superuser@example.com',
  password: 'superlogin',
  confirmPassword: 'superlogin',
  age: '32',
  zipcode: 'ABC123'
};

const emailUserForm = {
  name: 'Awesome',
  email: 'awesome@example.com',
  password: 'supercool',
  confirmPassword: 'supercool'
};

const userConfig = new Configure({
  testMode: {
    noEmail: true
  },
  security: {
    defaultRoles: ['user'],
    userActivityLogSize: 3
  },
  local: {
    sendConfirmEmail: true,
    requireEmailConfirm: false,
    passwordConstraints: {
      length: {
        minimum: 8,
        message: "must be at least 8 characters"
      },
      matches: 'confirmPassword'
    }
  },
  mailer: {
    fromEmail: 'noreply@example.com'
  },
  emails: {
    confirmEmail: {
      subject: 'Please confirm your email',
      template: path.join(__dirname, '../templates/email/confirm-email.ejs'),
      format: 'text'
    },
    forgotPassword: {
      subject: 'Your password reset link',
      template: 'templates/email/forgot-password.ejs',
      format: 'text'
    }
  },
  dbServer: {
    protocol: config.dbServer.protocol,
    host: config.dbServer.host,
    user: config.dbServer.user,
    password: config.dbServer.password,
    publicURL: 'https://mydb.example.com'
  },
  session: {
    adapter: 'memory'
  },
  userDBs: {
    defaultSecurityRoles: {
      admins: ['admin_role'],
      members: ['member_role']
    },
    model: {
      _default: {
        designDocs: ['test'],
        permissions: ['_reader', '_writer', '_replicator']
      }
    },
    defaultDBs: {
      private: ['usertest']
    },
    privatePrefix: 'test',
    designDocDir: __dirname + '/ddocs'
  },
  providers: {
    facebook: {
      clientID: 'FAKE_ID',
      clientSecret: 'FAKE_SECRET',
      callbackURL: 'http://localhost:5000/auth/facebook/callback'
    }
  },
  userModel: {
    static: {
      modelTest: true
    },
    whitelist: ['age', 'zipcode']
  }
});

const req = {
  headers: {
    host: 'example.com'
  },
  protocol: 'http',
  ip: '1.1.1.1'
};

const previous = Promise.resolve();

describe('User Model', function() {
  const emitter = new events.EventEmitter();
  const mailer = new Mailer(userConfig);
  let user = new User(userConfig, userDB, keysDB, mailer, emitter);

  let userTestDB;
  let verifyEmailToken;
  let sessionKey, sessionPass, firstExpires;
  let resetToken;
  let resetTokenHashed;

  before(function() {
    return seed(userDB, util.addProvidersToDesignDoc(userConfig, userDesign));
  });

  after(function() {
    var userTestDB1 = new PouchDB(dbUrl + "/test_usertest$superuser");
    var userTestDB2 = new PouchDB(dbUrl + "/test_usertest$misterx");
    var userTestDB3 = new PouchDB(dbUrl + "/test_usertest$misterx3");
    var userTestDB4 = new PouchDB(dbUrl + "/test_superdb");

    return Promise.all([
      userDB.destroy(),
      keysDB.destroy(),
      userTestDB1.destroy(),
      userTestDB2.destroy(),
      userTestDB3.destroy(),
      userTestDB4.destroy()
    ]);
  });

  it('should save a new user', function() {
    const emitterPromise = new Promise(function(resolve) {
      emitter.once('signup', function(user) {
        expect(user._id).to.equal('superuser');
        resolve();
      });
    });

    user.onCreate(function(userDoc) {
      userDoc.onCreate1 = true;
    });

    user.onCreate(function(userDoc) {
      userDoc.onCreate2 = true;
    });

    return user.create(testUserForm, req).then(function() {
      return userDB.get(testUserForm.username);
    }).then(function(newUser) {
      verifyEmailToken = newUser.unverifiedEmail.token;

      expect(newUser._id).to.equal('superuser');
      expect(newUser.roles[0]).to.equal('user');
      expect(newUser.local.salt).to.be.a('string');
      expect(newUser.local.derived_key).to.be.a('string');
      expect(newUser.modelTest).to.equal(true);
      expect(newUser.roles[0]).to.equal('user');
      expect(newUser.activity[0].action).to.equal('signup');
      expect(newUser.onCreate1).to.equal(true);
      expect(newUser.onCreate2).to.equal(true);
      expect(newUser.age).to.equal('32');
      expect(newUser.zipcode).to.equal('ABC123');

      return emitterPromise;
    });
  });

  it('should have created a user db with design doc and _security', function() {
    userTestDB = new PouchDB(dbUrl + '/test_usertest$superuser');

    return userTestDB.get('_design/test').then(function(ddoc) {
      expect(ddoc.views.mytest.map).to.be.a('string');
      return userTestDB.get('_security');
    }).then(function(secDoc) {
      expect(secDoc.admins.roles[0]).to.equal('admin_role');
      expect(secDoc.members.roles[0]).to.equal('member_role');
    });
  });

  it('should authenticate the password', function() {
    return userDB.get(testUserForm.username).then(function(newUser) {
      return util.verifyPassword(newUser.local, 'superlogin');
    });
  });

  it('should generate a validation error trying to save the same user again', function() {
    return user.create(testUserForm).then(function() {
      throw new Error('Validation errors should have been generated');
    }).catch(function(err) {
      if(err.validationErrors) {
        expect(err.validationErrors.email[0]).to.equal('Email already in use');
        expect(err.validationErrors.username[0]).to.equal('Username already in use');
      } else {
        throw err;
      }
    });
  });

  it('should generate a new session for the user', function() {
    const emitterPromise = new Promise(function(resolve) {
      emitter.once('login', function(session) {
        expect(session.user_id).to.equal('superuser');
        resolve();
      });
    });

    return user.createSession(testUserForm.username, 'local', req).then(function(result) {
      sessionKey = result.token;
      sessionPass = result.password;
      firstExpires = result.expires;

      expect(sessionKey).to.be.a('string');
      expect(result.userDBs.usertest).to.equal('https://' + sessionKey + ':' + sessionPass + '@' +
        'mydb.example.com/test_usertest$superuser');
      return userDB.get(testUserForm.username);
    }).then(function(user) {
      expect(user.session[sessionKey].ip).to.equal('1.1.1.1');
      expect(user.activity[0].action).to.equal('login');
      return emitterPromise;
    });
  });

  it('should have authorized the session in the usertest database', function() {
    return userTestDB.get('_security').then(function(secDoc) {
      expect(secDoc.members.names.length).to.equal(1);
    });
  });

  it('should refresh a session', function() {
    const emitterPromise = new Promise(function(resolve) {
      emitter.once('refresh', function(session) {
        expect(session.user_id).to.equal('superuser');
        resolve();
      });
    });

    return user.refreshSession(sessionKey, sessionPass).then(function(result) {
      expect(result.expires).to.be.above(firstExpires);
      return emitterPromise;
    });
  });

  it('should log out of a session', function() {
    const emitterPromise = new Promise(function(resolve) {
      emitter.once('logout', function(user_id) {
        expect(user_id).to.equal('superuser');
        resolve();
      });
    });

    return user.logoutSession(sessionKey).then(function() {
      return user.confirmSession(sessionKey, sessionPass);
    })
    .then(function() {
      throw new Error('Failed to log out of session');
    }, function(err) {
      expect(err).to.equal('invalid token');
      return userDB.get(testUserForm.username);
    })
    .then(function(user) {
      expect(user.session[sessionKey]).to.be.an('undefined');
      return emitterPromise;
    });
  });

  it('should have deauthorized the session in the usertest database after logout', function() {
    return userTestDB.get('_security').then(function(secDoc) {
      expect(secDoc.members.names.length).to.equal(0);
    });
  });

  it('should log the user out of all sessions', function() {
    const emitterPromise = new Promise(function(resolve) {
      emitter.once('logout-all', function(user_id) {
        expect(user_id).to.equal('superuser');
        resolve();
      });
    });

    var sessions = [];
    var passes = [];

    return user.createSession(testUserForm.username, 'local', req).then(function(session1) {
      sessions[0] = session1.token;
      passes[0] = session1.password;
      return user.createSession(testUserForm.username, 'local', req);
    }).then(function(session2) {
      sessions[1] = session2.token;
      passes[1] = session2.password;
      return user.logoutUser(null, sessions[0]);
    }).then(function() {
      return Promise.all([
        user.confirmSession(sessions[0], passes[0]),
        user.confirmSession(sessions[1], passes[1])
      ]).then(function(results) {
        throw new Error('Failed to delete user sessions');
      }).catch(function(error) {
        expect(error).to.equal('invalid token');
        return userDB.get(testUserForm.username);
      });
    }).then(function(user) {
      expect(user.session).to.be.an('undefined');
      // Make sure the sessions are deauthorized in the usertest db
      return userTestDB.get('_security');
    }).then(function(secDoc) {
      expect(secDoc.members.names.length).to.equal(0);
      return emitterPromise;
    });
  });

  it('should verify the email', function() {
    const emitterPromise = new Promise(function(resolve) {
      emitter.once('email-verified', function(user) {
        expect(user._id).to.equal('superuser');
        resolve();
      });
    });

    return user.verifyEmail(verifyEmailToken).then(function() {
      return userDB.get(testUserForm.username);
    }).then(function(verifiedUser) {
      expect(verifiedUser.email).to.equal(testUserForm.email);
      expect(verifiedUser.activity[0].action).to.equal('verified email');
      return emitterPromise;
    });
  });

  it('should generate a password reset token', function() {
    const emitterPromise = new Promise(function(resolve) {
      emitter.once('forgot-password', function(user) {
        expect(user._id).to.equal('superuser');
        resolve();
      });
    });

    const spySendMail = sinon.spy(mailer, "sendEmail");

    return user.forgotPassword(testUserForm.email, req).then(function() {
      return userDB.get(testUserForm.username);
    }).then(function(result) {
      resetTokenHashed = result.forgotPassword.token; // hashed token stored in db

      expect(result.forgotPassword.token).to.be.a('string');
      expect(result.forgotPassword.expires).to.be.above(Date.now());
      expect(result.activity[0].action).to.equal('forgot password');

      expect(spySendMail.callCount).to.equal(1);

      const args = spySendMail.getCall(0).args;
      expect(args[0]).to.equal('forgotPassword');
      expect(args[1]).to.equal(testUserForm.email);
      expect(args[2].user._id).to.equal(testUserForm.username);
      expect(args[2].token).to.be.a('string');

      resetToken = args[2].token; // keep unhashed token emailed to user.
      expect(resetTokenHashed).to.not.equal(resetToken);
      return emitterPromise;
    });
  });

  it('should not reset the password', function() {
    const form = {
      token: resetToken,
      password: 'secret',
      confirmPassword: 'secret'
    };

    return user.resetPassword(form).then(function() {
      throw new Error('Validation errors should have been generated');
    }).catch(function(err) {
      if (err.validationErrors) {
        expect(err.validationErrors.password[0]).to.equal('Password must be at least 8 characters');
      } else {
        throw err;
      }
    });
  });

  it('should reset the password', function() {
    const emitterPromise = new Promise(function (resolve) {
      emitter.once('password-reset', function (user) {
        expect(user._id).to.equal('superuser');
        resolve();
      });
    });

    const form = {
      token: resetToken,
      password: 'newSecret',
      confirmPassword: 'newSecret'
    };

    return user.resetPassword(form).then(function () {
      return userDB.get(testUserForm.username);
    }).then(function (userAfterReset) {
      // It should delete the password reset token completely
      /* jshint -W030 */
      expect(userAfterReset.forgotPassword).to.be.an.undefined;
      /* jshint +W030 */
      expect(userAfterReset.activity[0].action).to.equal('reset password');
      return util.verifyPassword(userAfterReset.local, 'newSecret');
    }).then(function () {
      return emitterPromise;
    });
  });

  it('should change the password', function() {
    const emitterPromise = new Promise(function(resolve) {
      emitter.once('password-change', function(user) {
        expect(user._id).to.equal('superuser');
        resolve();
      });
    });

    var form = {
      currentPassword: 'newSecret',
      newPassword: 'superpassword2',
      confirmPassword: 'superpassword2'
    };

    return user.changePasswordSecure(testUserForm.username, form).then(function() {
      return userDB.get(testUserForm.username);
    }).then(function(userAfterChange) {
      expect(userAfterChange.activity[0].action).to.equal('changed password');
      return util.verifyPassword(userAfterChange.local, 'superpassword2');
    }).then(function() {
      return emitterPromise;
    });
  });

  it('should change the email', function() {
    const emitterPromise = new Promise(function(resolve) {
      emitter.once('email-changed', function(user) {
        expect(user._id).to.equal('superuser');
        resolve();
      });
    });

    return user.changeEmail(testUserForm.username, 'superuser2@example.com', req).then(function() {
      return userDB.get(testUserForm.username);
    }).then(function(userAfterChange) {
      expect(userAfterChange.activity[0].action).to.equal('changed email');
      expect(userAfterChange.unverifiedEmail.email).to.equal('superuser2@example.com');
      return emitterPromise;
    });
  });

  it('should create a new account from facebook auth', function() {
    const emitterPromise = new Promise(function(resolve) {
      emitter.once('signup', function(user) {
        expect(user._id).to.equal('misterx');
        resolve();
      });
    });

    const auth = {token: 'x'};
    const profile = {
      id: 'abc123',
      username: 'misterx',
      emails: [{value: 'misterx@example.com'}]
    };

    return user.socialAuth('facebook', auth, profile, req).then(function() {
      return userDB.get('misterx');
    }).then(function(result) {
      expect(result.facebook.auth.token).to.equal('x');
      expect(result.email).to.equal('misterx@example.com');
      expect(result.providers[0]).to.equal('facebook');
      expect(result.facebook.profile.username).to.equal('misterx');
      expect(result.activity[0].action).to.equal('signup');
      expect(result.activity[0].provider).to.equal('facebook');
      return emitterPromise;
    });
  });

  it('should refresh an existing account from facebook auth', function() {
    const auth = {token: 'y'};
    const profile = {
      id: 'abc123',
      username: 'misterx',
      emails: [{value: 'misterx@example.com'}]
    };

    return user.socialAuth('facebook', auth, profile, req).then(function() {
      return userDB.get('misterx');
    }).then(function(result) {
      expect(result.facebook.auth.token).to.equal('y');
    });
  });

  it('should reject an email already in use', function() {
    const auth = {token: 'y'};
    const profile = {
      id: 'cde456',
      username: 'misterx2',
      emails: [{value: 'misterx@example.com'}]
    };

    return user.socialAuth('facebook', auth, profile, req).then(function() {
      throw new Error('existing email should have been rejected');
    }, function(err) {
      expect(err.status).to.equal(409);
    });
  });

  it('should generate a username in case of conflict', function() {
    const auth = {token: 'y'};
    const profile = {
      id: 'cde456',
      username: 'misterx',
      emails: [{value: 'misterx99@example.com'}]
    };

    const docs = [
      {_id: 'misterx1'},
      {_id: 'misterx2'},
      {_id: 'misterx4'}
    ];

    return userDB.bulkDocs(docs).then(function() {
      return user.socialAuth('facebook', auth, profile, req);
    }).then(function(result) {
      expect(result._id).to.equal('misterx3');
    });
  });

  it('should link a social profile to an existing user', function() {
    const auth = {token: 'y'};
    const profile = {
      id: 'efg789',
      username: 'superuser',
      emails: [{value: 'superuser@example.com'}]
    };

    return user.linkSocial('superuser', 'facebook', auth, profile, {}).then(function(theUser) {
      expect(theUser.facebook.profile.username).to.equal('superuser');
      expect(theUser.activity[0].action).to.equal('link');
      expect(theUser.activity[0].provider).to.equal('facebook');
      // Test that the activity list is limited to the maximum value
      expect(theUser.activity.length).to.equal(3);
    });
  });

  it('should unlink a social profile', function() {
    return user.unlink('superuser', 'facebook').then(function(theUser) {
      expect(typeof theUser.facebook).to.equal('undefined');
      expect(theUser.providers.length).to.equal(1);
      expect(theUser.providers.indexOf('facebook')).to.equal(-1);
    });
  });

  it('should clean all expired sessions', function() {
    const now = Date.now();
    const testUser = {
      _id: 'testuser',
      session: {
        good1: {
          expires: now + 100000
        },
        bad1: {
          expires: now - 100000
        },
        bad2: {
          expires: now - 100000
        }
      }
    };

    return user.logoutUserSessions(testUser, 'expired').then(function(finalDoc) {
      expect(Object.keys(finalDoc.session).length).to.equal(1);
      expect(finalDoc.session).to.include.keys('good1');
    });
  });

  it('should log out of all other sessions', function() {
    const now = Date.now();
    const testUser = {
      _id: 'testuser',
      session: {
        this1: {},
        other1: {},
        other2: {}
      }
    };

    return userDB.put(testUser).then(function() {
      return user.logoutOthers('this1');
    }).then(function() {
      return userDB.get('testuser');
    }).then(function(finalDoc) {
      expect(Object.keys(finalDoc.session).length).to.equal(1);
      expect(finalDoc.session).to.include.keys('this1');
    });
  });

  it('should add a new user database', function() {
    return user.addUserDB('superuser', 'test_superdb', 'shared').then(function() {
      return userDB.get('superuser');
    }).then(function(userDoc) {
      expect(userDoc.personalDBs.test_superdb.type).to.equal('shared');
      return checkDBExists('test_superdb');
    }).then(function(result) {
      expect(result).to.equal(true);
    });
  });

  it('should remove a user database', function() {
    return user.removeUserDB('superuser', 'test_superdb', false, true).then(function() {
      return userDB.get('superuser');
    }).then(function(userDoc) {
      expect(typeof userDoc.personalDBs.test_superdb).to.equal('undefined');
      return checkDBExists('test_superdb');
    }).then(function(result) {
      expect(result).to.equal(false);
    });
  });

  it('should delete a user and all databases', function() {
    return checkDBExists('test_usertest$superuser').then(function(result) {
      expect(result).to.equal(true);
      return user.remove('superuser', true);
    }).then(function() {
      return userDB.get('superuser');
    }).then(function(result) {
      throw 'User should have been deleted!';
    }, function(err) {
      expect(err.name).to.equal('not_found');
      return checkDBExists('test_usertest$superuser');
    }).then(function(result) {
      expect(result).to.equal(false);
    });
  });

  it('should create a new user in userEmail mode', function() {
    userConfig.setItem('local.emailUsername', true);
    // Don't create any more userDBs
    userConfig.removeItem('userDBs.defaultDBs');
    // Create a new instance of user with the new config
    user = new User(userConfig, userDB, keysDB, mailer, emitter);

    return user.create(emailUserForm, req).then(function(newUser) {
      expect(newUser.unverifiedEmail.email).to.equal(emailUserForm.email);
      expect(newUser._id).to.equal(emailUserForm.email);
    });
  });

  it('should not create a user with conflicting email', function() {
    return user.create(emailUserForm, req).then(function(newUser) {
      throw "Should not have created the user!";
    }, function(err) {
      if(err.error) {
        expect(err.error).to.equal('Validation failed');
      } else {
        throw err;
      }
    });
  });
});
