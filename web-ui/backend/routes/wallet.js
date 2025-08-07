// ───────────────────────────────────────────────
// ~/web-ui/backend/routes/wallet.js - Wallet information endpoints
// ───────────────────────────────────────────────
import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// GET /api/wallet/balance - Get wallet balance information
router.get('/balance', async (req, res) => {
  try {
    // Path to the balance prompt script
    const balancePath = path.resolve(__dirname, '../../../balance-prompt.js');
    
    // Execute balance check (we'll need to modify balance-prompt.js to support --json flag)
    const balanceProcess = spawn('node', [balancePath, '--json'], {
      cwd: path.resolve(__dirname, '../../..'),
      env: process.env
    });

    let output = '';
    let error = '';

    balanceProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    balanceProcess.stderr.on('data', (data) => {
      error += data.toString();
    });

    balanceProcess.on('close', (code) => {
      if (code === 0) {
        try {
          // Try to parse JSON output
          const balanceData = JSON.parse(output);
          res.json({
            status: 'success',
            data: balanceData
          });
        } catch (parseError) {
          // Fallback to parsing text output
          const balanceInfo = parseBalanceOutput(output);
          res.json({
            status: 'success',
            data: balanceInfo
          });
        }
      } else {
        res.status(500).json({
          status: 'error',
          message: 'Failed to fetch wallet balance',
          error: error,
          exitCode: code
        });
      }
    });

  } catch (error) {
    console.error('❌ Error fetching wallet balance:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// GET /api/wallet/address - Get wallet public key
router.get('/address', async (req, res) => {
  try {
    // Import wallet utility directly
    const { loadWalletKeypair } = await import('../../../lib/solana.js');
    const walletPath = process.env.WALLET_PATH;
    
    if (!walletPath) {
      return res.status(400).json({
        status: 'error',
        message: 'WALLET_PATH not configured'
      });
    }

    const keypair = loadWalletKeypair(walletPath);
    
    res.json({
      status: 'success',
      data: {
        address: keypair.publicKey.toBase58(),
        walletPath: walletPath
      }
    });

  } catch (error) {
    console.error('❌ Error getting wallet address:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Function to parse balance output text into structured data
function parseBalanceOutput(output) {
  const lines = output.split('\n').filter(line => line.trim());
  const balanceInfo = {
    totalBalance: 0,
    availableBalance: 0,
    reservedForFees: 0.07, // Default SOL buffer
    tokens: []
  };

  for (const line of lines) {
    // Parse total balance
    const totalMatch = line.match(/Total balance:\s*([\d.]+)\s*SOL/i);
    if (totalMatch) {
      balanceInfo.totalBalance = parseFloat(totalMatch[1]);
    }

    // Parse available balance
    const availableMatch = line.match(/Available for trading:\s*([\d.]+)\s*SOL/i);
    if (availableMatch) {
      balanceInfo.availableBalance = parseFloat(availableMatch[1]);
    }

    // Parse reserved amount
    const reservedMatch = line.match(/Reserved for fees:\s*([\d.]+)\s*SOL/i);
    if (reservedMatch) {
      balanceInfo.reservedForFees = parseFloat(reservedMatch[1]);
    }

    // Parse token balances (if any)
    const tokenMatch = line.match(/(\w+):\s*([\d.]+)/);
    if (tokenMatch && !line.includes('SOL') && !line.includes('balance')) {
      balanceInfo.tokens.push({
        symbol: tokenMatch[1],
        balance: parseFloat(tokenMatch[2])
      });
    }
  }

  return balanceInfo;
}

export default router;