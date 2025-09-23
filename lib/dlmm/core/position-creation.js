/**
 * position-creation.js - Core position creation logic
 * Per REFACTORING_PLAN.md lines 50-63
 * 
 * Extracted from original dlmm.js lines 972-1181
 */

import { Keypair, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import BN from 'bn.js';
import { 
  logPositionBinDistribution,
  calculateBinRange,
  resolveTotalBinsSpan
} from '../utils/bin-distribution.js';
import { handleError, ERROR_CODES } from '../handlers/error-handler.js';
import { validatePositionParams } from '../utils/validation.js';
import { sendTransactionWithSenderIfEnabled } from '../../sender.js';
import { getFallbackPriorityFee, PRIORITY_LEVELS, getDynamicPriorityFee, addDynamicPriorityFee } from '../../priority-fee.js';
import { logger } from '../../logger.js';
import { createJitoBundleHandler, shouldUseJitoBundles } from '../../jito-bundle-handler.js';

const MAX_BIN_PER_TX = 69; // Standard transaction limit from SDK

/**
 * Add dynamic priority fee to transaction (uses existing priority-fee.js utilities)
 * @param {Transaction} transaction - Transaction to add priority fee to
 * @param {Connection} connection - Solana connection
 * @param {string} priorityLevel - Priority level (Medium, High, VeryHigh)
 * @returns {Promise<Transaction>} Transaction with priority fee added
 */
async function addDynamicPriorityFeeWithFallback(transaction, connection, priorityLevel = PRIORITY_LEVELS.MEDIUM) {
  try {
    // Use the utility from priority-fee.js which handles everything
    return await addDynamicPriorityFee(transaction, connection, priorityLevel);
  } catch (error) {
    console.warn(`⚠️  Dynamic priority fee failed, using static fallback: ${error.message}`);
    // Fallback: add static priority fee manually
    const fallbackFee = getFallbackPriorityFee(priorityLevel);
    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: fallbackFee
    });
    transaction.instructions.unshift(priorityFeeIx);
    return transaction;
  }
}

/**
 * Create a DLMM position (standard or extended)
 * Pure function without retry logic
 * 
 * @param {Object} params - Position creation parameters
 * @returns {Promise<Object>} Position creation result
 */
export async function createPositionCore(params) {
  const {
    connection,
    userKeypair,
    dlmmPool,
    lamX,
    lamY,
    minBin,
    maxBin,
    slippage,
    priorityLevel,
    strategy,
    onTx = async () => {}
  } = params;
  
  // Validate parameters
  const validation = validatePositionParams({
    connection,
    userKeypair,
    poolAddress: dlmmPool.publicKey
  });
  
  if (!validation.valid) {
    throw handleError(
      new Error(`Invalid parameters: ${validation.errors.join(', ')}`),
      'position-creation',
      { errors: validation.errors }
    );
  }
  
  const binCount = maxBin - minBin + 1;
  let sig;
  let posKP;
  let created = false;
  
  logger.info(`Creating position with ${binCount} bins`, {
    minBin,
    maxBin,
    strategy,
    slippage
  });
  
  if (binCount <= MAX_BIN_PER_TX) {
    // ✅ STANDARD POSITION (≤69 bins) - Single position, single transaction
    // Uses regular RPC - NO Jito bundles needed
    console.log(`📤 Standard position (${binCount} bins) - using single transaction via regular RPC`);
    console.log(`💡 No Jito bundle needed - single position operations use regular RPC`);
    
    const result = await createStandardPosition({
      connection,
      userKeypair,
      dlmmPool,
      lamX,
      lamY,
      minBin,
      maxBin,
      slippage,
      priorityLevel,
      strategy,
      onTx
    });
    
    return result;
  } else {
    // 🎁 EXTENDED POSITION (>69 bins) - Multiple positions required
    // Uses Jito bundles for atomic multi-position creation
    console.log(`🎁 Extended position (${binCount} bins) - requires multiple positions`);
    console.log(`💡 Using Jito bundles for atomic multi-position creation`);
    
    const result = await createExtendedPosition({
      connection,
      userKeypair,
      dlmmPool,
      lamX,
      lamY,
      minBin,
      maxBin,
      slippage,
      priorityLevel,
      strategy,
      onTx,
      useJitoBundle: true // ONLY for multi-position operations
    });
    
    return result;
  }
}

/**
 * Create standard position (≤69 bins)
 * 
 * @param {Object} params - Position parameters
 * @returns {Promise<Object>} Position result
 */
async function createStandardPosition(params) {
  const {
    connection,
    userKeypair,
    dlmmPool,
    lamX,
    lamY,
    minBin,
    maxBin,
    slippage,
    priorityLevel,
    strategy,
    onTx
  } = params;
  
  console.log(`📊 Creating standard position with ${maxBin - minBin + 1} bins`);
  
  const posKP = Keypair.generate();
  
  console.log(`🔍 [DEBUG] DLMM SDK call with strategy:`, {
    minBinId: minBin,
    maxBinId: maxBin,
    strategyType: strategy
  });
  
  try {
    const ixs = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: posKP.publicKey,
      user: userKeypair.publicKey,
      totalXAmount: lamX,
      totalYAmount: lamY,
      strategy: strategy,  // 🔧 FIX: Use strategy object directly (already has minBinId, maxBinId, strategyType)
      slippage: slippage || 1,
    });
    
    // Build transaction with dynamic priority fee (using priority-fee.js utilities)
    const tx = new Transaction().add(...ixs.instructions);
    tx.feePayer = userKeypair.publicKey;
    
    // Add dynamic priority fee using the utility
    await addDynamicPriorityFeeWithFallback(tx, connection, priorityLevel || PRIORITY_LEVELS.MEDIUM);
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    
    // Send transaction with adaptive error handling (like working backup)
    let sig;
    try {
      sig = await sendTransactionWithSenderIfEnabled(
        connection, 
        tx, 
        [userKeypair, posKP], 
        priorityLevel || PRIORITY_LEVELS.MEDIUM
      );
    } catch (e) {
      // Adaptive retry on insufficient funds (like working backup)
      const msg = String(e?.message ?? '');
      const logs = (e?.logs && Array.isArray(e.logs)) ? e.logs.join('\n') : '';
      const text = msg + '\n' + logs;
      
      if (/TransferChecked/i.test(text) && /insufficient funds|insufficient lamports/i.test(text)) {
        console.log(`🔧 Insufficient funds detected - attempting adaptive balance adjustment...`);
        
        // Apply small margin reduction and rebuild transaction
        const MARGIN = new BN(5_000);
        let adjustedLamX = lamX;
        let adjustedLamY = lamY;
        
        if (lamY && lamY.gt(new BN(0))) {
          adjustedLamY = BN.max(new BN(0), lamY.sub(MARGIN));
          console.log(`   Adjusting Y: ${lamY.toString()} → ${adjustedLamY.toString()}`);
        }
        if (lamX && lamX.gt(new BN(0))) {
          adjustedLamX = BN.max(new BN(0), lamX.sub(MARGIN));
          console.log(`   Adjusting X: ${lamX.toString()} → ${adjustedLamX.toString()}`);
        }
        
        // Rebuild with adjusted amounts  
        const retryIxs = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: posKP.publicKey,
          user: userKeypair.publicKey,
          totalXAmount: adjustedLamX,
          totalYAmount: adjustedLamY,
          strategy: strategy,  // 🔧 FIX: Use strategy object directly
          slippage: slippage || 1,
        });
        
        const retryTx = new Transaction().add(...retryIxs.instructions);
        retryTx.feePayer = userKeypair.publicKey;
        
        // Add dynamic priority fee for retry
        await addDynamicPriorityFeeWithFallback(retryTx, connection, priorityLevel || PRIORITY_LEVELS.MEDIUM);
        
        const { blockhash: retryBlockhash, lastValidBlockHeight: retryLastValid } = await connection.getLatestBlockhash('confirmed');
        retryTx.recentBlockhash = retryBlockhash;
        retryTx.lastValidBlockHeight = retryLastValid;
        
        sig = await sendTransactionWithSenderIfEnabled(
          connection, 
          retryTx, 
          [userKeypair, posKP], 
          priorityLevel || PRIORITY_LEVELS.MEDIUM
        );
        
        console.log(`✅ Adaptive retry successful with adjusted amounts`);
      } else {
        throw e; // Re-throw non-recoverable errors
      }
    }
    
    console.log(`📍 Standard position opened: ${sig}`);
    console.log(`📍 Position created with address: ${posKP.publicKey.toBase58()}`);
    
    // Log bin distribution
    try {
      await logPositionBinDistribution(dlmmPool, userKeypair.publicKey, posKP.publicKey, 'Opened position');
    } catch {}
    
    // Callback for transaction tracking
    try { 
      await onTx(sig); 
    } catch {}
    
    return {
      success: true,
      positionPubKey: posKP.publicKey,
      signature: sig,
      binCount: maxBin - minBin + 1
    };
    
  } catch (error) {
    throw handleError(
      error,
      'createStandardPosition',
      { minBin, maxBin, strategy }
    );
  }
}

/**
 * Create extended position (>69 bins using multiple positions)
 * 
 * @param {Object} params - Position parameters
 * @returns {Promise<Object>} Position result
 */
async function createExtendedPosition(params) {
  const {
    connection,
    userKeypair,
    dlmmPool,
    lamX,
    lamY,
    minBin,
    maxBin,
    slippage,
    priorityLevel,
    strategy,
    onTx
  } = params;
  
  const binCount = maxBin - minBin + 1;
  console.log(`🎯 Creating extended position with ${binCount} bins (requires multiple transactions)`);
  
  // Position keypair generator
  const positionKeypairGenerator = async (count) => {
    const keypairs = [];
    for (let i = 0; i < count; i++) {
      keypairs.push(Keypair.generate());
    }
    return keypairs;
  };
  
  try {
    const result = await dlmmPool.initializeMultiplePositionAndAddLiquidityByStrategy(
      positionKeypairGenerator,
      lamX,
      lamY,
      strategy,  // 🔧 FIX: Use strategy object directly (already has minBinId, maxBinId, strategyType)
      userKeypair.publicKey, // owner
      userKeypair.publicKey, // payer
      slippage || 1
    );
    
    console.log(`🔄 Processing ${result.instructionsByPositions.length} positions for extended position...`);
    
    let firstPositionPubKey = null;
    let txCount = 0;
    let signatures = [];
    
    // Check if we should use Jito bundles for atomic execution
    const useJitoBundle = params.useJitoBundle !== false; // Default to true
    const estimatedTxCount = result.instructionsByPositions.reduce((count, pos) => 
      count + 1 + (pos.addLiquidityIxs?.length || 0), 0);
    
    const shouldBundle = useJitoBundle && shouldUseJitoBundles(estimatedTxCount, {
      isExtendedPosition: true, // Explicitly mark as extended position
      network: 'mainnet' // Assuming mainnet, could be made configurable
    });
    
    if (shouldBundle && estimatedTxCount <= 5) { // Max 5 transactions per bundle
      console.log(`🎁 Using Jito bundle for atomic execution of ${estimatedTxCount} transactions`);
      
      try {
        const bundleResult = await executeExtendedPositionBundle(
          result.instructionsByPositions,
          connection,
          userKeypair,
          priorityLevel,
          onTx
        );
        
        if (bundleResult.success) {
          firstPositionPubKey = bundleResult.firstPositionPubKey;
          signatures = bundleResult.signatures;
          txCount = bundleResult.transactionCount;
          
          console.log(`🎉 Extended position created atomically via Jito bundle: ${bundleResult.bundleId}`);
        } else {
          // Fallback to sequential execution
          console.log(`⚠️  Bundle execution failed, falling back to sequential execution`);
          throw new Error('Bundle execution failed, using fallback');
        }
      } catch (bundleError) {
        console.warn(`⚠️  Jito bundle execution failed: ${bundleError.message}`);
        console.log(`🔄 Falling back to sequential transaction execution...`);
        
        // Execute sequentially as fallback
        await executeExtendedPositionSequentially(
          result.instructionsByPositions,
          connection,
          userKeypair,
          priorityLevel,
          onTx,
          (pos, sigs, count) => {
            if (!firstPositionPubKey) firstPositionPubKey = pos;
            signatures = sigs;
            txCount = count;
          }
        );
      }
    } else {
      // Execute transactions sequentially (original logic)
      console.log(`📤 Using sequential execution for ${estimatedTxCount} transactions`);
      
      await executeExtendedPositionSequentially(
        result.instructionsByPositions,
        connection,
        userKeypair,
        priorityLevel,
        onTx,
        (pos, sigs, count) => {
          if (!firstPositionPubKey) firstPositionPubKey = pos;
          signatures = sigs;
          txCount = count;
        }
      );
    }
    
    console.log(`🎯 Extended position creation completed! Total transactions: ${txCount}`);
    
    // Log bin distribution for first position
    try {
      await logPositionBinDistribution(
        dlmmPool, 
        userKeypair.publicKey, 
        firstPositionPubKey, 
        'Opened (extended) position'
      );
    } catch {}
    
    console.log(`🔍 [DEBUG] Extended position returning positionPubKey: ${firstPositionPubKey.toBase58()}`);
    
    return {
      success: true,
      positionPubKey: firstPositionPubKey,
      signatures,
      txCount,
      binCount
    };
    
  } catch (error) {
    throw handleError(
      error,
      'createExtendedPosition',
      { minBin, maxBin, strategy, binCount }
    );
  }
}

/**
 * Execute extended position creation using Jito bundles (atomic)
 */
async function executeExtendedPositionBundle(
  instructionsByPositions,
  connection,
  userKeypair,
  priorityLevel,
  onTx
) {
  // Collect all transactions and keypairs
  const bundleTransactions = [];
  const positionKeypairs = [];
  let firstPositionPubKey = null;
  
  for (let i = 0; i < instructionsByPositions.length; i++) {
    const positionData = instructionsByPositions[i];
    const { positionKeypair, initializePositionIx, initializeAtaIxs, addLiquidityIxs } = positionData;
    
    if (i === 0) {
      firstPositionPubKey = positionKeypair.publicKey;
    }
    
    positionKeypairs.push(positionKeypair);
    
    // Transaction 1: Initialize position and ATA
    const initIxs = [initializePositionIx, ...(initializeAtaIxs || [])];
    const initTx = new Transaction().add(...initIxs);
    initTx.feePayer = userKeypair.publicKey;
    
    await addDynamicPriorityFeeWithFallback(initTx, connection, priorityLevel || PRIORITY_LEVELS.MEDIUM);
    bundleTransactions.push(initTx);
    
    // Transaction 2+: Add liquidity in batches
    for (let j = 0; j < addLiquidityIxs.length; j++) {
      const liquidityIxBatch = addLiquidityIxs[j];
      const liquidityTx = new Transaction().add(...liquidityIxBatch);
      liquidityTx.feePayer = userKeypair.publicKey;
      
      await addDynamicPriorityFeeWithFallback(liquidityTx, connection, priorityLevel || PRIORITY_LEVELS.MEDIUM);
      bundleTransactions.push(liquidityTx);
    }
  }
  
  // Execute bundle
  const jitoBundleHandler = createJitoBundleHandler(connection, userKeypair);
  
  const bundleResult = await jitoBundleHandler.sendBundleWithConfirmation(
    bundleTransactions,
    priorityLevel,
    positionKeypairs,
    {
      includeTip: true,
      maxRetries: 2
    }
  );
  
  // Call onTx for each signature if available
  if (bundleResult.signatures) {
    for (const sig of bundleResult.signatures) {
      try {
        await onTx(sig);
      } catch (error) {
        console.warn(`Warning: onTx callback failed for ${sig}: ${error.message}`);
      }
    }
  }
  
  return {
    success: true,
    firstPositionPubKey,
    signatures: bundleResult.signatures || [],
    transactionCount: bundleTransactions.length,
    bundleId: bundleResult.bundleId
  };
}

/**
 * Execute extended position creation sequentially (fallback)
 */
async function executeExtendedPositionSequentially(
  instructionsByPositions,
  connection,
  userKeypair,
  priorityLevel,
  onTx,
  resultCallback
) {
  let firstPositionPubKey = null;
  let txCount = 0;
  let signatures = [];
  
  for (let i = 0; i < instructionsByPositions.length; i++) {
    const positionData = instructionsByPositions[i];
    const { positionKeypair, initializePositionIx, initializeAtaIxs, addLiquidityIxs } = positionData;
    
    if (i === 0) {
      firstPositionPubKey = positionKeypair.publicKey;
      console.log(`🔍 [DEBUG] Setting firstPositionPubKey: ${firstPositionPubKey.toBase58()}`);
    }
    console.log(`   📊 Processing position ${i + 1}/${instructionsByPositions.length}...`);
    
    // Transaction 1: Initialize position and ATA
    const initIxs = [initializePositionIx, ...(initializeAtaIxs || [])];
    const initTx = new Transaction().add(...initIxs);
    initTx.feePayer = userKeypair.publicKey;
    
    // Add dynamic priority fee
    await addDynamicPriorityFeeWithFallback(initTx, connection, priorityLevel || PRIORITY_LEVELS.MEDIUM);
    
    const { blockhash: initBlockhash, lastValidBlockHeight: initLastValid } = 
      await connection.getLatestBlockhash('confirmed');
    initTx.recentBlockhash = initBlockhash;
    initTx.lastValidBlockHeight = initLastValid;
    
    const initSig = await sendTransactionWithSenderIfEnabled(
      connection, 
      initTx, 
      [userKeypair, positionKeypair], 
      priorityLevel || PRIORITY_LEVELS.MEDIUM
    );
    
    console.log(`   ✅ Position ${i + 1} initialized: ${positionKeypair.publicKey.toBase58()} (tx: ${initSig})`);
    signatures.push(initSig);
    try { await onTx(initSig); } catch {}
    txCount++;
    
    // Transactions 2+: Add liquidity in batches
    for (let j = 0; j < addLiquidityIxs.length; j++) {
      const liquidityIxBatch = addLiquidityIxs[j];
      const liquidityTx = new Transaction().add(...liquidityIxBatch);
      liquidityTx.feePayer = userKeypair.publicKey;
      
      // Add dynamic priority fee
      await addDynamicPriorityFeeWithFallback(liquidityTx, connection, priorityLevel || PRIORITY_LEVELS.MEDIUM);
      
      const { blockhash: liqBlockhash, lastValidBlockHeight: liqLastValid } = 
        await connection.getLatestBlockhash('confirmed');
      liquidityTx.recentBlockhash = liqBlockhash;
      liquidityTx.lastValidBlockHeight = liqLastValid;
      
      const liqSig = await sendTransactionWithSenderIfEnabled(
        connection, 
        liquidityTx, 
        [userKeypair], 
        priorityLevel || PRIORITY_LEVELS.MEDIUM
      );
      
      console.log(`   ✅ Liquidity batch ${j + 1}/${addLiquidityIxs.length} added: ${liqSig}`);
      signatures.push(liqSig);
      try { await onTx(liqSig); } catch {}
      txCount++;
    }
  }
  
  // Call the result callback to set the variables
  resultCallback(firstPositionPubKey, signatures, txCount);
}

/**
 * Check if a position exists for user
 * 
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {PublicKey} userPubKey - User public key
 * @returns {Promise<Object|null>} Existing position or null
 */
export async function checkExistingPosition(dlmmPool, userPubKey) {
  try {
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userPubKey);
    
    if (userPositions.length > 0) {
      return userPositions[0]; // Return first position
    }
    
    return null;
  } catch (error) {
    logger.warn('Failed to check existing positions', { error: error.message });
    return null;
  }
}

/**
 * Calculate position value in USD
 * 
 * @param {Object} position - Position data
 * @param {Object} prices - Token prices {tokenX, tokenY}
 * @param {Object} decimals - Token decimals {x, y}
 * @returns {number} Position value in USD
 */
export function calculatePositionValue(position, prices, decimals) {
  let totalX = 0;
  let totalY = 0;
  
  // Sum up all bins
  position.positionData.positionBinData.forEach(bin => {
    totalX += Number(bin.positionXAmount);
    totalY += Number(bin.positionYAmount);
  });
  
  // Convert to UI amounts
  const uiX = totalX / Math.pow(10, decimals.x);
  const uiY = totalY / Math.pow(10, decimals.y);
  
  // Calculate USD value
  return (uiX * prices.tokenX) + (uiY * prices.tokenY);
}
