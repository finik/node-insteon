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
var toRefresh = {};

app.get('/:id/on', function(req, res) {
    insteon.light(req.params.id).turnOn(function(err, data) {
        refreshLevels([req.params.id]);
        res.send({});
    })
});

app.get('/:id/off', function(req, res) {
    insteon.light(req.params.id).turnOff(function(err, data) {
        refreshLevels([req.params.id]);
        res.send({});
    })
});

app.get('/:id/links', function(req, res) {
    insteon.links(function(err, data) {
        res.send(data);
    })
});

app.get('/:id/level', function(req, res) {
    var level = +req.query.level;
    if (level) {
        insteon.light(req.params.id).level(level, function(err, level) {
            toRefresh[req.params.id] = true;
            res.send({});
        })
    } else {
        insteon.light(req.params.id).level(function(err, level) {
            toRefresh[req.params.id] = true;
            var event = {
                service: 'insteon',
                type: 'status',
                id: req.params.id.toUpperCase(),
                level: level
            };
            res.send(event);
        })
    }
});

app.get('/:id/info', function(req, res) {
    insteon.info(req.params.id, function(err, info) {
        console.log(info);
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
        var devices = [];

        async.eachSeries(ids, function(id, callback) {
                insteon.info(id, function(err, info) {
                    if (err || !info) return callback(err);

                    devices.push({
                        id: info.id.toUpperCase(),
                        cat: info.deviceCategory.id,
                        subcat: info.deviceSubcategory.id
                    });

                    callback();

                });
            },
            function(err) {
                if (err) return res.sendStatus(500);

                res.json({
                    count: devices.length,
                    devices: devices
                })
            })
    })

});


function refreshLevels() {
    var ids = Object.keys(toRefresh);
    var id = ids && ids.length && ids[0];
    if (id) {
        console.log('Refreshing status for devices:', id);
        delete toRefresh[id];

        insteon.light(id).level(function(err, level) {
            if (err) return;

            var event = {
                service: 'insteon',
                type: 'status',
                id: id.toUpperCase(),
                level: level
            };

            console.log("Sending to client", event)

            if (cfg.server) {
                request({
                    method: 'PUT',
                    url: cfg.server.url,
                    json: event
                });
            }
        });
    }

    setTimeout(refreshLevels, 5000);
}

function onCommand(command) {
    console.log('onCommand', command);
    var cmd = command && command.standard;
    if (cmd) {

        var id = command.standard.id;
        if (cmd.messageType === 6) {
            var groupId = parseInt(cmd.gatewayId, 16);
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
                            toRefresh[link.id] = true;
                        }
                    });


                });
            } else {
                var links = linkCache[id][groupId];
                if (links) {
                    Object.keys(links).forEach(function(id) {
                        toRefresh[id] = true;
                    });
                }
            }

            var event = {
                service: 'insteon',
                type: 'command',
                id: id.toUpperCase(),
                group: cmd.gatewayId.toUpperCase(),
                command1: cmd.command1,
                command2: cmd.command2
            };

            if (cfg.server) {
                request({
                    method: 'PUT',
                    url: cfg.server.url,
                    json: event
                });
            }

            toRefresh[id] = true;
        }
    }
}

function initialize() {
    insteon.on('command', onCommand);
    refreshLevels();

    app.listen(3000, function() {
        console.log('Connected. Listening on Port 3000');
    });
}

if (cfg.type == 'serial') {
    insteon.serial(cfg.serial.device, cfg.serial, initialize);
} else if (cfg.type == 'hub') {
    // TBD
}

