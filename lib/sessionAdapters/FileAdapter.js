const BPromise = require('bluebird');
const fs = require('fs-extra');
const path = require('path');
const sanitize = require("sanitize-filename");

function FileAdapter(config) {
  var sessionsRoot = config.getItem('session.file.sessionsRoot');
  this._sessionFolder = path.join(process.cwd(), sessionsRoot);
  console.log('File Adapter loaded', this._sessionFolder);
}

module.exports = FileAdapter;

FileAdapter.prototype._getFilepath = function(key) {
  return path.format({
    dir: this._sessionFolder,
    base: sanitize(key) + '.json'
  });
};

FileAdapter.prototype.storeKey = function(key, life, data) {
  var now = Date.now();
  return fs.outputJson(this._getFilepath(key), {
      data: data,
      expire: now + life
    });
};

/**
 * @param {string} key
 * @return {Promise<string>}
 */

FileAdapter.prototype.getKey = function(key) {
  var now = Date.now();
  return fs.readJson(this._getFilepath(key))
    .then(function (data) {
      if (data.expire > now) {
        return data.data;
      }
      return this.deleteKeys([key])
          .then(function(){
            return false;
          })
    })
    .catch(function () {
      return false;
    });
};

FileAdapter.prototype.deleteKeys = function(keys) {
  if(!(keys instanceof Array)) {
    keys = [keys];
  }
  var self = this;
  var deleteQueue = keys.map(function(key) {
    return fs.remove(self._getFilepath(key));
  });

  return BPromise.all(deleteQueue).then(function (done) {
    // this._removeExpired();
    return done.length;
  });
};

FileAdapter.prototype.quit = function() {
  return BPromise.resolve();
};

FileAdapter.prototype._removeExpired = function () {
  // open all files and check session expire date
};
