/**
 * wallet-scanner.js - Wallet token scanning utilities
 * Per REFACTORING_PLAN.md lines 103-111
 * 
 * Extracted from original dlmm.js lines 47-103 and 262-275
 */

import BN from 'bn.js';
import { safeGetBalance, getMintDecimals } from '../../solana.js';

/**
 * Scans wallet for tokens that match the DLMM pool's token mints
 * Only returns tokens that are part of the LP pair to avoid using random tokens
 * 
 * @param {Connection} connection - Solana connection
 * @param {Keypair} userKeypair - User wallet keypair
 * @param {Object} dlmmPool - DLMM pool instance
 * @returns {Promise<Object>} Token balances and metadata
 */
export async function scanWalletForCompatibleTokens(connection, userKeypair, dlmmPool) {
  try {
    const tokenXMint = dlmmPool.tokenX.publicKey.toBase58();
    const tokenYMint = dlmmPool.tokenY.publicKey.toBase58();
    
    console.log(`🔍 DEBUG: Scanning wallet for tokens:`);
    console.log(`   Looking for Token X: ${tokenXMint.slice(0,8)}...`);
    console.log(`   Looking for Token Y: ${tokenYMint.slice(0,8)}...`);
    
    // Get wallet balances for the LP pair tokens only
    const walletTokenX = await safeGetBalance(connection, dlmmPool.tokenX.publicKey, userKeypair.publicKey);
    const walletTokenY = await safeGetBalance(connection, dlmmPool.tokenY.publicKey, userKeypair.publicKey);
    
    console.log(`   Raw wallet balances: X=${walletTokenX.toString()}, Y=${walletTokenY.toString()}`);
    
    // Ensure decimals are available before using them
    let dx = dlmmPool.tokenX.decimal;
    let dy = dlmmPool.tokenY.decimal;
    
    if (typeof dx !== 'number') {
      dx = await getMintDecimals(connection, dlmmPool.tokenX.publicKey);
      dlmmPool.tokenX.decimal = dx;
      console.log(`   ⚠️  Had to fetch Token X decimals: ${dx}`);
    }
    if (typeof dy !== 'number') {
      dy = await getMintDecimals(connection, dlmmPool.tokenY.publicKey);
      dlmmPool.tokenY.decimal = dy;
      console.log(`   ⚠️  Had to fetch Token Y decimals: ${dy}`);
    }
    
    const tokenXAmount = walletTokenX.toNumber() / 10 ** dx;
    const tokenYAmount = walletTokenY.toNumber() / 10 ** dy;
    
    console.log(`   Converted amounts: X=${tokenXAmount.toFixed(9)}, Y=${tokenYAmount.toFixed(9)}`);
    
    return {
      walletTokenX,
      walletTokenY,
      tokenXAmount,
      tokenYAmount,
      tokenXMint,
      tokenYMint
    };
  } catch (error) {
    console.log(`⚠️  Error scanning wallet for compatible tokens: ${error.message}`);
    console.log(`   Stack trace:`, error.stack);
    // Return empty balances on error
    return {
      walletTokenX: new BN(0),
      walletTokenY: new BN(0),
      tokenXAmount: 0,
      tokenYAmount: 0,
      tokenXMint: '',
      tokenYMint: ''
    };
  }
}

/**
 * Fetch token balances for a given owner
 * 
 * @param {Connection} connection - Solana connection
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {PublicKey} ownerPk - Owner public key
 * @returns {Promise<Object>} Token balances in lamports
 */
export async function fetchBalances(connection, dlmmPool, ownerPk) {
  return {
    lamX: await safeGetBalance(
      connection,
      dlmmPool.tokenX.publicKey,
      ownerPk
    ),
    lamY: await safeGetBalance(
      connection,
      dlmmPool.tokenY.publicKey,
      ownerPk
    ),
  };
}

/**
 * Check if wallet has sufficient balance for operation
 * 
 * @param {BN} requiredAmount - Required amount in lamports
 * @param {BN} walletBalance - Wallet balance in lamports
 * @returns {boolean} True if sufficient balance
 */
export function hasSufficientBalance(requiredAmount, walletBalance) {
  return walletBalance.gte(requiredAmount);
}

/**
 * Format balance for display
 * 
 * @param {BN} lamports - Amount in lamports
 * @param {number} decimals - Token decimals
 * @returns {string} Formatted balance string
 */
export function formatBalance(lamports, decimals) {
  const amount = lamports.toNumber() / Math.pow(10, decimals);
  return amount.toFixed(Math.min(decimals, 9));
}
