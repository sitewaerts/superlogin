# CHANGELOG

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
