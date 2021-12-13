const createClient = require('redis').createClient;

function RedisAdapter(config) {

  const redisOptions = config.getItem('session.redis') || {};
  const redisClient = createClient(redisOptions);

  redisClient.on('error', (error) => {
    console.error('Session: Redis Adapter error: ' + error);
  });

  redisClient.on('connect', () => {
    console.log('Session: Redis Adapter is ready');
  });

    this._redisClient = redisClient.connect()
        .then(()=>{
            console.log('Session: Redis Client connected');
            return redisClient;
        })
        .catch((error) => {
            console.error("Session: Redis Adapter cannot init", error);
        });
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
  return this._redisClient.then((redisClient)=>{
      return redisClient.sendCommand(['PSETEX', key, life + '', data])
  });
};


/**
 * @param {string} key
 * @return {Promise<string>}
 */
RedisAdapter.prototype.getKey = function(key) {
    return this._redisClient.then((redisClient)=>{
        return redisClient.get(key);
    });
};

RedisAdapter.prototype.deleteKeys = function(keys) {
    return this._redisClient.then((redisClient)=>{
        return redisClient.del(keys);
    });
};

RedisAdapter.prototype.quit = function() {
    return this._redisClient.then((redisClient)=>{
        return redisClient.quit();
    });
};
