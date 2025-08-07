// ───────────────────────────────────────────────
// ~/web-ui/backend/server.js - Express API Server
// ───────────────────────────────────────────────
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config({ path: '../../.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const PORT = process.env.API_PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API Routes
import positionRoutes from './routes/positions.js';
import walletRoutes from './routes/wallet.js';
import configRoutes from './routes/config.js';

app.use('/api/positions', positionRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/config', configRoutes);

// WebSocket Server for real-time updates
const wss = new WebSocketServer({ server });

// Store active WebSocket connections
const clients = new Set();

wss.on('connection', (ws, request) => {
  console.log('🔌 WebSocket client connected');
  clients.add(ws);

  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connection',
    status: 'connected',
    timestamp: Date.now()
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 WebSocket message received:', data);
      
      // Handle different message types
      switch (data.type) {
        case 'subscribe':
          // Subscribe to specific data streams
          ws.subscriptions = data.streams || ['position', 'pnl'];
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
      }
    } catch (error) {
      console.error('❌ WebSocket message parse error:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
    clients.delete(ws);
  });
});

// Function to broadcast updates to all connected clients
export function broadcastUpdate(type, data) {
  const message = JSON.stringify({
    type,
    data,
    timestamp: Date.now()
  });

  clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      // Only send to clients subscribed to this data type
      if (!client.subscriptions || client.subscriptions.includes(type)) {
        client.send(message);
      }
    } else {
      clients.delete(client);
    }
  });
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ API Error:', error);
  
  res.status(error.status || 500).json({
    error: error.message || 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 MeteorShower API server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 WebSocket server ready for connections`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});