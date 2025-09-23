// ───────────────────────────────────────────────
// ~/lib/dlmm/fee-analysis.js - Fee Analysis for DLMM Operations
// ───────────────────────────────────────────────

import BN from 'bn.js';
import { getPrice } from '../price.js';
import { SOL_MINT } from '../constants.js';
import { mapDlmmFees } from '../fee-mapping.js';

/**
 * Calculate the USD value of claimed fees from position closure
 * @param {Connection} connection - Solana connection
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {PublicKey} userPublicKey - User's wallet public key
 * @returns {Promise<Object>} Fee analysis with USD values
 */
export async function calculateClaimedFeeValues(connection, dlmmPool, userPublicKey) {
  try {
    console.log(`💰 [fee-analysis] Calculating claimed fee values...`);

    // Get current prices for USD conversion
    const solPrice = await getPrice(SOL_MINT.toString());
    const tokenPrice = await getPrice(dlmmPool.tokenX.publicKey.toString()) ||
                       await getPrice(dlmmPool.tokenY.publicKey.toString());

    if (!solPrice || !tokenPrice) {
      console.warn(`⚠️ [fee-analysis] Could not get current prices for fee calculation`);
      return { claimedFeesUsd: 0, unswappedFeesUsd: 0, trackedFeesUsd: 0 };
    }

    // For swapless mode, we estimate fees based on typical DLMM fee rates
    // Since fees were already claimed during position closure, we can't get exact amounts
    // This is a best-effort estimation for P&L tracking

    console.log(`📊 [fee-analysis] SOL price: $${solPrice.toFixed(2)}, Token price: $${tokenPrice.toFixed(6)}`);

    // Return minimal fee tracking for swapless mode
    const estimatedFeesUsd = 0; // Conservative estimate since we can't measure precisely

    return {
      claimedFeesUsd: 0, // No fees "claimed to SOL" in swapless mode
      unswappedFeesUsd: estimatedFeesUsd, // Fees kept as tokens
      trackedFeesUsd: estimatedFeesUsd // Total fees for P&L tracking
    };

  } catch (error) {
    console.warn(`⚠️ [fee-analysis] Fee calculation error: ${error.message}`);
    return { claimedFeesUsd: 0, unswappedFeesUsd: 0, trackedFeesUsd: 0 };
  }
}

/**
 * Analyze and convert fees to SOL after position closure
 * @param {Object} params - Analysis parameters
 * @returns {Promise<Object>} Fee conversion results
 */
export async function analyzeFees(params) {
  const { connection, userKeypair, dlmmPool, feeHandlingMode, minSwapUsd } = params;

  try {
    console.log(`💰 [fee-analysis] Analyzing fees with mode: ${feeHandlingMode}`);

    if (feeHandlingMode !== 'claim_to_sol') {
      console.log(`💡 [fee-analysis] Fee handling mode is ${feeHandlingMode}, skipping SOL conversion`);
      return { claimedFeesUsd: 0, unswappedFeesUsd: 0 };
    }

    // Get current token balances to identify claimable fees
    const { fetchBalances } = await import('./utils/wallet-scanner.js');
    const balances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);

    // Get current prices
    const solPrice = await getPrice(SOL_MINT.toString());
    const tokenMint = dlmmPool.tokenX.publicKey.equals(SOL_MINT) ?
                      dlmmPool.tokenY.publicKey : dlmmPool.tokenX.publicKey;
    const tokenPrice = await getPrice(tokenMint.toString());

    if (!solPrice || !tokenPrice) {
      console.warn(`⚠️ [fee-analysis] Could not get prices for fee analysis`);
      return { claimedFeesUsd: 0, unswappedFeesUsd: 0 };
    }

    // Determine which balance represents the fee tokens (non-SOL tokens)
    const isXSol = dlmmPool.tokenX.publicKey.equals(SOL_MINT);
    const feeTokenBalance = isXSol ? balances.lamY : balances.lamX;
    const feeTokenDecimals = isXSol ? dlmmPool.tokenY.decimals : dlmmPool.tokenX.decimals;

    // Convert to UI amount
    const feeTokenAmount = feeTokenBalance.toNumber() / Math.pow(10, feeTokenDecimals);
    const feeValueUsd = feeTokenAmount * tokenPrice;

    console.log(`💰 [fee-analysis] Fee token balance: ${feeTokenAmount.toFixed(6)} tokens (~$${feeValueUsd.toFixed(4)})`);

    // Check if fee value meets minimum swap threshold
    if (feeValueUsd < minSwapUsd) {
      console.log(`💡 [fee-analysis] Fee value $${feeValueUsd.toFixed(4)} below minimum $${minSwapUsd}, keeping as tokens`);
      return {
        claimedFeesUsd: 0,
        unswappedFeesUsd: feeValueUsd
      };
    }

    // TODO: Implement actual fee token swapping logic here
    // For now, return as unswapped
    console.log(`💡 [fee-analysis] Fee swapping not yet implemented, keeping $${feeValueUsd.toFixed(4)} as tokens`);

    return {
      claimedFeesUsd: 0, // Would be > 0 if we successfully swapped
      unswappedFeesUsd: feeValueUsd
    };

  } catch (error) {
    console.error(`❌ [fee-analysis] Fee analysis failed: ${error.message}`);
    return { claimedFeesUsd: 0, unswappedFeesUsd: 0 };
  }
}

/**
 * Convert raw fee amounts to USD values
 * @param {BN} solFee - SOL fee amount in lamports
 * @param {BN} tokenFee - Token fee amount in token units
 * @param {number} solPrice - Current SOL price in USD
 * @param {number} tokenPrice - Current token price in USD
 * @param {number} tokenDecimals - Token decimal places
 * @returns {Object} USD fee values
 */
export function convertFeesToUsd(solFee, tokenFee, solPrice, tokenPrice, tokenDecimals) {
  const solFeeUsd = (solFee.toNumber() / 1e9) * solPrice; // SOL has 9 decimals
  const tokenFeeUsd = (tokenFee.toNumber() / Math.pow(10, tokenDecimals)) * tokenPrice;

  return {
    solFeeUsd,
    tokenFeeUsd,
    totalFeeUsd: solFeeUsd + tokenFeeUsd
  };
}