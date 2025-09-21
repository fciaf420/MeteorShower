/**
 * validation.js - Input validation utilities
 * Per REFACTORING_PLAN.md lines 38-41
 * 
 * New module for centralized input validation
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

/**
 * Validate Solana public key
 * 
 * @param {string|PublicKey} address - Address to validate
 * @returns {boolean} True if valid
 */
export function isValidPublicKey(address) {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate SOL amount
 * 
 * @param {number|string} amount - Amount to validate
 * @returns {boolean} True if valid
 */
export function isValidSolAmount(amount) {
  if (amount === null || amount === undefined) return true; // null is valid (unlimited)
  const num = Number(amount);
  return Number.isFinite(num) && num > 0;
}

/**
 * Validate token ratio
 * 
 * @param {Object} tokenRatio - Token ratio object
 * @returns {boolean} True if valid
 */
export function isValidTokenRatio(tokenRatio) {
  if (!tokenRatio) return true; // null is valid (use default)
  
  if (typeof tokenRatio !== 'object') return false;
  
  const { ratioX, ratioY } = tokenRatio;
  
  if (typeof ratioX !== 'number' || typeof ratioY !== 'number') return false;
  if (ratioX < 0 || ratioY < 0) return false;
  if (ratioX + ratioY !== 1) return false;
  
  return true;
}

/**
 * Validate bin span
 * 
 * @param {number} binSpan - Bin span value
 * @returns {boolean} True if valid
 */
export function isValidBinSpan(binSpan) {
  if (!binSpan) return true; // null is valid (use default)
  const num = Number(binSpan);
  return Number.isFinite(num) && num > 0 && num <= 1400;
}

/**
 * Validate BN amount
 * 
 * @param {BN} amount - Amount to validate
 * @returns {boolean} True if valid
 */
export function isValidBNAmount(amount) {
  if (!amount) return false;
  if (!(amount instanceof BN)) return false;
  return !amount.isNeg();
}

/**
 * Validate liquidity strategy
 * 
 * @param {string} strategy - Strategy name
 * @param {Object} StrategyType - Strategy type enum
 * @returns {boolean} True if valid
 */
export function isValidLiquidityStrategy(strategy, StrategyType) {
  if (!strategy) return true; // null is valid (use default)
  return strategy in StrategyType;
}

/**
 * Validate swapless options
 * 
 * @param {Object} options - Swapless options
 * @returns {boolean} True if valid
 */
export function isValidSwaplessOptions(options) {
  if (!options) return true; // null is valid (not swapless)
  
  if (typeof options !== 'object') return false;
  
  const { swapless, swaplessSpan, direction } = options;
  
  if (typeof swapless !== 'boolean') return false;
  
  if (swapless) {
    if (swaplessSpan && !isValidBinSpan(swaplessSpan)) return false;
    if (direction && !['UP', 'DOWN'].includes(direction)) return false;
  }
  
  return true;
}

/**
 * Validate position parameters
 * 
 * @param {Object} params - Position parameters
 * @returns {Object} Validation result {valid: boolean, errors: string[]}
 */
export function validatePositionParams(params) {
  const errors = [];
  
  const {
    connection,
    userKeypair,
    solAmount,
    tokenRatio,
    binSpan,
    poolAddress,
    liquidityStrategy,
    swaplessOptions
  } = params;
  
  // Required parameters
  if (!connection) errors.push('Connection is required');
  if (!userKeypair) errors.push('User keypair is required');
  
  // Optional parameters validation
  if (solAmount !== null && solAmount !== undefined && !isValidSolAmount(solAmount)) {
    errors.push('Invalid SOL amount');
  }
  
  if (tokenRatio && !isValidTokenRatio(tokenRatio)) {
    errors.push('Invalid token ratio - must sum to 1');
  }
  
  if (binSpan && !isValidBinSpan(binSpan)) {
    errors.push('Invalid bin span - must be between 1 and 200');
  }
  
  if (poolAddress && !isValidPublicKey(poolAddress)) {
    errors.push('Invalid pool address');
  }
  
  if (swaplessOptions && !isValidSwaplessOptions(swaplessOptions)) {
    errors.push('Invalid swapless options');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Sanitize and normalize input parameters
 * 
 * @param {Object} params - Raw parameters
 * @returns {Object} Sanitized parameters
 */
export function sanitizeParams(params) {
  const sanitized = { ...params };
  
  // Normalize SOL amount
  if (sanitized.solAmount !== null && sanitized.solAmount !== undefined) {
    sanitized.solAmount = Number(sanitized.solAmount);
  }
  
  // Normalize bin span
  if (sanitized.binSpan) {
    sanitized.binSpan = Number(sanitized.binSpan);
  }
  
  // Ensure pool address is PublicKey
  if (sanitized.poolAddress && !(sanitized.poolAddress instanceof PublicKey)) {
    sanitized.poolAddress = new PublicKey(sanitized.poolAddress);
  }
  
  return sanitized;
}
