// ───────────────────────────────────────────────
// ~/lib/price.js
// ───────────────────────────────────────────────
import fetch from 'node-fetch';
import { URL } from 'url';

async function getPrice(mint) {
  try {
    // Ultra API configuration
    const config = {
      baseUrl: process.env.JUPITER_API_BASE_URL || 'https://api.jup.ag/ultra',
      apiKey: process.env.JUPITER_API_KEY || null
    };
    
    // Remove trailing /ultra if present
    config.baseUrl = config.baseUrl.replace(/\/ultra\/?$/, '');
    
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['x-api-key'] = config.apiKey;
    }

    // Ultra API endpoint
    const url = `${config.baseUrl}/ultra/v1/search?query=${mint}`;
    const res = await fetch(url, { headers });
    
    if (!res.ok) {
      console.error(`[getPrice] HTTP ${res.status} for mint ${mint}`);
      return null;
    }

    const json = await res.json();
    
    // Parse Ultra API response format
    const data = json && Array.isArray(json) && json.length > 0 ? json[0] : null;
    if (!data || data.usdPrice == null) {
      console.error(`[getPrice] no price field for mint ${mint}`);
      return null;
    }

    const px = typeof data.usdPrice === "number"
      ? data.usdPrice
      : parseFloat(data.usdPrice);

    return Number.isFinite(px) ? px : null;
  } catch (err) {
    console.error(`[getPrice] exception for mint ${mint}: ${err.message}`);
    return null;
  }
}
export { getPrice };