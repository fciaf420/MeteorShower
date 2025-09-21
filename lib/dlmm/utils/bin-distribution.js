/**
 * bin-distribution.js - Bin calculation and distribution utilities
 * Per REFACTORING_PLAN.md lines 113-122
 * 
 * Extracted from original dlmm.js lines 127-151 and 208-260
 */

import BN from 'bn.js';
import fetch from 'node-fetch';

// Configuration from environment
const {
  TOTAL_BINS_SPAN: ENV_TOTAL_BINS_SPAN,
  MANUAL = 'true',
  DITHER_ALPHA_API = 'http://0.0.0.0:8000/metrics',
  LOOKBACK = '30',
  LOWER_COEF = 0.5
} = process.env;

const MANUAL_MODE = String(MANUAL).toLowerCase() === 'true';
const DEFAULT_TOTAL_BINS_SPAN = Number(ENV_TOTAL_BINS_SPAN ?? 20);

/**
 * Debug helper: log per-bin distribution for a position
 * 
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {PublicKey} ownerPk - Owner public key
 * @param {PublicKey} positionPubKey - Position public key
 * @param {string} label - Label for logging
 */
export async function logPositionBinDistribution(dlmmPool, ownerPk, positionPubKey, label = 'Position bin distribution') {
  try {
    await dlmmPool.refetchStates();
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(ownerPk);
    const pos = userPositions.find(p => p.publicKey.equals(positionPubKey));
    if (!pos) {
      console.log(`[dist] ${label}: position not found`);
      return;
    }
    const bins = pos.positionData?.positionBinData || [];
    console.log(`[dist] ${label}: ${bins.length} bin records`);
    let nonZero = 0;
    for (const b of bins) {
      const x = new BN(b.positionXAmount);
      const y = new BN(b.positionYAmount);
      if (!x.isZero() || !y.isZero()) {
        nonZero++;
        console.log(`  • Bin ${b.binId}: X=${x.toString()} Y=${y.toString()}`);
      }
    }
    if (nonZero === 0) console.log('  • All bins empty');
  } catch (e) {
    console.warn(`[dist] Failed to log bin distribution: ${e?.message || e}`);
  }
}

/**
 * Resolve total bins span based on configuration or API
 * 
 * @param {Object} dlmmPool - DLMM pool instance
 * @returns {Promise<number>} Total bins span
 */
export async function resolveTotalBinsSpan(dlmmPool) {
  if (MANUAL_MODE) {
    console.log(`[config] MANUAL=true – using TOTAL_BINS_SPAN=${DEFAULT_TOTAL_BINS_SPAN}`);
    return DEFAULT_TOTAL_BINS_SPAN;
  }
  if (!DITHER_ALPHA_API || !LOOKBACK) {
    console.warn('[config] DITHER_ALPHA_API or LOOKBACK unset – using default span');
    return DEFAULT_TOTAL_BINS_SPAN;
  }
  
  // Attempt to read the pool's step size in basis‑points
  const stepBp = dlmmPool?.lbPair?.binStep ?? 
                 dlmmPool?.binStep ?? 
                 dlmmPool?.stepBp ?? 
                 dlmmPool?.stepBP ?? 
                 null;
                 
  if (stepBp == null) {
    console.warn('[config] Could not determine pool step_bp – using default span');
    return DEFAULT_TOTAL_BINS_SPAN;
  }

  // Compose API URL
  const mintA = dlmmPool.tokenX.publicKey.toString();
  const mintB = dlmmPool.tokenY.publicKey.toString();
  const url = `${DITHER_ALPHA_API}?mintA=${mintA}&mintB=${mintB}&lookback=${LOOKBACK}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[config] API fetch failed (${res.status} ${res.statusText}) – using default span`);
      return DEFAULT_TOTAL_BINS_SPAN;
    }
    
    const data = await res.json();
    const gridSweep = data?.grid_sweep ?? data?.pnl_drivers?.grid_sweep;
    
    if (!Array.isArray(gridSweep)) {
      console.warn('[config] grid_sweep missing – using default span');
      return DEFAULT_TOTAL_BINS_SPAN;
    }

    const match = gridSweep.find(g => Number(g.step_bp) === Number(stepBp));
    if (!match) {
      console.warn(`[config] No grid_sweep entry for step_bp=${stepBp} – default span`);
      return DEFAULT_TOTAL_BINS_SPAN;
    }
    
    const binsPerSide = Number(match.bins);
    if (!Number.isFinite(binsPerSide) || binsPerSide <= 0) {
      console.warn('[config] Invalid bins value – default span');
      return DEFAULT_TOTAL_BINS_SPAN;
    }
    
    const span = binsPerSide * 2; // convert per‑side → total
    console.log(`[config] Resolved TOTAL_BINS_SPAN=${span} via API (step_bp=${stepBp})`);
    return span;
  } catch (err) {
    console.warn('[config] Error fetching grid_sweep –', err?.message ?? err);
    return DEFAULT_TOTAL_BINS_SPAN;
  }
}

/**
 * Calculate bin range based on strategy and token ratio
 * 
 * @param {number} activeBinId - Active bin ID
 * @param {number} totalBinsSpan - Total bins span
 * @param {Object} tokenRatio - Token ratio {ratioX, ratioY}
 * @param {boolean} X_IS_SOL - Whether token X is SOL
 * @param {boolean} Y_IS_SOL - Whether token Y is SOL
 * @returns {Object} {minBin, maxBin}
 */
export function calculateBinRange(activeBinId, totalBinsSpan, tokenRatio, X_IS_SOL, Y_IS_SOL) {
  let minBin, maxBin;
  
  if (!tokenRatio) {
    // Default distribution
    const binsForSOL = Math.floor(totalBinsSpan * Number(LOWER_COEF));
    const binsForToken = Math.floor(totalBinsSpan * (1 - Number(LOWER_COEF)));
    minBin = activeBinId - binsForSOL;
    maxBin = activeBinId + binsForToken;
    return { minBin, maxBin };
  }
  
  // Calculate SOL percentage based on which token is SOL
  let solPercentage, tokenPercentage;
  if (X_IS_SOL) {
    solPercentage = tokenRatio.ratioX;
    tokenPercentage = tokenRatio.ratioY;
  } else if (Y_IS_SOL) {
    solPercentage = tokenRatio.ratioY;
    tokenPercentage = tokenRatio.ratioX;
  } else {
    // Neither is SOL - fallback to X/Y distribution
    solPercentage = tokenRatio.ratioX;
    tokenPercentage = tokenRatio.ratioY;
  }
  
  // Handle extreme allocations (100% one-sided)
  if (solPercentage === 1) {
    // 100% SOL
    if (X_IS_SOL) {
      minBin = activeBinId;
      maxBin = activeBinId + (totalBinsSpan - 1);
    } else if (Y_IS_SOL) {
      minBin = activeBinId - (totalBinsSpan - 1);
      maxBin = activeBinId;
    }
  } else if (solPercentage === 0) {
    // 100% token
    if (X_IS_SOL) {
      minBin = activeBinId - (totalBinsSpan - 1);
      maxBin = activeBinId;
    } else if (Y_IS_SOL) {
      minBin = activeBinId;
      maxBin = activeBinId + (totalBinsSpan - 1);
    }
  } else {
    // Mixed allocation - exact total bins and side-aware placement
    const nonActive = totalBinsSpan - 1;
    const solBinsExact = Math.floor(nonActive * solPercentage);
    const tokenBinsExact = nonActive - solBinsExact;
    const belowBins = X_IS_SOL ? tokenBinsExact : solBinsExact;
    const aboveBins = X_IS_SOL ? solBinsExact : tokenBinsExact;
    minBin = activeBinId - belowBins;
    maxBin = activeBinId + aboveBins;
  }
  
  console.log(`💡 Calculated bin range: ${minBin} to ${maxBin} (${maxBin - minBin + 1} bins)`);
  return { minBin, maxBin };
}

/**
 * Get default configuration values
 */
export function getDefaultConfig() {
  return {
    MANUAL_MODE,
    DEFAULT_TOTAL_BINS_SPAN,
    LOWER_COEF: Number(LOWER_COEF)
  };
}
