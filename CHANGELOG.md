# CHANGELOG

## v2.0.31 - 2021-03-29

* cleanup arrays 

## v2.0.30 - 2021-03-25

* dedicated default roles config for social auth providers and local registration 

## v2.0.29 - 2021-03-23

* bugfixes design docs
* short one time passwords for email confirmation and password reset
* error handling for expired sessions during refresh
* better user name / email validation

## v2.0.28 - 2021-03-18

* revert to 2.0.27 (had no effect)

## v2.0.27 - 2021-03-18

* better handle new sessions on first access

## v2.0.26 - 2021-03-18

* bugfix in error handling (jsCallback is not defined)

## v2.0.25 - 2021-03-15

* file adapter thread save bugfix

## v2.0.24 - 2021-03-15

* pouchdb 7
* pouchdb-security-helper
* file adapter thread save
* oauth error handling
* doc

## v2.0.23 - 2021-03-02

* better error messages

## v2.0.22 - 2021-03-02

* bugfixes
* better error messages

## v2.0.21 - 2021-03-01

* better error messages

## v2.0.20 - 2021-03-01

* fixed typo in FileAdapter

## v2.0.18 - 2021-03-01

* optimized oAuth handling with new routes, channels, sessions, configurable callbacks, etc.

## v2.0.16 - 2021-01-27

* new route /profile

### Fixes
* bugfix when using email style username

## v2.0.15 - 2020-12-17

### Fixes
* avoid 409 on session cleanup/sync

## v2.0.14 - 2020-12-11

### Fixes
* better error messages
+ sync session refresh to userDB

## v2.0.13 - 2020-11-20

### Fixes
* json (instead of plain text) response when session invalid 

## v2.0.12 - 2020-11-26

### Fixes
* change listener on sl-users triggers updates on sessions and authDb when roles are modified

## v2.0.11 - 2020-11-22

### Fixes
* sync roles from user to session when refreshing session

## v2.0.6 - 2019-11-11

### Fixes
* better error messages
* bugfix FileAdapter

## v2.0.3 - 2019-02-21

### Fixes
* avoid exceptions in user-design views 

## v2.0.2 - 2019-01-23

### Fixes
* clone design doc instance to enable multiple independent instances of superLogin

## v2.0.1 - 2019-01-22

### Fixes
* fixed express error handler signature

## v2.0.0 - 2019-01-16

### Dependencies
* mocha from `5.1.1` to `5.2.0`
* sinon from `5.0.4` to `7.2.2`

### Features
* superlogin.initialized()


### Fixes
* default http status code for error message in '/register'
* generic error message in http response for '/validate-username/' and '/validate-email/'
* delegate method invocations from routes via superlogin instance instead of user instance to allow effective patching of superlogin methods

## v1.2.1 - 2018-05-07

### Dependencies
* fs-extra from `4.0.3` to `6.0.0`
* mocha from `3.5.3` to `5.1.1`
* passport from ` 0.3.2` to `0.4.0`
* pouchdb from `6.3.4` to `6.4.3`
* pouchdb-seed-design from `0.2.2` to `0.3.0`
* sinon from `3.3.0` to `5.0.4`
* sinon-chai from `2.14.0` to `3.0.0`

### Fixes
* Send a 400 with a JSON object when registration fails.


## v1.2.0 - 2017-11-07

### Dependencies
* bluebird from `3.3.4` to `3.5.1`
* express from `4.13.3` to `4.16.2`
* nodemailer from `4.1.1` to `4.3.1`
* superagent from `3.6.0` to `3.8.0`
* sinon-chai from `2.8.0` to `2.14.0`
* Ignore package-lock.json

### Tests
* `previous` usage as a promise anti-pattern, removed.
* moved `require` calls to the top
* Always test `err` in callbacks
* `before` should not include a promise in `onCreate`
* Missed returning a promise in user spec: `bulkDocs`

### CI
* Test node 9

### package.json
* Point to this repo for this fork

## v1.1.0 - 2017-09-27
* Update `fs-extra` from `^0.3.0` to `^4.0.2`
* Update `nodemailer` from `^2.3.0` to `^4.1.1`
* Update `superagent` from `^1.2.0` to `^3.6.0`
* Remove `gulp`, `gulp-mocha`, `gulp-jshint`
* Improve linting
* Drop support for node 4
* Whitespace cleanup
* Do not cache node modules
* Remove cloudant test
* Do not publish `test` directory or `.travis.yml` or `.jshintrc` to npm

## v1.0.0 - 2017-09-19
* Updated CHANGELOG formatting
* Change couch-pwd to @sensu/couch-pwd
* Update Travis CI config to test modern versions of node
* Update chai, gulp-mocha, mocha, & sinon to modern versions
* Add some missing newlines at ends of files

## v0.6.1 - 2016-04-02
* Misc bugfixes
* Documentation improvements
* Now testing against Node 4.x and 5.x

## v0.6.0 - 2016-04-02
* Updated dependencies
* Improved unit tests (thanks [@tohagan](https://github.com/tohagan) and [@ybian](https://github.com/ybian))
* CouchDB server can now have a separate URL for public access
* Misc bug fixes

## v0.5.0 - 2015-10-08
* Previously a user could only logout if the session token was still valid. API keys would be expired, but database credentials could still be used. Now logout will ensure the user is completely logged out, even if the session is already expired.
* Fixed a bug that was causing `sessionLife` and `tokenLife` settings not to work.

## v0.4.0 - 2015-09-21
* Default per-DB Cloudant permissions no longer save in the user doc. You can set custom permissions in the user doc, otherwise it will use the settings in your config. Misc bug fixes.

## v0.3.0 - 2015-09-18
* Created configuration options to setup `_security` roles when user databases are created
* Improved tests and updated PouchDB.

## v0.2.0 - 2015-09-13
* Added client `access_token` strategies to support OAuth2 flows from Cordova, PhoneGap, and native apps

## v0.1.0 - 2015-09-10
* The intense power of SuperLogin is unleashed on a world that may not be ready! Tested with Node.js 0.12.7 and 4.0.0
