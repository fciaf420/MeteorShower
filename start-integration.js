#!/usr/bin/env node

import { MeteorShowerWebSocketServer } from './wsServer.js';

// Start WebSocket server
const server = new MeteorShowerWebSocketServer(8080);
server.start();

// Keep process alive
process.on('SIGINT', () => {
    server.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    server.stop();
    process.exit(0);
});

console.log('🚀 MeteorShower Integration Server started!');
