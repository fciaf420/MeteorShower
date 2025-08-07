// ───────────────────────────────────────────────
// ~/web-ui/backend/routes/positions.js - Position management endpoints
// ───────────────────────────────────────────────
import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { broadcastUpdate } from '../server.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store bot process and state
let botProcess = null;
let botState = {
  isRunning: false,
  currentPosition: null,
  pnl: { total: 0, percentage: 0, fees: 0 },
  config: {},
  lastUpdate: null,
  rebalanceCount: 0
};

// GET /api/positions/status - Get current position status
router.get('/status', async (req, res) => {
  try {
    res.json({
      status: 'success',
      data: {
        isRunning: botState.isRunning,
        position: botState.currentPosition,
        pnl: botState.pnl,
        config: botState.config,
        lastUpdate: botState.lastUpdate,
        rebalanceCount: botState.rebalanceCount,
        processId: botProcess?.pid || null
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// POST /api/positions/start - Start the bot with configuration
router.post('/start', async (req, res) => {
  try {
    if (botState.isRunning) {
      return res.status(400).json({
        status: 'error',
        message: 'Bot is already running'
      });
    }

    const { interval = 5 } = req.body;
    
    // Path to the main CLI script
    const cliPath = path.resolve(__dirname, '../../../cli.js');
    
    // Start the bot process
    botProcess = spawn('node', [cliPath, 'run', '--interval', interval.toString()], {
      cwd: path.resolve(__dirname, '../../..'),
      env: process.env
    });

    botState.isRunning = true;
    botState.lastUpdate = new Date().toISOString();
    botState.config = { interval };

    // Handle bot output
    botProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('🤖 Bot output:', output);
      
      // Parse bot output for position updates
      try {
        parseAndBroadcastBotOutput(output);
      } catch (parseError) {
        console.error('❌ Error parsing bot output:', parseError);
      }
    });

    botProcess.stderr.on('data', (data) => {
      console.error('🤖 Bot error:', data.toString());
    });

    botProcess.on('close', (code) => {
      console.log(`🤖 Bot process exited with code ${code}`);
      botState.isRunning = false;
      botProcess = null;
      
      broadcastUpdate('botStatus', {
        isRunning: false,
        exitCode: code
      });
    });

    res.json({
      status: 'success',
      message: 'Bot started successfully',
      data: {
        processId: botProcess.pid,
        config: botState.config
      }
    });

    // Broadcast bot start to WebSocket clients
    broadcastUpdate('botStatus', {
      isRunning: true,
      processId: botProcess.pid,
      startTime: botState.lastUpdate
    });

  } catch (error) {
    console.error('❌ Error starting bot:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// POST /api/positions/stop - Stop the bot
router.post('/stop', async (req, res) => {
  try {
    if (!botState.isRunning || !botProcess) {
      return res.status(400).json({
        status: 'error',
        message: 'Bot is not running'
      });
    }

    // Gracefully terminate the bot process
    botProcess.kill('SIGTERM');
    
    // Wait for process to exit or force kill after timeout
    setTimeout(() => {
      if (botProcess && !botProcess.killed) {
        botProcess.kill('SIGKILL');
      }
    }, 5000);

    botState.isRunning = false;
    botState.lastUpdate = new Date().toISOString();

    res.json({
      status: 'success',
      message: 'Bot stopped successfully'
    });

    // Broadcast bot stop to WebSocket clients
    broadcastUpdate('botStatus', {
      isRunning: false,
      stopTime: botState.lastUpdate
    });

  } catch (error) {
    console.error('❌ Error stopping bot:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// POST /api/positions/close - Emergency close all positions
router.post('/close', async (req, res) => {
  try {
    // Path to the main CLI script
    const cliPath = path.resolve(__dirname, '../../../cli.js');
    
    // Execute close command
    const closeProcess = spawn('node', [cliPath, 'close'], {
      cwd: path.resolve(__dirname, '../../..'),
      env: process.env
    });

    let output = '';
    let error = '';

    closeProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    closeProcess.stderr.on('data', (data) => {
      error += data.toString();
    });

    closeProcess.on('close', (code) => {
      if (code === 0) {
        // Reset bot state
        botState.currentPosition = null;
        botState.pnl = { total: 0, percentage: 0, fees: 0 };
        botState.lastUpdate = new Date().toISOString();

        res.json({
          status: 'success',
          message: 'All positions closed successfully',
          output: output
        });

        // Broadcast position closure to WebSocket clients
        broadcastUpdate('positionClosed', {
          closeTime: botState.lastUpdate,
          output: output
        });
      } else {
        res.status(500).json({
          status: 'error',
          message: 'Failed to close positions',
          error: error,
          exitCode: code
        });
      }
    });

  } catch (error) {
    console.error('❌ Error closing positions:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Function to parse bot output and extract relevant information
function parseAndBroadcastBotOutput(output) {
  const lines = output.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    // Look for P&L updates
    if (line.includes('P&L:') || line.includes('USD')) {
      const pnlMatch = line.match(/P&L:\s*([+-]?\$?[\d,]+\.?\d*)/);
      const percentMatch = line.match(/([+-]?\d+\.?\d*)%/);
      const feesMatch = line.match(/Fees:\s*\$?([\d,]+\.?\d*)/);
      
      if (pnlMatch || percentMatch || feesMatch) {
        const updatedPnl = { ...botState.pnl };
        
        if (pnlMatch) {
          updatedPnl.total = parseFloat(pnlMatch[1].replace(/[$,]/g, ''));
        }
        if (percentMatch) {
          updatedPnl.percentage = parseFloat(percentMatch[1]);
        }
        if (feesMatch) {
          updatedPnl.fees = parseFloat(feesMatch[1].replace(/[$,]/g, ''));
        }
        
        botState.pnl = updatedPnl;
        botState.lastUpdate = new Date().toISOString();
        
        broadcastUpdate('pnl', updatedPnl);
      }
    }
    
    // Look for position information
    if (line.includes('Position:') || line.includes('Range:')) {
      // Extract position details and broadcast
      const positionInfo = line.trim();
      botState.currentPosition = positionInfo;
      botState.lastUpdate = new Date().toISOString();
      
      broadcastUpdate('position', {
        info: positionInfo,
        timestamp: botState.lastUpdate
      });
    }
    
    // Look for rebalance events
    if (line.includes('Rebalancing') || line.includes('rebalanced')) {
      botState.rebalanceCount += 1;
      botState.lastUpdate = new Date().toISOString();
      
      broadcastUpdate('rebalance', {
        count: botState.rebalanceCount,
        timestamp: botState.lastUpdate,
        info: line.trim()
      });
    }
  }
}

export default router;