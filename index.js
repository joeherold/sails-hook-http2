
const spdy = require('spdy')
const path = require('path')
const fs = require('fs')
var _ = require('lodash');


module.exports = function http2(sails) {


  var spdyServerOptions = {

    // Private key
    // key: fs.readFileSync(path.join(__dirname, '/keys/server.key')),
    //
    // // Fullchain file or cert file (prefer the former)
    // cert: fs.readFileSync(path.join(__dirname + '/keys/server.crt')),

    // **optional** SPDY-specific options
    spdy: {
      protocols: ['h2', 'spdy/3.1', 'http/1.1'],
      plain: false,

      // **optional**
      // Parse first incoming X_FORWARDED_FOR frame and put it to the
      // headers of every request.
      // NOTE: Use with care! This should not be used without some proxy that
      // will *always* send X_FORWARDED_FOR
      'x-forwarded-for': true,

      connection: {
        windowSize: 1024 * 1024, // Server's window size

        // **optional** if true - server will send 3.1 frames on 3.0 *plain* spdy
        autoSpdy31: false
      }
    }
  };

  return {
    defaults: {},
    configure: function () {
    },
    initialize: function (cb) {
      var self = this;


      sails.after("hook:http:loaded", function () {


        var isUsingSSL =
          (sails.config.ssl === true) ||
          (sails.config.ssl.key && sails.config.ssl.cert) ||
          sails.config.ssl.pfx;

        var useHttp2 = sails.config.ssl.http2 === true || false;

        if (isUsingSSL && useHttp2) {

          //sails.log.info("shutting down https1.1 server");


          sails.hooks.http.destroy();

          sails.log.info("configure HTTP/2 (spdy) server");


          // Merge SSL into server options
          var serverOptions = sails.config.http.serverOptions || {};
          
          // Merge HTTP/2 options
          var httpOpts = sails.config.ssl.http2 || {};
          _.extend(spdyServerOptions, {spdy: httpOpts})

          _.extend(serverOptions, sails.config.ssl);
          _.extend(serverOptions, spdyServerOptions);

          

          // Lodash 3's _.merge attempts to transform buffers into arrays;
          // so if we detect an array, then transform it back into a buffer.
          _.each(['key', 'cert', 'pfx'], function _eachSSLOption(sslOption) {
            if (_.isArray(serverOptions[sslOption])) {
              serverOptions[sslOption] = new Buffer(serverOptions[sslOption]);
            }
          });

          

          // Use serverOptions if they were specified
          // Manually create http server using Express app instance
          if (sails.config.http.serverOptions || isUsingSSL) {
            sails.hooks.http.server = spdy.createServer(serverOptions, sails.hooks.http.app);
          }
          else {
            sails.hooks.http.server = spdy.createServer(spdyServerOptions, sails.hooks.http.app);
          }


          // Keep track of all openTcpConnections that come in,
          // so we can destroy them later if we want to.
          var openTcpConnections = {};

          // Listen for `connection` events on the raw HTTP server.
          sails.hooks.http.server.on('connection', function _onNewTCPConnection(tcpConnection) {
            var key = tcpConnection.remoteAddress + ':' + tcpConnection.remotePort;
            openTcpConnections[key] = tcpConnection;
            tcpConnection.on('close', function () {
              delete openTcpConnections[key];
            });
          });

          // Create a `destroy` method we can use to do a hard shutdown of the server.
          sails.hooks.http.destroy = function (done) {
            sails.log.verbose('Destroying http server...');
            sails.hooks.http.server.close(done);
            // TODO: consider moving this loop ABOVE sails.hooks.http.server.close(done) for clarity (since at this point we've passed control via `done`)
            for (var key in openTcpConnections) {
              openTcpConnections[key].destroy();
            }
          };

          //
          //sails.log.info("bootinng https 2 socket service");
          sails.on("lifted", function(){
            sails.log.info("reconfigured sockets for HTTP/2");
            sails.log.info("webserer running on protocol HTTP/2 (spdf)");
          })
          return sails.hooks.sockets.initialize(cb);

        } else {
          cb();
        }


      })

    }
  };


}
