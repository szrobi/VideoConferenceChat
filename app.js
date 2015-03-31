(function(require, JSON, process, __dirname) {
    "use strict";
    var express = require('express'),
            app = express(),
            http = require('http'),
            server = http.createServer(app),
            io = require('socket.io').listen(server),
            util = require('util'),
            memwatch = require('memwatch'),
            heapdump = require('heapdump'),
            env = process.env.NODE_ENV || 'development',
            config = require('./config.' + env),
            MessageRouter = require('./MessageRouter'),
            MqConnections = require('./MqConnections'),
            winston = require('winston'),
            FmsApi = require('./FmsApi'),
            fmsApi = FmsApi.create(config.fms);

    var hd = new memwatch.HeapDiff();

    winston.add(winston.transports.File, {filename: __dirname + '/logs/app.log'});

    memwatch.on('leak', function(info) {
        winston.info('Memora leak detected', info);
    });

    memwatch.on('stats', function(stats) {
        winston.info('Memoty stats', stats);
    });

    app.use('/static', express.static(__dirname + '/static'));

    app.use('/heapdiff', function(req, res) {
        res.send(hd.end());
        hd = new memwatch.HeapDiff();
    });

    app.use('/heapsnapshot', function(req, res) {
        var filename = __dirname + '/heapsnapshots/' + Date.now() + '.heapsnapshot';
        heapdump.writeSnapshot(filename);
        res.send('doing...');
    });

    app.get('/crossdomain.xml', function(req, res) {
        res.sendfile(__dirname + '/static/crossdomain.xml');
    });

    app.get('/index_new.html', function(req, res) {
        res.sendfile(__dirname + '/index_new.html');
    });

    app.get('/', function(req, res) {
        res.sendfile(__dirname + '/static/index.html');
    });

    server.listen(8200);

    io.configure('production', function() {
        io.enable('browser client etag');
        io.enable('browser client minification');
        io.set('log level', 1);
//        io.set('transports', ['websocket', 'flashsocket']);
    });
    io.configure('development', function() {
//        io.set('transports', ['websocket', 'flashsocket']);
    });

    // on client connection we do everything
    io.sockets.on('connection', function(socket) {
        var currentPerformerId,
                currentMessageType = MessageRouter.MessageTypes.GUEST,
                currentSessionId = socket.id,
                currentDisplayName = socket.id,
                currentChatMode,
                messageRouter = MessageRouter.create(MqConnections, config.mq);

        // connection lost
        socket.on('disconnect', function() {
            messageRouter.close();

            fmsApi.requestLeaveRoom(currentSessionId, currentPerformerId).then(function() {
                util.debug('FMS API notified about leaving the room');
            });

            util.debug('Disconnected!!!');
        });

        // enter_room handler
        socket.on('enter_room', function(data) {
            var timeTaken, startTime = process.hrtime();

            fmsApi.requestEnterRoom(currentSessionId, data.performerId).then(function(result) {
                timeTaken = process.hrtime(startTime);
                util.debug(util.format('%s: %d ms', 'FMS API request succeeded', (timeTaken[0] * 1e9 + timeTaken[1]) / 1000000.0));

                messageRouter.connect(currentSessionId, data.performerId, data.mode || MessageRouter.ChatModes.GUEST,
                        function(message) {
                            var chatMessage = JSON.parse(message.content.toString());
                            socket.emit('chat', chatMessage);
                        },
                        function(message) {
                            util.debug('Control message arrived');
                        }
                ).then(
                        function() {
                            currentChatMode = data.mode || MessageRouter.ChatModes.GUEST;
                            currentMessageType = MessageRouter.MessageTypes.GUEST;
                            currentPerformerId = data.performerId;

                            socket.emit('enter_room_result', {result: 'ok', message: 'Entered room', streamData: result.streamData, mode: currentChatMode});
                        },
                        function() {
                            socket.emit('enter_room_result', {result: 'failed', message: 'Connection failed'});
                        }
                );
            }, function(result) {
                timeTaken = process.hrtime(startTime);
                util.debug(util.format('%s: %d ms', 'FMS API request failed', (timeTaken[0] * 1e9 + timeTaken[1]) / 1000000.0));

                socket.emit('enter_room_result', result);
            });
        });

        // request_private handler
        socket.on('private_request', function(data) {
            var timeTaken, startTime = process.hrtime();

            fmsApi.requestPrivate(currentSessionId, currentPerformerId, data.isExclusive).then(function(result) {
                timeTaken = process.hrtime(startTime);
                util.debug(util.format('%s: %d ms', 'FMS API request succeeded', (timeTaken[0] * 1e9 + timeTaken[1]) / 1000000.0));

                messageRouter.close();
                messageRouter.connect(currentSessionId, currentPerformerId, MessageRouter.ChatModes.PRIVATE,
                        function(message) {
                            var chatMessage = JSON.parse(message.content.toString());
                            socket.emit('chat', chatMessage);
                        },
                        function(message) {
                            util.debug('Control message arrived');
                        }
                ).then(
                        function() {
                            currentChatMode = MessageRouter.ChatModes.PRIVATE;
                            currentMessageType = MessageRouter.MessageTypes.PRIVATE;

                            socket.emit('private_request_result', {result: 'ok', message: 'Private accepted', streamData: result.streamData});
                        },
                        function() {
                            socket.emit('private_request_result', {result: 'failed', message: 'Connection failed'});
                        }
                );


            }, function(result) {
                timeTaken = process.hrtime(startTime);
                util.debug(util.format('%s: %d ms', 'FMS API request failed', (timeTaken[0] * 1e9 + timeTaken[1]) / 1000000.0));

                socket.emit('private_request_result', result);
            });
        });

        // chat handler
        socket.on('chat', function(data) {
            messageRouter.sendChat({from: currentDisplayName, type: data.type || currentMessageType || 'freechat', text: data.text, userType: data.userType || 'guest'});
        });

        // private ping handler
        socket.on('private_ping', function() {
            util.debug('Private ping arrived');
        });

        // end private handler
        socket.on('private_end', function() {
            util.debug('End private arrived');
        });

        // development related messages
        if (env === 'development') {
            socket.on('auto_chat', function(data) {
                var chatSequence = 1;
                setInterval(function() {
                    socket.emit('chat', {from: currentDisplayName, type: 'freechat', text: 'Chat message ' + chatSequence++});
                }, data ? data.interval || 1000 : 1000);
            });
        }
    });
}(require, JSON, process, __dirname));
