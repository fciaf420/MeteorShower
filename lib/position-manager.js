// ───────────────────────────────────────────────
// ~/lib/position-manager.js
// ───────────────────────────────────────────────

import { recenterPosition, openDlmmPosition } from './dlmm.js';

/**
 * Position management utilities that use DLMM functions
 * This module provides higher-level position management operations
 */

/**
 * Rebalance a DLMM position with logging and error handling
 * @param {Connection} connection - Solana connection
 * @param {Object} dlmmPool - DLMM pool instance  
 * @param {Keypair} userKeypair - User wallet keypair
 * @param {PublicKey} positionPubKey - Current position public key
 * @param {Object} originalParams - Original position parameters
 * @param {string} direction - Direction of rebalancing ('UP' or 'DOWN')
 * @returns {Promise<Object>} New position details
 */
export async function rebalancePosition(connection, dlmmPool, userKeypair, positionPubKey, originalParams, direction) {
  console.log(`🔄 Starting position rebalancing - Direction: ${direction}`);
  
  try {
    const result = await recenterPosition(
      connection, 
      dlmmPool, 
      userKeypair, 
      positionPubKey, 
      originalParams, 
      direction
    );
    
    console.log(`✅ Position rebalancing completed successfully`);
    return result;
    
  } catch (error) {
    console.error(`❌ Position rebalancing failed: ${error.message}`);
    throw error;
  }
}

/**
 * Create a new DLMM position with enhanced logging
 * @param {Connection} connection - Solana connection
 * @param {Keypair} userKeypair - User wallet keypair
 * @param {Object} params - Position parameters
 * @returns {Promise<Object>} Position creation result
 */
export async function createPosition(connection, userKeypair, params) {
  console.log(`🎯 Creating new DLMM position with parameters:`, params);
  
  try {
    const result = await openDlmmPosition(
      connection,
      userKeypair,
      params.solAmount,
      params.tokenRatio,
      params.binSpan,
      params.poolAddress,
      params.liquidityStrategy,
      params.swaplessOptions,
      params.providedBalances,
      params.skipExistingCheck,
      params.callbacks
    );
    
    console.log(`✅ DLMM position created successfully`);
    return result;
    
  } catch (error) {
    console.error(`❌ DLMM position creation failed: ${error.message}`);
    throw error;
  }
}
