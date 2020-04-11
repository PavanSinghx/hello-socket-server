'use strict';

const express = require('express');
const socketIO = require('socket.io');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'index.html');

var poolSessions = {};

var userPoolMapping = {};

var songList = {};

const server = express()
    .use((req, res) => res.sendFile(INDEX))
    .listen(PORT, () => console.log(`Listening on ${ PORT }`));

const io = socketIO(server);

const poolns = io.of('/pool')

var getSongs = () => {
    var songDb = "https://hello-9fdcc.firebaseio.com/.json";

    https.get(songDb, (res) => {
            res.on('data', (data) => {
                songList = JSON.parse(data);
            });
        })
        .on('error', (e) => {
            console.error(e);
        });
}


/*** FIREBASE ***/
setInterval(() => {
    getSongs();
    log("Fetched songs");
}, 1000 * 60)

/*** ON CONNECT ***/

poolns.on('connection', (socket) => {

    socket.on('joinRoom', function(data) {
        joinRoom(socket, data);
    });

    socket.on('disconnect', function() {
        disconnectUser(socket);
    });

    socket.on('answer', function(data) {
        handleAnswer(socket.id, data.pts);
    });
});

setInterval(() => poolns.emit('time', new Date().toTimeString()), 1000);

var joinRoom = (socket, data) => {
    socket.join(data.pool, () => {
        userPoolMapping[socket.id] = data.pool;
        addOrUpdateSession(data.pool, socket, data.user);
    });
}

var disconnectUser = (socket) => {
    let poolName = userPoolMapping[socket.id];
    let pool = poolSessions[poolName];

    if (pool == undefined) {
        return;
    }
    var tempArr = [];
    for (var i = 0; i < pool.userList.length; i++) {
        if (pool.userList[i].sid != socket.id) {
            tempArr.push(pool.userList[i]);
        }
    }
    pool.userList = tempArr;

    reset(socket.id);
    emitUsers(socket.id);
}

var initNextEvent = (poolSize) => {
    var listLength = songList.length;

    var randomSongs = randomClips(listLength);

    var mainClip = randomSongs[0].clip;

    var songArr = [];

    for (var i = 0; i < randomSongs.length; i++) {
        songArr.push({
            name: randomSongs[i].name,
            isCorrect: false
        });
    }

    songArr[0].isCorrect = true;

    songArr = shuffle(songArr);

    var evt = {
        hostSid: null,
        clip: mainClip,
        questions: songArr,
        isActive: true
    };

    return evt;
}

var shuffle = (a) => {
    var j, x, i;
    for (i = a.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
    return a;
}

var randomClips = (len) => {
    var arr = [];
    var songs = [];

    while (arr.length < 4) {
        var r = Math.floor(Math.random() * len);
        if (arr.indexOf(r) === -1) arr.push(r);
    }

    for (var i = 0; i < arr.length; i++) {
        songs.push(songList[arr[i]])
    }

    return songs;
}

var handleAnswer = (socketid, pts) => {
    var poolName = userPoolMapping[socketid];
    var userPoolIndex = getUserFromSocketId(socketid);
    
    poolSessions[poolName].userList[userPoolIndex].hasAnswered = true;
    poolSessions[poolName].userList[userPoolIndex].userData.pts = pts;
    console.log(poolSessions[poolName].userList[userPoolIndex]);
    emitUsers(socketid);
    reset(socketid);
}

var reset = (socketid) => {
    var poolName = userPoolMapping[socketid];
    var pool = poolSessions[poolName];

    if (!poolSessions[poolName].nextEvent.isActive) {
        return;
    }

    for (var i = 0; i < pool.userList.length; i++) {
        if (!pool.userList[i].hasAnswered) {
            return;
        }
    }

    poolSessions[poolName].nextEvent.isActive = false;

    var hostSid = poolSessions[poolName].nextEvent.hostSid;

    poolSessions[poolName].nextEvent = initNextEvent(hostSid);

    poolSessions[poolName].nextEvent.hostSid = hostSid;

    for (var i = 0; i < pool.userList.length; i++) {
        pool.userList[i].hasAnswered = false;
        emitEvent(pool.userList[i].sid);
    }
}

var addOrUpdateSession = (poolName, socket, userData) => {

    if (poolSessions[poolName] == undefined) {
        poolSessions[poolName] = {
            nextEvent: {},
            userList: []
        }
    }

    var user = {
        sid: socket.id,
        userData: userData,
        isHost: false,
        hasAnswered: false
    };

    console.log(user)

    if (poolSessions[poolName].userList.length == 0) {
        user.isHost = true;
        poolSessions[poolName].nextEvent = initNextEvent();
        poolSessions[poolName].nextEvent.hostSid = socket.id;
    }

    poolSessions[poolName].userList.push(user);

    emitUsers(socket.id);
    emitEvent(socket.id);
}

var getUserFromSocketId = (socketid) => {
    var poolName = userPoolMapping[socketid];
    var pool = poolSessions[poolName];

    for (var i = 0; i < pool.userList.length; i++) {
        var user = pool.userList[i];
        if (user.sid == socketid) {
            return i;
        }
    }

    return -1;
}

/*** Emittions ***/

var emitUsers = (socketId) => {
    initNextEvent();
    var poolName = userPoolMapping[socketId];
    var session = poolSessions[poolName];
    poolns.emit('updateUserList', session.userList);
}

var emitEvent = (socketid) => {
    var poolName = userPoolMapping[socketid];
    var session = poolSessions[poolName];

    if (session.nextEvent.hostSid != socketid) {
        session.nextEvent.clip = null;
    }

    poolns.to(socketid).emit('updateEvent', session.nextEvent);
}

var log = (o) => console.log(o)