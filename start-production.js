#!/usr/bin/env node

import { MeteorShowerWebSocketServer } from './wsServer.js';

// Configurações de produção
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0'; // Permitir conexões externas

console.log('🚀 Starting MeteorShower in Production Mode');

// Start WebSocket server
const server = new MeteorShowerWebSocketServer(PORT);
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

// Log de inicialização
console.log('✅ MeteorShower Integration Server started!');
