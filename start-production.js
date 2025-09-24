#!/usr/bin/env node

import { MeteorShowerWebSocketServer } from './wsServer.js';

// Configurações de produção
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0'; // Permitir conexões externas

console.log('🚀 Starting MeteorShower in Production Mode');
console.log(`📡 WebSocket server will run on ${HOST}:${PORT}`);
console.log('🔧 Production optimizations enabled');

// Start WebSocket server
const server = new MeteorShowerWebSocketServer(PORT);
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

// Log de inicialização
console.log('✅ MeteorShower Integration Server started!');
console.log(`📡 WebSocket running on ${HOST}:${PORT}`);
console.log('🔗 Ready for LiquidityPups connections via nginx proxy');
console.log('🔒 Authentication required with INTEGRATION_SECRET');
