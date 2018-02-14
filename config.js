cfg = {
    type: 'serial',
    serial : {
        device: '/dev/tty.usbserial-A506C7VJ',
        baudRate: 19200
    },
    server: {
        url: 'http://192.168.0.16:39500/insteon'
    },

    blacklist: ['129d48', '3cb0da', '391dc2']
};


module.exports = cfg;