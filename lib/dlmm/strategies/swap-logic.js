/**
 * swap-logic.js - Token swapping and balancing utilities  
 * Per REFACTORING_PLAN.md lines 91-101
 * 
 * Extracted from original dlmm.js lines 430-545
 */

import BN from 'bn.js';
import { swapTokensUltra } from '../../jupiter.js';
import { getSolBalanceBN } from '../../balance-utils.js';
import { getPrice } from '../../price.js';
import { SOL_MINT, MINIMUM_SOL_RESERVE_BN } from '../../constants.js';
import { handleError, ERROR_CODES } from '../handlers/error-handler.js';
import { logger } from '../../logger.js';
import { getSolPositionInfo } from '../utils/sol-position-mapper.js';

/**
 * Balance tokens to achieve desired ratio
 * 
 * @param {Object} params - Balancing parameters
 * @returns {Promise<Object>} Swap result
 */
export async function balanceTokenRatio(params) {
  const {
    connection,
    userKeypair,
    dlmmPool,
    lamX,
    lamY,
    tokenRatio,
    solAmount,
    swaplessOptions,
    slippageBps = 10,
    priceImpactPct = 0.5
  } = params;
  
  // Extract token info
  const dx = dlmmPool.tokenX.decimal;
  const dy = dlmmPool.tokenY.decimal;
  const X_MINT = dlmmPool.tokenX.publicKey.toString();
  const Y_MINT = dlmmPool.tokenY.publicKey.toString();
  const X_IS_SOL = X_MINT === SOL_MINT.toString();
  const Y_IS_SOL = Y_MINT === SOL_MINT.toString();
  
  // Check if swapless mode
  if (swaplessOptions?.swapless) {
    console.log(`💡 Swapless mode: Using existing balances without swapping`);
    return {
      success: true,
      swapped: false,
      lamX,
      lamY
    };
  }
  
  // Get token prices
  const priceX = await getPrice(X_MINT);
  const priceY = await getPrice(Y_MINT);
  
  // CRITICAL: Check prices BEFORE using them (like working backup)
  if (priceX == null || priceY == null) {
    throw handleError(
      new Error('Price feed unavailable for one of the pool tokens'),
      'balanceTokenRatio',
      { X_MINT, Y_MINT, priceX, priceY }
    );
  }
  
  // Calculate current USD values (now guaranteed priceX/priceY are not null)
  const usdX = lamX.toNumber() / 10 ** dx * priceX;
  const usdY = lamY.toNumber() / 10 ** dy * priceY;
  const totalUsd = usdX + usdY;
  
  // Skip if no meaningful balance or no ratio specified
  if (!tokenRatio || totalUsd < 0.01) {
    return {
      success: true,
      swapped: false,
      lamX,
      lamY
    };
  }
  
  // Calculate target allocations
  let budgetUsd = totalUsd;
  if (solAmount !== null && Number.isFinite(solAmount)) {
    const solPrice = X_IS_SOL ? priceX : (Y_IS_SOL ? priceY : null);
    if (solPrice) {
      budgetUsd = solAmount * solPrice;
      console.log(`Using ${solAmount} SOL budget ($${budgetUsd.toFixed(2)} USD) for target allocation`);
    }
  }
  
  const targetUsdX = budgetUsd * tokenRatio.ratioX;
  const targetUsdY = budgetUsd * tokenRatio.ratioY;
  const diffUsdX = targetUsdX - usdX;
  
  console.log(`Current: $${usdX.toFixed(2)} X, $${usdY.toFixed(2)} Y`);
  console.log(`Target: $${targetUsdX.toFixed(2)} X (${(tokenRatio.ratioX * 100).toFixed(1)}%), $${targetUsdY.toFixed(2)} Y (${(tokenRatio.ratioY * 100).toFixed(1)}%)`);
  
  // Check for 100% SOL allocation
  const isHundredSol = (X_IS_SOL && tokenRatio.ratioX === 1 && tokenRatio.ratioY === 0) || 
                       (Y_IS_SOL && tokenRatio.ratioY === 1 && tokenRatio.ratioX === 0);
  
  if (isHundredSol) {
    console.log('✅ 100% SOL allocation detected — skipping swap');
    return {
      success: true,
      swapped: false,
      lamX,
      lamY
    };
  }
  
  // Check if swap needed
  if (Math.abs(diffUsdX) < 0.01) {
    console.log('✅ Tokens already at desired ratio, no swap needed');
    return {
      success: true,
      swapped: false,
      lamX,
      lamY
    };
  }
  
  // Check SOL balance for swap fees
  const SOL_BUFFER = new BN(MINIMUM_SOL_RESERVE_BN);
  const nativeBalance = await getSolBalanceBN(connection, userKeypair.publicKey, 'confirmed');
  const minSolForSwaps = SOL_BUFFER.add(new BN(20_000_000)); // Buffer + 0.02 SOL for fees
  
  if (nativeBalance.lt(minSolForSwaps)) {
    console.log(`⚠️  Skipping token balancing - insufficient SOL for safe swapping`);
    console.log(`   Native balance: ${nativeBalance.toNumber() / 1e9} SOL`);
    console.log(`   Minimum needed: ${minSolForSwaps.toNumber() / 1e9} SOL`);
    return {
      success: true,
      swapped: false,
      lamX,
      lamY
    };
  }
  
  // Perform swap
  const swapResult = await performSwap({
    connection,
    userKeypair,
    dlmmPool,
    lamX,
    lamY,
    diffUsdX,
    dx,
    dy,
    priceX,
    priceY,
    X_MINT,
    Y_MINT,
    X_IS_SOL,
    Y_IS_SOL,
    slippageBps,
    priceImpactPct,
    solAmount
  });
  
  return swapResult;
}

/**
 * Perform the actual token swap
 * 
 * @param {Object} params - Swap parameters
 * @returns {Promise<Object>} Swap result
 */
export async function performSwap(params) {
  const {
    connection,
    userKeypair,
    dlmmPool,
    lamX,
    lamY,
    diffUsdX,
    dx,
    dy,
    priceX,
    priceY,
    X_MINT,
    Y_MINT,
    X_IS_SOL,
    Y_IS_SOL,
    slippageBps,
    priceImpactPct,
    solAmount
  } = params;
  
  const needMoreX = diffUsdX > 0;
  const inputMint = needMoreX ? Y_MINT : X_MINT;
  const outputMint = needMoreX ? X_MINT : Y_MINT;
  const inputDecs = needMoreX ? dy : dx;
  const pxInputUsd = needMoreX ? priceY : priceX;
  const usdToSwap = Math.abs(diffUsdX);
  
  // Calculate swap amount
  const swapCalc = Math.floor((usdToSwap / pxInputUsd) * 10 ** inputDecs);
  if (!Number.isFinite(swapCalc) || isNaN(swapCalc)) {
    throw handleError(
      new Error(`Invalid swap calculation: ${swapCalc} from usdToSwap=${usdToSwap}, pxInputUsd=${pxInputUsd}, inputDecs=${inputDecs}`),
      'performSwap',
      { usdToSwap, pxInputUsd, inputDecs, swapCalc }
    );
  }
  
  let swapInputLamports = BigInt(swapCalc);
  
  // Cap by available balance
  const maxAvailableInput = needMoreX ? lamY : lamX;
  const maxAvailableInputBigInt = BigInt(maxAvailableInput.toString());
  if (swapInputLamports > maxAvailableInputBigInt) {
    swapInputLamports = maxAvailableInputBigInt;
  }
  
  // Cap by SOL budget if applicable
  if (solAmount !== null) {
    const solAmountLamports = BigInt(Math.floor(solAmount * 1e9));
    if (!needMoreX && X_IS_SOL && swapInputLamports > solAmountLamports) {
      swapInputLamports = solAmountLamports;
    }
    if (needMoreX && Y_IS_SOL && swapInputLamports > solAmountLamports) {
      swapInputLamports = solAmountLamports;
    }
  }
  
  if (swapInputLamports <= 0n) {
    console.log('Swap skipped: no available balance to adjust toward target ratio');
    return {
      success: true,
      swapped: false,
      lamX,
      lamY
    };
  }
  
  console.log(`Swapping ${needMoreX ? 'Y->X' : 'X->Y'} worth $${usdToSwap.toFixed(2)} (${swapInputLamports.toString()} lamports)`);
  
  try {
    const sig = await swapTokensUltra(
      inputMint,
      outputMint,
      swapInputLamports,
      userKeypair,
      connection,
      dlmmPool,
      slippageBps,
      20, // Max accounts
      priceImpactPct
    );
    
    if (!sig) {
      throw new Error('Ultra API swap failed');
    }
    
    logger.info('Token swap completed', {
      signature: sig,
      inputMint,
      outputMint,
      amount: swapInputLamports.toString()
    });
    
    // Wait for swap to settle
    console.log('⏳ Waiting for swap to settle...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      success: true,
      swapped: true,
      signature: sig,
      lamX,
      lamY
    };
    
  } catch (error) {
    throw handleError(
      error,
      'performSwap',
      { 
        inputMint, 
        outputMint, 
        amount: swapInputLamports.toString() 
      }
    );
  }
}

/**
 * Calculate swap amount for token ratio
 * 
 * @param {Object} params - Calculation parameters
 * @returns {Object} Swap details
 */
export function calculateSwapAmount(params) {
  const {
    currentX,
    currentY,
    targetRatioX,
    targetRatioY,
    priceX,
    priceY
  } = params;
  
  // Calculate current USD values
  const currentUsdX = currentX * priceX;
  const currentUsdY = currentY * priceY;
  const totalUsd = currentUsdX + currentUsdY;
  
  // Calculate target USD values
  const targetUsdX = totalUsd * targetRatioX;
  const targetUsdY = totalUsd * targetRatioY;
  
  // Calculate difference
  const diffUsdX = targetUsdX - currentUsdX;
  const diffUsdY = targetUsdY - currentUsdY;
  
  // Determine swap direction and amount
  const needMoreX = diffUsdX > 0;
  const swapUsd = Math.abs(diffUsdX);
  
  if (needMoreX) {
    // Swap Y -> X
    const yToSwap = swapUsd / priceY;
    return {
      direction: 'Y_TO_X',
      inputAmount: yToSwap,
      outputAmount: swapUsd / priceX,
      inputToken: 'Y',
      outputToken: 'X',
      usdValue: swapUsd
    };
  } else {
    // Swap X -> Y
    const xToSwap = swapUsd / priceX;
    return {
      direction: 'X_TO_Y',
      inputAmount: xToSwap,
      outputAmount: swapUsd / priceY,
      inputToken: 'X',
      outputToken: 'Y',
      usdValue: swapUsd
    };
  }
}

/**
 * Check if tokens are balanced according to ratio
 * 
 * @param {Object} params - Balance check parameters
 * @returns {boolean} True if balanced
 */
export function isBalanced(params) {
  const {
    lamX,
    lamY,
    targetRatio,
    decimalsX,
    decimalsY,
    tolerance = 0.01 // 1% tolerance
  } = params;
  
  if (!targetRatio) return true;
  
  // Convert to UI amounts
  const uiX = lamX.toNumber() / Math.pow(10, decimalsX);
  const uiY = lamY.toNumber() / Math.pow(10, decimalsY);
  const total = uiX + uiY;
  
  if (total === 0) return true;
  
  // Calculate actual ratios
  const actualRatioX = uiX / total;
  const actualRatioY = uiY / total;
  
  // Check if within tolerance
  const diffX = Math.abs(actualRatioX - targetRatio.ratioX);
  const diffY = Math.abs(actualRatioY - targetRatio.ratioY);
  
  return diffX <= tolerance && diffY <= tolerance;
}
