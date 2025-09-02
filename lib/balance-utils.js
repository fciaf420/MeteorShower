// MeteorShower Balance Utilities
// Standardizes balance fetching and type conversions across modules

import BN from 'bn.js';

/**
 * Fetch SOL balance and return as BigInt for consistent precision
 * 
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} publicKey - Wallet public key
 * @param {string} commitment - Commitment level (default: 'confirmed')
 * @returns {Promise<bigint>} SOL balance in lamports as BigInt
 */
export async function getSolBalanceBigInt(connection, publicKey, commitment = 'confirmed') {
  const balance = await connection.getBalance(publicKey, commitment);
  return BigInt(balance);
}

/**
 * Fetch SOL balance and return as BN for DLMM SDK compatibility
 * 
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} publicKey - Wallet public key
 * @param {string} commitment - Commitment level (default: 'confirmed')
 * @returns {Promise<BN>} SOL balance in lamports as BN
 */
export async function getSolBalanceBN(connection, publicKey, commitment = 'confirmed') {
  const balance = await connection.getBalance(publicKey, commitment);
  return new BN(balance);
}

/**
 * Convert BigInt to BN safely
 * 
 * @param {bigint} value - BigInt value to convert
 * @returns {BN} BN representation of the value
 */
export function bigIntToBN(value) {
  return new BN(value.toString());
}

/**
 * Convert BN to BigInt safely
 * 
 * @param {BN} value - BN value to convert
 * @returns {bigint} BigInt representation of the value
 */
export function bnToBigInt(value) {
  return BigInt(value.toString());
}

/**
 * Convert number to both BigInt and BN for dual compatibility
 * 
 * @param {number} value - Number value to convert
 * @returns {Object} Object with both bigint and bn properties
 */
export function numberToBoth(value) {
  return {
    bigint: BigInt(value),
    bn: new BN(value)
  };
}

/**
 * Safe comparison between different numeric types
 * 
 * @param {bigint|BN|number} a - First value
 * @param {bigint|BN|number} b - Second value
 * @returns {number} -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareNumbers(a, b) {
  // Normalize both values to strings for comparison
  const aStr = a.toString();
  const bStr = b.toString();
  
  if (aStr === bStr) return 0;
  return BigInt(aStr) < BigInt(bStr) ? -1 : 1;
}

/**
 * Format lamports to SOL with specified decimal places
 * 
 * @param {bigint|BN|number} lamports - Amount in lamports
 * @param {number} decimals - Number of decimal places (default: 4)
 * @returns {string} Formatted SOL amount
 */
export function formatSol(lamports, decimals = 4) {
  const sol = Number(lamports.toString()) / 1e9;
  return sol.toFixed(decimals);
}