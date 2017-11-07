'use strict';

var request = require('superagent');
var chai = require('chai');
var sinon = require('sinon');
var expect= chai.expect;
chai.use(require('sinon-chai'));

var BPromise = require('bluebird');
global.Promise = BPromise;
var PouchDB = require('pouchdb');
var seed = require('pouchdb-seed-design');

var util = require('../lib/util.js');
var config = require('./test.config');
var testServer = require('./test-server');
var userDesign = require('../designDocs/user-design');

var server = 'http://localhost:5000';
var dbUrl = util.getDBURL(config.dbServer);

describe('SuperLogin', function() {
  var app;
  var superlogin;
  var userDB, keysDB;
  var accessToken;
  var accessPass;
  var expireCompare;
  var resetToken = null;

  var newUser = {
    name: 'Kewl Uzer',
    username: 'kewluzer',
    email: 'kewluzer@example.com',
    password: '1s3cret',
    confirmPassword: '1s3cret'
  };

  var newUser2 = {
    name: 'Kewler Uzer',
    username: 'kewleruzer',
    email: 'kewleruzer@example.com',
    password: '1s3cret',
    confirmPassword: '1s3cret'
  };

  before(function() {
    userDB = new PouchDB(dbUrl + "/sl_test-users");
    keysDB = new PouchDB(dbUrl + "/sl_test-keys");
    app = testServer(config);

    app.superlogin.onCreate(function(userDoc, provider) {
      userDoc.profile = { name: userDoc.name };
    });

    return seed(userDB, userDesign);
  });

  after(function() {
    return BPromise.all([userDB.destroy(), keysDB.destroy()]).then(function() {
      app.shutdown();
    });
  });

  it('should create a new user', function() {
    return new BPromise(function(resolve, reject) {
      request
        .post(server + '/auth/register')
        .send(newUser)
        .end(function(err, res) {
          if (err) return reject(err);
          expect(res.status).to.equal(201);
          expect(res.body.success).to.equal('User created.');
          resolve();
        });
    });
  });

  it('should verify the email', function() {
    var emailToken;
    return userDB.get('kewluzer').then(function(record) {
      emailToken = record.unverifiedEmail.token;
      return 1;
    }).then(function() {
      return new BPromise(function(resolve, reject) {
        request
          .get(server + '/auth/confirm-email/' + emailToken)
          .end(function(err, res) {
            if (err) return reject(err);
            expect(res.status).to.equal(200);
            resolve();
          });
      });
    });
  });

  it('should login the user', function() {
    return new BPromise(function(resolve, reject) {
      request
        .post(server + '/auth/login')
        .send({ username: newUser.username, password: newUser.password })
        .end(function(err, res) {
          if (err) return reject(err);
          accessToken = res.body.token;
          accessPass = res.body.password;
          expect(res.status).to.equal(200);
          expect(res.body.roles[0]).to.equal('user');
          expect(res.body.token.length).to.be.above(10);
          expect(res.body.profile.name).to.equal(newUser.name);
          resolve();
        });
    });
  });

  it('should access a protected endpoint', function() {
    return new BPromise(function(resolve, reject) {
      request
        .get(server + '/auth/session')
        .set('Authorization', 'Bearer ' + accessToken + ':' + accessPass)
        .end(function(err, res) {
          if (err) return reject(err);
          expect(res.status).to.equal(200);
          resolve();
        });
    });
  });

  it('should require a role', function() {
    return new BPromise(function(resolve, reject) {
      request
        .get(server + '/user')
        .set('Authorization', 'Bearer ' + accessToken + ':' + accessPass)
        .end(function(err, res) {
          if (err) return reject(err);
          expect(res.status).to.equal(200);
          resolve();
        });
    });
  });

  it('should deny access when a required role is not present', function() {
    return new BPromise(function(resolve, reject) {
      request
        .get(server + '/admin')
        .set('Authorization', 'Bearer ' + accessToken + ':' + accessPass)
        .end(function(err, res) {
          expect(err.message).to.equal('Forbidden');
          expect(res.status).to.equal(403);
          resolve();
        });
    });
  });

  it('should generate a forgot password token', function() {
    var spySendMail = sinon.spy(app.superlogin.mailer, "sendEmail");

    return new BPromise(function(resolve, reject) {
      request
        .post(server + '/auth/forgot-password')
        .send({email: newUser.email})
        .end(function(err, res) {
          if (err) return reject(err);
          expect(res.status).to.equal(200);
          var sendEmailArgs = spySendMail.getCall(0).args;
          resetToken = sendEmailArgs[2].token;
          resolve();
        });
    });
  });

  it('should reset the password', function() {
    return userDB.get(newUser.username).then(function(resetUser) {
      return new BPromise(function(resolve, reject) {
        request
          .post(server + '/auth/password-reset')
          .send({token: resetToken, password: 'newpass', confirmPassword: 'newpass'})
          .end(function(err, res) {
            if (err) return reject(err);
            expect(res.status).to.equal(200);
            resolve();
          });
      });
    });
  });

  it('should logout the user upon password reset', function() {
    return new BPromise(function(resolve, reject) {
      request
        .get(server + '/auth/session')
        .set('Authorization', 'Bearer ' + accessToken + ':' + accessPass)
        .end(function(err, res) {
          expect(err.message).to.equal('Unauthorized');
          expect(res.status).to.equal(401);
          resolve();
        });
    });
  });

  it('should login with the new password', function() {
    return new BPromise(function(resolve, reject) {
      request
        .post(server + '/auth/login')
        .send({ username: newUser.username, password: 'newpass' })
        .end(function(err, res) {
          if (err) return reject(err);
          accessToken = res.body.token;
          accessPass = res.body.password;
          expireCompare = res.body.expires;
          expect(res.status).to.equal(200);
          expect(res.body.roles[0]).to.equal('user');
          expect(res.body.token.length).to.be.above(10);
          resolve();
        });
    });
  });

  it('should refresh the session', function() {
    return new BPromise(function(resolve, reject) {
      request
        .post(server + '/auth/refresh')
        .set('Authorization', 'Bearer ' + accessToken + ':' + accessPass)
        .end(function(err, res) {
          if (err) return reject(err);
          expect(res.status).to.equal(200);
          expect(res.body.expires).to.be.above(expireCompare);
          resolve();
        });
    });
  });

  it('should change the password', function() {
    return userDB.get(newUser.username).then(function(resetUser) {
      return new BPromise(function(resolve, reject) {
        request
          .post(server + '/auth/password-change')
          .set('Authorization', 'Bearer ' + accessToken + ':' + accessPass)
          .send({currentPassword: 'newpass', newPassword: 'newpass2', confirmPassword: 'newpass2'})
          .end(function(err, res) {
            if (err) return reject(err);
            expect(res.status).to.equal(200);
            resolve();
          });
      });
    });
  });

  it('should logout the user', function() {
    return new BPromise(function(resolve, reject) {
      request
        .post(server + '/auth/logout')
        .set('Authorization', 'Bearer ' + accessToken + ':' + accessPass)
        .end(function(err, res) {
          if (err) return reject(err);
          expect(res.status).to.equal(200);
          resolve();
        });
    }).then(function() {
      return new BPromise(function(resolve, reject) {
        request
          .get(server + '/auth/session')
          .set('Authorization', 'Bearer ' + accessToken + ':' + accessPass)
          .end(function(err, res) {
            expect(err.message).to.equal('Unauthorized');
            expect(res.status).to.equal(401);
            resolve();
          });
      });
    });
  });

  it('should login after creating a new user', function() {
    app.config.setItem('security.loginOnRegistration', true);
    return new BPromise(function(resolve, reject) {
      request
        .post(server + '/auth/register')
        .send(newUser2)
        .end(function(err, res) {
          if (err) return reject(err);
          expect(res.status).to.equal(200);
          expect(typeof res.body.token).to.equal('string');
          resolve();
        });
    });
  });

  it('should validate a username', function() {
    return new BPromise(function(resolve, reject) {
      request
        .get(server + '/auth/validate-username/idontexist')
        .end(function(err, res) {
          if (err) return reject(err);
          expect(res.status).to.equal(200);
          expect(res.body.ok).to.equal(true);
          resolve();
        });
    }).then(function() {
      return new BPromise(function(resolve, reject) {
        request
          .get(server + '/auth/validate-username/kewluzer')
          .end(function(err, res) {
            expect(err.message).to.equal('Conflict');
            expect(res.status).to.equal(409);
            resolve();
          });
      });
    });
  });

  it('should validate an email', function() {
    return new BPromise(function(resolve, reject) {
      request
        .get(server + '/auth/validate-email/nobody@example.com')
        .end(function(err, res) {
          if (err) return reject(err);
          expect(res.status).to.equal(200);
          expect(res.body.ok).to.equal(true);
          resolve();
        });
    }).then(function() {
      return new BPromise(function(resolve, reject) {
        request
          .get(server + '/auth/validate-username/kewluzer@example.com')
          .end(function(err, res) {
            expect(err.message).to.equal('Conflict');
            expect(res.status).to.equal(409);
            resolve();
          });
      });
    });
  });

  function attemptLogin(username, password) {
    return new BPromise(function(resolve, reject) {
      request
        .post(server + '/auth/login')
        .send({ username: username, password: password })
        .end(function(error, res) {
          resolve({status: res.status, message: res.body.message});
        });
    });
  }

  it('should respond unauthorized if a user logs in and no password is set', function() {
    return userDB.put({
      _id: 'nopassword',
      email: 'nopassword@example.com'
    }).then(function() {
      return attemptLogin('nopassword', 'wrongpassword');
    }).then(function(result) {
      expect(result.status).to.equal(401);
      expect(result.message).to.equal('Invalid username or password');
    });
  });

  it('should block a user after failed logins', function() {
    return attemptLogin('kewluzer', 'wrong').then(function(result) {
      expect(result.status).to.equal(401);
      expect(result.message).to.equal('Invalid username or password');
      return attemptLogin('kewluzer', 'wrong');
    })
    .then(function(result) {
      expect(result.status).to.equal(401);
      expect(result.message).to.equal('Invalid username or password');
      return attemptLogin('kewluzer', 'wrong');
    })
    .then(function(result) {
      expect(result.status).to.equal(401);
      expect(result.message.search('Maximum failed login')).to.equal(0);
      return attemptLogin('kewluzer', 'newpass');
    })
    .then(function(result) {
      expect(result.status).to.equal(401);
      expect(result.message.search('Your account is currently locked')).to.equal(0);
    });
  });
});
