#!/usr/bin/env node

import { MeteorShowerWebSocketServer } from './wsServer.js';

// Start WebSocket server
const server = new MeteorShowerWebSocketServer(8080);
server.start();

// Keep process alive
process.on('SIGINT', () => {
    console.log('\n🛑 Stopping MeteorShower server...');
    server.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Stopping MeteorShower server...');
    server.stop();
    process.exit(0);
});

console.log('🚀 MeteorShower Integration Server started!');
console.log('📡 WebSocket running on port 8080');
console.log('🔗 Waiting for LiquidityPups connections...');
