'use strict';

const Hapi = require('hapi');
const Path = require('path');
var querystring = require('querystring');
var req = require('request'); // "Request" library

const helpers = require('./utils/helpers');

const server = Hapi.server({
  port: 3000,
  host: 'localhost',
  routes: {
    files: {
      relativeTo: Path.join(__dirname, 'public')
    }
  }
});

var client_id = '089bab4924d5466f8d5e4fa92ebba037'; // Your client id
var client_secret = '05980c9105cb402692612d2cbdcf2322'; // Your secret
var redirect_uri = 'http://localhost:3000/callback'; // Your redirect uri

var stateKey = 'spotify_auth_state';

// server.route({
//   method: 'GET',
//   path: '/',
//   handler: (request, h) => {
//     return 'Hello, world!';
//   }
// });

server.state(stateKey, {
  ttl: null,
  isSecure: false,
  isHttpOnly: false,
  encoding: 'base64json',
  clearInvalid: false, // remove invalid cookies
  strictHeader: false, // don't allow violations of RFC 6265
});

server.route({
  method: 'GET',
  path: '/login',
  handler: function (request, h) {
    var state = helpers.generateRandomString(16);
    // Set cookie
    h.state(stateKey, state);

    // your application requests authorization
    var scope = 'user-read-private user-read-email';
    return h.redirect('https://accounts.spotify.com/authorize?' +
      querystring.stringify({
        response_type: 'code',
        client_id: client_id,
        scope: scope,
        redirect_uri: redirect_uri,
        state: state
      }));
  },
});

server.route({
  method: 'GET',
  path: '/callback',
  handler: function (request, h) {
    // your application requests refresh and access tokens
    // after checking the state parameter

    var code = request.query.code || null;
    var state = request.query.state || null;
    var storedState = request.state ? request.state[stateKey] : null;

    if (state === null || state !== storedState) {
      return h.redirect('/#' +
        querystring.stringify({
          error: 'state_mismatch'
        }));

    } else {

      // Clear cookie
      h.unstate(stateKey);

      var authOptions = {
        url: 'https://accounts.spotify.com/api/token',
        form: {
          code: code,
          redirect_uri: redirect_uri,
          grant_type: 'authorization_code'
        },
        headers: {
          'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
        },
        json: true
      };

      var promise = new Promise(function (resolve) {
        req.post(authOptions, function(error, response, body) {
          if (!error && response.statusCode === 200) {

            var access_token = body.access_token,
              refresh_token = body.refresh_token;

            var options = {
              url: 'https://api.spotify.com/v1/me',
              headers: { 'Authorization': 'Bearer ' + access_token },
              json: true
            };

            // use the access token to access the Spotify Web API
            req.get(options, function(error, response, body) {
              console.log(body);
            });

            // we can also pass the token to the browser to make requests from there
            // h.redirect returns a response body that needs to be returned at the end of the handler fn
            resolve(h.redirect('/#' +
              querystring.stringify({
                access_token: access_token,
                refresh_token: refresh_token
              })
            ));

          } else {
            return h.redirect('/#' +
              querystring.stringify({
                error: 'invalid_token'
              })
            );
          }
        })
      });

      // Each lifecycle method must return a value or a promise that resolves into a value.
      return promise;
    }
  }
});

server.route({
  method: 'GET',
  path: '/refresh_token',
  handler: function (request, h) {
    // requesting access token from refresh token
    var refresh_token = request.query.refresh_token;
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      headers: { 'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64')) },
      form: {
        grant_type: 'refresh_token',
        refresh_token: refresh_token
      },
      json: true
    };

    req.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {
        var access_token = body.access_token;
        h.send({
          'access_token': access_token
        });
      }
    });

  }
});

const start = async () => {

  await server.register([
    {
      plugin: require('hapi-pino'),
      options: {
        prettyPrint: true,
        logEvents: ['response']
      }
    },
    {
      plugin: require('inert'),
    }
  ]);

  server.route({
    method: 'GET',
    path: '/{param*}',
    handler: {
      directory: {
        path: '.',
        redirectToSlash: true,
        index: true,
      }
    }
  });

  await server.start();
  console.log(`Server running at: ${server.info.uri}`);
};

process.on('unhandledRejection', (err) => {
  console.log(err);
  process.exit(1);
});

start();
