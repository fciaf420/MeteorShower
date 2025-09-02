// MeteorShower Fee Calculation Utilities
// Consolidates priority fee estimation and transaction cost calculations

import BN from 'bn.js';
import { BASE_FEE_LAMPORTS, BASE_FEE_BN, TOKEN_ACCOUNT_SIZE, PREFLIGHT_SOL_BUFFER } from './constants.js';

/**
 * Calculate total transaction overhead including base fee, priority fee, and rent exemption
 * Returns BigInt for compatibility with BigInt-based balance calculations
 * 
 * @param {Connection} connection - Solana connection for rent calculation
 * @param {bigint} estPriorityLamports - Estimated priority fee in lamports (BigInt)
 * @returns {Promise<bigint>} Total overhead in lamports
 */
export async function calculateTransactionOverhead(connection, estPriorityLamports) {
  const rentExempt = BigInt(await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE));
  return rentExempt + estPriorityLamports + BASE_FEE_LAMPORTS + PREFLIGHT_SOL_BUFFER;
}

/**
 * Calculate maximum spendable amount after accounting for transaction costs
 * Returns BigInt for compatibility with BigInt-based balance calculations
 * 
 * @param {bigint} walletLamports - Current wallet balance in lamports (BigInt)
 * @param {Connection} connection - Solana connection for rent calculation  
 * @param {bigint} estPriorityLamports - Estimated priority fee in lamports (BigInt)
 * @returns {Promise<bigint>} Maximum spendable amount in lamports
 */
export async function calculateMaxSpendable(walletLamports, connection, estPriorityLamports) {
  const overhead = await calculateTransactionOverhead(connection, estPriorityLamports);
  const maxSpend = walletLamports - overhead;
  return maxSpend > 0n ? maxSpend : 0n;
}

/**
 * Calculate maximum spendable amount using BN arithmetic for DLMM operations
 * Returns BN for compatibility with DLMM SDK calculations
 * 
 * @param {BN} walletLamportsBN - Current wallet balance as BN
 * @param {BN} estPriorityLamportsBN - Estimated priority fee as BN
 * @returns {BN} Maximum spendable amount as BN
 */
export function calculateMaxSpendableBN(walletLamportsBN, estPriorityLamportsBN) {
  const baseFee = new BN(BASE_FEE_BN);
  const maxSpend = walletLamportsBN.sub(estPriorityLamportsBN).sub(baseFee);
  return maxSpend.gt(new BN(0)) ? maxSpend : new BN(0);
}

/**
 * Standardized priority fee estimation with fallback
 * Handles both the RPC-based estimation and fallback values consistently
 * 
 * @param {Connection} connection - Solana connection
 * @param {Transaction} estimationTx - Transaction to estimate fees for
 * @param {number} fallbackMicroLamports - Fallback fee in micro-lamports per compute unit
 * @returns {Promise<number>} Priority fee in micro-lamports per compute unit
 */
export async function estimatePriorityFee(connection, estimationTx, fallbackMicroLamports) {
  try {
    const response = await connection._rpcRequest('getPriorityFeeEstimate', {
      transaction: Buffer.from(estimationTx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64'),
      options: { includeAllPriorityFeeLevels: true }
    });
    
    if (response?.result?.priorityFeeEstimate) {
      const estimate = response.result.priorityFeeEstimate;
      return Math.max(estimate, 1000); // Minimum 1000 micro-lamports
    }
  } catch (error) {
    console.log(`⚠️ Priority fee estimation failed, using fallback: ${error.message}`);
  }
  
  return fallbackMicroLamports;
}