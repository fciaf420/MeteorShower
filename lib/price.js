// ───────────────────────────────────────────────
// ~/lib/price.js
// ───────────────────────────────────────────────
import fetch from 'node-fetch';
import { URL } from 'url';

// Cache global para evitar múltiplas chamadas
const priceCache = new Map();
const cache = new Map();
const RATE_LIMIT_MS = 8000; // 8 segundos entre chamadas
let lastRequestTime = 0;

// Ultra API configuration
async function getJupiterConfig() {
  const config = {
    baseUrl: process.env.JUPITER_API_BASE_URL || 'https://api.jup.ag/ultra',
    apiKey: process.env.JUPITER_API_KEY || null
  };
  
  // Remove trailing /ultra if present
  config.baseUrl = config.baseUrl.replace(/\/ultra\/?$/, '');
  
  return config;
}

async function getPrice(mint) {
  try {
    // Check cache first
    const cached = cache.get(mint);
    if (cached && (Date.now() - cached.timestamp) < 60000) { // 60s cache
      return cached.price;
    }

    // Get Jupiter config
    const config = await getJupiterConfig();
    
    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_MS) {
      const waitTime = RATE_LIMIT_MS - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastRequestTime = Date.now();

    // Prepare headers
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['x-api-key'] = config.apiKey;
    }

    // Ultra API endpoint
    const url = `${config.baseUrl}/ultra/v1/search?query=${mint}`;
    const res = await fetch(url, { headers });
    
    if (!res.ok) {
      if (res.status === 429) {
        // Exponential backoff on rate limit
        await new Promise(resolve => setTimeout(resolve, Math.min(30000, RATE_LIMIT_MS * 2)));
      }
      // Silent error for logs
      return null;
    }

    const json = await res.json();
    
    // Parse Ultra API response format
    const data = json && Array.isArray(json) && json.length > 0 ? json[0] : null;
    if (!data || data.usdPrice == null) {
      return null;
    }

    const price = typeof data.usdPrice === "number"
      ? data.usdPrice
      : parseFloat(data.usdPrice);

    if (!Number.isFinite(price)) {
      return null;
    }

    // Cache result
    cache.set(mint, { price, timestamp: Date.now() });
    
    return price;
  } catch (err) {
    // Silent error for production
    return null;
  }
}

// Batch get prices for multiple tokens
async function getPrices(mints) {
  if (!mints || mints.length === 0) return {};
  
  const results = {};
  const mintsToFetch = [];
  
  // Check cache first
  for (const mint of mints) {
    const cached = cache.get(mint);
    if (cached && (Date.now() - cached.timestamp) < 60000) {
      results[mint] = cached.price;
    } else {
      mintsToFetch.push(mint);
    }
  }

  if (mintsToFetch.length === 0) {
    return results;
  }

  try {
    const config = await getJupiterConfig();
    
    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_MS) {
      const waitTime = RATE_LIMIT_MS - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastRequestTime = Date.now();

    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['x-api-key'] = config.apiKey;
    }

    // Batch fetch via individual calls (Ultra API limitation)
    for (const mint of mintsToFetch) {
      try {
        const url = `${config.baseUrl}/ultra/v1/search?query=${mint}`;
        const res = await fetch(url, { headers });
        
        if (res.ok) {
          const json = await res.json();
          const data = json && Array.isArray(json) && json.length > 0 ? json[0] : null;
          if (data && data.usdPrice) {
            const price = typeof data.usdPrice === "number" ? data.usdPrice : parseFloat(data.usdPrice);
            if (Number.isFinite(price)) {
              results[mint] = price;
              cache.set(mint, { price, timestamp: Date.now() });
            }
          }
        }
        
        // Small delay between requests to avoid rate limits
        if (mintsToFetch.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err) {
        // Continue with next mint
        continue;
      }
    }
    
    return results;
  } catch (err) {
    return results; // Return cached prices only
  }
}

export { getPrice, getPrices };