import WebSocket from 'ws';
import { launchPoolBot, stopPoolBot } from './botManager.js';
import 'dotenv/config';

class MeteorShowerWebSocketServer {
    constructor(port = 8080) {
        this.port = port;
        this.wss = null;
        this.bots = new Map(); // botId -> bot instance
        this.clients = new Set(); // connected clients
        this.authenticatedClients = new Set(); // authenticated clients
        this.integrationSecret = process.env.INTEGRATION_SECRET;
        
        if (!this.integrationSecret) {
            throw new Error('INTEGRATION_SECRET environment variable is required');
        }
    }

    // Authentication methods
    isAuthenticated(ws) {
        return this.authenticatedClients.has(ws);
    }

    authenticate(ws, secret) {
        if (secret === this.integrationSecret) {
            this.authenticatedClients.add(ws);
            console.log('✅ Client authenticated successfully');
            return true;
        } else {
            console.log('❌ Authentication failed - invalid secret');
            return false;
        }
    }

    requireAuthentication(ws) {
        if (!this.isAuthenticated(ws)) {
            ws.send(JSON.stringify({
                type: 'AUTHENTICATION_REQUIRED',
                data: { error: 'Authentication required. Send AUTHENTICATE message with valid secret.' }
            }));
            return false;
        }
        return true;
    }

    start() {
        this.wss = new WebSocket.Server({ 
            port: this.port,
            perMessageDeflate: false,
            // Permitir conexões via proxy
            verifyClient: (info) => {
                // Log da conexão para debug
                console.log(`🔍 WebSocket connection attempt from: ${info.origin || 'unknown'}`);
                console.log(`🔍 Headers:`, info.req.headers);
                return true; // Aceitar todas as conexões
            }
        });
        
        this.wss.on('connection', (ws, req) => {
            console.log('🔌 Client connected to MeteorShower WebSocket');
            this.clients.add(ws);
            
            // Send welcome message with authentication requirement
            ws.send(JSON.stringify({
                type: 'CONNECTION_ESTABLISHED',
                data: { 
                    message: 'Connected to MeteorShower',
                    requiresAuth: true,
                    authMessage: 'Send AUTHENTICATE message with valid secret'
                }
            }));
            
            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data);
                    await this.handleMessage(ws, message);
                } catch (error) {
                    console.error('❌ Erro ao processar mensagem:', error);
                    ws.send(JSON.stringify({
                        type: 'ERROR',
                        data: { error: error.message }
                    }));
                }
            });
            
            ws.on('close', (code, reason) => {
                console.log(`🔌 Client disconnected: ${code} - ${reason}`);
                this.clients.delete(ws);
                this.authenticatedClients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                this.clients.delete(ws);
                this.authenticatedClients.delete(ws);
            });
        });
        
        console.log(`🚀 MeteorShower WebSocket server running on port ${this.port}`);
    }

    async handleMessage(ws, message) {
        console.log(`📨 Message received: ${message.type}`);
        
        // Handle authentication separately (no auth required)
        if (message.type === 'AUTHENTICATE') {
            const { secret } = message.data || {};
            if (this.authenticate(ws, secret)) {
                ws.send(JSON.stringify({
                    type: 'AUTHENTICATION_SUCCESS',
                    data: { message: 'Authentication successful' }
                }));
            } else {
                ws.send(JSON.stringify({
                    type: 'AUTHENTICATION_FAILED',
                    data: { error: 'Invalid secret' }
                }));
                ws.close(1008, 'Authentication failed');
            }
            return;
        }
        
        // Require authentication for all other operations
        if (!this.requireAuthentication(ws)) {
            return;
        }
        
        switch (message.type) {
            case 'LAUNCH_POOL_BOT':
                await this.handleLaunchPoolBot(ws, message.data);
                break;
            case 'STOP_POOL_BOT':
                await this.handleStopPoolBot(ws, message.data);
                break;
            case 'GET_BOT_STATUS':
                await this.handleGetBotStatus(ws, message.data);
                break;
            case 'PING':
                ws.send(JSON.stringify({ type: 'PONG', data: { timestamp: Date.now() } }));
                break;
            default:
                ws.send(JSON.stringify({
                    type: 'ERROR',
                    data: { error: 'Unknown message type' }
                }));
        }
    }

    async handleLaunchPoolBot(ws, config) {
        try {
            // Validate configuration
            if (!config.botId || !config.poolAddress || !config.privateKey) {
                throw new Error('Invalid configuration: botId, poolAddress and privateKey are required');
            }

            // Launch bot using existing MeteorShower logic
            const result = await launchPoolBot(config);
            
            if (result.success) {
                this.bots.set(config.botId, result.bot);
                
                // Start monitoring metrics
                this.startMetricsMonitoring(config.botId, result.bot);
                
                ws.send(JSON.stringify({
                    type: 'POOL_BOT_LAUNCHED',
                    data: {
                        botId: config.botId,
                        positionAddress: result.positionAddress,
                        message: 'Pool bot started successfully'
                    }
                }));

            } else {
                ws.send(JSON.stringify({
                    type: 'POOL_BOT_ERROR',
                    data: { 
                        botId: config.botId,
                        error: result.error 
                    }
                }));
            }
        } catch (error) {
            console.error(`❌ Error starting pool bot ${config.botId}:`, error);
            ws.send(JSON.stringify({
                type: 'POOL_BOT_ERROR',
                data: { 
                    botId: config.botId,
                    error: error.message 
                }
            }));
        }
    }

    async handleStopPoolBot(ws, data) {
        try {
            const { botId } = data;
            
            const bot = this.bots.get(botId);
            
            if (bot) {
                await stopPoolBot(bot);
                this.bots.delete(botId);
                
                ws.send(JSON.stringify({
                    type: 'POOL_BOT_STOPPED',
                    data: { 
                        botId,
                        message: 'Pool bot stopped successfully'
                    }
                }));

            } else {
                ws.send(JSON.stringify({
                    type: 'POOL_BOT_ERROR',
                    data: { 
                        botId,
                        error: 'Bot not found' 
                    }
                }));
            }
        } catch (error) {
            console.error(`❌ Error stopping pool bot ${data.botId}:`, error);
            ws.send(JSON.stringify({
                type: 'POOL_BOT_ERROR',
                data: { 
                    botId: data.botId,
                    error: error.message 
                }
            }));
        }
    }

    async handleGetBotStatus(ws, data) {
        try {
            const { botId } = data;
            const bot = this.bots.get(botId);
            
            if (bot) {
                ws.send(JSON.stringify({
                    type: 'BOT_STATUS',
                    data: {
                        botId,
                        status: bot.status,
                        metrics: bot.getMetrics ? bot.getMetrics() : null
                    }
                }));
            } else {
                ws.send(JSON.stringify({
                    type: 'BOT_STATUS',
                    data: {
                        botId,
                        status: 'not_found'
                    }
                }));
            }
        } catch (error) {
            ws.send(JSON.stringify({
                type: 'ERROR',
                data: { error: error.message }
            }));
        }
    }

    // Start monitoring metrics for a bot
    startMetricsMonitoring(botId, bot) {
        const interval = setInterval(async () => {
            try {
                if (!this.bots.has(botId)) {
                    clearInterval(interval);
                    return;
                }

                // Get current metrics from bot
                const metrics = bot.getMetrics ? bot.getMetrics() : {
                    currentValue: 0,
                    pnl: 0,
                    pnlPercentage: 0,
                    feesEarned: 0,
                    rebalanceCount: 0,
                    lastRebalance: null
                };

                // Send metrics to all connected clients
                this.broadcast({
                    type: 'POOL_METRICS_UPDATE',
                    data: {
                        botId,
                        metrics,
                        timestamp: Date.now()
                    }
                });

            } catch (error) {
                console.error(`❌ Error getting bot metrics ${botId}:`, error);
            }
        }, 5000); // Update every 5 seconds

        // Store interval for cleanup
        bot.metricsInterval = interval;
    }

    // Broadcast message to all connected clients
    broadcast(message) {
        const data = JSON.stringify(message);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(data);
                } catch (error) {
                    console.error('❌ Error sending broadcast:', error);
                    this.clients.delete(client);
                }
            }
        });
    }

    // Get server status
    getStatus() {
        return {
            port: this.port,
            connectedClients: this.clients.size,
            activeBots: this.bots.size,
            uptime: process.uptime()
        };
    }

    // Stop server
    stop() {
        if (this.wss) {
            this.wss.close();
        }
        
        // Stop all bots
        this.bots.forEach(bot => {
            if (bot.stop) {
                bot.stop();
            }
        });
        
        this.bots.clear();
        this.clients.clear();
        
        console.log('🛑 MeteorShower WebSocket server stopped');
    }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const server = new MeteorShowerWebSocketServer();
    server.start();
    
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Stopping server...');
        server.stop();
        process.exit(0);
    });
}

export { MeteorShowerWebSocketServer };
