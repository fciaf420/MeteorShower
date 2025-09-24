import { launchPoolBot, stopPoolBot } from './botManager.js';
import 'dotenv/config';

class MeteorShowerVercelServer {
    constructor() {
        this.bots = new Map(); // botId -> bot instance
        this.authenticatedClients = new Map(); // clientId -> { authenticated: true, lastSeen: Date }
        this.integrationSecret = process.env.INTEGRATION_SECRET;
        this.clientMessages = new Map(); // clientId -> message queue
        
        if (!this.integrationSecret) {
            throw new Error('INTEGRATION_SECRET environment variable is required');
        }
    }

    // Authentication methods
    authenticate(secret) {
        return secret === this.integrationSecret;
    }

    generateClientId() {
        return 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // HTTP endpoint handlers for Vercel
    async handleRequest(req, res) {
        const { method, url } = req;
        const urlObj = new URL(url, 'http://localhost');
        const pathname = urlObj.pathname;
        const searchParams = urlObj.searchParams;

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (method === 'OPTIONS') {
            res.status(200).end();
            return;
        }

        try {
            switch (pathname) {
                case '/api/connect':
                    await this.handleConnect(req, res);
                    break;
                case '/api/authenticate':
                    await this.handleAuthenticate(req, res);
                    break;
                case '/api/launch-pool-bot':
                    await this.handleLaunchPoolBot(req, res);
                    break;
                case '/api/stop-pool-bot':
                    await this.handleStopPoolBot(req, res);
                    break;
                case '/api/events':
                    await this.handleEvents(req, res, searchParams);
                    break;
                case '/api/health':
                    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
                    break;
                default:
                    res.status(404).json({ error: 'Not found' });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async handleConnect(req, res) {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        const clientId = this.generateClientId();
        this.authenticatedClients.set(clientId, { authenticated: false, lastSeen: new Date() });
        this.clientMessages.set(clientId, []);


        res.status(200).json({
            clientId,
            message: 'Connected to MeteorShower',
            requiresAuth: true,
            authMessage: 'Send POST to /api/authenticate with valid secret'
        });
    }

    async handleAuthenticate(req, res) {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        // Use Express body parser (already parsed by middleware)
        const { clientId, secret } = req.body || {};

        if (!clientId || !secret) {
            res.status(400).json({ error: 'clientId and secret are required' });
            return;
        }

        const client = this.authenticatedClients.get(clientId);
        if (!client) {
            res.status(404).json({ error: 'Client not found' });
            return;
        }

        if (this.authenticate(secret)) {
            client.authenticated = true;
            client.lastSeen = new Date();
            
            res.status(200).json({
                message: 'Authentication successful'
            });
        } else {
            res.status(401).json({
                error: 'Invalid secret'
            });
        }
    }

    async handleLaunchPoolBot(req, res) {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        // Use Express body parser (already parsed by middleware)
        const { clientId, config } = req.body || {};

        if (!this.requireAuthentication(clientId, res)) {
            return;
        }

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
                this.startMetricsMonitoring(config.botId, result.bot, clientId);
                
                res.status(200).json({
                    success: true,
                    botId: config.botId,
                    positionAddress: result.positionAddress,
                    message: 'Pool bot started successfully'
                });

            } else {
                res.status(500).json({
                    success: false,
                    botId: config.botId,
                    error: result.error
                });
            }
        } catch (error) {
            res.status(500).json({
                success: false,
                botId: config.botId || 'unknown',
                error: error.message
            });
        }
    }

    async handleStopPoolBot(req, res) {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        // Use Express body parser (already parsed by middleware)
        const { clientId, botId } = req.body || {};

        if (!this.requireAuthentication(clientId, res)) {
            return;
        }

        try {
            const bot = this.bots.get(botId);
            
            if (bot) {
                await stopPoolBot(bot);
                this.bots.delete(botId);
                
                res.status(200).json({
                    success: true,
                    botId,
                    message: 'Pool bot stopped successfully'
                });

            } else {
                res.status(404).json({
                    success: false,
                    botId,
                    error: 'Bot not found'
                });
            }
        } catch (error) {
            res.status(500).json({
                success: false,
                botId: botId || 'unknown',
                error: error.message
            });
        }
    }

    async handleEvents(req, res, searchParams) {
        if (req.method !== 'GET') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        const clientId = searchParams.get('clientId');
        if (!clientId) {
            res.status(400).json({ error: 'clientId parameter is required' });
            return;
        }

        const client = this.authenticatedClients.get(clientId);
        if (!client || !client.authenticated) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }

        // Set up Server-Sent Events
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control'
        });

        // Send initial connection message
        res.write(`data: ${JSON.stringify({
            type: 'CONNECTION_ESTABLISHED',
            data: { message: 'Event stream connected' }
        })}\n\n`);

        // Keep connection alive and send queued messages
        const interval = setInterval(() => {
            const messages = this.clientMessages.get(clientId) || [];
            if (messages.length > 0) {
                const message = messages.shift();
                res.write(`data: ${JSON.stringify(message)}\n\n`);
                this.clientMessages.set(clientId, messages);
            }
            
            // Update last seen
            client.lastSeen = new Date();
        }, 1000);

        // Clean up on disconnect
        req.on('close', () => {
            clearInterval(interval);
        });
    }

    requireAuthentication(clientId, res) {
        const client = this.authenticatedClients.get(clientId);
        if (!client || !client.authenticated) {
            res.status(401).json({ error: 'Authentication required' });
            return false;
        }
        return true;
    }

    async getRequestBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error('Invalid JSON'));
                }
            });
        });
    }

    startMetricsMonitoring(botId, bot, clientId) {
        // Start monitoring and send metrics to client
        setInterval(() => {
            if (this.bots.has(botId)) {
                const metrics = {
                    botId,
                    currentValue: bot.currentValue || 0,
                    pnl: bot.pnl || 0,
                    pnlPercentage: bot.pnlPercentage || 0,
                    feesEarned: bot.feesEarned || 0,
                    rebalanceCount: bot.rebalanceCount || 0,
                    lastRebalance: bot.lastRebalance || null,
                    initialValue: bot.initialValue || 0
                };

                // Queue message for client
                const messages = this.clientMessages.get(clientId) || [];
                messages.push({
                    type: 'METRICS_UPDATE',
                    data: metrics
                });
                this.clientMessages.set(clientId, messages);
            }
        }, 5000); // Update every 5 seconds
    }

    // Clean up old clients
    cleanupClients() {
        const now = new Date();
        const maxAge = 5 * 60 * 1000; // 5 minutes

        for (const [clientId, client] of this.authenticatedClients.entries()) {
            if (now - client.lastSeen > maxAge) {
                this.authenticatedClients.delete(clientId);
                this.clientMessages.delete(clientId);
            }
        }
    }
}

// Vercel serverless function handler
export default async function handler(req, res) {
    const server = new MeteorShowerVercelServer();
    
    // Clean up old clients periodically
    server.cleanupClients();
    
    await server.handleRequest(req, res);
}

// For local development
if (import.meta.url === `file://${process.argv[1]}`) {
    import('express').then((express) => {
        const app = express.default();
        app.use(express.default.json());
        
        const server = new MeteorShowerVercelServer();
        
        // Handle all routes
        app.use((req, res) => server.handleRequest(req, res));
        
        const port = process.env.PORT || 8080;
        app.listen(port, () => {
        });
    }).catch(() => {});
}
