function MemoryAdapter() {
  this._keys = {};
  this._expires = {};
  console.warn('Session Memory Adapter loaded. This is not for productive usage due to security and performance issues!');
}

module.exports = MemoryAdapter;

/**
 *
 * @param {string} key
 * @param {number} life
 * @param {string} data
 * @return {Promise<void>}
 */
MemoryAdapter.prototype.storeKey = function(key, life, data) {
  const now = Date.now();
  this._keys[key] = data;
  this._expires[key] = now + life;
  this._removeExpired();
  return Promise.resolve();
};

/**
 * @param {string} key
 * @return {Promise<string>}
 */
MemoryAdapter.prototype.getKey = function(key) {
  const now = Date.now();
  if(this._keys[key] && this._expires[key] > now) {
    return Promise.resolve(this._keys[key]);
  } else {
    this.deleteKeys([key]).catch((error)=>{console.error("Memory Adapter: cannot delete keys", error);});
    return Promise.resolve(null);
  }
};

MemoryAdapter.prototype.deleteKeys = function(keys) {
  if(!(keys instanceof Array)) {
    keys = [keys];
  }
  const self = this;
  keys.forEach(function(key) {
    delete self._keys[key];
    delete self._expires[key];
  });
  this._removeExpired();
  return Promise.resolve(keys.length);
};

MemoryAdapter.prototype.quit = function() {
  return Promise.resolve();
};

MemoryAdapter.prototype._removeExpired = function () {
  const now = Date.now();
  const self = this;
  Object.keys(this._expires).forEach(function(key) {
    if(self._expires[key] < now) {
      delete self._keys[key];
      delete self._expires[key];
    }
  });
};
