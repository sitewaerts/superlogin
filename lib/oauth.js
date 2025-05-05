'use strict';
const fs = require('fs');
const path = require('path');
const ejs  = require('ejs');
const jsonwebtoken = require('jsonwebtoken');

const util = require('./util');

const stateRequired = ['google', 'linkedin'];

module.exports = function(router, passport, user, config) {

  // TODO: persist via redis, filesystem, etc.
  // TODO: destroy channels after 1 hour

    /**
     *
     * @type {Record<string, Channel>}
     * @private
     */
  const _channels = {};

  const SESSION_KEY = 'superlogin:ec';

  /**
   * @deprecated
   * @constructor
   */
  function Channel(){
    this.expires = new Date().getTime() + 60 * 60 * 1000;
    this.id = "ec:" + util.URLSafeUUID();
    _channels[this.id] = this;
    this.secret = util.URLSafeUUID();
    this.cbu = null;
    this.event = null;
    let _handler = null;

    /**
     * sessions are required anyway by OIDC
     */
    this.linkSession = function(session){
      session[SESSION_KEY] = this.id
    }

    this.setCallbackUrl = function(cbu){
      this.cbu = cbu;
    }

    const _delete = ()=>{
      delete _channels[this.id];
    }

    this.setEvent = function(event){
      if(!event)
        throw new Error('missing event');
      event.channelId = this.id;
      delete event.callback;

      if(_handler)
      {
        _delete()
        _handler(event);
      }
      else
      {
        this.event = event;
      }
    }

    this.waitForEvent = function(handler){
      if(_handler){
        _handler(null);
        _handler = null;
      }
      if(this.event)
      {
        _delete();
        _handler(this.event)
      }
      else
        _handler = handler;

      return ()=>{
        if(_handler === handler)
          _handler = null;
      }
    }

    this.destroy = function(){
      _delete();
      if(_handler)
        _handler(null);
    }
  }

  Channel.get=function(req){
    return _channels[req.session[SESSION_KEY]];
  }

  /**
   * create channel and secret
   */
  router.post('/oauth/events/channel', function(req, res, next){
    const c = new Channel();
    res.status(200).json({id: c.id, secret: c.secret});
  });

  /**
   * destroy channel silently
   */
  router.delete('/oauth/events/channel/:channelId', function(req, res, next){
    const channelId = req.params['channelId'];
    const c = _channels[channelId];
    if(c)
    {
      if(req.headers.authorization === 'Bearer ' + c.secret)
        c.destroy();
    }
    res.sendStatus(200);
  });

  /**
   * get event from channel
   */
  router.get('/oauth/events/channel/:channelId', function(req, res, next){
    const channelId = req.params['channelId'];
    const c = _channels[channelId];
    if(!c)
      return res.sendStatus(404);

    if(req.headers.authorization !== 'Bearer ' + c.secret)
      return res.sendStatus(404);

    let remover = c.waitForEvent((event)=>{
      if(!remover)
        return;
      remover = null;
      if(event)
      res.status(200).json(event);
      else
        res.sendStatus(200);
    });
    setTimeout(()=>{
      if(!remover)
        return;
      remover();
      remover = null;
      res.sendStatus(200);

    }, 25000)
  });

  // Function to initialize a session following authentication from a oAuth provider
  function initSession(req, res, next) {
    const provider = getProvider(req.path);
    return user.createSession(req.user._id, provider, req)
      .then(function(mySession) {
        return Promise.resolve({
          error: null,
          auth: {token: mySession.token, password: mySession.password},
          link: null
        });
      })
      .then(function (event) {
          const c = Channel.get(req);
          if(c)
            c.setEvent(event);
          let callbackUrl = getPublishRedirectURL(provider, req, event);
          res.redirect(callbackUrl);
      })
      .catch(function (err) {
        return next(err);
      });
  }

  // Function to publish a session|error|link following authentication from a oAuth provider
  function publishOAuthEvent(req, res, next) {
    const event = JSON.parse(req.query['token']);
    event.jsCallback = event.jsCallback || false; // avoid ' jsCallback is not defined' when parsing template
    event.error = event.error || null; // avoid ' error is not defined' when parsing template
    event.auth = event.auth || null; // avoid ' auth is not defined' when parsing template
    event.link = event.link || null; // avoid ' link is not defined' when parsing template

    if(!event.auth && !event.link && !event.error)
      event.error = "OAuth provider login failed but the provider didn't deliver an error message.";

    if(event.error)
      console.error("OAuth failed", event, req.query);


    let template;
    if(config.getItem('testMode.oauthTest'))
      template = fs.readFileSync(path.join(__dirname, '../templates/oauth/auth-callback-test.ejs'), 'utf8');
    else
      template = fs.readFileSync(path.join(__dirname, '../templates/oauth/auth-callback.ejs'), 'utf8');

    const html = ejs.render(template, event);
    res.status(event.error ? 400 : 200).send(html);
  }

  // Function to initialize a session following authentication from a socialAuth provider
  function initTokenSession(req, res, next) {
    const provider = getProviderToken(req.path);
    return user.createSession(req.user._id, provider, req)
      .then(function(mySession) {
        return Promise.resolve(mySession);
      })
      .then(function (session) {
        session.delivered = Date.now();
        res.status(200).json(session);
      }, function (err) {
        return next(err);
      });
  }

  // Called after an account has been successfully linked
  function linkSuccess(req, res) {
    const provider = getProvider(req.path);
    const event = {
      error: null,
      auth: null,
      link: provider
    };
    const c = Channel.get(req);
    if(c)
          c.setEvent(event);
      let callbackUrl = getPublishRedirectURL(provider, req, event);
      res.redirect(callbackUrl);
  }

  // Called after an account has been successfully linked using access_token provider
  function linkTokenSuccess(req, res) {
    const provider = getProviderToken(req.path);
    res.status(200).json({
      ok: true,
      success: util.capitalizeFirstLetter(provider) + ' successfully linked',
      provider: provider
    });
  }

  // Handles errors if authentication fails
  function oauthErrorHandler(err, req, res, next) {
    console.error("oAuth error", err);
    if(err.stack)
    {
      console.error("oAuth error stack", err.stack);
      delete err.stack;
    }

    const provider = getProvider(req.path);
    const event = {
      error: err.message || JSON.stringify(err),
      auth: null,
      link: null
    };

      const c = Channel.get(req);
      if(c)
          c.setEvent(event);
      let callbackUrl = getPublishRedirectURL(provider, req, event);
      res.redirect(callbackUrl);
  }

  // Handles errors if authentication from access_token provider fails
  function tokenAuthErrorHandler(err, req, res, next) {
    var status;
    if(req.user && req.user._id) {
      status = 403;
    } else {
      status = 401;
    }
    console.error("token auth error", err);
    if(err.stack) {
      console.error("token auth error stack", err.stack);
      delete err.stack;
    }
    res.status(status).json(err);
  }

  function generalAuthErrorHandler(err, req, res, next)
  {
    // force error response in json format, not just a string to avoid client side exceptions when parsing response
    // see https://stackoverflow.com/a/34699181/4094951
    const output = {
      error: {
        name: err.name,
        message: err.message,
        text: err.toString()
      }
    };
    console.error("error in auth handling", err);
    res.status(err.status || 500).json(output);
  }

  // Framework to register OAuth providers with passport
  function registerProvider(provider, configFunction) {
    provider = provider.toLowerCase();
    var configRef = 'providers.' + provider;
    if (config.getItem(configRef + '.credentials')) {
      var credentials = config.getItem(configRef + '.credentials');
      credentials.passReqToCallback = true;
      var options = config.getItem(configRef + '.options') || {};
      configFunction.call(null, credentials, passport, authHandler);
      router.get('/' + provider, passportCallback(provider, options, 'login'), oauthErrorHandler);
      router.get('/' + provider + '/callback', passportCallback(provider, options, 'login'), initSession, oauthErrorHandler);
      router.get('/' + provider + '/publish', publishOAuthEvent, generalAuthErrorHandler);
      if(!config.getItem('security.disableLinkAccounts')) {
        router.get('/link/' + provider, passport.authenticate('bearer', {session: false}), passportCallback(provider, options, 'link'), oauthErrorHandler);
        router.get('/link/' + provider + '/callback', passport.authenticate('bearer', {session: false}),
          passportCallback(provider, options, 'link'), linkSuccess, oauthErrorHandler);
      }
      console.log(provider + ' loaded.');
    }
  }

  // A shortcut to register OAuth2 providers that follow the exact accessToken, refreshToken pattern.
  function registerOAuth2 (providerName, Strategy) {
    registerProvider(providerName, function (credentials, passport, authHandler) {
      passport.use(providerName, new Strategy(credentials,
        function verify(req, accessToken, refreshToken, params, profile, done) {
        profile.provider = providerName;
          authHandler(req, providerName, {accessToken: accessToken, refreshToken: refreshToken}, profile)
            .then((result)=>{
              done(null, result)
            }, (error)=>{
              done(error, null);
            });
        }
      ));
    });
  }

  // Registers a provider that accepts an access_token directly from the client, skipping the popup window and callback
  // This is for supporting Cordova, native IOS and Android apps, as well as other devices
  function registerTokenProvider (providerName, Strategy) {
    providerName = providerName.toLowerCase();
    var configRef = 'providers.' + providerName;
    if (config.getItem(configRef + '.credentials')) {
      var credentials = config.getItem(configRef + '.credentials');
      credentials.passReqToCallback = true;
      var options = config.getItem(configRef + '.options') || {};
      // Configure the Passport Strategy
      passport.use(providerName + '-token', new Strategy(credentials,
          /**
           *
           * @param req
           * @param {string?} accessToken
           * @param {string?} refreshToken
           * @param {any} profile
           * @param {(error:any|null, result:any)=>void} done
           */
        function (req, accessToken, refreshToken, profile, done) {
          profile.provider = providerName;
          authHandler(req, providerName, {accessToken: accessToken, refreshToken: refreshToken}, profile)
              .then((result)=>{
                done(null, result)
              }, (error)=>{
                done(error, null);
              });
        }));
      router.post('/' + providerName + '/token', passportTokenCallback(providerName, options), initTokenSession, tokenAuthErrorHandler);
      if(!config.getItem('security.disableLinkAccounts')) {
        router.post('/link/' + providerName + '/token', passport.authenticate('bearer', {session: false}),
          passportTokenCallback(providerName, options), linkTokenSuccess, tokenAuthErrorHandler);
      }
      console.log(providerName + '-token loaded.');
    }
  }

  // This is called after a user has successfully authenticated with a provider
  // If a user is authenticated with a bearer token we will link an account, otherwise log in
  // auth is an object containing 'access_token' and optionally 'refresh_token'
  /**
   * @param {any} req
   * @param {string} provider
   * @param {{access_token?:string, refresh_token?:string}} auth
   * @param {{}} profile
   * @return {Promise<{}>}
   */
  function authHandler(req, provider, auth, profile) {
    if(req.user && req.user._id && req.user.key) {
      return user.linkSocial(req.user._id, provider, auth, profile, req);
    } else {
      return user.socialAuth(provider, auth, profile, req);
    }
  }

  // TODO: validate given url, otherwise this pattern would be very unsecure
  // Windows: see https://docs.microsoft.com/en-us/windows/uwp/security/web-authentication-broker
  // Windows: see https://docs.microsoft.com/en-us/uwp/api/windows.security.authentication.web.webauthenticationbroker.getcurrentapplicationcallbackuri
  // Windows: SSO capable callback uri:  ms-app://<appSID>
  // Idea for generic/dynamic validation to avoid explicit white listing:
  // - allow certain url schema only (ms-app)
  // - check if app id in url matches app id in req.userAgent (won't work in web-authentication-broker-window)
  // - check if app-id in url matches app id in oauth config (requires explicit white listing)
  // - pass validator in via oauth config which checks if app-id is known by the backend (best solution)
  function isValidCustomCallbackUri(uri)
  {
    if (uri.startsWith('ms-app://'))
      return true; // generic Windows App callback uri

    // accept schemes that look like "de.cleverdox.demo[.xx.xx.xx]://"
    if(/^[a-z]{2,}\.[a-z]{2,}\.[a-z]{2,}[a-z.]*:\/\/$/.test(uri))
      return true;

    // accept cdx skin login redirect uri
    return /^https:\/\/[^/]+\/app\/main\/adl\/[a-z0-9]{2,}\/login$/.test(uri);

    // TODO accept white listed schemes for iOS and Android
  }

  // Configures the passport.authenticate for the given provider, passing in options
  // Operation is 'login' or 'link'
  /**
   *
   * @param {string} provider
   * @param {{}} options
   * @param {'login' | 'link'} operation
   * @return {(req:any, res:any, next:()=>void)=>void}
   */
  function passportCallback(provider, options, operation) {
    return function(req, res, next) {
      const theOptions = Object.assign({}, options);
      theOptions.failWithError = true;
      if(provider === 'linkedin') {
        theOptions.state = true;
      }
      const accessToken = req.query['bearer_token'] || req.query['state'];

      if(operation === 'login' && (!accessToken)){
        // initial request to oAuth provider login

        const ec = req.query['ec'];
        if(ec) {
          // deprecated feature for client side event listener for server side login event
          if(!_channels[ec])
            throw new Error("unknown event channel " + ec);
          _channels[ec].linkSession(req.session);

          const cbu = req.query['redirect_uri'] || req.query['cbu'];
          if(cbu)
          {
            if(!isValidCustomCallbackUri(cbu))
              throw new Error('invalid callback url: ' + cbu);
            _channels[ec].setCallbackUrl(cbu);
          }
        }
        else {
          const cbu = req.query['redirect_uri'] || req.query['cbu'];
          if(cbu)
          {
            // custom callback uri provided without a channel
            if(!isValidCustomCallbackUri(cbu))
              throw new Error('invalid callback url: ' + cbu);
            req.session.customRedirectUrl = cbu;
          }
        }
      }

      if(accessToken && (stateRequired.indexOf(provider) > -1 || config.getItem('providers.' + provider + '.stateRequired') === true)) {
        // add state to options, not to query of callback url as the query must be static
        // see https://stackoverflow.com/questions/55524480/should-dynamic-query-parameters-be-present-in-the-redirection-uri-for-an-oauth2
        theOptions.state = accessToken;
      }
      theOptions.callbackURL = getLinkCallbackURLs(provider, req, operation, accessToken);
      theOptions.session = false;
      theOptions.failWithError= true;
      passport.authenticate(provider, theOptions)(req, res, next);
    };
  }

  // Configures the passport.authenticate for the given access_token provider, passing in options
  function passportTokenCallback(provider, options) {
    return function(req, res, next) {
      var theOptions = Object.assign({}, options);
      theOptions.session = false;
      passport.authenticate(provider + '-token', theOptions)(req, res, next);
    };
  }

  function getLinkCallbackURLs(provider, req, operation, accessToken) {
    if(accessToken)
      accessToken = encodeURIComponent(accessToken);

    let reqUrl;

    //TODO: check req.session.customerRedirectUrl

    const protocol = (req.get('X-Forwarded-Proto') || req.protocol) + '://';
    if(operation === 'login') {
      reqUrl = protocol + req.get('host') + req.baseUrl + '/' + provider + '/callback';
    }
    else if(operation === 'link') {
      if(accessToken && (stateRequired.indexOf(provider) > -1 || config.getItem('providers.' + provider + '.stateRequired') === true)) {
        reqUrl = protocol + req.get('host') + req.baseUrl + '/link/' + provider + '/callback';
      } else {
        reqUrl = protocol + req.get('host') + req.baseUrl + '/link/' + provider + '/callback?state=' + accessToken;
      }
    }
    return reqUrl;
  }

  function getPublishRedirectURL(provider, req, event)
  {
    let reqUrl, jsCallback;
    const c = Channel.get(req);
    if (c){
      reqUrl = c.cbu;
      jsCallback = false;
    }
    else if (req.session.customRedirectUrl){
      reqUrl = req.session.customRedirectUrl;
      delete req.session.customRedirectUrl;
      jsCallback = false;
    }
    else
    {
      reqUrl = ((req.get('X-Forwarded-Proto') || req.protocol) + '://') + req.get('host') + req.baseUrl + '/' + provider + '/publish';
      jsCallback = true;
    }


    if(reqUrl.indexOf('?') >=0)
      reqUrl = reqUrl + "&";
    else
      reqUrl = reqUrl + "?";

    return reqUrl + 'token=' + encodeURIComponent(JSON.stringify({error: event.error, auth: event.auth, link: event.link, jsCallback: jsCallback}));
  }

  /**
   * Gets the provider name from a callback or publish path
   * @return string
   */
  function getProvider(pathname) {
    const items = pathname.split('/');
    let index = items.indexOf('callback');
    if(index > 0) {
      return items[index-1];
    }
    index = items.indexOf('publish');
    if(index > 0) {
      return items[index-1];
    }
  }

  /**
   * Gets the provider name from a callback path for access_token strategy
   * @return string
   */
  function getProviderToken(pathname) {
    const items = pathname.split('/');
    const index = items.indexOf('token');
    if(index > 0) {
      return items[index-1];
    }
  }

  return {
    registerProvider: registerProvider,
    registerOAuth2: registerOAuth2,
    registerTokenProvider: registerTokenProvider
  };

};
