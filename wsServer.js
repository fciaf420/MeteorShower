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
        this.adminClients = new Set(); // admin authenticated clients
        this.integrationSecret = process.env.INTEGRATION_SECRET;
        this.adminSecret = process.env.ADMIN_SECRET || process.env.INTEGRATION_SECRET;
        
        if (!this.integrationSecret) {
            throw new Error('INTEGRATION_SECRET environment variable is required');
        }
    }

    // Authentication methods
    isAuthenticated(ws) {
        return this.authenticatedClients.has(ws);
    }

    isAdmin(ws) {
        return this.adminClients.has(ws);
    }

    authenticate(ws, secret) {
        if (secret === this.integrationSecret) {
            this.authenticatedClients.add(ws);
            return { success: true, role: 'user' };
        } else if (secret === this.adminSecret) {
            this.authenticatedClients.add(ws);
            this.adminClients.add(ws);
            return { success: true, role: 'admin' };
        } else {
            return { success: false, role: null };
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

    requireAdmin(ws) {
        if (!this.isAdmin(ws)) {
            ws.send(JSON.stringify({
                type: 'ADMIN_ACCESS_REQUIRED',
                data: { error: 'Admin access required. This endpoint requires administrative privileges.' }
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
                return true; // Aceitar todas as conexões
            }
        });
        
        this.wss.on('connection', (ws, req) => {
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
        
        // Handle authentication separately (no auth required)
        if (message.type === 'AUTHENTICATE') {
            const { secret } = message.data || {};
            const authResult = this.authenticate(ws, secret);
            if (authResult.success) {
                ws.send(JSON.stringify({
                    type: 'AUTHENTICATION_SUCCESS',
                    data: { 
                        message: 'Authentication successful',
                        role: authResult.role
                    }
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
            // User endpoints
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
            
            // Admin endpoints
            case 'LIST_ACTIVE_BOTS':
                if (!this.requireAdmin(ws)) return;
                await this.handleListActiveBots(ws);
                break;
            case 'GET_SERVER_STATUS':
                if (!this.requireAdmin(ws)) return;
                await this.handleGetServerStatus(ws);
                break;
            case 'GET_SYSTEM_METRICS':
                if (!this.requireAdmin(ws)) return;
                await this.handleGetSystemMetrics(ws);
                break;
            case 'STOP_ALL_BOTS':
                if (!this.requireAdmin(ws)) return;
                await this.handleStopAllBots(ws);
                break;
            case 'GET_BOT_LOGS':
                if (!this.requireAdmin(ws)) return;
                await this.handleGetBotLogs(ws, message.data);
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

    async handleListActiveBots(ws) {
        try {
            const activeBots = Array.from(this.bots.values()).map(bot => ({
                botId: bot.botId || 'unknown',
                poolAddress: bot.poolAddress || 'unknown',
                status: bot.status || 'unknown',
                walletAddress: bot.walletAddress || 'unknown',
                createdAt: bot.createdAt || new Date(),
                // Adicionar informações de tokens se disponíveis
                tokenXSymbol: bot.tokenXSymbol || null,
                tokenYSymbol: bot.tokenYSymbol || null,
                tokenPair: bot.tokenPair || null
            }));

            ws.send(JSON.stringify({
                type: 'ACTIVE_BOTS_LIST',
                data: {
                    bots: activeBots,
                    count: activeBots.length,
                    timestamp: Date.now()
                }
            }));
        } catch (error) {
            ws.send(JSON.stringify({
                type: 'ERROR',
                data: { error: error.message }
            }));
        }
    }

    async handleGetServerStatus(ws) {
        try {
            const status = {
                port: this.port,
                connectedClients: this.clients.size,
                authenticatedClients: this.authenticatedClients.size,
                adminClients: this.adminClients.size,
                activeBots: this.bots.size,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage(),
                version: process.version,
                platform: process.platform,
                arch: process.arch,
                nodeEnv: process.env.NODE_ENV || 'development',
                timestamp: Date.now()
            };

            ws.send(JSON.stringify({
                type: 'SERVER_STATUS',
                data: status
            }));
        } catch (error) {
            ws.send(JSON.stringify({
                type: 'ERROR',
                data: { error: error.message }
            }));
        }
    }

    async handleGetSystemMetrics(ws) {
        try {
            const os = await import('os');
            
            const metrics = {
                system: {
                    uptime: os.uptime(),
                    loadAverage: os.loadavg(),
                    totalMemory: os.totalmem(),
                    freeMemory: os.freemem(),
                    cpuCount: os.cpus().length,
                    cpuInfo: os.cpus().map(cpu => ({
                        model: cpu.model,
                        speed: cpu.speed,
                        times: cpu.times
                    }))
                },
                process: {
                    pid: process.pid,
                    uptime: process.uptime(),
                    memoryUsage: process.memoryUsage(),
                    cpuUsage: process.cpuUsage(),
                    version: process.version,
                    platform: process.platform,
                    arch: process.arch
                },
                meteorShower: {
                    activeBots: this.bots.size,
                    connectedClients: this.clients.size,
                    authenticatedClients: this.authenticatedClients.size,
                    adminClients: this.adminClients.size
                },
                timestamp: Date.now()
            };

            ws.send(JSON.stringify({
                type: 'SYSTEM_METRICS',
                data: metrics
            }));
        } catch (error) {
            ws.send(JSON.stringify({
                type: 'ERROR',
                data: { error: error.message }
            }));
        }
    }

    async handleStopAllBots(ws) {
        try {
            const stoppedBots = [];
            
            for (const [botId, bot] of this.bots.entries()) {
                try {
                    await stopPoolBot(bot);
                    stoppedBots.push(botId);
                } catch (error) {
                    console.error(`Error stopping bot ${botId}:`, error);
                }
            }
            
            this.bots.clear();

            ws.send(JSON.stringify({
                type: 'ALL_BOTS_STOPPED',
                data: {
                    stoppedCount: stoppedBots.length,
                    stoppedBots: stoppedBots,
                    message: `Successfully stopped ${stoppedBots.length} bots`,
                    timestamp: Date.now()
                }
            }));
        } catch (error) {
            ws.send(JSON.stringify({
                type: 'ERROR',
                data: { error: error.message }
            }));
        }
    }

    async handleGetBotLogs(ws, data) {
        try {
            const { botId, lines = 50 } = data || {};
            
            if (!botId) {
                ws.send(JSON.stringify({
                    type: 'ERROR',
                    data: { error: 'Bot ID is required' }
                }));
                return;
            }

            const bot = this.bots.get(botId);
            if (!bot) {
                ws.send(JSON.stringify({
                    type: 'ERROR',
                    data: { error: 'Bot not found' }
                }));
                return;
            }

            // Simular logs do bot (em uma implementação real, você teria um sistema de logging)
            const logs = [
                { timestamp: new Date().toISOString(), level: 'INFO', message: `Bot ${botId} is running` },
                { timestamp: new Date().toISOString(), level: 'DEBUG', message: 'Monitoring position metrics' },
                { timestamp: new Date().toISOString(), level: 'INFO', message: 'Position is active and profitable' }
            ];

            ws.send(JSON.stringify({
                type: 'BOT_LOGS',
                data: {
                    botId,
                    logs: logs.slice(-lines),
                    totalLines: logs.length,
                    requestedLines: lines,
                    timestamp: Date.now()
                }
            }));
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
            authenticatedClients: this.authenticatedClients.size,
            adminClients: this.adminClients.size,
            activeBots: this.bots.size,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            timestamp: Date.now()
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
        
    }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const server = new MeteorShowerWebSocketServer();
    server.start();
    
    // Graceful shutdown
    process.on('SIGINT', () => {
        server.stop();
        process.exit(0);
    });
}

export { MeteorShowerWebSocketServer };
