// ───────────────────────────────────────────────
// ~/web-ui/backend/routes/config.js - Configuration endpoints
// ───────────────────────────────────────────────
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// GET /api/config - Get current configuration
router.get('/', async (req, res) => {
  try {
    const envPath = path.resolve(__dirname, '../../../.env');
    
    // Read .env file
    const envContent = await fs.readFile(envPath, 'utf8');
    const config = parseEnvContent(envContent);
    
    res.json({
      status: 'success',
      data: config
    });

  } catch (error) {
    console.error('❌ Error reading configuration:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// POST /api/config - Update configuration
router.post('/', async (req, res) => {
  try {
    const updates = req.body;
    const envPath = path.resolve(__dirname, '../../../.env');
    
    // Read current .env file
    let envContent = '';
    try {
      envContent = await fs.readFile(envPath, 'utf8');
    } catch (readError) {
      // If .env doesn't exist, start with empty content
      console.log('Creating new .env file');
    }

    // Update configuration
    const updatedContent = updateEnvContent(envContent, updates);
    
    // Write updated .env file
    await fs.writeFile(envPath, updatedContent, 'utf8');
    
    // Return updated configuration
    const newConfig = parseEnvContent(updatedContent);
    
    res.json({
      status: 'success',
      message: 'Configuration updated successfully',
      data: newConfig
    });

  } catch (error) {
    console.error('❌ Error updating configuration:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// GET /api/config/pools - Get available pool information
router.get('/pools', async (req, res) => {
  try {
    // This would ideally fetch from Meteora API or maintain a pool registry
    // For now, return a basic structure
    const pools = [
      {
        address: "Cs6MuBEhUznVN9JWKcnfqm4JesbhwKZ2Nh7PMj2zd1P8",
        name: "SOL/USDC",
        tokenX: "SOL",
        tokenY: "USDC",
        fee: "0.25%",
        apy: "12.5%",
        tvl: "$1.2M"
      },
      {
        address: "2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv",
        name: "SOL/USDT",
        tokenX: "SOL",
        tokenY: "USDT",
        fee: "0.25%",
        apy: "10.8%",
        tvl: "$890K"
      }
    ];

    res.json({
      status: 'success',
      data: pools
    });

  } catch (error) {
    console.error('❌ Error fetching pools:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Validation middleware for configuration updates
router.use('/validate', (req, res, next) => {
  const { config } = req.body;
  const errors = [];

  // Validate required fields
  if (config.POOL_ADDRESS && !isValidSolanaAddress(config.POOL_ADDRESS)) {
    errors.push('Invalid pool address format');
  }

  if (config.TOTAL_BINS_SPAN && (config.TOTAL_BINS_SPAN < 1 || config.TOTAL_BINS_SPAN > 100)) {
    errors.push('Bin span must be between 1 and 100');
  }

  if (config.TAKE_PROFIT_PERCENT && (config.TAKE_PROFIT_PERCENT < 0.1 || config.TAKE_PROFIT_PERCENT > 200)) {
    errors.push('Take profit must be between 0.1% and 200%');
  }

  if (config.STOP_LOSS_PERCENT && (config.STOP_LOSS_PERCENT < 0.1 || config.STOP_LOSS_PERCENT > 100)) {
    errors.push('Stop loss must be between 0.1% and 100%');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      message: 'Configuration validation failed',
      errors: errors
    });
  }

  next();
});

// POST /api/config/validate - Validate configuration without saving
router.post('/validate', (req, res) => {
  res.json({
    status: 'success',
    message: 'Configuration is valid'
  });
});

// Helper functions
function parseEnvContent(content) {
  const config = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        const cleanKey = key.trim();
        const cleanValue = value.replace(/^["']|["']$/g, ''); // Remove quotes
        
        // Only include valid configuration keys, filter out any invalid data
        if (cleanKey && cleanValue && !cleanKey.startsWith('data.') && cleanKey.length < 100) {
          config[cleanKey] = cleanValue;
        }
      }
    }
  }
  
  return config;
}

function updateEnvContent(content, updates) {
  const lines = content.split('\n');
  const existingKeys = new Set();
  
  // Update existing keys
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#')) {
      const [key] = line.split('=');
      if (key && updates.hasOwnProperty(key.trim())) {
        const cleanKey = key.trim();
        lines[i] = `${cleanKey}=${updates[cleanKey]}`;
        existingKeys.add(cleanKey);
      }
    }
  }
  
  // Add new keys
  for (const [key, value] of Object.entries(updates)) {
    if (!existingKeys.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }
  
  return lines.join('\n');
}

function isValidSolanaAddress(address) {
  // Basic Solana address validation (base58, 44 characters)
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

export default router;