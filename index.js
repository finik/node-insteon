const express = require('express');
const request = require('request');
const _ = require('lodash');
const app = express();
const async = require('async');
var Insteon = require('home-controller').Insteon;
var insteon = new Insteon();
const cfg = require('./config');
var pretty = require('express-prettify');


app.use(pretty({ query: 'pretty' }));

var linkCache = {};
var pingQueue = [];

app.get('/:id/on', function(req, res) {
    console.log('on', req.params.id);
    insteon.light(req.params.id).turnOn(function(err) {
        pingLinkedDevices(req.params.id, 1);
        res.send({});
    })
});

app.get('/:id/off', function(req, res) {
    console.log('off', req.params.id);
    insteon.light(req.params.id).turnOff(function(err) {
        pingLinkedDevices(req.params.id, 1);
        res.send({});
    })
});

app.get('/:id/links', function(req, res) {
    insteon.links(function(err, data) {
        res.send(data);
    })
});

app.get('/:id/level', function(req, res) {
    console.log('status', req.params.id);
    var level = +req.query.level;
    if (level) {
        insteon.light(req.params.id).level(level, function(err, level) {
            var event = {
                service: 'insteon',
                type: 'status',
                id: req.params.id.toUpperCase(),
                level: level
            };
            sendClientEvent(event);
        })
    } else {
        insteon.light(req.params.id).level(function(err, level) {
            var event = {
                service: 'insteon',
                type: 'status',
                id: req.params.id.toUpperCase(),
                level: level
            };
            sendClientEvent(event);
        })
    }

    res.send({});
});

app.get('/:id/info', function(req, res) {
    insteon.info(req.params.id, function(err, info) {
        console.log(info);

        if (!err) {
            var event = {
                service: 'insteon',
                type: 'device',
                id: info.id.toUpperCase(),
                category: info.deviceCategory.id,
                subCategory: info.deviceSubcategory.id
            };

            sendClientEvent(event);
        }

        res.send({
            id: req.params.id.toUpperCase(),
            info: info
        });
    })
});

app.get('/linkCache', function(req, res) {
    res.send(linkCache);
});

app.get('/links', function(req, res) {
    insteon.links(function(err, links) {
        var ids = _.uniq(_.map(links, 'id'));

        res.json({
            count: ids.length,
            devices: ids
        });

        async.eachSeries(ids, function(id, callback) {
            insteon.info(id, function(err, info) {
                if (err || !info) return callback(err);

                var event = {
                    service: 'insteon',
                    type: 'device',
                    id: info.id.toUpperCase(),
                    category: info.deviceCategory.id,
                    subCategory: info.deviceSubcategory.id
                };

                sendClientEvent(event);

                callback();

            });
        },
        function(err) {

        })
    })

});

function sendClientEvent(event) {
    console.log("Sending to client", event)
    request({
        method: 'PUT',
        url: cfg.server.url,
        json: event
    });
}

function pingDevices() {
    var id = pingQueue.pop();

    if (id) {
        console.log('Pinging device:', id);

        var event = {
            service: 'insteon',
            type: 'ping',
            id: id.toUpperCase()
        };

        sendClientEvent(event);
    }

    setTimeout(pingDevices, 1000);
}

function pingLinkedDevices(id, group) {
    if (!linkCache[id]) {
        // No link information for this device, update
        console.log('No link cache, Retrieving links for', id);

        insteon.links(id, function(err, links) {
            if (err) return;

            linkCache[id] = linkCache[id] || {};
            links.forEach(function(link) {
                if (link.controller && (cfg.blacklist.indexOf(link.id) === -1)) {
                    linkCache[id][link.group] = linkCache[id][link.group] || {};
                    linkCache[id][link.group][link.id] = link.data;
                    if ((pingQueue.indexOf(link.id) === -1) && (link.group == group))
                        pingQueue.push(link.id);
                    console.log('pingQueue', pingQueue);
                }
            });


        });
    } else {
        var links = linkCache[id][group];
        if (links) {
            Object.keys(links).forEach(function(link) {
                console.log(link);
                if (pingQueue.indexOf(link.id) === -1)
                    pingQueue.push(link);
            });
            console.log('pingQueue', pingQueue);
        }
    }

}

function onCommand(command) {
    console.log('onCommand', command);
    var cmd = command && command.standard;
    if (cmd) {

        var id = command.standard.id;
        if (cmd.messageType === 6) {
            var group = parseInt(cmd.gatewayId, 16);

            if (group > 255) return; // TODO: Weird commands are being returned 0250442b90110104cb0600

            // Ping all linked devices, some may want to refresh they level
            pingLinkedDevices(id, group);

            var event = {
                service: 'insteon',
                type: 'command',
                id: id.toUpperCase(),
                group: group,
                command1: parseInt(cmd.command1, 16),
                command2: parseInt(cmd.command2, 16)
            };

            sendClientEvent(event);

            // Ping self, might need refreshing level
            pingQueue.push(id);
        }
    }
}

function initialize() {
    insteon.on('command', onCommand);
    pingDevices();

    app.listen(3000, function() {
        console.log('Connected. Listening on Port 3000');
    });
}

if (cfg.type == 'serial') {
    insteon.serial(cfg.serial.device, cfg.serial, initialize);
} else if (cfg.type == 'hub') {
    // TBD
}

