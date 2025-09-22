/**
 * fee-handler.js - Fee claiming and processing
 * Per REFACTORING_PLAN.md lines 78-89
 * 
 * Extracted from original dlmm.js lines 1382-1478
 */

import { PublicKey } from '@solana/web3.js';
import { safeGetBalance } from '../../solana.js';
import { getPrice } from '../../price.js';
import { SOL_MINT } from '../../constants.js';
import { swapTokensUltra } from '../../jupiter.js';
import { handleError, ERROR_CODES } from './error-handler.js';
import { logger } from '../../logger.js';

/**
 * Analyze claimed fees from position closure
 * 
 * @param {Object} params - Fee analysis parameters
 * @returns {Promise<Object>} Fee analysis result
 */
export async function analyzeFees(params) {
  const {
    connection,
    userKeypair,
    dlmmPool,
    feeHandlingMode,
    minSwapUsd
  } = params;
  
  // Check if fee handling is enabled
  if (feeHandlingMode !== 'claim_to_sol' || !minSwapUsd) {
    return {
      analyzed: false,
      claimedFeesUsd: 0,
      unswappedFeesUsd: 0,
      totalFeeValue: 0
    };
  }
  
  console.log(`💰 Analyzing claimed fees from position closure...`);
  
  try {
    const tokenXMint = dlmmPool.tokenX.publicKey.toString();
    const tokenYMint = dlmmPool.tokenY.publicKey.toString();
    
    // Get current wallet balances
    const currentBalances = await getWalletBalances(
      connection,
      userKeypair.publicKey,
      tokenXMint,
      tokenYMint
    );
    
    // Calculate USD values
    const solPrice = await getPrice(SOL_MINT.toString());
    const currentSolUsd = (currentBalances.sol / 1e9) * (solPrice || 0);
    
    // Analyze alt tokens
    const altTokenAnalysis = await analyzeAltTokens(
      dlmmPool,
      currentBalances,
      tokenXMint,
      tokenYMint
    );
    
    console.log(`📊 Current wallet analysis after position closure:`);
    console.log(`   • SOL balance: ${(currentBalances.sol / 1e9).toFixed(6)} SOL ($${currentSolUsd.toFixed(4)})`);
    
    if (altTokenAnalysis.altTokenAmount > 0) {
      console.log(`   • ${altTokenAnalysis.altTokenSymbol} balance: ${altTokenAnalysis.altTokenAmount.toFixed(6)} ${altTokenAnalysis.altTokenSymbol} ($${altTokenAnalysis.currentAltTokenUsd.toFixed(4)})`);
      console.log(`   • Fee threshold: $${minSwapUsd.toFixed(2)}`);
    }
    
    // Process fees based on threshold
    const feeResult = await processFees({
      connection,
      userKeypair,
      altTokenAnalysis,
      minSwapUsd,
      currentSolUsd
    });
    
    return {
      analyzed: true,
      ...feeResult,
      totalFeeValue: currentSolUsd + (altTokenAnalysis.altTokenAmount > 0 ? altTokenAnalysis.currentAltTokenUsd : 0)
    };
    
  } catch (error) {
    logger.error('Error analyzing fees', { error: error.message });
    return {
      analyzed: false,
      claimedFeesUsd: 0,
      unswappedFeesUsd: 0,
      totalFeeValue: 0,
      error: error.message
    };
  }
}

/**
 * Get wallet balances for analysis
 * 
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} userPubKey - User public key
 * @param {string} tokenXMint - Token X mint address
 * @param {string} tokenYMint - Token Y mint address
 * @returns {Promise<Object>} Wallet balances
 */
async function getWalletBalances(connection, userPubKey, tokenXMint, tokenYMint) {
  return {
    sol: await connection.getBalance(userPubKey),
    tokenX: await safeGetBalance(connection, new PublicKey(tokenXMint), userPubKey),
    tokenY: await safeGetBalance(connection, new PublicKey(tokenYMint), userPubKey)
  };
}

/**
 * Analyze alt tokens in wallet
 * 
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {Object} balances - Wallet balances
 * @param {string} tokenXMint - Token X mint
 * @param {string} tokenYMint - Token Y mint
 * @returns {Promise<Object>} Alt token analysis
 */
async function analyzeAltTokens(dlmmPool, balances, tokenXMint, tokenYMint) {
  let currentAltTokenUsd = 0;
  let altTokenAmount = 0;
  let altTokenMint = null;
  let altTokenSymbol = '';
  let totalAltTokenBalance = null;
  
  // Check token X
  if (tokenXMint !== SOL_MINT.toString() && !balances.tokenX.isZero()) {
    altTokenMint = tokenXMint;
    totalAltTokenBalance = balances.tokenX;
    altTokenAmount = balances.tokenX.toNumber() / Math.pow(10, dlmmPool.tokenX.decimal || 6);
    altTokenSymbol = dlmmPool.tokenX.symbol || 'TOKEN_X';
    const tokenPrice = await getPrice(tokenXMint);
    currentAltTokenUsd = altTokenAmount * (tokenPrice || 0);
  }
  // Check token Y
  else if (tokenYMint !== SOL_MINT.toString() && !balances.tokenY.isZero()) {
    altTokenMint = tokenYMint;
    totalAltTokenBalance = balances.tokenY;
    altTokenAmount = balances.tokenY.toNumber() / Math.pow(10, dlmmPool.tokenY.decimal || 9);
    altTokenSymbol = dlmmPool.tokenY.symbol || 'TOKEN_Y';
    const tokenPrice = await getPrice(tokenYMint);
    currentAltTokenUsd = altTokenAmount * (tokenPrice || 0);
  }
  
  return {
    altTokenMint,
    altTokenSymbol,
    altTokenAmount,
    currentAltTokenUsd,
    totalAltTokenBalance
  };
}

/**
 * Process fees based on threshold
 * 
 * @param {Object} params - Fee processing parameters
 * @returns {Promise<Object>} Processing result
 */
async function processFees(params) {
  const {
    connection,
    userKeypair,
    altTokenAnalysis,
    minSwapUsd,
    currentSolUsd
  } = params;
  
  let claimedFeesUsd = 0;
  let unswappedFeesUsd = 0;
  
  const {
    altTokenMint,
    altTokenSymbol,
    altTokenAmount,
    currentAltTokenUsd,
    totalAltTokenBalance
  } = altTokenAnalysis;
  
  // Check if we should swap alt tokens
  if (altTokenAmount > 0 && altTokenMint && currentAltTokenUsd >= minSwapUsd) {
    // Alt token amount exceeds threshold - swap to SOL
    console.log(`✅ Alt token amount exceeds threshold - swapping to SOL`);
    
    try {
      await swapTokensUltra(
        connection,
        userKeypair,
        altTokenMint,
        SOL_MINT.toString(),
        totalAltTokenBalance.toNumber(),
        0.5 // 0.5% slippage
      );
      
      claimedFeesUsd = currentAltTokenUsd;
      console.log(`✅ Alt tokens swapped to SOL: $${claimedFeesUsd.toFixed(4)}`);
      
    } catch (swapError) {
      console.log(`⚠️ Failed to swap alt tokens to SOL: ${swapError.message}`);
      unswappedFeesUsd = currentAltTokenUsd;
    }
  } else if (altTokenAmount > 0) {
    // Alt token amount below threshold - keep as alt token
    unswappedFeesUsd = currentAltTokenUsd;
    console.log(`📊 Alt token amount below threshold - keeping as ${altTokenSymbol}: $${unswappedFeesUsd.toFixed(4)}`);
  } else {
    console.log(`ℹ️ No alt tokens to process (position contained only SOL)`);
  }
  
  // Log total fee value
  const totalFeeValue = currentSolUsd + (altTokenAmount > 0 ? currentAltTokenUsd : 0);
  console.log(`💰 Total fee value analysis: $${totalFeeValue.toFixed(4)} (SOL: $${currentSolUsd.toFixed(4)}, ${altTokenSymbol || 'ALT'}: $${currentAltTokenUsd.toFixed(4)})`);
  
  return {
    claimedFeesUsd,
    unswappedFeesUsd,
    swapped: claimedFeesUsd > 0
  };
}

/**
 * Calculate fee thresholds
 * 
 * @param {Object} params - Threshold parameters
 * @returns {Object} Threshold values
 */
export function calculateFeeThresholds(params) {
  const {
    baseThresholdUsd = 10,
    networkFeeUsd = 0.5,
    slippageFactor = 1.01
  } = params;
  
  // Minimum threshold should cover network fees + slippage
  const minThreshold = (networkFeeUsd * 2) * slippageFactor;
  
  // Effective threshold is the higher of base and minimum
  const effectiveThreshold = Math.max(baseThresholdUsd, minThreshold);
  
  return {
    minThreshold,
    effectiveThreshold,
    networkFeeUsd,
    slippageFactor
  };
}

/**
 * Claim fees from a position
 * 
 * @param {Object} params - Claim parameters
 * @returns {Promise<Object>} Claim result
 */
export async function claimFeesFromPosition(params) {
  const {
    connection,
    userKeypair,
    dlmmPool,
    positionPubKey
  } = params;
  
  try {
    // Refresh pool state
    await dlmmPool.refetchStates();
    
    // Get position
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
    const position = userPositions.find(p => p.publicKey.equals(positionPubKey));
    
    if (!position) {
      throw new Error('Position not found');
    }
    
    // Check if fees are available
    const hasFeesX = position.positionData.feeX && !position.positionData.feeX.isZero();
    const hasFeesY = position.positionData.feeY && !position.positionData.feeY.isZero();
    
    if (!hasFeesX && !hasFeesY) {
      console.log('No fees to claim');
      return {
        claimed: false,
        feeX: 0,
        feeY: 0
      };
    }
    
    // Claim fees (returns array of transactions)
    const claimTxs = await dlmmPool.claimSwapFee({
      owner: userKeypair.publicKey,
      position: position
    });

    // Send transactions
    const signatures = [];
    for (let i = 0; i < claimTxs.length; i++) {
      const claimTx = claimTxs[i];
      const sig = await connection.sendTransaction(claimTx, [userKeypair]);
      await connection.confirmTransaction(sig, 'confirmed');
      signatures.push(sig);
      console.log(`✅ Fees claimed (tx ${i + 1}/${claimTxs.length}): ${sig}`);
    }

    return {
      claimed: true,
      signatures,
      signature: signatures[0], // For backward compatibility
      feeX: position.positionData.feeX?.toNumber() || 0,
      feeY: position.positionData.feeY?.toNumber() || 0
    };
    
  } catch (error) {
    throw handleError(
      error,
      'claimFeesFromPosition',
      { positionPubKey: positionPubKey.toBase58() }
    );
  }
}

/**
 * Check if fees meet threshold for claiming
 * 
 * @param {Object} params - Threshold check parameters
 * @returns {Promise<boolean>} True if threshold met
 */
export async function meetsClaimThreshold(params) {
  const {
    feeX,
    feeY,
    priceX,
    priceY,
    decimalsX,
    decimalsY,
    thresholdUsd
  } = params;
  
  // Convert fees to USD
  const feeXUsd = (feeX / Math.pow(10, decimalsX)) * priceX;
  const feeYUsd = (feeY / Math.pow(10, decimalsY)) * priceY;
  const totalFeeUsd = feeXUsd + feeYUsd;
  
  return totalFeeUsd >= thresholdUsd;
}
