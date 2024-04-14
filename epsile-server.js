#!/usr/bin/env node
// epsile server
// created by djazz
'use strict';

// Load and initialize modules
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const compression = require('compression'); // Import the compression middleware
const winston = require('winston'); // Import winston for logging

// Initialize Winston logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} ${level}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// Configuration
require('dotenv').config(); // Load environment variables from .env file
const port = process.env.PORT || 8001; // Use environment variable or default to 8001

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    log: 1
});

server.listen(port, () => {
    logger.info(`epsile server listening at port ${port}`);
});

// Use the compression middleware
app.use(compression());

app.use(express.static(__dirname + '/'));

// Global variables to keep track of sockets, users, and the state of the app
const sockets = {};
const users = {};
let strangerQueue = false;
let peopleActive = 0;
let peopleTotal = 0;

// Helper functions for logging
const fillZero = (val) => (val > 9 ? `${val}` : `0${val}`);
const timestamp = () => {
    const now = new Date();
    return `[${fillZero(now.getHours())}:${fillZero(now.getMinutes())}:${fillZero(now.getSeconds())}]`;
};

// Event handlers for socket connections
io.on('connection', (socket) => {
    try {
        handleNewConnection(socket);
    } catch (error) {
        logger.error('Error handling connection:', error);
    }
});

// Function to handle new connections
function handleNewConnection(socket) {
    // Store the socket and info about the user
    sockets[socket.id] = socket;
    users[socket.id] = {
        connectedTo: -1,
        isTyping: false,
    };

    // Connect the user to another if strangerQueue isn't empty
    if (strangerQueue !== false) {
        users[socket.id].connectedTo = strangerQueue;
        users[socket.id].isTyping = false;
        users[strangerQueue].connectedTo = socket.id;
        users[strangerQueue].isTyping = false;
        socket.emit('conn');
        sockets[strangerQueue].emit('conn');
        strangerQueue = false;
    } else {
        strangerQueue = socket.id;
    }

    peopleActive++;
    peopleTotal++;
    logger.info(`${timestamp()} ${peopleTotal} connect`);
    io.sockets.emit('stats', { people: peopleActive });

    socket.on("new", () => {
        handleNewData(socket);
    });

    socket.on("disconn", () => {
        handleDisconnection(socket);
    });

    socket.on('chat', (message) => {
        handleChatMessage(socket, message);
    });

    socket.on('typing', (isTyping) => {
        handleTyping(socket, isTyping);
    });

    socket.on("disconnect", (err) => {
        handleSocketDisconnect(socket, err);
    });
}

// Function to handle new data
function handleNewData(socket) {
    if (strangerQueue !== false) {
        users[socket.id].connectedTo = strangerQueue;
        users[strangerQueue].connectedTo = socket.id;
        users[socket.id].isTyping = false;
        users[strangerQueue].isTyping = false;
        socket.emit('conn');
        sockets[strangerQueue].emit('conn');
        strangerQueue = false;
    } else {
        strangerQueue = socket.id;
    }
    peopleActive++;
    io.sockets.emit('stats', { people: peopleActive });
}

// Function to handle disconnection
function handleDisconnection(socket) {
    const connTo = users[socket.id].connectedTo;
    if (strangerQueue === socket.id || strangerQueue === connTo) {
        strangerQueue = false;
    }
    users[socket.id].connectedTo = -1;
    users[socket.id].isTyping = false;
    if (sockets[connTo]) {
        users[connTo].connectedTo = -1;
        users[connTo].isTyping = false;
        sockets[connTo].emit("disconn", { who: 2 });
    }
    socket.emit("disconn", { who: 1 });
    peopleActive -= 2;
    io.sockets.emit('stats', { people: peopleActive });
}

// Function to handle chat messages
function handleChatMessage(socket, message) {
    if (users[socket.id].connectedTo !== -1 && sockets[users[socket.id].connectedTo]) {
        sockets[users[socket.id].connectedTo].emit('chat', message);
    }
}

// Function to handle typing events
function handleTyping(socket, isTyping) {
    if (users[socket.id].connectedTo !== -1 && sockets[users[socket.id].connectedTo] && users[socket.id].isTyping !== isTyping) {
        users[socket.id].isTyping = isTyping;
        sockets[users[socket.id].connectedTo].emit('typing', isTyping);
    }
}

// Function to handle socket disconnect
function handleSocketDisconnect(socket, err) {
    let connTo = users[socket.id]?.connectedTo ?? -1;
    if (connTo !== -1 && sockets[connTo]) {
        sockets[connTo].emit("disconn", { who: 2, reason: err?.toString() });
        users[connTo].connectedTo = -1;
        users[connTo].isTyping = false;
        peopleActive -= 2;
    }

    delete sockets[socket.id];
    delete users[socket.id];

    if (strangerQueue === socket.id || strangerQueue === connTo) {
        strangerQueue = false;
        peopleActive--;
    }
    peopleTotal--;
    logger.info(`${timestamp()} ${peopleTotal} disconnect`);
    io.sockets.emit('stats', { people: peopleActive });
}
