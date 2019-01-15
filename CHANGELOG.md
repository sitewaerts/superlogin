# CHANGELOG

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
