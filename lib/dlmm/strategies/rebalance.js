/**
 * rebalance.js - Rebalancing strategies
 * Per REFACTORING_PLAN.md lines 65-76
 * 
 * Extracted from original dlmm.js lines 1222-1495
 */

import BN from 'bn.js';
import { ComputeBudgetProgram } from '@solana/web3.js';
import { withRetry } from '../../retry.js';
import { unwrapWSOL } from '../../solana.js';
import { fetchBalances } from '../utils/wallet-scanner.js';
import { analyzeFees } from '../handlers/fee-handler.js';
import { handleError } from '../handlers/error-handler.js';
import { sendTransactionWithSenderIfEnabled } from '../../sender.js';
import { getFallbackPriorityFee, PRIORITY_LEVELS, addDynamicPriorityFee } from '../../priority-fee.js';
import { logger } from '../../logger.js';
import { createJitoBundleHandler, shouldUseJitoBundles } from '../../jito-bundle-handler.js';

/**
 * Execute rebalancing using Jito bundles for atomic multi-transaction operations
 * 
 * @param {Connection} connection - Solana connection
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {Keypair} userKeypair - User wallet keypair
 * @param {PublicKey} positionPubKey - Current position public key
 * @param {Object} originalParams - Original position parameters
 * @param {string} rebalanceDirection - Direction of rebalancing
 * @returns {Promise<Object|null>} Atomic rebalancing result or null if fallback needed
 */
async function executeAtomicRebalancing(connection, dlmmPool, userKeypair, positionPubKey, originalParams, rebalanceDirection) {
  // IMPORTANT: Based on user clarification, rebalancing should generally NOT use Jito bundles
  // Jito bundles are ONLY for multi-position operations (>69 bins requiring multiple position objects)
  // Regular rebalancing (close 1 position, open 1 position) should use regular RPC
  
  console.log('🔍 Evaluating if rebalancing qualifies for Jito bundle usage...');
  
  // Check if the NEW position will be extended (>69 bins) requiring multiple positions
  const newBinSpan = originalParams.swaplessConfig?.binSpan || originalParams.binSpan;
  const willCreateExtendedPosition = newBinSpan > 69;
  
  if (!willCreateExtendedPosition) {
    console.log(`📤 Rebalancing will create standard position (${newBinSpan} bins) - using regular RPC`);
    console.log(`💡 Jito bundles are only for multi-position operations (>69 bins)`);
    return null; // Use regular sequential rebalancing
  }
  
  console.log(`🎁 Rebalancing will create extended position (${newBinSpan} bins) - evaluating for bundle...`);
  
  try {
    // Only proceed if we're creating an extended position that requires multiple position objects
    // This is the ONLY scenario where rebalancing should use Jito bundles
    
    const closureTransactions = await prepareClosureTransactionsForBundle(
      connection, 
      dlmmPool, 
      userKeypair, 
      positionPubKey
    );
    
    console.log(`📦 Position closure: ${closureTransactions.length} transactions`);
    console.log(`📦 New position: Will require multiple positions (${newBinSpan} bins > 69)`);
    
    // For extended position rebalancing, we should bundle the closure transactions
    // The new extended position creation will handle its own bundling via existing logic
    
    const shouldBundle = shouldUseJitoBundles(closureTransactions.length, {
      isExtendedPosition: false,
      isMultiPositionOperation: true, // This is a multi-position operation
      network: 'mainnet'
    });
    
    if (shouldBundle && closureTransactions.length > 1) {
      console.log(`🎁 Bundling ${closureTransactions.length} closure transactions for extended position rebalancing`);
      
      const jitoBundleHandler = createJitoBundleHandler(connection, userKeypair);
      
      const bundleResult = await jitoBundleHandler.sendBundleWithConfirmation(
        closureTransactions,
        'high', // High priority for rebalancing
        [],
        {
          includeTip: true,
          maxRetries: 2,
          timeoutMs: 45000
        }
      );
      
      if (bundleResult.success) {
        console.log(`🎉 Position closure bundled atomically: ${bundleResult.bundleId}`);
        console.log(`💰 Bundle tip: ${bundleResult.tipSOL?.toFixed(6)} SOL`);
        
        // Continue with new extended position creation (which will use its own bundling if needed)
        await unwrapWSOL(connection, userKeypair);
        
        const { fetchBalances } = await import('../utils/wallet-scanner.js');
        const postClosureBalances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
        
        const strategyToUse = originalParams.rebalanceStrategy || originalParams.liquidityStrategy || 'Spot';
        const isSwaplessEnabled = originalParams.swaplessConfig?.enabled;
        const swaplessOptions = isSwaplessEnabled ? { ...originalParams.swaplessConfig, enabled: true } : { enabled: false };
        
        const { openDlmmPosition } = await import('../../dlmm.js');
        
        // Create new extended position (will use its own Jito bundling if >69 bins)
        const result = await openDlmmPosition(
          connection,
          userKeypair,
          originalParams.solAmount,
          originalParams.tokenRatio,
          newBinSpan,
          originalParams.poolAddress,
          strategyToUse,
          swaplessOptions,
          { lamX: postClosureBalances.lamX, lamY: postClosureBalances.lamY },
          false,
          {}
        );
        
        return {
          success: true,
          newPositionPubKey: result.positionPubKey,
          rebalanceType: 'bundled-closure-extended-creation',
          bundleId: bundleResult.bundleId,
          newDepositValue: result.positionValue || 0,
          usedBundles: true
        };
      }
    } else {
      console.log(`📤 Closure has ${closureTransactions.length} transactions - not suitable for bundling`);
    }
    
  } catch (error) {
    console.warn(`⚠️  Extended position rebalancing preparation failed: ${error.message}`);
  }
  
  return null; // Use regular sequential rebalancing
}

/**
 * Prepare position closure transactions for bundling (without executing them)
 */
async function prepareClosureTransactionsForBundle(connection, dlmmPool, userKeypair, positionPubKey) {
  console.log(`🔍 [bundle-prep] Preparing closure transactions for: ${positionPubKey.toBase58()}`);
  
  // Get position data
  await dlmmPool.refetchStates();
  const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
  const oldPos = userPositions.find(p => p.publicKey.equals(positionPubKey));
  
  if (!oldPos) {
    throw new Error('Position not found for closure preparation');
  }
  
  // Get removal transactions (but don't execute)
  const removeTxs = await dlmmPool.removeLiquidity({
    position: positionPubKey,
    user: userKeypair.publicKey,
    fromBinId: oldPos.positionData.lowerBinId,
    toBinId: oldPos.positionData.upperBinId,
    bps: new BN(10_000), // 100%
    shouldClaimAndClose: true,
  });
  
  const rmTxs = Array.isArray(removeTxs) ? removeTxs : [removeTxs];
  console.log(`[bundle-prep] Prepared ${rmTxs.length} closure transaction(s) for bundling`);
  
  // Prepare transactions for bundling (set feePayer and add priority fees)
  const preparedTransactions = [];
  
  for (let i = 0; i < rmTxs.length; i++) {
    const tx = rmTxs[i];
    tx.feePayer = userKeypair.publicKey;
    
    // Add dynamic priority fee
    try {
      await addDynamicPriorityFee(tx, connection, PRIORITY_LEVELS.HIGH);
    } catch (error) {
      console.warn(`⚠️  Dynamic priority fee failed for tx ${i + 1}, using static fallback`);
      const fallbackFee = getFallbackPriorityFee(PRIORITY_LEVELS.HIGH);
      tx.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fallbackFee })
      );
    }
    
    preparedTransactions.push(tx);
  }
  
  return preparedTransactions;
}

/**
 * Rebalance/recenter a DLMM position by closing current and opening new
 * Now supports atomic execution via Jito bundles for position closure
 * 
 * @param {Connection} connection - Solana connection
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {Keypair} userKeypair - User wallet keypair
 * @param {PublicKey} positionPubKey - Current position public key
 * @param {Object} originalParams - Original position parameters
 * @param {string} rebalanceDirection - Direction of rebalancing ('UP' or 'DOWN')
 * @returns {Promise<Object>} New position details
 */
export async function recenterPosition(connection, dlmmPool, userKeypair, positionPubKey, originalParams, rebalanceDirection) {
  console.log(`🔄 [recenter] Rebalancing position`);
  console.log(`   Original limit was ${originalParams.solAmount || 'unlimited'} SOL`);
  
  // Try atomic rebalancing via Jito bundles first
  const atomicResult = await executeAtomicRebalancing(
    connection, 
    dlmmPool, 
    userKeypair, 
    positionPubKey, 
    originalParams, 
    rebalanceDirection
  );
  
  if (atomicResult && atomicResult.success) {
    console.log(`🎉 [recenter] Atomic rebalancing completed successfully!`);
    console.log(`📦 Bundle ID: ${atomicResult.bundleId}`);
    console.log(`💰 Tip paid: ${atomicResult.tipPaid?.toFixed(6)} SOL`);
    
    return {
      positionPubKey: atomicResult.newPositionPubKey,
      newDepositValue: atomicResult.newDepositValue,
      atomicExecution: true,
      bundleId: atomicResult.bundleId,
      rebalanceType: atomicResult.rebalanceType
    };
  }
  
  // Fallback to sequential rebalancing
  console.log(`📤 [recenter] Using sequential rebalancing (fallback)`);
  
  // Use the rebalance strategy from originalParams
  const strategyToUse = originalParams.rebalanceStrategy || 
                        originalParams.liquidityStrategy || 
                        'Spot';
  console.log(`🎯 [recenter] Using rebalance strategy: ${strategyToUse}`);
  
  // Close the current position and get tokens
  const closureResult = await closePositionForRebalance(
    connection,
    dlmmPool,
    userKeypair,
    positionPubKey
  );
  
  if (!closureResult.success) {
    throw new Error('Failed to close position for rebalancing');
  }
  
  // Get fresh balances after position close
  const balances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
  let lamX = balances.lamX;
  let lamY = balances.lamY;
  
  // Debug: Check if balances are valid
  console.log(`🔍 [DEBUG] Raw balance fetch results:`);
  console.log(`   • lamX (raw): ${lamX?.toString() || 'undefined'}`);
  console.log(`   • lamY (raw): ${lamY?.toString() || 'undefined'}`);
  
  // Handle undefined balances (fallback to zero)
  if (!lamX) {
    console.log(`⚠️ [DEBUG] lamX is undefined, setting to zero`);
    lamX = new BN(0);
  }
  if (!lamY) {
    console.log(`⚠️ [DEBUG] lamY is undefined, setting to zero`);
    lamY = new BN(0);
  }
  
  console.log(`🔄 [recenter] Calling openDlmmPosition with calculated balances...`);
  console.log(`   • Token X: ${(lamX?.toNumber() || 0) / Math.pow(10, dlmmPool.tokenX.decimal || 6)} tokens`);
  console.log(`   • Token Y: ${(lamY?.toNumber() || 0) / Math.pow(10, dlmmPool.tokenY.decimal || 9)} tokens`);
  console.log(`   • Strategy: ${strategyToUse}`);
  console.log(`   • Bin Span: ${originalParams.swaplessConfig?.binSpan || originalParams.binSpan}`);
  
  // Skip rebalancing if we have no tokens to work with
  if ((!lamX || lamX.isZero()) && (!lamY || lamY.isZero())) {
    console.log(`⚠️ [DEBUG] No tokens available after position close - skipping rebalance`);
    return { 
      dlmmPool, 
      positionPubKey: null, 
      signature: null 
    };
  }
  
  // Determine if this should be swapless or normal rebalancing
  const isSwaplessEnabled = !!(originalParams.swaplessConfig?.enabled);
  
  let swaplessOptions = null;
  let tokenRatioForRebalance = null;
  
  if (isSwaplessEnabled) {
    // SWAPLESS MODE: Use whatever tokens we have from closed position
    console.log(`💡 Using SWAPLESS rebalancing - maintaining current token composition`);
    swaplessOptions = {
      swapless: true,
      swaplessSpan: originalParams.swaplessConfig.binSpan,
      direction: rebalanceDirection
    };
  } else {
    // NORMAL MODE: Swap back to original token ratio
    console.log(`💡 Using NORMAL rebalancing - swapping back to original token ratio`);
    tokenRatioForRebalance = originalParams.tokenRatio;
    console.log(`   Original ratio: ${JSON.stringify(tokenRatioForRebalance)}`);
    swaplessOptions = null; // Explicitly not swapless
  }
  
  // 🔧 FIX: Analyze fees for both normal AND swapless modes
  // In swapless mode, we still need to track fees for P&L - we just don't swap them
  let feeAnalysis = { claimedFeesUsd: 0, unswappedFeesUsd: 0, trackedFeesUsd: 0 };

  if (!isSwaplessEnabled && originalParams?.feeHandlingMode === 'claim_to_sol' && originalParams?.minSwapUsd) {
    console.log(`💰 Analyzing claimed fees from position closure...`);
    feeAnalysis = await analyzeFees({
      connection,
      userKeypair,
      dlmmPool,
      feeHandlingMode: originalParams.feeHandlingMode,
      minSwapUsd: originalParams.minSwapUsd
    });
  } else if (isSwaplessEnabled) {
    console.log(`💡 SWAPLESS MODE: Tracking fees for P&L but keeping all tokens for new position`);
    // In swapless mode, we still need to track the fees for P&L purposes
    try {
      const { calculateClaimedFeeValues } = await import('../fee-analysis.js');
      // Calculate the USD value of fees that were claimed (but not swapped)
      feeAnalysis = await calculateClaimedFeeValues(connection, dlmmPool, userKeypair.publicKey);
      feeAnalysis.trackedFeesUsd = feeAnalysis.claimedFeesUsd; // Track for P&L
      feeAnalysis.claimedFeesUsd = 0; // But don't count as "claimed to SOL"
      console.log(`📊 SWAPLESS: Tracked $${feeAnalysis.trackedFeesUsd.toFixed(4)} in fees for P&L (not swapped)`);
    } catch (error) {
      console.warn(`⚠️ Could not calculate fee values in swapless mode: ${error.message}`);
    }
  }
  
  // 🔧 CRITICAL FIX: Refresh balances after potential token swapping
  let updatedBalances = null;
  if (!isSwaplessEnabled) {
    // For normal rebalancing, get updated wallet balances after swapping
    console.log(`🔄 [recenter] Refreshing balances after potential fee swapping...`);
    const { fetchBalances } = await import('../utils/wallet-scanner.js');
    const freshBalances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
    
    console.log(`🔍 [DEBUG] Updated balance fetch results:`);
    console.log(`   • lamX (updated): ${freshBalances.lamX}`);
    console.log(`   • lamY (updated): ${freshBalances.lamY}`);
    
    updatedBalances = { 
      lamX: freshBalances.lamX, 
      lamY: freshBalances.lamY 
    };
  } else {
    // 🔧 CRITICAL FIX: For swapless, MUST use fresh balances after position closure
    console.log(`🔄 [recenter] SWAPLESS: Getting fresh balances after position closure...`);
    const { fetchBalances } = await import('../utils/wallet-scanner.js');
    const freshBalances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);

    console.log(`🔍 [DEBUG] SWAPLESS fresh balance fetch results:`);
    console.log(`   • lamX (fresh): ${freshBalances.lamX}`);
    console.log(`   • lamY (fresh): ${freshBalances.lamY}`);

    updatedBalances = {
      lamX: freshBalances.lamX,
      lamY: freshBalances.lamY
    };
  }
  
  // Create rebalance parameters
  const rebalanceParams = calculateRebalanceParameters({
    originalParams,
    strategyToUse,
    swaplessOptions,
    tokenRatioForRebalance,
    lamX: updatedBalances.lamX,
    lamY: updatedBalances.lamY,
    binSpan: originalParams.swaplessConfig?.binSpan || originalParams.binSpan
  });
  
  // Import openDlmmPosition dynamically to avoid circular dependency
  const { openDlmmPosition } = await import('../../dlmm.js');
  
  // Create new position with updated balances after swapping
  const result = await openDlmmPosition(
    connection,
    userKeypair,
    originalParams.solAmount, // Respect original SOL budget limit
    tokenRatioForRebalance,
    rebalanceParams.binSpan,
    originalParams.poolAddress,
    strategyToUse,
    swaplessOptions,
    updatedBalances, // ✅ FIX: Use post-swap balances
    false, // Don't skip existing check
    {}
  );
  
  if (!result.positionPubKey) {
    throw new Error('Failed to create rebalanced position');
  }
  
  console.log(`📊 [REBALANCE-LOG] ✅ REBALANCING COMPLETED SUCCESSFULLY:`);
  console.log(`   • New Position ID: ${result.positionPubKey.toBase58()}`);
  console.log(`   • Strategy Used: ${strategyToUse}`);
  console.log(`   • Direction: ${rebalanceDirection}`);
  
  // Calculate position value for baseline tracking
  const positionValueOnly = result.positionValue || 0;
  const newDepositValue = positionValueOnly + feeAnalysis.claimedFeesUsd;
  
  return {
    dlmmPool,
    positionPubKey: result.positionPubKey,
    signature: result.signature,
    claimedFeesUsd: feeAnalysis.claimedFeesUsd,
    unswappedFeesUsd: feeAnalysis.unswappedFeesUsd,
    positionValueOnly,
    newDepositValue
  };
}

/**
 * Close position for rebalancing
 * 
 * @param {Connection} connection - Solana connection
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {Keypair} userKeypair - User wallet keypair  
 * @param {PublicKey} positionPubKey - Position to close
 * @returns {Promise<Object>} Closure result
 */
export async function closePositionForRebalance(connection, dlmmPool, userKeypair, positionPubKey) {
  return await withRetry(async () => {
    console.log(`🔍 [DEBUG] Closing position: ${positionPubKey.toBase58()}`);
    console.log(`🔍 [DEBUG] Owner: ${userKeypair.publicKey.toBase58()}`);
    
    // Validate position parameter
    if (!positionPubKey) {
      throw new Error(`Invalid position key: ${positionPubKey}`);
    }
    
    // Remove 100% liquidity and close position
    await dlmmPool.refetchStates();
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
    const oldPos = userPositions.find(p => p.publicKey.equals(positionPubKey));
    
    if (!oldPos) {
      throw new Error('Position not found to remove liquidity');
    }
    
    const removeTxs = await dlmmPool.removeLiquidity({
      position: positionPubKey,
      user: userKeypair.publicKey,
      fromBinId: oldPos.positionData.lowerBinId,
      toBinId: oldPos.positionData.upperBinId,
      bps: new BN(10_000), // 100%
      shouldClaimAndClose: true,
    });
    
    const rmTxs = Array.isArray(removeTxs) ? removeTxs : [removeTxs];
    console.log(`[recenter] Removing 100% liquidity in ${rmTxs.length} transaction(s)`);
    
    for (let i = 0; i < rmTxs.length; i++) {
      const tx = rmTxs[i];
      
      tx.feePayer = userKeypair.publicKey;
      
      // Add dynamic priority fee with fallback
      try {
        await addDynamicPriorityFee(tx, connection, PRIORITY_LEVELS.MEDIUM);
      } catch (error) {
        console.warn(`⚠️  Dynamic priority fee failed, using static fallback: ${error.message}`);
        const fallbackFee = getFallbackPriorityFee(PRIORITY_LEVELS.MEDIUM);
        tx.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fallbackFee })
        );
      }
      const recent = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = recent.blockhash;
      tx.lastValidBlockHeight = recent.lastValidBlockHeight;
      
      const sig = await sendTransactionWithSenderIfEnabled(
        connection, 
        tx, 
        [userKeypair], 
        PRIORITY_LEVELS.MEDIUM
      );
      
      console.log(`   Remove-liquidity tx ${i + 1}/${rmTxs.length} completed: ${sig}`);
    }
    
    // Unwrap any WSOL
    await unwrapWSOL(connection, userKeypair);
    console.log(`[recenter] Position fully closed and tokens returned to wallet`);
    
    return { success: true };
    
  }, 'recenterPosition');
}

/**
 * Calculate rebalance parameters
 * 
 * @param {Object} params - Calculation parameters
 * @returns {Object} Rebalance parameters
 */
export function calculateRebalanceParameters(params) {
  const {
    originalParams,
    strategyToUse,
    swaplessOptions,
    tokenRatioForRebalance,
    lamX,
    lamY,
    binSpan
  } = params;
  
  const result = {
    strategy: strategyToUse,
    binSpan: binSpan || 20,
    swaplessOptions,
    tokenRatio: tokenRatioForRebalance,
    providedBalances: {
      lamX,
      lamY
    }
  };
  
  // Add any additional parameters from originalParams
  if (originalParams.poolAddress) {
    result.poolAddress = originalParams.poolAddress;
  }
  
  logger.info('Calculated rebalance parameters', result);
  
  return result;
}

/**
 * Determine if rebalancing is needed
 * 
 * @param {Object} position - Current position
 * @param {Object} currentPrice - Current pool price
 * @param {Object} thresholds - Rebalance thresholds
 * @returns {Object} {needsRebalance, direction}
 */
export function checkRebalanceNeeded(position, currentPrice, thresholds) {
  const { lowerBinId, upperBinId } = position.positionData;
  const activeBin = currentPrice.binId;
  
  // Calculate position range
  const positionRange = upperBinId - lowerBinId;
  const distanceFromLower = activeBin - lowerBinId;
  const distanceFromUpper = upperBinId - activeBin;
  
  // Calculate percentages
  const percentFromLower = (distanceFromLower / positionRange) * 100;
  const percentFromUpper = (distanceFromUpper / positionRange) * 100;
  
  // Default thresholds
  const lowerThreshold = thresholds?.lower || 20; // Rebalance if within 20% of lower bound
  const upperThreshold = thresholds?.upper || 20; // Rebalance if within 20% of upper bound
  
  let needsRebalance = false;
  let direction = null;
  
  if (percentFromLower <= lowerThreshold) {
    needsRebalance = true;
    direction = 'DOWN';
    console.log(`📊 Rebalance needed: Price near lower bound (${percentFromLower.toFixed(1)}%)`);
  } else if (percentFromUpper <= upperThreshold) {
    needsRebalance = true;
    direction = 'UP';
    console.log(`📊 Rebalance needed: Price near upper bound (${percentFromUpper.toFixed(1)}%)`);
  }
  
  return {
    needsRebalance,
    direction,
    percentFromLower,
    percentFromUpper,
    activeBin,
    lowerBinId,
    upperBinId
  };
}
