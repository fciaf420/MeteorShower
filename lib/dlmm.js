/**
 * dlmm.js - Main export file for DLMM module
 * Per REFACTORING_PLAN.md Phase 3 (lines 159-163)
 * 
 * This is the clean, refactored version that imports from modular components
 */

import BN from 'bn.js';
import dlmmPackage from '@meteora-ag/dlmm';
import { PublicKey } from '@solana/web3.js';

// Core imports
import {
  createPositionCore,
  checkExistingPosition
} from './dlmm/core/position-creation.js';

// Strategy imports
import {
  balanceTokenRatio,
  calculateSwapAmount 
} from './dlmm/strategies/swap-logic.js';
import { 
  recenterPosition as recenterPositionCore,
  checkRebalanceNeeded 
} from './dlmm/strategies/rebalance.js';

// Utils imports
import {
  scanWalletForCompatibleTokens,
  fetchBalances
} from './dlmm/utils/wallet-scanner.js';
import {
  logPositionBinDistribution,
  resolveTotalBinsSpan
} from './dlmm/utils/bin-distribution.js';
import { validatePositionParams } from './dlmm/utils/validation.js';
import { logTokenAssignments } from './dlmm/utils/token-verification.js';
import { 
  convertUserRatiosToTokenRatios,
  getSolPositionInfo,
  logRatioMapping 
} from './dlmm/utils/sol-position-mapper.js';

// Handler imports
import { handleError, ERROR_CODES } from './dlmm/handlers/error-handler.js';
import { analyzeFees, claimFeesFromPosition } from './dlmm/handlers/fee-handler.js';

// External utility imports
import { withProgressiveSlippageAndFees } from './retry.js';
import { logger } from './logger.js';
import { getPrice } from './price.js';
import { SOL_MINT, MINIMUM_SOL_RESERVE_BN } from './constants.js';
import { getSolBalanceBN } from './balance-utils.js';
import { getMintDecimals } from './solana.js';
import { getFallbackPriorityFee, PRIORITY_LEVELS } from './priority-fee.js';

// Constants from DLMM package
const { StrategyType } = dlmmPackage;
const DLMM = dlmmPackage.default ?? dlmmPackage;

/**
 * Main function to open a DLMM position
 * Coordinates all the modular components
 * 
 * @param {Connection} connection - Solana connection
 * @param {Keypair} userKeypair - User wallet keypair
 * @param {number|null} solAmount - SOL amount to use
 * @param {Object|null} tokenRatio - Target token ratio {ratioX, ratioY}
 * @param {number|null} binSpan - Bin span for position
 * @param {string|null} poolAddress - Pool address
 * @param {string|null} liquidityStrategy - Strategy type
 * @param {Object|null} swaplessOptions - Swapless configuration
 * @param {Object|null} providedBalances - Pre-calculated balances
 * @param {boolean} skipExistingCheck - Skip checking for existing position
 * @param {Object} callbacks - Callback functions for events
 * @returns {Promise<Object>} Position creation result
 */
export async function openDlmmPosition(
      connection,
  userKeypair,
  solAmount = null,
  tokenRatio = null,
  binSpan = null,
  poolAddress = null,
  liquidityStrategy = null,
  swaplessOptions = null,
  providedBalances = null,
  skipExistingCheck = false,
  callbacks = {}
) {
  const onTx = callbacks.onTx || (async () => {});
  const onReserve = callbacks.onReserve || (() => {});
  
  logger.info('Opening DLMM position', {
    solAmount,
    tokenRatio,
    binSpan,
    poolAddress,
    liquidityStrategy
  });
  
  // Track swap state for retries
  let swapCompleted = false;
  let postSwapBalances = null;
  
  // Create position with progressive slippage and priority fees
  const executePositionCreation = async (slippage, attemptNumber, priorityLevel) => {
    console.log(`🎯 Position creation attempt ${attemptNumber + 1} - Slippage: ${slippage}% - Priority: ${priorityLevel || 'Static'}`);
    
    try {
      // 1. Pool Discovery
      if (!poolAddress) {
        throw new Error('Pool address is required');
      }
      
      const poolPubkey = new PublicKey(poolAddress);
      const dlmmPool = await DLMM.create(connection, poolPubkey, { cluster: 'mainnet-beta' });
      
      if (!dlmmPool) {
        throw new Error('Failed to load DLMM pool');
      }
      
      console.log(`📊 Pool loaded: ${dlmmPool.tokenX.symbol || 'TOKEN_X'}/${dlmmPool.tokenY.symbol || 'TOKEN_Y'} (${poolPubkey.toBase58().slice(0, 8)}...)`);
      
      // 🔄 CRITICAL: Cache token decimals IMMEDIATELY (before any USD calculations)
          for (const t of [dlmmPool.tokenX, dlmmPool.tokenY]) {
        if (typeof t.decimal !== 'number') {
              t.decimal = await getMintDecimals(connection, t.publicKey);
          }
      }
      console.log(`📏 Token decimals cached: X=${dlmmPool.tokenX.decimal}, Y=${dlmmPool.tokenY.decimal}`);
      
      // 🔍 Auto-verify token assignments and detect SOL
      logTokenAssignments(dlmmPool, 'DLMM Pool Token Verification');
      
      // 🔄 Get SOL position info for dynamic handling
      const solInfo = getSolPositionInfo(dlmmPool);
      console.log(`🎯 SOL Position: ${solInfo.solPosition ? `token${solInfo.solPosition}` : 'NONE'} in ${solInfo.poolName}`);
      
      // 2. Check for existing position (unless skipped)
      if (!skipExistingCheck) {
        // Safety: Ensure decimals are cached before position checking
        for (const t of [dlmmPool.tokenX, dlmmPool.tokenY]) {
          if (typeof t.decimal !== 'number') {
            t.decimal = await getMintDecimals(connection, t.publicKey);
          }
        }
        
        const existingPosition = await checkExistingPosition(dlmmPool, userKeypair.publicKey);
        if (existingPosition) {
          console.log(`⚠️  User already has a position in this pool: ${existingPosition.publicKey.toBase58()}`);
          console.log(`💡 Creating additional position in same pool (multiple positions allowed)`);
          // Continue with position creation - don't return existing position
        }
      }
      
      // 3. Fetch or use provided balances
    let balances;
    if (postSwapBalances) {
        // Use cached balances from completed swap
        console.log(`💡 Retry mode: Using cached balances from completed swap`);
      balances = postSwapBalances;
    } else if (providedBalances) {
        console.log(`💡 Using provided balances`);
      balances = providedBalances;
    } else {
        console.log(`🔍 Fetching wallet balances...`);
      balances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
    }

      let { lamX, lamY } = balances;
      
      // 🔧 FIX: Setup budget variables (from working backup)
    const solAmountNumber = solAmount !== null ? Number(solAmount) : null;
    const solBudgetLamports = (
      solAmountNumber !== null && Number.isFinite(solAmountNumber)
      ) ? Math.floor(solAmountNumber * 1e9) : null; // LAMPORTS_PER_SOL
    const solBudgetLamportsBN = solBudgetLamports !== null ? new BN(solBudgetLamports) : null;

    let ratioSolShare = null;
    if (
      solBudgetLamportsBN &&
      tokenRatio &&
      typeof tokenRatio.ratioX === 'number' &&
      typeof tokenRatio.ratioY === 'number'
    ) {
        const X_IS_SOL = dlmmPool.tokenX.publicKey.toString() === SOL_MINT.toString();
        const Y_IS_SOL = dlmmPool.tokenY.publicKey.toString() === SOL_MINT.toString();
        
      if (X_IS_SOL) ratioSolShare = tokenRatio.ratioX;
      else if (Y_IS_SOL) ratioSolShare = tokenRatio.ratioY;
      else ratioSolShare = 0;
    }

    const normalizedSolShare = ratioSolShare !== null
      ? Math.min(Math.max(ratioSolShare, 0), 1)
      : null;
    const targetSolLamportsBN = (
      normalizedSolShare !== null && solBudgetLamports !== null
    )
      ? new BN(Math.floor(solBudgetLamports * normalizedSolShare))
      : null;

      // Apply SOL budget limit if specified  
      const SOL_BUFFER = new BN(MINIMUM_SOL_RESERVE_BN);
        const nativeBalance = await getSolBalanceBN(connection, userKeypair.publicKey, 'confirmed');
      
      if (solAmount !== null && Number.isFinite(solAmount)) {
        const solAmountLamports = new BN(Math.floor(solAmount * 1e9));
        const X_IS_SOL = dlmmPool.tokenX.publicKey.toString() === SOL_MINT.toString();
        const Y_IS_SOL = dlmmPool.tokenY.publicKey.toString() === SOL_MINT.toString();

      if (X_IS_SOL) {
          const maxSolToUse = BN.min(solAmountLamports, nativeBalance.sub(SOL_BUFFER));
          lamX = BN.min(lamX, maxSolToUse);
          console.log(`🎯 Limiting SOL (Token X) to ${lamX.toNumber() / 1e9} SOL`);
      }
      if (Y_IS_SOL) {
          const maxSolToUse = BN.min(solAmountLamports, nativeBalance.sub(SOL_BUFFER));
          lamY = BN.min(lamY, maxSolToUse);
          console.log(`🎯 Limiting SOL (Token Y) to ${lamY.toNumber() / 1e9} SOL`);
        }
      }
      
      // 🔧 FIX: Reasonable SOL buffer check (like working backup)
      if (nativeBalance.lte(SOL_BUFFER)) {
        const msg = `Not enough native SOL to keep fee buffer. Have: ${(nativeBalance.toNumber() / 1e9).toFixed(3)} SOL, Need: ${(SOL_BUFFER.toNumber() / 1e9).toFixed(3)} SOL minimum`;
        console.log(`❌ ${msg}`);
        await onReserve();
        throw new Error(msg);
      }
      
      console.log(`✅ SOL buffer check passed: ${(nativeBalance.toNumber() / 1e9).toFixed(3)} SOL available, ${(SOL_BUFFER.toNumber() / 1e9).toFixed(3)} SOL buffer maintained`);
      
      // 4. Token balancing (if not swapless and not already swapped)
      if (!swapCompleted && !swaplessOptions?.swapless && tokenRatio) {
        // 🔧 FIX: Apply budget limiting for ratio calculations (from working backup)
        const X_IS_SOL = dlmmPool.tokenX.publicKey.toString() === SOL_MINT.toString();
        const Y_IS_SOL = dlmmPool.tokenY.publicKey.toString() === SOL_MINT.toString();
        
        const lamXForRatio = (X_IS_SOL && solBudgetLamportsBN) ? BN.min(lamX, solBudgetLamportsBN) : lamX;
        const lamYForRatio = (Y_IS_SOL && solBudgetLamportsBN) ? BN.min(lamY, solBudgetLamportsBN) : lamY;
        
        console.log(`💡 Budget-limited amounts for ratio calculation:`);
        if (X_IS_SOL && solBudgetLamportsBN) {
          console.log(`   X (SOL) limited: ${(lamX.toNumber() / 1e9).toFixed(6)} -> ${(lamXForRatio.toNumber() / 1e9).toFixed(6)} SOL`);
        }
        if (Y_IS_SOL && solBudgetLamportsBN) {
          console.log(`   Y (SOL) limited: ${(lamY.toNumber() / 1e9).toFixed(6)} -> ${(lamYForRatio.toNumber() / 1e9).toFixed(6)} SOL`);
        }

        const swapResult = await balanceTokenRatio({
              connection,
          userKeypair,
              dlmmPool,
          lamX: lamXForRatio, // Use budget-limited amounts
          lamY: lamYForRatio, // Use budget-limited amounts
          tokenRatio,
          solAmount,
          swaplessOptions,
          slippageBps: 10,
          priceImpactPct: 0.5
        });
        
        if (swapResult.swapped) {
          swapCompleted = true;
          
          // 🔧 CRITICAL FIX: Budget enforcement after swap (from working backup)
        console.log('⏳ Waiting 1s for swap to settle, then refreshing balances...');
        await new Promise(resolve => setTimeout(resolve, 1000));
          
          postSwapBalances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
          lamX = postSwapBalances.lamX;
          lamY = postSwapBalances.lamY;
          
          // Apply user's SOL budget cap after swap
          if (solAmount !== null && Number.isFinite(solAmount)) {
            const solBudgetLamports = Math.floor(solAmount * 1e9);
            const solBudgetLamportsBN = new BN(solBudgetLamports);
            const X_IS_SOL = dlmmPool.tokenX.publicKey.toString() === SOL_MINT.toString();
            const Y_IS_SOL = dlmmPool.tokenY.publicKey.toString() === SOL_MINT.toString();
            
            console.log(`🎯 Enforcing SOL budget post-swap: ${solAmount} SOL (${solBudgetLamports} lamports)`);

      if (X_IS_SOL) {
        const before = lamX;
              lamX = BN.min(before, solBudgetLamportsBN);
        if (lamX.lt(before)) {
          const reserved = before.sub(lamX);
                console.log(`💰 Budget clamp on X (SOL): ${(before.toNumber() / 1e9).toFixed(6)} -> ${(lamX.toNumber() / 1e9).toFixed(6)} SOL`);
          try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
        }
      } else if (Y_IS_SOL) {
        const before = lamY;
              lamY = BN.min(before, solBudgetLamportsBN);
        if (lamY.lt(before)) {
          const reserved = before.sub(lamY);
                console.log(`💰 Budget clamp on Y (SOL): ${(before.toNumber() / 1e9).toFixed(6)} -> ${(lamY.toNumber() / 1e9).toFixed(6)} SOL`);
          try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
              }
            }
          }
        }
      }
      
      // 3. Validate and convert strategy (like working backup)
      const strategyString = liquidityStrategy || process.env.LIQUIDITY_STRATEGY_TYPE || "Spot";
      if (!(strategyString in StrategyType)) {
        throw new Error(`Invalid strategy "${strategyString}". Valid: ${Object.keys(StrategyType).join(", ")}`);
      }
      const currentLiquidityStrategy = StrategyType[strategyString];
      console.log(`💡 Using liquidity strategy: ${strategyString}`);

      // 4. Calculate bin range (fixed to match working backup)
      const TOTAL_BINS_SPAN = binSpan || (swaplessOptions?.swaplessSpan) || 
                           await resolveTotalBinsSpan(dlmmPool);
      
      // 🔧 FIX: Get active bin correctly (like working backup)
    const activeBin = await dlmmPool.getActiveBin();
      const currentBinId = activeBin.binId;
    
    let minBin, maxBin;
    
      // 🔧 FIX: Use proper bin calculation logic (like working backup)
    if (swaplessOptions && swaplessOptions.swapless) {
        // Swapless mode logic from working backup
      const { direction, swaplessSpan } = swaplessOptions;
      const span = Math.max(1, Number(swaplessSpan));
      
      const hasX = lamX && lamX.gt(new BN(0));
      const hasY = lamY && lamY.gt(new BN(0));
      
        let depositSide = null;
      if (hasX && !hasY) depositSide = 'X';
      else if (!hasX && hasY) depositSide = 'Y';
      else if (hasX && hasY) {
          // Choose dominant USD side
          const usdXSide = (lamX.toNumber() / 10 ** dlmmPool.tokenX.decimal) * (await getPrice(dlmmPool.tokenX.publicKey.toString()));
          const usdYSide = (lamY.toNumber() / 10 ** dlmmPool.tokenY.decimal) * (await getPrice(dlmmPool.tokenY.publicKey.toString()));
        depositSide = usdXSide >= usdYSide ? 'X' : 'Y';
      } else {
          // Fallback to direction heuristic
          const X_IS_SOL = dlmmPool.tokenX.publicKey.equals(SOL_MINT);
          const Y_IS_SOL = dlmmPool.tokenY.publicKey.equals(SOL_MINT);
        depositSide = (direction === 'UP') ? (Y_IS_SOL ? 'X' : 'Y') : (X_IS_SOL ? 'X' : 'Y');
      }
      
      if (depositSide === 'X') {
          minBin = currentBinId;
          maxBin = currentBinId + (span - 1);
          console.log(`🎯 Swapless deposit=X: using above side: Bin ${minBin}..${maxBin} (${span} bins)`);
      } else {
          minBin = currentBinId - (span - 1);
          maxBin = currentBinId;
          console.log(`🎯 Swapless deposit=Y: using below side: Bin ${minBin}..${maxBin} (${span} bins)`);
        }
      } else {
        // Normal mode: Use sophisticated bin distribution from working backup
        const X_IS_SOL = dlmmPool.tokenX.publicKey.equals(SOL_MINT);
        const Y_IS_SOL = dlmmPool.tokenY.publicKey.equals(SOL_MINT);
      
      if (tokenRatio) {
          // Calculate SOL percentage based on which token is SOL
        let solPercentage, tokenPercentage;
        if (X_IS_SOL) {
          solPercentage = tokenRatio.ratioX;
          tokenPercentage = tokenRatio.ratioY;
        } else if (Y_IS_SOL) {
          solPercentage = tokenRatio.ratioY;
          tokenPercentage = tokenRatio.ratioX;
        } else {
          solPercentage = tokenRatio.ratioX;
          tokenPercentage = tokenRatio.ratioY;
        }
        
          console.log(`🎯 Token-aware bin distribution: SOL=${(solPercentage * 100).toFixed(1)}%, Token=${(tokenPercentage * 100).toFixed(1)}%`);
          
          // Handle extreme allocations (100% one-sided)
        if (solPercentage === 1) {
            // 100% SOL
          if (X_IS_SOL) {
              minBin = currentBinId;
              maxBin = currentBinId + (TOTAL_BINS_SPAN - 1);
          } else if (Y_IS_SOL) {
              minBin = currentBinId - (TOTAL_BINS_SPAN - 1);
              maxBin = currentBinId;
          }
        } else if (solPercentage === 0) {
            // 100% token
          if (X_IS_SOL) {
              minBin = currentBinId - (TOTAL_BINS_SPAN - 1);
              maxBin = currentBinId;
          } else if (Y_IS_SOL) {
              minBin = currentBinId;
              maxBin = currentBinId + (TOTAL_BINS_SPAN - 1);
          }
        } else {
          // Mixed allocation - exact total bins and side-aware placement
          const nonActive = TOTAL_BINS_SPAN - 1;
          const solBinsExact = Math.floor(nonActive * solPercentage);
          const tokenBinsExact = nonActive - solBinsExact;
          const belowBins = X_IS_SOL ? tokenBinsExact : solBinsExact;
          const aboveBins = X_IS_SOL ? solBinsExact : tokenBinsExact;
            minBin = currentBinId - belowBins;
            maxBin = currentBinId + aboveBins;
        }
      } else {
          // Default distribution
          const LOWER_COEF = 0.5;
          const binsForSOL = Math.floor(TOTAL_BINS_SPAN * LOWER_COEF);
          const binsForToken = Math.floor(TOTAL_BINS_SPAN * (1 - LOWER_COEF));
          minBin = currentBinId - binsForSOL;
          maxBin = currentBinId + binsForToken;
        }
      }
      
      console.log(`📊 Position range: Bins ${minBin} to ${maxBin} (${TOTAL_BINS_SPAN} bins total)`);
      
      // 🔧 FIX: Final budget cap enforcement before position creation (from working backup)
      if (solBudgetLamportsBN !== null) {
        const X_IS_SOL = dlmmPool.tokenX.publicKey.toString() === SOL_MINT.toString();
        const Y_IS_SOL = dlmmPool.tokenY.publicKey.toString() === SOL_MINT.toString();
        
        console.log(`💰 Final budget enforcement before position creation:`);
        console.log(`   Budget: ${(solBudgetLamportsBN.toNumber() / 1e9).toFixed(6)} SOL`);

    if (X_IS_SOL && lamX.gt(new BN(0))) {
      const before = lamX;
          lamX = BN.min(lamX, solBudgetLamportsBN);
          if (lamX.lt(before)) {
        const reserved = before.sub(lamX);
            console.log(`💰 Final budget cap on X (SOL): ${(before.toNumber() / 1e9).toFixed(6)} -> ${(lamX.toNumber() / 1e9).toFixed(6)} SOL`);
        try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
      }
    }
        
    if (Y_IS_SOL && lamY.gt(new BN(0))) {
      const before = lamY;
          lamY = BN.min(lamY, solBudgetLamportsBN);
          if (lamY.lt(before)) {
        const reserved = before.sub(lamY);
            console.log(`💰 Final budget cap on Y (SOL): ${(before.toNumber() / 1e9).toFixed(6)} -> ${(lamY.toNumber() / 1e9).toFixed(6)} SOL`);
        try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
          }
        }
        
        // Apply target ratio cap within budget
        if (targetSolLamportsBN !== null) {
          console.log(`🎯 Applying target ratio cap: ${(targetSolLamportsBN.toNumber() / 1e9).toFixed(6)} SOL`);
          
          if (X_IS_SOL) {
            const before = lamX;
            lamX = BN.min(lamX, targetSolLamportsBN);
            if (lamX.lt(before)) {
              const reserved = before.sub(lamX);
              console.log(`🎯 Ratio cap on X (SOL): ${(before.toNumber() / 1e9).toFixed(6)} -> ${(lamX.toNumber() / 1e9).toFixed(6)} SOL`);
              try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
            }
          } else if (Y_IS_SOL) {
          const before = lamY;
            lamY = BN.min(lamY, targetSolLamportsBN);
            if (lamY.lt(before)) {
              const reserved = before.sub(lamY);
              console.log(`🎯 Ratio cap on Y (SOL): ${(before.toNumber() / 1e9).toFixed(6)} -> ${(lamY.toNumber() / 1e9).toFixed(6)} SOL`);
              try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
            }
          }
        }
      }

      console.log(`✅ Final deposit amounts after all budget enforcement:`);
      console.log(`   Token X: ${(lamX.toNumber() / Math.pow(10, dlmmPool.tokenX.decimal || 9)).toFixed(6)}`);
      console.log(`   Token Y: ${(lamY.toNumber() / Math.pow(10, dlmmPool.tokenY.decimal || 9)).toFixed(6)}`);

      // 5. Create position (with correct strategy object structure)
      const positionResult = await createPositionCore({
        connection,
        userKeypair,
        dlmmPool,
      lamX,
      lamY,
        minBin,
        maxBin,
        slippage,
        priorityLevel,
        strategy: {
        minBinId: minBin,
        maxBinId: maxBin,
        strategyType: currentLiquidityStrategy,
      },
        onTx
      });
      
      if (!positionResult.success) {
        throw new Error('Failed to create position');
      }
      
      console.log(`🔍 [DEBUG] Position creation result:`, {
        success: positionResult.success,
        positionPubKey: positionResult.positionPubKey?.toBase58(),
        signatures: positionResult.signatures?.map(s => s.slice(0,8) + '...'),
        txCount: positionResult.txCount
      });
      
      // 7. Validate position by fetching it from SDK and calculating real USD value
      console.log(`🔍 Validating position: ${positionResult.positionPubKey.toBase58()}`);
      
      let userAmountUsd = 0; // Initialize USD value
      
      try {
        // Fetch the actual position from the blockchain using SDK
        // Add small delay and retry for position indexing during rebalancing
        await dlmmPool.refetchStates();
        
        let position = null;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (!position && attempts < maxAttempts) {
          attempts++;
          try {
            position = await dlmmPool.getPosition(positionResult.positionPubKey);
            if (position && position.positionData) break;
            } catch (e) {
            console.log(`🔄 Position fetch attempt ${attempts}/${maxAttempts} - waiting for indexing...`);
          }
          
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
          }
        }
        
        if (!position || !position.positionData) {
          throw new Error('Position not found after retries - may need more time to index');
        }
        
        // Calculate real USD value from position bin data
        const priceX = await getPrice(dlmmPool.tokenX.publicKey.toString());
        const priceY = await getPrice(dlmmPool.tokenY.publicKey.toString());
        
        if (!priceX || !priceY) {
          throw new Error('Price feed unavailable');
        }
        
        // Calculate USD value from actual position data
        let totalUsdValue = 0;
        const binData = position.positionData.positionBinData || [];
        
        console.log(`📊 Price validation: priceX=${priceX}, priceY=${priceY}`);
        
        // Ensure decimals are available (re-fetch if needed)
        if (!dlmmPool.tokenX.decimal || !dlmmPool.tokenY.decimal) {
          console.log(`🔄 Re-fetching missing decimals...`);
          const [xMint, yMint] = await Promise.all([
            getMintDecimals(connection, dlmmPool.tokenX.publicKey),
            getMintDecimals(connection, dlmmPool.tokenY.publicKey)
          ]);
          dlmmPool.tokenX.decimal = xMint;
          dlmmPool.tokenY.decimal = yMint;
        }
        
        console.log(`📊 Decimals: X=${dlmmPool.tokenX.decimal}, Y=${dlmmPool.tokenY.decimal}`);
        console.log(`📊 Processing ${binData.length} bins for USD calculation`);
        
        for (const bin of binData) {
          const xAmount = new BN(bin.positionXAmount || 0);
          const yAmount = new BN(bin.positionYAmount || 0);
          
          if (xAmount.gt(new BN(0)) || yAmount.gt(new BN(0))) {
            const xUi = xAmount.toNumber() / Math.pow(10, dlmmPool.tokenX.decimal);
            const yUi = yAmount.toNumber() / Math.pow(10, dlmmPool.tokenY.decimal);
            
            const binUsdX = xUi * priceX;
            const binUsdY = yUi * priceY;
            
            console.log(`  Bin ${bin.binId}: X=${xUi.toFixed(6)} ($${binUsdX.toFixed(4)}) + Y=${yUi.toFixed(6)} ($${binUsdY.toFixed(4)})`);
            
            if (!isNaN(binUsdX)) totalUsdValue += binUsdX;
            if (!isNaN(binUsdY)) totalUsdValue += binUsdY;
          }
        }
        
        console.log(`💰 Total calculated USD value: $${totalUsdValue.toFixed(4)}`);
        
        console.log(`✅ Position validated: $${totalUsdValue.toFixed(4)} actual liquidity`);
        userAmountUsd = totalUsdValue;
        
      } catch (validationError) {
        console.warn(`⚠️  Position validation failed: ${validationError.message}`);
        console.log(`📊 Falling back to estimated USD value based on user input`);
        
        // Fallback to user amount estimate if validation fails
        const estimatedSolPrice = 200;
        userAmountUsd = (solAmount || 0) * estimatedSolPrice;
      }

  return {
        dlmmPool,
    initialCapitalUsd: userAmountUsd,
        positionValue: userAmountUsd, // ← Add alias for rebalancing compatibility
        positionPubKey: positionResult.positionPubKey,
        signature: positionResult.signature,
        openFeeLamports: 0 // Placeholder
      };
      
      } catch (error) {
      // Reset swap state if position creation fails
      if (swapCompleted && attemptNumber < 2) {
        console.log(`⚠️  Position creation failed after swap - will retry with cached balances`);
      }
      
      throw handleError(
        error,
        'openDlmmPosition',
        { 
          poolAddress, 
          attemptNumber, 
          slippage 
        }
      );
    }
  };
  
  // Execute with progressive retry logic
  const openResult = await withProgressiveSlippageAndFees(
    executePositionCreation,
    'openDlmmPosition'
  );

  return openResult;
}

/**
 * Rebalance/recenter a DLMM position
 * Re-exports the core rebalance function
 * 
 * @param {Connection} connection - Solana connection
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {Keypair} userKeypair - User wallet keypair
 * @param {PublicKey} positionPubKey - Current position public key
 * @param {Object} originalParams - Original position parameters
 * @param {string} rebalanceDirection - Direction ('UP' or 'DOWN')
 * @returns {Promise<Object>} New position details
 */
export async function recenterPosition(
  connection,
  dlmmPool,
  userKeypair,
  positionPubKey,
  originalParams,
  rebalanceDirection
) {
  try {
    // Validate inputs
    if (!positionPubKey || !(positionPubKey instanceof PublicKey)) {
      throw new Error(`Invalid position key: ${positionPubKey}`);
    }
    
    logger.info('Recentering position', {
      position: positionPubKey.toBase58(),
      direction: rebalanceDirection,
      strategy: originalParams.rebalanceStrategy || originalParams.liquidityStrategy
    });
    
    // Call the core rebalance function
    const result = await recenterPositionCore(
    connection,
      dlmmPool,
    userKeypair,
      positionPubKey,
      originalParams,
      rebalanceDirection
    );
    
    return result;
    
  } catch (error) {
    throw handleError(
      error,
      'recenterPosition',
      {
        position: positionPubKey?.toBase58(),
        direction: rebalanceDirection
      }
    );
  }
}

// Re-export utility functions for external use
export {
  checkExistingPosition,
  checkRebalanceNeeded,
  scanWalletForCompatibleTokens,
  fetchBalances,
  logPositionBinDistribution,
  resolveTotalBinsSpan,
  validatePositionParams,
  analyzeFees,
  claimFeesFromPosition,
  balanceTokenRatio,
  calculateSwapAmount,
  handleError,
  ERROR_CODES
};

// Export constants
export { StrategyType };
