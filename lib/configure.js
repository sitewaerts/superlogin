'use strict';
const util = require('./util');

module.exports = function(data, defaults) {

  this.config = data || {};
  this.defaults = defaults || {};

  this.getItem = function(key) {
    const result = util.getObjectRef(this.config, key);
    if(typeof result === 'undefined' || result === null) {
      return util.getObjectRef(this.defaults, key);
    }
    return result;
  };

  this.setItem = function(key, value) {
    return util.setObjectRef(this.config, key, value);
  };

  this.removeItem = function(key) {
    return util.delObjectRef(this.config, key);
  };

};
