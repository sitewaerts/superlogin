const BPromise = require('bluebird');
const redis = BPromise.promisifyAll(require('redis'));

function RedisAdapter(config) {
  let redisClient;

  if(!config.getItem('session.redis.unix_socket')) {
    if(config.getItem('session.redis.url')) {
      redisClient = redis.createClient(config.getItem('session.redis.url'), config.getItem('session.redis.options'));
    } else {
      redisClient = redis.createClient(config.getItem('session.redis.port') || 6379,
        config.getItem('session.redis.host') || '127.0.0.1', config.getItem('session.redis.options'));
    }
  } else {
    redisClient = redis.createClient(config.getItem('session.redis.unix_socket'), config.getItem('session.redis.options'));
  }

  // Authenticate with Redis if necessary
  if(config.getItem('session.redis.password')) {
    redisClient.authAsync(config.getItem('session.redis.password'))
      .catch(function(error) {
        console.error("Session: Redis Adapter cannot init auth", error);
      });
  }

  redisClient.on('error', function (error) {
    console.error('Session: Redis Adapter error: ' + error);
  });

  redisClient.on('connect', function () {
    console.log('Session: Redis Adapter is ready');
  });

  this._redisClient = redisClient;
  console.log('Session: Redis Adapter loaded');
}

module.exports = RedisAdapter;

/**
 *
 * @param {string} key
 * @param {number} life
 * @param {string} data
 * @return {Promise<void>}
 */
RedisAdapter.prototype.storeKey = function(key, life, data) {
  return this._redisClient.psetexAsync(key, life, data);
};


/**
 * @param {string} key
 * @return {Promise<string>}
 */
RedisAdapter.prototype.getKey = function(key) {
  return this._redisClient.getAsync(key);
};

RedisAdapter.prototype.deleteKeys = function(keys) {
  return this._redisClient.delAsync(keys);
};

RedisAdapter.prototype.quit = function() {
  return this._redisClient.quit();
};
