'use strict';
const util = require('./util');
const YAML = require('yamljs');

module.exports = function (config, router, passport, superlogin, user)
{

    const env = process.env.NODE_ENV || 'development';

    router.use(passport.initialize());

    function buildRedirect(req, auth, error)
    {
        let reqUrl = req.body['redirect_uri'];
        if (auth)
            reqUrl = reqUrl || req.body['redirect_uri_success'];
        if (error)
            reqUrl = reqUrl || req.body['redirect_uri_error'];
        if (!reqUrl)
            return null;
        if (reqUrl.indexOf('#') > 0)
            reqUrl = reqUrl.substring(0, reqUrl.indexOf('#'));
        if (reqUrl.indexOf('?') >= 0)
            reqUrl = reqUrl + "&";
        else
            reqUrl = reqUrl + "?";

        reqUrl = reqUrl + 'token=' + encodeURIComponent(JSON.stringify({auth: auth, error: error}));
        return reqUrl;
    }

    function getCookiePath(req)
    {
        const baseUrlComponents = req.baseUrl.split('/');
        baseUrlComponents.pop();
        baseUrlComponents.push('local-login'); // HACK
        return baseUrlComponents.join('/');
    }

    router.post('/login', function (req, res, next)
    {
        passport.authenticate('local', function (err, user, info)
        {
            if (err)
            {
                console.error("cannot passport.authenticate", err);
                const redirect = buildRedirect(req, null, err);
                if (redirect)
                    return res.status(302).redirect(redirect);
                else
                    return next(err);
            }
            if (!user)
            {
                // Authentication failed
                console.error('login 401', info)
                const redirect = buildRedirect(req, null, {message: 'login 401', info: info});
                if (redirect)
                {
                    res.clearCookie('localAuth', {secure: true, path: getCookiePath(req)});
                    return res.status(302).redirect(redirect);
                }
                else
                    return res.status(401).json(info);
            }
            // Success
            req.logIn(user, {session: false}, function (err)
            {
                if (err)
                {
                    console.error("cannot login", err);
                    const redirect = buildRedirect(req, null, err);
                    if (redirect)
                        return res.status(302).redirect(redirect);
                    else
                        return next(err);
                }
            });
            return next();
        })(req, res, next);
    }, function (req, res, next)
    {
        // Success handler
        return superlogin.createSession(req.user._id, 'local', req)
            .then(function (mySession)
            {
                const auth = {
                    token: mySession.token,
                    password: mySession.password,
                    expires: mySession.expires,
                    ends: mySession.ends,
                    user_id: mySession.user_id
                };
                const redirect = buildRedirect(req, auth, null);
                if (redirect)
                {
                    res.cookie('localAuth',
                        JSON.stringify(auth),
                        {
                            expires: new Date(mySession.expires),
                            secure: true,
                            path: getCookiePath(req)
                        }
                    )
                    res.status(302).redirect(redirect);
                }
                else
                {
                    mySession.delivered = Date.now();
                    res.status(200).json(mySession);
                }
            }).catch(function (err)
            {
                console.error("cannot create session", err);
                const redirect = buildRedirect(req, null, err);
                if (redirect)
                    return res.status(302).redirect(redirect);
                else
                    return next(err);
            });
    });

    router.post('/refresh',
        passport.authenticate('bearer', {session: false}),
        function (req, res, next)
        {
            return user.refreshSession(req.user.key)
                .then(function (mySession)
                {
                    mySession.delivered = Date.now();
                    res.status(200).json(mySession);
                }).catch(function (err)
                {
                    console.error('refresh failed', err);
                    // force session invalidation at client
                    return next({
                        error: 'session invalid',
                        status: 400
                    });
                });
        });

    router.post('/logout',
        function (req, res, next)
        {
            const sessionToken = util.getSessionToken(req);
            if (!sessionToken)
            {
                return next({
                    error: 'unauthorized',
                    status: 401
                });
            }
            superlogin.logoutSession(sessionToken)
                .then(function ()
                {
                    res.status(200).json({ok: true, success: 'Logged out'});
                }).catch(function (err)
            {
                console.error('Logout failed');
                return next(err);
            });
        });

    router.post('/logout-others',
        passport.authenticate('bearer', {session: false}),
        function (req, res, next)
        {
            superlogin.logoutOthers(req.user.key)
                .then(function ()
                {
                    res.status(200).json({success: 'Other sessions logged out'});
                }, function (err)
                {
                    console.error('Logout failed');
                    return next(err);
                });
        });

    router.post('/logout-all',
        function (req, res, next)
        {
            const sessionToken = util.getSessionToken(req);
            if (!sessionToken)
            {
                return next({
                    error: 'unauthorized',
                    status: 401
                });
            }
            superlogin.logoutUser(null, sessionToken)
                .then(function ()
                {
                    res.status(200).json({success: 'Logged out'});
                }, function (err)
                {
                    console.error('Logout-all failed');
                    return next(err);
                });
        });

    // Setting up the auth api
    router.post('/register', function (req, res, next)
    {
        superlogin.createUser(req.body, req)
            .then(function (newUser)
            {
                if (config.getItem('security.loginOnRegistration'))
                {
                    return user.createSession(newUser._id, 'local', req.ip)
                        .then(function (mySession)
                        {
                            mySession.delivered = Date.now();
                            res.status(200).json(mySession);
                        }, function (err)
                        {
                            return next(err);
                        });
                }
                else
                {
                    res.status(201).json({success: 'User created.'});
                }
            }, function (err)
            {
                return next(err);
            });
    });

    router.post('/forgot-password', function (req, res, next)
    {
        superlogin.forgotPassword(req.body.email, req).then(function ()
        {
            res.status(200).json({success: 'Password recovery email sent.'});
        }, function (err)
        {
            return next(err);
        });
    });

    router.post('/password-reset', function (req, res, next)
    {
        superlogin.resetPassword(req.body, req)
            .then(function (currentUser)
            {
                if (config.getItem('security.loginOnPasswordReset'))
                {
                    return user.createSession(currentUser._id, 'local', req.ip)
                        .then(function (mySession)
                        {
                            res.status(200).json(mySession);
                        }, function (err)
                        {
                            return next(err);
                        });
                }
                else
                {
                    res.status(200).json({success: 'Password successfully reset.'});
                }
            }, function (err)
            {
                return next(err);
            });
    });

    router.post('/password-change',
        passport.authenticate('bearer', {session: false}),
        function (req, res, next)
        {
            user.changePasswordSecure(req.user._id, req.body, req)
                .then(function ()
                {
                    res.status(200).json({success: 'password changed'});
                }, function (err)
                {
                    return next(err);
                });
        });

    router.post('/unlink/:provider',
        passport.authenticate('bearer', {session: false}),
        function (req, res, next)
        {
            const provider = req.params.provider;
            user.unlink(req.user._id, provider)
                .then(function ()
                {
                    res.status(200).json({success: util.capitalizeFirstLetter(provider) + ' unlinked'});
                }, function (err)
                {
                    return next(err);
                });
        });

    router.get('/confirm-email/:token', function (req, res, next)
    {
        const redirectURL = config.getItem('local.confirmEmailRedirectURL');
        if (!req.params.token)
        {
            const err = {error: 'Email verification token required'};
            if (redirectURL)
            {
                return res.status(201).redirect(redirectURL + '?error=' + encodeURIComponent(err.error));
            }
            return res.status(400).send(err);
        }
        superlogin.verifyEmail(req.params.token, req).then(function ()
        {
            if (redirectURL)
            {
                return res.status(201).redirect(redirectURL + '?success=true');
            }
            res.status(200).send({ok: true, success: 'Email verified'});
        }, function (err)
        {
            if (redirectURL)
            {
                let query = '?error=' + encodeURIComponent(err.error);
                if (err.message)
                {
                    query += '&message=' + encodeURIComponent(err.message);
                }
                return res.status(201).redirect(redirectURL + query);
            }
            return next(err);
        });
    });

    router.get('/validate-username/:username',
        function (req, res, next)
        {
            if (!req.params.username)
            {
                return next({error: 'Username required', status: 400});
            }
            superlogin.validateUsername(req.params.username)
                .then(function (err)
                {
                    if (!err)
                    {
                        res.status(200).json({ok: true});
                    }
                    else
                    {
                        res.status(409).json({error: 'Username ' + err, cause: err});
                    }
                }, function (err)
                {
                    return next(err);
                });
        }
    );

    router.get('/validate-email/:email',
        function (req, res, next)
        {
            let promise;
            if (!req.params.email)
            {
                return next({error: 'Email required', status: 400});
            }
            if (config.getItem('local.emailUsername'))
            {
                promise = superlogin.validateEmailUsername(req.params.email);
            }
            else
            {
                promise = superlogin.validateEmail(req.params.email);
            }
            promise
                .then(function (err)
                {
                    if (!err)
                    {
                        res.status(200).json({ok: true});
                    }
                    else
                    {
                        res.status(409).json({error: 'Email ' + err, cause: err});
                    }
                }, function (err)
                {
                    return next(err);
                });
        }
    );

    router.post('/change-email',
        passport.authenticate('bearer', {session: false}),
        function (req, res, next)
        {
            superlogin.changeEmail(req.user._id, req.body.newEmail, req)
                .then(function ()
                {
                    res.status(200).json({ok: true, success: 'Email changed'});
                }, function (err)
                {
                    return next(err);
                });
        });

    // route to test token authentication
    router.get('/session',
        passport.authenticate('bearer', {session: false, failWithError: true}),
        function (req, res, next)
        {
            return user.syncSessionRoles(req.user.key)
                .then(function (mySession)
                {
                    mySession.delivered = Date.now();
                    res.status(200).json(mySession);
                })
                .catch(function (err)
                {
                    console.error("/session: session loading failed", err);
                    return next(err);
                });
        },
        function (err, req, res)
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
            console.error("error in /session", output);
            res.status(err.status || 500).json(output);
        }
    );

    router.get('/profile',
        function (req, res, next)
        {
            //console.log("profile requested");
            passport.authenticate('bearer', {session: false, failWithError: true})(req, res, next)
        },

        function (req, res, next)
        {

            function _error(err)
            {
                console.error("cannot load profile", err);
                next(err);
            }

            try
            {
                const user_id = req.user._id;
                superlogin.getUser(user_id).then(function (userDoc)
                {
                    if (!userDoc)
                    {
                        res.sendStatus(404);
                        res.json({message: 'not found'});
                        return;
                    }
                    res.status(200);

                    const profile = {};
                    profile._id = userDoc._id;
                    profile.name = userDoc.name;
                    profile.email = userDoc.email;
                    profile.providers = userDoc.providers;
                    profile.providerProfiles = {};
                    const allRoles = user.getAllRolesFromUserDoc(userDoc);
                    userDoc.providers.forEach(function (provider)
                    {
                        const providerData = userDoc[provider];
                        if (providerData)
                        {
                            profile.providerProfiles[provider] = YAML.stringify(providerData.profile);
                            if (provider !== 'local')
                                profile[provider] = YAML.stringify(providerData.profile._json);
                        }
                    });
                    // Make a list
                    const providerConfig = superlogin.config.getItem('providers');
                    profile.allProviders = providerConfig ? Object.keys(providerConfig) : [];
                    profile.sessions = 0;
                    if (userDoc.session)
                        profile.sessions = Object.keys(userDoc.session).length;

                    profile.allRoles = allRoles;
                    profile.roles = {};
                    for (let i = 0; i < allRoles.length; i++)
                        profile.roles[allRoles[i]] = true;

                    res.json(profile);
                }).catch(_error);
            } catch (err)
            {
                _error(err);
            }
        },
        function (err, req, res)
        {
            // force error response in json format, not just a string to avoid client side exceptions when parsing response
            // see https://stackoverflow.com/a/34699181/4094951
            res.status(err.status || 500).json({
                error: {
                    name: err.name,
                    message: err.message,
                    text: err.toString()
                }
            });
        }
    );


    // Error handling
    router.use(function (err, req, res, next)
    {
        try
        {
            console.error(err);
            if (err.stack)
            {
                console.error(err.stack);
            }
            res.status(err.status || 500);
            if (err.stack && env !== 'development')
            {
                delete err.stack;
            }
            res.json(err);
        } catch (e)
        {
            next(e);
        }
    });

};
