/**
 * SOL Position Mapping Utilities
 * Handles dynamic SOL position (X or Y) based on lexicographic token sorting
 */

import { SOL_MINT } from '../../constants.js';

/**
 * Map user's SOL/Token ratio intent to correct tokenX/tokenY ratios
 * Handles the fact that SOL can be either tokenX or tokenY depending on the other token
 * 
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {number} solRatio - User's desired SOL ratio (0.0 to 1.0)
 * @param {number} tokenRatio - User's desired non-SOL token ratio (0.0 to 1.0)
 * @returns {Object} Mapped ratios for tokenX and tokenY
 */
export function mapSolTokenRatios(dlmmPool, solRatio, tokenRatio) {
  const X_IS_SOL = dlmmPool.tokenX.publicKey.toString() === SOL_MINT.toString();
  const Y_IS_SOL = dlmmPool.tokenY.publicKey.toString() === SOL_MINT.toString();
  
  // Validation
  if (!X_IS_SOL && !Y_IS_SOL) {
    throw new Error('Neither token is SOL - cannot map SOL ratios');
  }
  if (X_IS_SOL && Y_IS_SOL) {
    throw new Error('Both tokens are SOL - invalid pool configuration');
  }
  
  // Map user intent to SDK positions
  let ratioX, ratioY;
  
  if (X_IS_SOL) {
    // SOL is tokenX, other token is tokenY
    ratioX = solRatio;
    ratioY = tokenRatio;
  } else {
    // SOL is tokenY, other token is tokenX  
    ratioX = tokenRatio;
    ratioY = solRatio;
  }
  
  return {
    ratioX,
    ratioY,
    solPosition: X_IS_SOL ? 'X' : 'Y',
    tokenPosition: X_IS_SOL ? 'Y' : 'X',
    mapping: {
      [`${X_IS_SOL ? 'SOL' : 'TOKEN'}(X)`]: ratioX,
      [`${Y_IS_SOL ? 'SOL' : 'TOKEN'}(Y)`]: ratioY
    }
  };
}

/**
 * Convert user's percentage-based intent to tokenX/tokenY ratios
 * Example: "I want 70% SOL, 30% USDC" -> maps to correct X/Y ratios
 * 
 * @param {Object} dlmmPool - DLMM pool instance  
 * @param {number} solPercent - SOL percentage (0-100)
 * @param {number} tokenPercent - Token percentage (0-100)
 * @returns {Object} Mapped ratios and metadata
 */
export function convertUserRatiosToTokenRatios(dlmmPool, solPercent, tokenPercent) {
  // Validate percentages
  if (Math.abs(solPercent + tokenPercent - 100) > 0.01) {
    throw new Error(`Percentages must sum to 100: ${solPercent}% + ${tokenPercent}% = ${solPercent + tokenPercent}%`);
  }
  
  // Convert to 0-1 ratios
  const solRatio = solPercent / 100;
  const tokenRatio = tokenPercent / 100;
  
  // Map to tokenX/tokenY positions
  const mapping = mapSolTokenRatios(dlmmPool, solRatio, tokenRatio);
  
  return {
    ...mapping,
    userIntent: {
      solPercent,
      tokenPercent,
      solRatio,
      tokenRatio
    }
  };
}

/**
 * Get SOL position and metadata for a pool
 * 
 * @param {Object} dlmmPool - DLMM pool instance
 * @returns {Object} SOL position metadata
 */
export function getSolPositionInfo(dlmmPool) {
  const X_IS_SOL = dlmmPool.tokenX.publicKey.toString() === SOL_MINT.toString();
  const Y_IS_SOL = dlmmPool.tokenY.publicKey.toString() === SOL_MINT.toString();
  
  return {
    hasSol: X_IS_SOL || Y_IS_SOL,
    solPosition: X_IS_SOL ? 'X' : (Y_IS_SOL ? 'Y' : null),
    tokenPosition: X_IS_SOL ? 'Y' : (Y_IS_SOL ? 'X' : null),
    X_IS_SOL,
    Y_IS_SOL,
    solSymbol: X_IS_SOL ? dlmmPool.tokenX.symbol : (Y_IS_SOL ? dlmmPool.tokenY.symbol : null),
    tokenSymbol: X_IS_SOL ? dlmmPool.tokenY.symbol : (Y_IS_SOL ? dlmmPool.tokenX.symbol : null),
    poolName: `${dlmmPool.tokenX.symbol || 'TOKEN_X'}/${dlmmPool.tokenY.symbol || 'TOKEN_Y'}`
  };
}

/**
 * Log detailed ratio mapping for debugging
 * 
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {number} solPercent - SOL percentage
 * @param {number} tokenPercent - Token percentage
 */
export function logRatioMapping(dlmmPool, solPercent, tokenPercent) {
  try {
    const mapping = convertUserRatiosToTokenRatios(dlmmPool, solPercent, tokenPercent);
    const solInfo = getSolPositionInfo(dlmmPool);
    
    console.log(`🔄 Dynamic SOL Position Mapping:`);
    console.log(`   Pool: ${solInfo.poolName}`);
    console.log(`   SOL Position: token${mapping.solPosition} (${solInfo.solSymbol})`);
    console.log(`   Token Position: token${mapping.tokenPosition} (${solInfo.tokenSymbol})`);
    console.log(`   User Intent: ${solPercent}% SOL, ${tokenPercent}% ${solInfo.tokenSymbol}`);
    console.log(`   SDK Mapping: ratioX=${mapping.ratioX}, ratioY=${mapping.ratioY}`);
    console.log(`   Verification: ${JSON.stringify(mapping.mapping, null, 2).replace(/\n/g, '\n     ')}`);
    
  } catch (error) {
    console.error(`❌ Ratio mapping error:`, error.message);
  }
}
