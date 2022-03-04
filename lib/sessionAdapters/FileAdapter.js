const fs = require('fs-extra');
const path = require('path');
const sanitize = require("sanitize-filename");

function FileAdapter(config) {
  const sessionsRoot = config.getItem('session.file.sessionsRoot');
  this._sessionFolder = path.join(process.cwd(), sessionsRoot);
  console.warn('Session File Adapter loaded. This is not for productive usage due to concurrency and performance issues!', this._sessionFolder);
  fs.mkdirs(this._sessionFolder);
}

module.exports = FileAdapter;

FileAdapter.prototype._getFilepath = function(key) {
  return path.format({
    dir: this._sessionFolder,
    base: sanitize(key) + '.json'
  });
};


/**
 *
 * @type {Record<string, Promise<void>>}
 * @private
 */
const _fileAccessors = {};

/**
 *
 * @param {string} key
 * @param {number} life
 * @param {string} data
 * @return {Promise<void>}
 */
FileAdapter.prototype.storeKey = function(key, life, data) {
    const fa = _fileAccessors[key] = _fileAccessors[key] || Promise.resolve();
    const result = fa.then( () => {
        const now = Date.now();
        return fs.writeJson(this._getFilepath(key), {
            data: data,
            expire: now + life
        });
    }).then(()=>{});
    _fileAccessors[key] = result.then(()=>{}, (error)=>{
        console.error("cannot storeKey", error);
    }); // catch errors
    return result;
};

/**
 * @param {string} key
 * @return {Promise<string>}
 */
FileAdapter.prototype.getKey = async (key) => {
    const fa = _fileAccessors[key] = _fileAccessors[key] || Promise.resolve();
    const result = fa.then(()=>{
        const now = Date.now();
        return fs.readJson(this._getFilepath(key))
            .then((data) => {
                if (data.expire > now) {
                    return data.data;
                }
                console.warn('removing expired session file', key)
                return this.deleteKeys([key])
                    .then(()=>{
                        return null;
                    })
            })
            .catch((e)=> {
                console.error('FileAdapter: cannot read session from file', e, key)
                return null;
            });
    });
    _fileAccessors[key] = result.then(()=>{}, (error)=>{
        console.error("cannot getKey", error);
    }); // catch errors
    return result;
};

FileAdapter.prototype.deleteKeys = function(keys) {
  if(!(keys instanceof Array)) {
    keys = [keys];
  }
  var self = this;
  var deleteQueue = keys.map((key) =>{
    return fs.remove(self._getFilepath(key));
  });

  return Promise.all(deleteQueue).then((done)=> {
    // this._removeExpired();
    return done.length;
  });
};

FileAdapter.prototype.quit = function() {
  return Promise.resolve();
};

FileAdapter.prototype._removeExpired = function () {
  // open all files and check session expire date
};
