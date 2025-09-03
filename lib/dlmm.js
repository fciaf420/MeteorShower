// ───────────────────────────────────────────────
// ~/lib/dlmm.js
// ───────────────────────────────────────────────
import BN from 'bn.js';
import dlmmPackage from '@meteora-ag/dlmm';
import fetch from 'node-fetch';
import bs58 from 'bs58';
import { logger } from './logger.js';
const { StrategyType } = dlmmPackage;
import {
  PublicKey,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction
} from '@solana/web3.js';

import { withRetry, withProgressiveSlippage, withDynamicRetry, withProgressiveSlippageAndFees } from './retry.js';
import { getDynamicPriorityFee, addDynamicPriorityFee, PRIORITY_LEVELS, getFallbackPriorityFee } from './priority-fee.js';
import { sendTransactionWithSenderIfEnabled } from './sender.js';
import { SOL_MINT, TOKEN_ACCOUNT_SIZE, BASE_FEE_LAMPORTS, BASE_FEE_BN } from './constants.js';
import { calculateMaxSpendable, calculateMaxSpendableBN } from './fee-utils.js';
import { getSolBalanceBigInt, getSolBalanceBN } from './balance-utils.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { getPrice } from './price.js';
import { swapTokensUltra } from './jupiter.js';
import {
  getMintDecimals,
  safeGetBalance,
  unwrapWSOL,
} from './solana.js';

import 'dotenv/config';

/**
 * Scans wallet for tokens that match the DLMM pool's token mints
 * Only returns tokens that are part of the LP pair to avoid using random tokens
 */
async function scanWalletForCompatibleTokens(connection, userKeypair, dlmmPool) {
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
    
    // 🔧 FIX: Ensure decimals are available before using them
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

// pull config from env once
 const {
  POOL_ADDRESS,
  TOTAL_BINS_SPAN: ENV_TOTAL_BINS_SPAN,
  LOWER_COEF               = 0.5,
   MANUAL = 'true',
   DITHER_ALPHA_API = 'http://0.0.0.0:8000/metrics',   // sensible defaults
   LOOKBACK = '30',
   PRICE_IMPACT,
   SLIPPAGE
 } = process.env;

const MANUAL_MODE             = String(MANUAL).toLowerCase() === 'true';
const DEFAULT_TOTAL_BINS_SPAN = Number(ENV_TOTAL_BINS_SPAN ?? 20);
const SLIPPAGE_BPS = Number(SLIPPAGE ?? 10);       // e.g. “25” → 25
const PRICE_IMPACT_PCT = Number(PRICE_IMPACT ?? 0.5);

const DLMM = dlmmPackage.default ?? dlmmPackage;

const STRATEGY_STRING = (process.env.LIQUIDITY_STRATEGY_TYPE || "Spot").trim();

// Debug helper: log per-bin distribution for a position
async function logPositionBinDistribution(dlmmPool, ownerPk, positionPubKey, label = 'Position bin distribution') {
  try {
    await dlmmPool.refetchStates();
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(ownerPk);
    const pos = userPositions.find(p => p.publicKey.equals(positionPubKey));
    if (!pos) {
      console.log(`[dist] ${label}: position not found`);
      return;
    }
    const bins = pos.positionData?.positionBinData || [];
    console.log(`[dist] ${label}: ${bins.length} bin records`);
    let nonZero = 0;
    for (const b of bins) {
      const x = new BN(b.positionXAmount);
      const y = new BN(b.positionYAmount);
      if (!x.isZero() || !y.isZero()) {
        nonZero++;
        console.log(`  • Bin ${b.binId}: X=${x.toString()} Y=${y.toString()}`);
      }
    }
    if (nonZero === 0) console.log('  • All bins empty');
  } catch (e) {
    console.warn(`[dist] Failed to log bin distribution: ${e?.message || e}`);
  }
}

/**
 * Get dynamic priority fee with fallback to static fee
 * @param {Connection} connection - Solana connection
 * @param {Transaction} transaction - Transaction to estimate fees for
 * @param {string} priorityLevel - Priority level (Medium, High, VeryHigh)
 * @returns {Promise<number>} Priority fee in micro-lamports
 */
async function getDynamicPriorityFeeWithFallback(connection, transaction, priorityLevel = PRIORITY_LEVELS.MEDIUM) {
  try {
    // Attempt to get dynamic priority fee from Helius API
    return await getDynamicPriorityFee(connection, transaction, priorityLevel);
  } catch (error) {
    const fallbackFee = getFallbackPriorityFee(priorityLevel);
    console.warn(`⚠️  Dynamic priority fee failed, using static fallback: ${fallbackFee}`);
    return fallbackFee;
  }
}

// Validate & translate
if (!(STRATEGY_STRING in StrategyType)) {
  throw new Error(
    `Invalid LIQUIDITY_STRATEGY_TYPE="${STRATEGY_STRING}". ` +
    `Valid options: ${Object.keys(StrategyType).join(", ")}`
  );
}

export const LIQUIDITY_STRATEGY_TYPE = StrategyType[STRATEGY_STRING];

async function estimatePriorityFeeMicros(connection, feePayer, instructions, priorityLevel = 'Medium') {
  try {
    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) return null;
    const tx = new Transaction();
    if (Array.isArray(instructions) && instructions.length) tx.add(...instructions);
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = feePayer;
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const serializedB58 = bs58.encode(serialized);
    const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    const body = {
      jsonrpc: '2.0', id: '1', method: 'getPriorityFeeEstimate',
      params: [{ transaction: serializedB58, options: (priorityLevel ? { priorityLevel } : { recommended: true }) }]
    };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) return null;
    const data = await res.json();
    const estimate = data?.result?.priorityFeeEstimate;
    if (typeof estimate === 'number' && estimate > 0) return Math.floor(estimate);
    return null;
  } catch (_) {
    return null;
  }
}

async function resolveTotalBinsSpan(dlmmPool) {
  if (MANUAL_MODE) {
    console.log(`[config] MANUAL=true – using TOTAL_BINS_SPAN=${DEFAULT_TOTAL_BINS_SPAN}`);
    return DEFAULT_TOTAL_BINS_SPAN;
  }
  if (!DITHER_ALPHA_API || !LOOKBACK) {
    console.warn('[config] DITHER_ALPHA_API or LOOKBACK unset – using default span');
    return DEFAULT_TOTAL_BINS_SPAN;
  }
  // Attempt to read the pool's step size in basis‑points.
  // Try the SDK property first; fall back if missing
  const stepBp = dlmmPool?.lbPair?.binStep ?? dlmmPool?.binStep ?? dlmmPool?.stepBp ?? dlmmPool?.stepBP ?? null;
  if (stepBp == null) {
    console.warn('[config] Could not determine pool step_bp – using default span');
    return DEFAULT_TOTAL_BINS_SPAN;
  }

  // Compose API URL
  const mintA = dlmmPool.tokenX.publicKey.toString();
  const mintB = dlmmPool.tokenY.publicKey.toString();
  const url   = `${DITHER_ALPHA_API}?mintA=${mintA}&mintB=${mintB}&lookback=${LOOKBACK}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[config] API fetch failed (${res.status} ${res.statusText}) – using default span`);
      return DEFAULT_TOTAL_BINS_SPAN;
    }
    const data = await res.json();
    const gridSweep = data?.grid_sweep ?? data?.pnl_drivers?.grid_sweep;
    if (!Array.isArray(gridSweep)) {
      console.warn('[config] grid_sweep missing – using default span');
      return DEFAULT_TOTAL_BINS_SPAN;
    }

    const match = gridSweep.find(g => Number(g.step_bp) === Number(stepBp));
    if (!match) {
      console.warn(`[config] No grid_sweep entry for step_bp=${stepBp} – default span`);
      return DEFAULT_TOTAL_BINS_SPAN;
    }
    const binsPerSide = Number(match.bins);
    if (!Number.isFinite(binsPerSide) || binsPerSide <= 0) {
      console.warn('[config] Invalid bins value – default span');
      return DEFAULT_TOTAL_BINS_SPAN;
    }
    const span = binsPerSide * 2;                 // convert per‑side → total
    console.log(`[config] Resolved TOTAL_BINS_SPAN=${span} via API (step_bp=${stepBp})`);
    return span;
  } catch (err) {
    console.warn('[config] Error fetching grid_sweep –', err?.message ?? err);
    return DEFAULT_TOTAL_BINS_SPAN;
  }
}

async function fetchBalances(connection, dlmmPool, ownerPk) {
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

export async function openDlmmPosition(connection, userKeypair, solAmount = null, tokenRatio = null, binSpan = null, poolAddress = null, liquidityStrategy = null, swaplessOptions = null, providedBalances = null, skipExistingCheck = false, callbacks = {}) {
  const onTx = callbacks.onTx || (async () => {});
  const onReserve = callbacks.onReserve || (() => {});
  
  // Step 1: Track if swap has been completed to avoid double swapping
  let swapCompleted = false;
  let postSwapBalances = null;
  
  // Step 2: Position creation with progressive slippage + dynamic priority fee retry
  return await withProgressiveSlippageAndFees(async (slippage, attemptNumber, priorityLevel) => {
    console.log(`🎯 Position creation attempt ${attemptNumber + 1} - Slippage: ${slippage}% - Priority: ${priorityLevel || 'Static'}`);
    
    // Log SOL amount limiting
    if (solAmount !== null) {
      console.log(`🎯 Will limit position to ${solAmount} SOL as requested`);
    }
    //------------------------------------------------------------------
    // 0) Pool metadata
    //------------------------------------------------------------------
    const poolPK = new PublicKey(poolAddress || POOL_ADDRESS);
    const dlmmPool = await DLMM.create(connection, poolPK);
    // 🔍 0‑a) Abort if a position already exists (skip during rebalancing)
    if (!skipExistingCheck) {
      try {
        const { userPositions } =
          await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);

        if (userPositions.length) {
          // ── grab the first position (or pick by some other rule) ─────────
          const existingPos = userPositions[0];

          // (i) make sure decimals are cached
          for (const t of [dlmmPool.tokenX, dlmmPool.tokenY]) {
            if (typeof t.decimal !== 'number')
              t.decimal = await getMintDecimals(connection, t.publicKey);
          }
          const dx = dlmmPool.tokenX.decimal;
          const dy = dlmmPool.tokenY.decimal;

          // (ii) pull the balances locked in that position
          let lamX = new BN(0), lamY = new BN(0);
          existingPos.positionData.positionBinData.forEach(b => {
            lamX = lamX.add(new BN(b.positionXAmount));
            lamY = lamY.add(new BN(b.positionYAmount));
          });

          // (iii) USD valuation
          const priceX = await getPrice(dlmmPool.tokenX.publicKey.toString());
          const priceY = await getPrice(dlmmPool.tokenY.publicKey.toString());
          const uiX    = lamX.toNumber() / 10 ** dx;
          const uiY    = lamY.toNumber() / 10 ** dy;
          const depositUsd = uiX * priceX + uiY * priceY;

          console.log('[open] Existing position detected – skipping open.');

          return {
            dlmmPool,
            initialCapitalUsd: depositUsd,
            positionPubKey:    existingPos.publicKey,
            openFeeLamports:   0                 
          };
        }
      } catch (err) {
        console.error('[open] Could not check for existing positions:', err);
      }
    } else {
      console.log('[open] Skipping existing position check for rebalancing');
    }
    // Use provided binSpan or fallback to API/default
    const TOTAL_BINS_SPAN = binSpan || await resolveTotalBinsSpan(dlmmPool);
    
    // Use provided liquidity strategy or fallback to env/default
    const strategyString = liquidityStrategy || process.env.LIQUIDITY_STRATEGY_TYPE || "Spot";
    if (!(strategyString in StrategyType)) {
      throw new Error(`Invalid strategy "${strategyString}". Valid: ${Object.keys(StrategyType).join(", ")}`);
    }
    const currentLiquidityStrategy = StrategyType[strategyString];
    console.log(`💡 Using liquidity strategy: ${strategyString}`);
    logger.debug(`🔍 [DEBUG] Strategy mapping: "${strategyString}" → StrategyType.${strategyString} = ${currentLiquidityStrategy}`);

    // Cache decimals
    for (const t of [dlmmPool.tokenX, dlmmPool.tokenY]) {
      if (typeof t.decimal !== 'number')
        t.decimal = await getMintDecimals(connection, t.publicKey);
    }
    const dx = dlmmPool.tokenX.decimal;
    const dy = dlmmPool.tokenY.decimal;

    const X_MINT  = dlmmPool.tokenX.publicKey.toString();
    const Y_MINT  = dlmmPool.tokenY.publicKey.toString();
    const X_IS_SOL = X_MINT === SOL_MINT.toString();
    const Y_IS_SOL = Y_MINT === SOL_MINT.toString();

    //------------------------------------------------------------------
    // 1) Reserve SOL buffer (increased for safety)
    //------------------------------------------------------------------
    const SOL_BUFFER = new BN(20_000_000);          // 0.02 SOL for fees and safety (reduced for testing)

    // Use provided balances (from closed position) or fetch fresh balances
    let balances;
    if (postSwapBalances) {
      // Use cached post-clamp balances from previous attempt (respects original SOL limit)
      console.log(`📊 [RETRY] Using cached post-clamp balances from first attempt:`);
      console.log(`   • Cached lamX: ${postSwapBalances.lamX.toString()} (${(postSwapBalances.lamX.toNumber() / 10**dx).toFixed(6)} tokens)`);
      console.log(`   • Cached lamY: ${postSwapBalances.lamY.toString()} (${(postSwapBalances.lamY.toNumber() / 10**dy).toFixed(6)} tokens)`);
      balances = postSwapBalances;
    } else if (providedBalances) {
      console.log(`📊 [REBALANCE-LOG] Using provided balances from closed position:`);
      console.log(`   • Provided lamX: ${providedBalances.lamX.toString()} (${(providedBalances.lamX.toNumber() / 10**dx).toFixed(6)} tokens)`);
      console.log(`   • Provided lamY: ${providedBalances.lamY.toString()} (${(providedBalances.lamY.toNumber() / 10**dy).toFixed(6)} tokens)`);
      console.log(`   • Source: Calculated from closed position + fees (respects original ${solAmount} SOL limit)`);
      balances = providedBalances;
    } else {
      console.log(`📊 [REBALANCE-LOG] Fetching fresh wallet balances (initial position creation)`);
      balances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
      console.log(`   • Fresh lamX: ${balances.lamX.toString()} (${(balances.lamX.toNumber() / 10**dx).toFixed(6)} tokens)`);
      console.log(`   • Fresh lamY: ${balances.lamY.toString()} (${(balances.lamY.toNumber() / 10**dy).toFixed(6)} tokens)`);
    }

    let lamX = balances.lamX;      // BN
    let lamY = balances.lamY;      // BN

    // Skip SOL amount limiting when using provided balances (rebalancing) or cached balances (retry)
    if (postSwapBalances || providedBalances) {
      console.log(`💡 Using provided balances from closed position - no SOL limits for rebalancing`);
    } else if (solAmount !== null) {
      // Defer budget enforcement until after swap; preserve both sides now
      console.log(`🎯 Budget set to ${solAmount} SOL – will apply SOL buffer post-swap while preserving ratio`);
    }

    //------------------------------------------------------------------
    // 2) Optional Jupiter swap to achieve desired ratio (SKIP if swapless)
    //------------------------------------------------------------------
    const priceX = await getPrice(X_MINT);
    const priceY = await getPrice(Y_MINT);
    if (priceX == null || priceY == null)
      throw new Error('Price feed unavailable for one of the pool tokens');

    const usdX = lamX.toNumber() / 10 ** dx * priceX;
    const usdY = lamY.toNumber() / 10 ** dy * priceY;
    const totalUsd = usdX + usdY;

    // SWAPLESS MODE: Skip token balancing, use whatever tokens we have
    if (swaplessOptions && swaplessOptions.swapless) {
      console.log(`💡 Swapless mode: Using existing balances without swapping`);
      console.log(`   Current: $${usdX.toFixed(2)} X, $${usdY.toFixed(2)} Y`);
      // Skip all token balancing logic - we'll use whatever we have from the closed position
    } else if (postSwapBalances) {
      console.log(`💡 Retry mode: Using cached balances from completed swap`);
      console.log(`   Current: $${usdX.toFixed(2)} X, $${usdY.toFixed(2)} Y`);
      // Skip swapping on retry - use cached balances
    } else {
      // NORMAL MODE: Token balancing and swapping (NOT swapless)
      if (tokenRatio && totalUsd > 0.01) {
      
      // 🎯 FIX: Calculate target allocations based on user's requested SOL amount, not entire wallet
      let budgetUsd = totalUsd; // Default to full wallet if no budget specified
      if (solAmount !== null) {
        // Use user's specified SOL amount as the budget
        const solPrice = Y_IS_SOL ? priceY : priceX;
        budgetUsd = solAmount * solPrice;
        console.log(`🎯 Using ${solAmount} SOL budget ($${budgetUsd.toFixed(2)} USD) for target allocation`);
      }
      
      const targetUsdX = budgetUsd * tokenRatio.ratioX;
      const targetUsdY = budgetUsd * tokenRatio.ratioY;
      const diffUsdX = targetUsdX - usdX; // +ve → need more X, -ve → need less X
      
      console.log(`Current: $${usdX.toFixed(2)} X, $${usdY.toFixed(2)} Y`);
      console.log(`Target: $${targetUsdX.toFixed(2)} X (${(tokenRatio.ratioX * 100).toFixed(1)}%), $${targetUsdY.toFixed(2)} Y (${(tokenRatio.ratioY * 100).toFixed(1)}%)`);

      // Guard: if user wants 100% SOL, do not pre-swap. Respect budget later.
      const isHundredSol = (X_IS_SOL && tokenRatio.ratioX === 1 && tokenRatio.ratioY === 0) || (Y_IS_SOL && tokenRatio.ratioY === 1 && tokenRatio.ratioX === 0);
      if (isHundredSol) {
        console.log('✅ 100% SOL allocation detected — skipping any pre-swap. Budget clamp will limit SOL deposit.');
      } else {
        // Check if we have enough SOL to perform swaps safely
        const nativeBalance = await getSolBalanceBN(connection, userKeypair.publicKey, 'confirmed');
        const minSolForSwaps = SOL_BUFFER.add(new BN(20_000_000)); // Buffer + 0.02 SOL for swap fees
        
        if (nativeBalance.lt(minSolForSwaps)) {
          console.log(`⚠️  Skipping token balancing - insufficient SOL for safe swapping`);
          console.log(`   Native balance: ${nativeBalance.toNumber() / 1e9} SOL`);
          console.log(`   Minimum needed: ${minSolForSwaps.toNumber() / 1e9} SOL`);
          console.log(`   Using existing token balances without swaps`);
        } else if (Math.abs(diffUsdX) > 0.01) {
          const needMoreX = diffUsdX > 0;
          const inputMint  = needMoreX ? Y_MINT : X_MINT;
          const outputMint = needMoreX ? X_MINT : Y_MINT;
          const inputDecs  = needMoreX ? dy : dx;
          const pxInputUsd = needMoreX ? priceY : priceX;
          const usdToSwap  = Math.abs(diffUsdX);
          
          const rawInputAmt = BigInt(
            Math.floor((usdToSwap / pxInputUsd) * 10 ** inputDecs)
          );
          console.log(`Swapping ${needMoreX ? 'Y→X' : 'X→Y'} worth $${usdToSwap.toFixed(2)} to achieve ratio…`);

          const sig = await swapTokensUltra(
            inputMint,
            outputMint,
            rawInputAmt,
            userKeypair,
            connection,
            dlmmPool,
            SLIPPAGE_BPS,
            20,
            PRICE_IMPACT_PCT
          );
          if (!sig) throw new Error('Ultra API swap failed');
        } else {
          console.log('✅ Tokens already at desired ratio, no swap needed');
        }
      }
    } else if (!swaplessOptions || !swaplessOptions.swapless) {
      // FALLBACK ERROR: This should not happen with proper configuration
      
      // 🚨 SAFETY CHECK: This should never execute in swapless mode
      if (swaplessOptions && swaplessOptions.swapless) {
        throw new Error('CRITICAL BUG: Normal rebalancing fallback attempted in swapless mode.');
      }
      
      // This fallback should rarely execute now that we pass original tokenRatio for normal rebalancing
      console.error(`⚠️  CONFIGURATION ERROR: Normal rebalancing mode but no tokenRatio provided.`);
      console.error(`   This suggests the original token allocation was not preserved during rebalancing.`);
      console.error(`   Falling back to using existing token balances without swapping.`);
      console.error(`   Current: $${usdX.toFixed(2)} X, $${usdY.toFixed(2)} Y`);
      
      // Don't swap anything - just use what we have (similar to swapless behavior)
      console.log(`💡 Emergency fallback: Using existing balances without swapping`);
    }
    
    // End of swapping logic - swapless mode skips all the above
    
    // CRITICAL: After swapping, enforce user's SOL budget using post-swap balances
    if (solAmount !== null) {
      // Wait 1 second for blockchain/Jupiter to update before fetching fresh balances
      console.log('⏳ Waiting 1s for swap to settle, then refreshing balances...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const freshBalances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
      lamX = freshBalances.lamX;
      lamY = freshBalances.lamY;

      // Compute conservative cap: min(user budget, wallet balance minus rent/fees)
      const solAmountLamports = new BN(Math.floor(solAmount * 1e9));
      const estimatedPriorityFee = getFallbackPriorityFee(PRIORITY_LEVELS.MEDIUM); // Estimate from env-configured fallback
      const estPriorityLamports = BigInt(estimatedPriorityFee) * 250000n / 1_000_000n; // ~250k CU
      const walletLamports = await getSolBalanceBigInt(connection, userKeypair.publicKey, 'confirmed');
      let maxSpend = await calculateMaxSpendable(walletLamports, connection, estPriorityLamports);
      if (maxSpend < 0n) maxSpend = 0n;
      const conservativeCap = new BN(maxSpend.toString());
      const userCap = BN.min(solAmountLamports, conservativeCap);
      
      if (X_IS_SOL) {
        const before = lamX;
        lamX = BN.min(before, userCap);
        if (lamX.lt(before)) {
          const reserved = before.sub(lamX);
          try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
          console.log(`🎯 Budget clamp applied on X (SOL): ${before.toString()} → ${lamX.toString()}`);
        }
      } else if (Y_IS_SOL) {
        const before = lamY;
        lamY = BN.min(before, userCap);
        if (lamY.lt(before)) {
          const reserved = before.sub(lamY);
          try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
          console.log(`🎯 Budget clamp applied on Y (SOL): ${before.toString()} → ${lamY.toString()}`);
        }
      }
      console.log(`🎯 Enforced SOL budget post-swap; depositing per target ratio`);
      
      // 🔒 Enforce SOL-side ratio cap within the user's initial budget
      // Example: budget=1.0 SOL, SOL share=10% → cap SOL deposit to 0.1 SOL
      if (tokenRatio && typeof tokenRatio.ratioX === 'number' && typeof tokenRatio.ratioY === 'number') {
        let solShare = 0;
        if (X_IS_SOL) solShare = tokenRatio.ratioX;
        else if (Y_IS_SOL) solShare = tokenRatio.ratioY;
        if (solShare > 0 && solAmount !== null) {
          const targetSolLamports = new BN(Math.floor(solAmount * 1e9 * solShare));
          if (X_IS_SOL) {
            const before = lamX;
            lamX = BN.min(lamX, targetSolLamports);
            if (lamX.lt(before)) {
              const reserved = before.sub(lamX);
              try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
              console.log(`🎯 Ratio cap on X (SOL): ${before.toString()} → ${lamX.toString()} (target ${targetSolLamports.toString()})`);
            }
          } else if (Y_IS_SOL) {
            const before = lamY;
            lamY = BN.min(lamY, targetSolLamports);
            if (lamY.lt(before)) {
              const reserved = before.sub(lamY);
              try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
              console.log(`🎯 Ratio cap on Y (SOL): ${before.toString()} → ${lamY.toString()} (target ${targetSolLamports.toString()})`);
            }
          }
        }
      }
      
      // Cache balances for retry attempts AFTER budget clamping (this ensures retries respect original limits)
      if (!postSwapBalances) {
        postSwapBalances = { lamX: lamX, lamY: lamY };
        console.log(`📊 [CACHE] Cached post-clamp balances for retry attempts`);
      }
    } else {
      // If no solAmount limit, refresh balances after swapping –
      // BUT when rebalancing with providedBalances (position + fees),
      // keep the exact provided amounts to avoid timing/rpc drift and
      // unintended inclusion/exclusion of wallet reserves.
      if (!providedBalances) {
        console.log('⏳ Waiting 1s for swap to settle, then refreshing balances...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        const freshBalances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
        lamX = freshBalances.lamX;
        lamY = freshBalances.lamY;
        
        // Cache balances for retry attempts to avoid double swapping
        if (!postSwapBalances) {
          postSwapBalances = { lamX: freshBalances.lamX, lamY: freshBalances.lamY };
          console.log(`📊 [CACHE] Cached post-swap balances for retry attempts`);
        }
      }
    }
    }
    
    // Logging final amounts with correct decimals
    const uiFinalX = lamX.toNumber() / 10 ** dx;
    const uiFinalY = lamY.toNumber() / 10 ** dy;
    console.log(`💰 Using final amounts: ${uiFinalX} X, ${uiFinalY} Y`);

    // Initial buffer sanity check and one-time haircut (initial positions only)
    if (!providedBalances) {
      if (X_IS_SOL || Y_IS_SOL) {
        const native = await getSolBalanceBN(connection, userKeypair.publicKey, 'confirmed');
        if (native.lte(SOL_BUFFER)) throw new Error('Not enough native SOL to keep fee buffer');
      }
      
      // Apply 5 bps one-time haircut on initial position creation only
      const HAIRCUT_BPS_INITIAL = 5; // 0.05% - one-time safety reserve for entire position lifecycle
      const SCALE_INITIAL = new BN(10000);
      const HAIRCUT_NUM_INITIAL = new BN(10000 - HAIRCUT_BPS_INITIAL);

      console.log(`📊 [INITIAL-POSITION] Apply one-time safety haircut:`);
      console.log(`   • Haircut: ${HAIRCUT_BPS_INITIAL} bps (one-time only)`);
      console.log(`   • X_IS_SOL: ${X_IS_SOL}, Y_IS_SOL: ${Y_IS_SOL}`);
      console.log(`   • Pre-Haircut lamX: ${lamX.toString()} (${(lamX.toNumber() / 10**dx).toFixed(6)} tokens)`);
      console.log(`   • Pre-Haircut lamY: ${lamY.toString()} (${(lamY.toNumber() / 10**dy).toFixed(6)} tokens)`);

      // Apply haircut to SOL side
      if (X_IS_SOL && lamX.gt(new BN(0))) {
        const beforeHaircut = lamX;
        lamX = beforeHaircut.mul(HAIRCUT_NUM_INITIAL).div(SCALE_INITIAL);
        const reservedFromHaircut = beforeHaircut.sub(lamX);
        if (reservedFromHaircut.gt(new BN(0))) {
          try { onReserve(reservedFromHaircut); } catch (_) {}
          console.log(`   • One-time haircut reserve on X (SOL): ${reservedFromHaircut.toString()} lamports`);
        }
      }
      if (Y_IS_SOL && lamY.gt(new BN(0))) {
        const beforeHaircut = lamY;
        lamY = beforeHaircut.mul(HAIRCUT_NUM_INITIAL).div(SCALE_INITIAL);
        const reservedFromHaircut = beforeHaircut.sub(lamY);
        if (reservedFromHaircut.gt(new BN(0))) {
          try { onReserve(reservedFromHaircut); } catch (_) {}
          console.log(`   • One-time haircut reserve on Y (SOL): ${reservedFromHaircut.toString()} lamports`);
        }
      }

      // If single-sided token (SOL side zero), apply tiny haircut to token side too to avoid rounding overflows
      const HAIRCUT_BPS_TOKEN = 5;
      const SCALE_TOKEN = new BN(10000);
      const HAIRCUT_NUM_TOKEN = new BN(10000 - HAIRCUT_BPS_TOKEN);
      if ((X_IS_SOL && lamY.eq(new BN(0)) && lamX.gt(new BN(0))) || (Y_IS_SOL && lamX.eq(new BN(0)) && lamY.gt(new BN(0)))) {
        if (!X_IS_SOL && lamX.gt(new BN(0))) {
          const beforeX = lamX;
          lamX = beforeX.mul(HAIRCUT_NUM_TOKEN).div(SCALE_TOKEN);
          console.log(`   • Applied one-time token-side haircut on X: ${beforeX.toString()} → ${lamX.toString()}`);
          try { if (typeof globalThis.__MS_TOKEN_RESERVE_X_ADD__ === 'function') globalThis.__MS_TOKEN_RESERVE_X_ADD__(beforeX.sub(lamX)); } catch {}
        }
        if (!Y_IS_SOL && lamY.gt(new BN(0))) {
          const beforeY = lamY;
          lamY = beforeY.mul(HAIRCUT_NUM_TOKEN).div(SCALE_TOKEN);
          console.log(`   • Applied one-time token-side haircut on Y: ${beforeY.toString()} → ${lamY.toString()}`);
          try { if (typeof globalThis.__MS_TOKEN_RESERVE_Y_ADD__ === 'function') globalThis.__MS_TOKEN_RESERVE_Y_ADD__(beforeY.sub(lamY)); } catch {}
        }
      }
      
      console.log(`   ✅ X after one-time haircut: ${lamX.toString()} (${(lamX.toNumber() / 10**dx).toFixed(6)} tokens)`);
      console.log(`   ✅ Y after one-time haircut: ${lamY.toString()} (${(lamY.toNumber() / 10**dy).toFixed(6)} tokens)`);
    } else {
      // Rebalancing: Use exact position proceeds without additional haircuts
      console.log(`💡 [REBALANCING] Using exact position proceeds - no additional haircuts`);
      console.log(`   • Pre-Rebalance lamX: ${lamX.toString()} (${(lamX.toNumber() / 10**dx).toFixed(6)} tokens)`);
      console.log(`   • Pre-Rebalance lamY: ${lamY.toString()} (${(lamY.toNumber() / 10**dy).toFixed(6)} tokens)`);
    }
    
    // Sanity‑check: wallet still owns enough SOL (skip for rebalancing)
    if (!providedBalances) {
      const walletSol = Number((await getSolBalanceBN(connection, userKeypair.publicKey, 'confirmed')).toString());
      if (walletSol < SOL_BUFFER.toNumber())
        throw new Error('SOL buffer was consumed during swap — aborting');
    }

    //------------------------------------------------------------------
    // 4) Final deposit figures & USD value
    //------------------------------------------------------------------
    const uiX = lamX.toNumber() / 10 ** dx;
    const uiY = lamY.toNumber() / 10 ** dy;
    const depositUsd = uiX * priceX + uiY * priceY;
    console.log(`Final deposit: ${uiX.toFixed(4)} X  +  ${uiY.toFixed(4)} Y  =  $${depositUsd.toFixed(2)}`);

    //------------------------------------------------------------------
    // 5) Dynamic bin distribution based on token ratio OR swapless mode
    //------------------------------------------------------------------
    const activeBin = await dlmmPool.getActiveBin();
    
    let minBin, maxBin;
    
    // SWAPLESS MODE: Pick bin side based on the actual deposit side (X-only or Y-only),
    // not just the price direction. This avoids mismatches when ending the close with SOL vs token.
    if (swaplessOptions && swaplessOptions.swapless) {
      const { direction, swaplessSpan } = swaplessOptions;
      const currentBin = activeBin.binId;
      const span = Math.max(1, Number(swaplessSpan));
      
      const hasX = lamX && lamX.gt(new BN(0));
      const hasY = lamY && lamY.gt(new BN(0));
      
      let depositSide = null; // 'X' or 'Y'
      if (hasX && !hasY) depositSide = 'X';
      else if (!hasX && hasY) depositSide = 'Y';
      else if (hasX && hasY) {
        // When both assets exist, prioritize the direction-appropriate side for swapless
        if (direction === 'DOWN') {
          // OUT-BELOW: Use tokens (X) to position ABOVE, ignore small SOL dust
          depositSide = 'X';
          console.log(`💡 OUT-BELOW with dual assets: Using tokens (X) to position ABOVE, ignoring SOL dust`);
        } else {
          // OUT-ABOVE: Use SOL (Y) to position BELOW, ignore small token dust  
          depositSide = 'Y';
          console.log(`💡 OUT-ABOVE with dual assets: Using SOL (Y) to position BELOW, ignoring token dust`);
        }
      } else {
        // No funds detected; fall back to direction heuristic
        if (direction === 'DOWN') {
          // OUT-BELOW: Always position ABOVE to convert tokens to SOL on upward movement
          depositSide = 'X'; // X-side positions ABOVE current bin
          console.log(`💡 OUT-BELOW scenario: Forcing ABOVE positioning (depositSide=X) to capture upward token→SOL conversion`);
        } else {
          // OUT-ABOVE: Use original logic
          depositSide = (Y_IS_SOL ? 'X' : 'Y');
        }
      }
      
      if (depositSide === 'X') {
        // X-only bins are RIGHT (above) - zero out Y to avoid dual-asset deposit
        lamY = new BN(0);
        minBin = currentBin;
        maxBin = currentBin + (span - 1);
        console.log(`dY"S Swapless deposit=X ? using above side: Bin ${minBin}..${maxBin} (${span} bins)`);
        console.log(`💡 Zeroed out Y (SOL) for single-asset X deposit: ${lamY.toString()}`);
      } else {
        // Y-only bins are LEFT (below) - zero out X to avoid dual-asset deposit
        lamX = new BN(0);
        minBin = currentBin - (span - 1);
        maxBin = currentBin;
        console.log(`dY"S Swapless deposit=Y ? using below side: Bin ${minBin}..${maxBin} (${span} bins)`);
        console.log(`💡 Zeroed out X (tokens) for single-asset Y deposit: ${lamX.toString()}`);
      }
      
      // If our direction heuristic disagrees with deposit side, log it for visibility
      let expectedSide;
      if (direction === 'DOWN') {
        // OUT-BELOW: Always expect ABOVE positioning (X side)
        expectedSide = 'X';
      } else {
        // OUT-ABOVE: Use original logic
        expectedSide = (Y_IS_SOL ? 'X' : 'Y');
      }
      
      if (expectedSide !== depositSide) {
        console.log(`dY'? Note: Price direction=${direction} heuristic expected ${expectedSide} side, but balances indicate ${depositSide}. Using ${depositSide}.`);
      }
    }
    else {
      let dynamicLowerCoef = LOWER_COEF; // fallback to default
      let binsForSOL = Math.floor(TOTAL_BINS_SPAN * LOWER_COEF);
      let binsForToken = Math.floor(TOTAL_BINS_SPAN * (1 - LOWER_COEF));
      
      if (tokenRatio) {
        // Determine which token is SOL and calculate SOL percentage correctly
        let solPercentage, tokenPercentage;
        if (X_IS_SOL) {
          // SOL is tokenX
          solPercentage = tokenRatio.ratioX;
          tokenPercentage = tokenRatio.ratioY;
        } else if (Y_IS_SOL) {
          // SOL is tokenY  
          solPercentage = tokenRatio.ratioY;
          tokenPercentage = tokenRatio.ratioX;
        } else {
          // Neither is SOL - fallback to X/Y distribution
          solPercentage = tokenRatio.ratioX;
          tokenPercentage = tokenRatio.ratioY;
        }
        
        dynamicLowerCoef = solPercentage; // % allocated to SOL
        binsForSOL = Math.floor(TOTAL_BINS_SPAN * solPercentage);
        binsForToken = Math.floor(TOTAL_BINS_SPAN * tokenPercentage);
        
        logger.debug(`🔍 DEBUG: Token Assignment Analysis`);
        logger.debug(`   - ratioX: ${tokenRatio.ratioX} (${(tokenRatio.ratioX * 100).toFixed(1)}%)`);
        logger.debug(`   - ratioY: ${tokenRatio.ratioY} (${(tokenRatio.ratioY * 100).toFixed(1)}%)`);
        logger.debug(`   - X_IS_SOL: ${X_IS_SOL}, Y_IS_SOL: ${Y_IS_SOL}`);
        logger.debug(`   - Calculated SOL%: ${solPercentage} (${(solPercentage * 100).toFixed(1)}%)`);
        logger.debug(`   - Calculated Token%: ${tokenPercentage} (${(tokenPercentage * 100).toFixed(1)}%)`);
        logger.debug(`   - binsForSOL: ${binsForSOL}`);
        logger.debug(`   - binsForToken: ${binsForToken}`);
        
        // Side-aware, exact-span preview (exclude double-counting the active bin)
        const __nonActive = TOTAL_BINS_SPAN - 1;
        const __solBinsExact = Math.floor(__nonActive * solPercentage);
        const __tokenBinsExact = __nonActive - __solBinsExact;
        const __below = X_IS_SOL ? __tokenBinsExact : __solBinsExact;
        const __above = X_IS_SOL ? __solBinsExact : __tokenBinsExact;
        logger.debug(`📊 Normal Bin Distribution (exact):`);
        logger.debug(`   - ${__below} bins below active price (${(solPercentage * 100).toFixed(1)}% for ${X_IS_SOL ? 'TOKEN' : 'SOL'})`);
        logger.debug(`   - ${__above} bins above active price (${(tokenPercentage * 100).toFixed(1)}% for ${X_IS_SOL ? 'SOL' : 'TOKEN'})`);
        logger.debug(`   - Total span: ${TOTAL_BINS_SPAN} bins (including active)`);
        
        logger.debug(`🔍 DEBUG: Extreme Allocation Check`);
        logger.debug(`   - solPercentage === 1? ${solPercentage === 1} (100% SOL)`);
        logger.debug(`   - solPercentage === 0? ${solPercentage === 0} (100% Token)`);
        logger.debug(`   - activeBin.binId: ${activeBin.binId}`);
        logger.debug(`   - TOTAL_BINS_SPAN: ${TOTAL_BINS_SPAN}`);
        
        if (solPercentage === 1) {
          // 100% SOL — choose side based on which token is SOL
          if (X_IS_SOL) {
            // X-only bins are to the RIGHT (above)
            minBin = activeBin.binId;
            maxBin = activeBin.binId + (TOTAL_BINS_SPAN - 1);
            console.log(`💡 100% SOL allocation (SOL=X) - positioning ABOVE active price`);
            console.log(`   - Position will be: ${minBin} to ${maxBin} (ABOVE active bin ${activeBin.binId})`);
          } else if (Y_IS_SOL) {
            // Y-only bins are to the LEFT (below)
            minBin = activeBin.binId - (TOTAL_BINS_SPAN - 1);
            maxBin = activeBin.binId;
            console.log(`💡 100% SOL allocation (SOL=Y) - positioning BELOW active price`);
            console.log(`   - Position will be: ${minBin} to ${maxBin} (BELOW active bin ${activeBin.binId})`);
          }
        } else if (solPercentage === 0) {
          // 100% token — choose side based on which token is NON-SOL
          if (X_IS_SOL) {
            // token is Y → Y-only bins are LEFT (below)
            minBin = activeBin.binId - (TOTAL_BINS_SPAN - 1);
            maxBin = activeBin.binId;
            console.log(`💡 100% token allocation (token=Y) - positioning BELOW active price`);
            console.log(`   - Position will be: ${minBin} to ${maxBin} (BELOW active bin ${activeBin.binId})`);
          } else if (Y_IS_SOL) {
            // token is X → X-only bins are RIGHT (above)
            minBin = activeBin.binId;
            maxBin = activeBin.binId + (TOTAL_BINS_SPAN - 1);
            console.log(`💡 100% token allocation (token=X) - positioning ABOVE active price`);
            console.log(`   - Position will be: ${minBin} to ${maxBin} (ABOVE active bin ${activeBin.binId})`);
          }
        } else {
          // Mixed allocation - exact total bins and side-aware placement
          const nonActive = TOTAL_BINS_SPAN - 1;
          const solBinsExact = Math.floor(nonActive * solPercentage);
          const tokenBinsExact = nonActive - solBinsExact;
          const belowBins = X_IS_SOL ? tokenBinsExact : solBinsExact;
          const aboveBins = X_IS_SOL ? solBinsExact : tokenBinsExact;
          minBin = activeBin.binId - belowBins;
          maxBin = activeBin.binId + aboveBins;
          console.log(`💡 Mixed allocation - side-aware, exact-span around active bin`);
          console.log(`   - Below: ${belowBins} | Above: ${aboveBins} | Total: ${TOTAL_BINS_SPAN}`);
          console.log(`   - Position will be: ${minBin} to ${maxBin} (spanning active bin ${activeBin.binId})`);
        }
      } else {
        // Fallback to normal distribution
        minBin = activeBin.binId - binsForSOL;
        maxBin = activeBin.binId + binsForToken;
      }
    }

    //------------------------------------------------------------------
    // 5.5) Ensure user ATAs exist, then FINAL cap by budget−fees and buffer
    //------------------------------------------------------------------
    const ensureUserAtaIfNeeded = async (mintStr) => {
      if (mintStr === SOL_MINT.toString()) return; // native SOL
      const mintPk = new PublicKey(mintStr);
      const ata = await getAssociatedTokenAddress(mintPk, userKeypair.publicKey, true);
      let exists = true;
      try { await connection.getTokenAccountBalance(ata, 'confirmed'); } catch (e) { exists = /could not find account/i.test(e?.message || ''); }
      if (!exists) {
        const ix = createAssociatedTokenAccountInstruction(userKeypair.publicKey, ata, userKeypair.publicKey, mintPk);
        const tx = new Transaction().add(ix);
        tx.feePayer = userKeypair.publicKey;
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
        await sendTransactionWithSenderIfEnabled(connection, tx, [userKeypair], PRIORITY_LEVELS.MEDIUM);
        console.log(`✅ Created ATA for ${mintStr.slice(0, 8)}…`);
      }
    };

    await ensureUserAtaIfNeeded(X_MINT);
    await ensureUserAtaIfNeeded(Y_MINT);

    // Recompute wallet balance after any ATA rent, then cap SOL-side deposit (only if depositing SOL > 0)
    const walletLamportsPostAta = await getSolBalanceBN(connection, userKeypair.publicKey, 'confirmed');
    // Estimate small base + priority fee headroom; do not subtract SOL_BUFFER here since we never added it to deposit
    const estimatedPriorityFee = getFallbackPriorityFee(PRIORITY_LEVELS.MEDIUM); // Estimate from env-configured fallback
    const estPriorityLamports2 = new BN(Math.floor((estimatedPriorityFee * 250000) / 1_000_000));
    const baseFee = new BN(BASE_FEE_BN);
    let maxSpendForDeposit = calculateMaxSpendableBN(walletLamportsPostAta, estPriorityLamports2);
    if (maxSpendForDeposit.lt(new BN(0))) maxSpendForDeposit = new BN(0);

    if (X_IS_SOL && lamX.gt(new BN(0))) {
      const before = lamX;
      lamX = BN.min(lamX, maxSpendForDeposit);
      if (lamX.lte(new BN(0))) throw new Error('Insufficient lamports for SOL-side deposit after fees/rent');
      if (!lamX.eq(before)) {
        const reserved = before.sub(lamX);
        try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
        console.log(`🎯 Final cap on X (SOL): ${before.toString()} → ${lamX.toString()}`);
      }
    }
    if (Y_IS_SOL && lamY.gt(new BN(0))) {
      const before = lamY;
      lamY = BN.min(lamY, maxSpendForDeposit);
      if (lamY.lte(new BN(0))) throw new Error('Insufficient lamports for SOL-side deposit after fees/rent');
      if (!lamY.eq(before)) {
        const reserved = before.sub(lamY);
        try { if (typeof onReserve === 'function') onReserve(reserved); } catch {}
        console.log(`🎯 Final cap on Y (SOL): ${before.toString()} → ${lamY.toString()}`);
      }
    }

    //------------------------------------------------------------------
    // 5.9) Re-anchor bin range if active bin moved before sending tx
    //------------------------------------------------------------------
    try {
      const freshActive = await dlmmPool.getActiveBin();
      const freshId = Number(freshActive?.binId);
      const baseId = Number(activeBin?.binId);
      if (Number.isFinite(freshId) && Number.isFinite(baseId) && freshId !== baseId && Number.isFinite(minBin) && Number.isFinite(maxBin)) {
        const belowBins = Math.max(0, baseId - minBin);
        const aboveBins = Math.max(0, maxBin - baseId);
        const newMin = freshId - belowBins;
        const newMax = freshId + aboveBins;
        console.log(`[range] Active bin moved during open: ${baseId} → ${freshId}`);
        console.log(`[range] Re-anchoring position range: ${minBin}-${maxBin} → ${newMin}-${newMax}`);
        minBin = newMin;
        maxBin = newMax;
      }
    } catch (_) {}

    //------------------------------------------------------------------
    // 6) Build & send InitializePositionAndAddLiquidity transaction
    //------------------------------------------------------------------
      const binCount = maxBin - minBin + 1;
  const MAX_BIN_PER_TX = 69; // Standard transaction limit from SDK
  
  let sig;
  let posKP;
  
  let created = false;
  
  if (binCount <= MAX_BIN_PER_TX) {
    // Standard position creation for ≤69 bins
    console.log(`📊 Creating standard position with ${binCount} bins`);
    
    posKP = Keypair.generate();
    console.log(`🔍 [DEBUG] DLMM SDK call with strategy:`, {
      minBinId: minBin,
      maxBinId: maxBin,
      strategyType: currentLiquidityStrategy,
      strategyTypeName: Object.keys(StrategyType).find(key => StrategyType[key] === currentLiquidityStrategy)
    });
    
    const ixs = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: posKP.publicKey,
      user:           userKeypair.publicKey,
      totalXAmount:   lamX,
      totalYAmount:   lamY,
      strategy:       {
        minBinId: minBin,
        maxBinId: maxBin,
        strategyType: currentLiquidityStrategy,
        singleSidedX: lamY.isZero(),
      },
      slippage: slippage, // Progressive slippage: 1%, 2%, 3%, 3%...
    });

    const estOpenMicros = await estimatePriorityFeeMicros(connection, userKeypair.publicKey, ixs.instructions, 'Medium');
    const openMicros = estOpenMicros ?? getFallbackPriorityFee(PRIORITY_LEVELS.MEDIUM); // Fallback fee
    
    // Final balance validation for rebalancing scenarios - ensure we have enough SOL after recent transactions
    let finalIxs = ixs; // Default to original instructions
    
    if (providedBalances && (X_IS_SOL || Y_IS_SOL)) {
      const currentSolBalance = await getSolBalanceBigInt(connection, userKeypair.publicKey, 'confirmed');
      const solAmountToUse = X_IS_SOL ? lamX : lamY;
      const remainingAfter = currentSolBalance - BigInt(solAmountToUse.toString());
      console.log(`📊 [FINAL-CHECK] Current SOL balance: ${currentSolBalance.toString()} lamports (${(Number(currentSolBalance) / 1e9).toFixed(6)} SOL)`);
      console.log(`📊 [FINAL-CHECK] SOL to use: ${solAmountToUse.toString()} lamports (${(solAmountToUse.toNumber() / 1e9).toFixed(6)} SOL)`);
      console.log(`📊 [FINAL-CHECK] Will remain: ${remainingAfter.toString()} lamports (${(Number(remainingAfter) / 1e9).toFixed(6)} SOL)`);
      
      if (remainingAfter < 50_000_000n) { // Less than 0.05 SOL remaining
        console.log(`⚠️  [FINAL-CHECK] Very tight on SOL - applying emergency 10k lamport reduction`);
        if (X_IS_SOL && lamX.gt(new BN(10_000))) {
          const before = lamX;
          lamX = lamX.sub(new BN(10_000));
          console.log(`   🔧 Emergency reduction on X (SOL): ${before.toString()} → ${lamX.toString()}`);
        } else if (Y_IS_SOL && lamY.gt(new BN(10_000))) {
          const before = lamY;
          lamY = lamY.sub(new BN(10_000));
          console.log(`   🔧 Emergency reduction on Y (SOL): ${before.toString()} → ${lamY.toString()}`);
        }
        
        // Rebuild instructions with adjusted amounts
        finalIxs = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: posKP.publicKey,
          user:           userKeypair.publicKey,
          totalXAmount:   lamX,
          totalYAmount:   lamY,
          strategy:       {
            minBinId: minBin,
            maxBinId: maxBin,
            strategyType: currentLiquidityStrategy,
            singleSidedX: lamY.isZero(),
          },
          slippage: slippage,
        });
      }
    }
    
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: openMicros }),
      ...finalIxs.instructions
    );
    tx.feePayer = userKeypair.publicKey;

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash      = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;

    // Adaptive retry on TransferChecked insufficient funds
    const sendOnce = async () => {
      return await sendTransactionWithSenderIfEnabled(connection, tx, [userKeypair, posKP], PRIORITY_LEVELS.MEDIUM);
    };
    try {
      sig = await sendOnce();
    } catch (e) {
      const msg = String(e?.message ?? '');
      const logs = (e?.logs && Array.isArray(e.logs)) ? e.logs.join('\n') : '';
      const text = msg + '\n' + logs;
      if (/TransferChecked/i.test(text) && /insufficient funds|insufficient lamports/i.test(text) && ((Y_IS_SOL && lamY && lamY.gt(new BN(0))) || (X_IS_SOL === false && lamX && lamX.gt(new BN(0))))) {
        // Shave a tiny margin and retry once (SOL side or token-only X side)
        const MARGIN = new BN(5_000);
        if (Y_IS_SOL && lamY && lamY.gt(new BN(0))) {
          const before = lamY;
          lamY = BN.max(new BN(0), lamY.sub(MARGIN));
          const delta = before.sub(lamY);
          if (delta.gt(new BN(0))) { try { onReserve(delta); } catch (_) {} }
          logger.debug(`   🔧 Adaptive shrink applied on SOL side: ${before.toString()} → ${lamY.toString()} (−${delta.toString()} lamports)`);
        } else if (!Y_IS_SOL && lamX && lamX.gt(new BN(0))) {
          const beforeX = lamX;
          lamX = BN.max(new BN(0), lamX.sub(MARGIN));
          logger.debug(`   🔧 Adaptive shrink applied on token X side: ${beforeX.toString()} → ${lamX.toString()} (−${beforeX.sub(lamX).toString()} lamports)`);
        }
        // Rebuild tx with updated lamY
        logger.debug(`🔍 [DEBUG] RETRY DLMM SDK call with strategy:`, {
          minBinId: minBin,
          maxBinId: maxBin,
          strategyType: currentLiquidityStrategy,
          strategyTypeName: Object.keys(StrategyType).find(key => StrategyType[key] === currentLiquidityStrategy)
        });
        
        const retryIxs = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: posKP.publicKey,
          user:           userKeypair.publicKey,
          totalXAmount:   lamX,
          totalYAmount:   lamY,
          strategy:       {
            minBinId: minBin,
            maxBinId: maxBin,
            strategyType: currentLiquidityStrategy,
            singleSidedX: lamY.isZero(),
          },
          slippage: slippage, // Progressive slippage: 1%, 2%, 3%, 3%...
        });
        const estRetryMicros = await estimatePriorityFeeMicros(connection, userKeypair.publicKey, retryIxs.instructions, 'Medium');
        const retryMicros = estRetryMicros ?? getFallbackPriorityFee(PRIORITY_LEVELS.MEDIUM); // Fallback fee
        const retryTx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: retryMicros }),
          ...retryIxs.instructions
        );
        retryTx.feePayer = userKeypair.publicKey;
        const recent2 = await connection.getLatestBlockhash('confirmed');
        retryTx.recentBlockhash      = recent2.blockhash;
        retryTx.lastValidBlockHeight = recent2.lastValidBlockHeight;
        sig = await sendTransactionWithSenderIfEnabled(connection, retryTx, [userKeypair, posKP], PRIORITY_LEVELS.MEDIUM);
      } else {
        throw e;
      }
    }
    console.log(`📍 Standard position opened: ${sig}`);
    try { await logPositionBinDistribution(dlmmPool, userKeypair.publicKey, posKP.publicKey, 'Opened position'); } catch {}
    created = true;
    //
    try { await onTx(sig); } catch (_) {}
  } else {
    // Extended position creation for >69 bins using multiple positions
    console.log(`🎯 Creating extended position with ${binCount} bins (requires multiple transactions)`);
    
    // Create position keypair generator function
    const positionKeypairGenerator = async (count) => {
      const keypairs = [];
      for (let i = 0; i < count; i++) {
        keypairs.push(Keypair.generate());
      }
      return keypairs;
    };

    const slippageCandidates = [1.0, 2.0, 3.0];
    let lastError;
    let firstPositionPubKey = null; // Move outside the retry loop
    let txCount = 0;

    for (const slipPct of slippageCandidates) {
      try {
        console.log(`🔧 Extended add-liquidity with slippage ${slipPct}%`);
        // Reset txCount for each slippage attempt, but keep firstPositionPubKey if set
        txCount = 0;
    const result = await dlmmPool.initializeMultiplePositionAndAddLiquidityByStrategy(
      positionKeypairGenerator,
      lamX,
      lamY,
      {
        minBinId: minBin,
        maxBinId: maxBin,
        strategyType: currentLiquidityStrategy,
        singleSidedX: lamY.isZero(),
      },
      userKeypair.publicKey, // owner
      userKeypair.publicKey, // payer
          slipPct // slippage percentage
    );

    console.log(`🔄 Processing ${result.instructionsByPositions.length} positions for extended position...`);
    
    for (let i = 0; i < result.instructionsByPositions.length; i++) {
      const positionData = result.instructionsByPositions[i];
      const { positionKeypair, initializePositionIx, initializeAtaIxs, addLiquidityIxs } = positionData;
      
      if (i === 0 && !firstPositionPubKey) firstPositionPubKey = positionKeypair.publicKey;
      console.log(`   📊 Processing position ${i + 1}/${result.instructionsByPositions.length}...`);
      
      // Transaction 1: Initialize position and ATA (dynamic fee)
      const initIxs = [initializePositionIx, ...(initializeAtaIxs || [])];
      const estInitMicros = await estimatePriorityFeeMicros(connection, userKeypair.publicKey, initIxs, 'Medium');
      const initMicros = estInitMicros ?? getFallbackPriorityFee(PRIORITY_LEVELS.MEDIUM); // Fallback fee
      const initTx = new Transaction();
      initTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: initMicros }));
      initTx.add(...initIxs);
      initTx.feePayer = userKeypair.publicKey;
      const { blockhash: initBlockhash, lastValidBlockHeight: initLastValid } = await connection.getLatestBlockhash('confirmed');
      initTx.recentBlockhash = initBlockhash;
      initTx.lastValidBlockHeight = initLastValid;
      const initSig = await sendTransactionWithSenderIfEnabled(connection, initTx, [userKeypair, positionKeypair], PRIORITY_LEVELS.MEDIUM);
      console.log(`   ✅ Position ${i + 1} initialized: ${initSig}`);
          try { await onTx(initSig); } catch (_) {}
      txCount++;
      if (i === 0 && !sig) sig = initSig; // Use first transaction signature as main reference
      
      // Transactions 2+: Add liquidity in batches (dynamic fee)
      for (let j = 0; j < addLiquidityIxs.length; j++) {
        const liquidityIxBatch = addLiquidityIxs[j];
        const estLiqMicros = await estimatePriorityFeeMicros(connection, userKeypair.publicKey, liquidityIxBatch, 'Medium');
        const liqMicros = estLiqMicros ?? getFallbackPriorityFee(PRIORITY_LEVELS.MEDIUM); // Fallback fee
        const liquidityTx = new Transaction();
        liquidityTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: liqMicros }));
        liquidityTx.add(...liquidityIxBatch);
        liquidityTx.feePayer = userKeypair.publicKey;
        const { blockhash: liqBlockhash, lastValidBlockHeight: liqLastValid } = await connection.getLatestBlockhash('confirmed');
        liquidityTx.recentBlockhash = liqBlockhash;
        liquidityTx.lastValidBlockHeight = liqLastValid;
            try {
        const liqSig = await sendTransactionWithSenderIfEnabled(connection, liquidityTx, [userKeypair], PRIORITY_LEVELS.MEDIUM);
        logger.debug(`   ✅ Liquidity batch ${j + 1}/${addLiquidityIxs.length} added: ${liqSig}`);
              try { await onTx(liqSig); } catch (_) {}
        txCount++;
            } catch (e) {
              const msg = e?.message || '';
              // Anchor 6004 or hex 0x1774 or message indicates bin slippage
              const isBinSlip = /ExceededBinSlippageTolerance|\b6004\b|0x1774/i.test(msg);
              if (isBinSlip) {
                console.warn(`   ⚠️  Liquidity batch failed due to bin slippage at ${slipPct}% — will retry with higher slippage if available.`);
                throw e; // bubble to outer loop to retry with higher slippage
              }
              throw e;
            }
          }
        }

        // Success for this slippage
        created = true;
        break;
      } catch (error) {
        console.error(`❌ Extended position creation failed at slippage ${slipPct}%:`, error.message);
        // Will retry with higher slippage if available
      }
    }
    
    if (created) {
      if (!firstPositionPubKey) {
        throw new Error('Extended position creation failed: firstPositionPubKey not set');
      }
      posKP = { publicKey: firstPositionPubKey };
      console.log(`🎯 Extended position creation completed! Total transactions: ${txCount}, Main signature: ${sig}`);
      try { await logPositionBinDistribution(dlmmPool, userKeypair.publicKey, firstPositionPubKey, 'Opened (extended) position'); } catch {}
    }
  } // End of extended position handling

  if (!created) {
    throw new Error('Failed to create DLMM position after all attempts');
  }

  // Calculate deposited amounts for logging
  const tokenAmountX = lamX.toNumber() / Math.pow(10, dlmmPool.tokenX.decimal);
  const tokenAmountY = lamY.toNumber() / Math.pow(10, dlmmPool.tokenY.decimal);
  
  // Use the user's intended SOL amount for USD calculation (this is what they specified)
  // Assume SOL ~$200 for rough validation - actual USD tracking happens in main.js
  const userAmountUsd = (solAmount || 0) * 200;

  console.log(`✅ Position created successfully with $${(userAmountUsd || 0).toFixed(2)} liquidity`);
  
  return {
    dlmmPool: dlmmPool,
    initialCapitalUsd: userAmountUsd,
    positionPubKey: posKP.publicKey,
    signature: sig,
    openFeeLamports: 0 // Placeholder since fees are handled elsewhere
  };
  });
}

/**
 * Rebalance/recenter a DLMM position by closing current and opening new
 * @param {Connection} connection - Solana connection
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {Keypair} userKeypair - User wallet keypair
 * @param {PublicKey} positionPubKey - Current position public key
 * @param {Object} originalParams - Original position parameters
 * @param {string} rebalanceDirection - Direction of rebalancing ('UP' or 'DOWN')
 * @returns {Promise<Object>} New position details
*/
export async function recenterPosition(connection, dlmmPool, userKeypair, positionPubKey, originalParams, rebalanceDirection) {
  console.log(`🔄 [recenter] Swapless rebalancing: Respecting original deposit limit`);
  console.log(`   Original limit: ${originalParams.solAmount || 'unlimited'} SOL - will enforce this limit even with gains/fees`);

  // Use the rebalance strategy from originalParams (not the initial strategy)
  const strategyToUse = originalParams.rebalanceStrategy || originalParams.liquidityStrategy || 'Spot';
  console.log(`🎯 [recenter] Using rebalance strategy: ${strategyToUse}`);

  // Close the current position first and get tokens
  const { withRetry } = await import('./retry.js');
  const { unwrapWSOL } = await import('./solana.js');
  
  let lamX, lamY;
  // Track pre-close fees to decide swapping in claim_to_sol mode
  let preCloseFeeX = new BN(0), preCloseFeeY = new BN(0);
  
  await withRetry(async () => {
    console.log(`🔍 [DEBUG] Closing position: ${positionPubKey.toBase58()}`);
    console.log(`🔍 [DEBUG] Position type: ${typeof positionPubKey}, instanceof PublicKey: ${positionPubKey instanceof PublicKey}`);
    console.log(`🔍 [DEBUG] Owner: ${userKeypair.publicKey.toBase58()}`);
    
    // Validate position parameter
    if (!positionPubKey || !(positionPubKey instanceof PublicKey)) {
      throw new Error(`Invalid position key: ${positionPubKey}`);
    }
    
        // Remove 100% liquidity, then close the position explicitly
    await dlmmPool.refetchStates();
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
    const oldPos = userPositions.find(p => p.publicKey.equals(positionPubKey));
    if (!oldPos) throw new Error('Position not found to remove liquidity');

    // Snapshot fees before closing
    try {
      preCloseFeeX = new BN(oldPos?.positionData?.feeX || 0);
      preCloseFeeY = new BN(oldPos?.positionData?.feeY || 0);
      console.log(`📊 [REBALANCE-LOG] Pre-close fees: feeX=${preCloseFeeX.toString()} feeY=${preCloseFeeY.toString()}`);
    } catch (_) {}

    // Pre-close snapshot: sum all bin liquidity into lamX/lamY so we can reopen deterministically
    lamX = new BN(0);
    lamY = new BN(0);
    try {
      console.log(`📊 [REBALANCE-LOG] Pre-close snapshot of bin liquidity:`);
      for (const bin of (oldPos?.positionData?.positionBinData || [])) {
        const bx = new BN(bin.positionXAmount);
        const by = new BN(bin.positionYAmount);
        lamX = lamX.add(bx);
        lamY = lamY.add(by);
        if (!bx.isZero() || !by.isZero()) {
          console.log(`   • Bin ${bin.binId}: ${bx.toString()} X, ${by.toString()} Y`);
        }
      }
      // Optionally include unclaimed fees for auto-compound modes
      const feeHandlingMode = originalParams?.feeHandlingMode || 'compound'; // 'compound' | 'claim_to_sol'
      const autoCfg = originalParams?.autoCompoundConfig || {};
      const autoEnabled = !!autoCfg.enabled;
      const autoMode = autoCfg.mode || 'both'; // both | sol_only | token_only | none
      const feeX = new BN(oldPos?.positionData?.feeX || 0);
      const feeY = new BN(oldPos?.positionData?.feeY || 0);
      const X_IS_SOL = dlmmPool.tokenX.publicKey.toString() === SOL_MINT.toString();
      const Y_IS_SOL = dlmmPool.tokenY.publicKey.toString() === SOL_MINT.toString();
      if (feeHandlingMode === 'compound' && autoEnabled) {
        if (autoMode === 'both') {
          lamX = lamX.add(feeX);
          lamY = lamY.add(feeY);
          console.log(`   ↳ Auto-compound BOTH: +fees X=${feeX.toString()} Y=${feeY.toString()}`);
        } else if (autoMode === 'sol_only') {
          if (X_IS_SOL) { lamX = lamX.add(feeX); console.log(`   ↳ Auto-compound SOL_ONLY: +feeX=${feeX.toString()} (SOL)`); }
          if (Y_IS_SOL) { lamY = lamY.add(feeY); console.log(`   ↳ Auto-compound SOL_ONLY: +feeY=${feeY.toString()} (SOL)`); }
        } else if (autoMode === 'token_only') {
          if (!X_IS_SOL) { lamX = lamX.add(feeX); console.log(`   ↳ Auto-compound TOKEN_ONLY: +feeX=${feeX.toString()} (token)`); }
          if (!Y_IS_SOL) { lamY = lamY.add(feeY); console.log(`   ↳ Auto-compound TOKEN_ONLY: +feeY=${feeY.toString()} (token)`); }
        } else {
          console.log(`   ↳ Auto-compound NONE: fees not added to reopen amounts.`);
        }
      } else {
        // claim_to_sol or auto-compound disabled → do not add fees here
        console.log(`   ↳ Fee handling: ${feeHandlingMode}${autoEnabled ? ` (${autoMode})` : ' (auto-compound OFF)'} — not adding fees to reopen amounts`);
      }
    } catch (_) {
      // Non-fatal: we'll fall back to wallet after close if needed
      console.log(`⚠️  [REBALANCE-LOG] Could not enumerate bins pre-close; will rely on wallet post-close.`);
    }

    const removeTxs = await dlmmPool.removeLiquidity({
      position:            positionPubKey,
      user:                userKeypair.publicKey,
      fromBinId:           oldPos.positionData.lowerBinId,
      toBinId:             oldPos.positionData.upperBinId,
      bps:                 new BN(10_000),
      shouldClaimAndClose: true,
    });

    const rmTxs = Array.isArray(removeTxs) ? removeTxs : [removeTxs];
    console.log(`[recenter] Removing 100% liquidity in ${rmTxs.length} transaction(s)`);
    for (let i = 0; i < rmTxs.length; i++) {
      const tx = rmTxs[i];
      try {
        const dynamicFee = await getDynamicPriorityFeeWithFallback(connection, tx, PRIORITY_LEVELS.MEDIUM);
        tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: dynamicFee }));
      } catch {
        tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: getFallbackPriorityFee(PRIORITY_LEVELS.MEDIUM) }));
      }
      tx.feePayer = userKeypair.publicKey;
      const recent = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = recent.blockhash;
      tx.lastValidBlockHeight = recent.lastValidBlockHeight;
      const sig = await sendTransactionWithSenderIfEnabled(connection, tx, [userKeypair], PRIORITY_LEVELS.MEDIUM);
      console.log(`      o. Remove-liquidity tx ${i + 1}/${rmTxs.length} completed: ${sig}`);
    }






















    await unwrapWSOL(connection, userKeypair);
    console.log(`o. [recenter] Position fully closed and tokens returned to wallet`);
    
  }, 'recenterPosition');

  // ---------------------------------------------------------------
  // Fee handling: convert fees to SOL when in claim_to_sol mode
  // Applies threshold (minSwapUsd) to avoid tiny swaps. Auto-compound modes ignore threshold.
  // ---------------------------------------------------------------
  let claimedFeesUsd = 0;
  let unswappedFeesUsd = 0;
  try {
    const feeHandlingMode = originalParams?.feeHandlingMode || 'compound'; // 'compound' | 'claim_to_sol'
    const minSwapUsd = Number(originalParams?.minSwapUsd ?? 0);
    // Ensure decimals available
    for (const t of [dlmmPool.tokenX, dlmmPool.tokenY]) {
      if (typeof t.decimal !== 'number') t.decimal = await getMintDecimals(connection, t.publicKey);
    }
    const dx = dlmmPool.tokenX.decimal;
    const dy = dlmmPool.tokenY.decimal;
    const X_MINT = dlmmPool.tokenX.publicKey.toString();
    const Y_MINT = dlmmPool.tokenY.publicKey.toString();
    const X_IS_SOL = X_MINT === SOL_MINT.toString();
    const Y_IS_SOL = Y_MINT === SOL_MINT.toString();
    const solPx = await getPrice(SOL_MINT.toString());
    const active = await dlmmPool.getActiveBin();
    const tokenPx = (active?.price ?? 0) * solPx;

    // Compute fee USD values
    const feeXSigned = preCloseFeeX ?? new BN(0);
    const feeYSigned = preCloseFeeY ?? new BN(0);
    const solFeeLamports = X_IS_SOL ? feeXSigned : Y_IS_SOL ? feeYSigned : new BN(0);
    const tokenFeeAmount = X_IS_SOL ? feeYSigned : feeXSigned; // token on the non-SOL side
    const solFeeUsd = (solFeeLamports.toNumber() / 1e9) * solPx;
    const tokenDecs = X_IS_SOL ? dy : dx;
    const tokenFeeUnits = tokenFeeAmount.toNumber() / Math.pow(10, tokenDecs);
    const tokenFeeUsd = tokenFeeUnits * (tokenPx || 0);

    if (feeHandlingMode === 'claim_to_sol') {
      // Always count SOL-side fees as claimed; convert token-side if threshold permits
      claimedFeesUsd += solFeeUsd;

      if (tokenFeeAmount.gt(new BN(0)) && tokenFeeUsd > 0) {
        console.log(`💵 [FEES] Token-side fees: ${tokenFeeUnits.toFixed(6)} (~$${tokenFeeUsd.toFixed(2)}) | Threshold: $${minSwapUsd}`);
        if (tokenFeeUsd >= (minSwapUsd || 0)) {
          // Wait for indexers to reflect claimed amounts
          await new Promise(r => setTimeout(r, 1500));
          const inputMint = X_IS_SOL ? Y_MINT : X_MINT;
          const amount = BigInt(tokenFeeAmount.toString());
          const sig = await swapTokensUltra(
            inputMint,
            SOL_MINT,
            amount,
            userKeypair,
            connection,
            dlmmPool,
            SLIPPAGE_BPS,
            20,
            PRICE_IMPACT_PCT
          );
          if (sig) {
            console.log(`   ✅ Swapped token fees → SOL (sig: ${sig})`);
            claimedFeesUsd += tokenFeeUsd;
          } else {
            console.log(`   ⚠️ Swap returned no signature; leaving token fees unconverted`);
            unswappedFeesUsd += tokenFeeUsd;
          }
        } else {
          console.log(`   ⏸️ Below threshold — leaving token fees unconverted`);
          unswappedFeesUsd += tokenFeeUsd;
        }
      }
    } else {
      // compound modes: threshold not applicable here
      // Fees are handled in snapshot inclusion above based on autoCompoundConfig
    }
  } catch (e) {
    console.log(`⚠️ [FEES] Error during fee conversion handling: ${e?.message || e}`);
  }

  // We already captured lamX/lamY from the position before closing.
  // Now just report and validate against wallet balances post-close.
  console.log(`📊 [REBALANCE-LOG] Using pre-close snapshot amounts from position:`);
  // (lamX/lamY were computed pre-close; do not reset here.)
  
  console.log(`📊 [REBALANCE-LOG] ✅ Position proceeds calculated (PURE - no wallet contamination):`);
  console.log(`   • Total X from position: ${lamX.toString()} (${(lamX.toNumber() / Math.pow(10, dlmmPool.tokenX.decimal)).toFixed(6)} tokens)`);
  console.log(`   • Total Y from position: ${lamY.toString()} (${(lamY.toNumber() / Math.pow(10, dlmmPool.tokenY.decimal)).toFixed(6)} tokens)`);
  
  // Verify our calculated amounts match what should be in wallet (debug-safety only; source of truth is snapshot)
  const walletBalances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
  console.log(`🔍 [VALIDATION] Wallet vs Position comparison:`);
  console.log(`   • Wallet X: ${walletBalances.lamX.toString()}, Position X: ${lamX.toString()}`);
  console.log(`   • Wallet Y: ${walletBalances.lamY.toString()}, Position Y: ${lamY.toString()}`);
  
  if (walletBalances.lamX.lt(lamX) || walletBalances.lamY.lt(lamY)) {
    console.log(`⚠️ [VALIDATION] Warning: Wallet has less than expected from snapshot — capping to avoid insufficient-funds on reopen.`);
    // Safety cap only; we still derive target from the snapshot amounts
    lamX = BN.min(lamX, walletBalances.lamX);
    lamY = BN.min(lamY, walletBalances.lamY);
    console.log(`   🔧 Capped to wallet limits: X=${lamX.toString()}, Y=${lamY.toString()}`);
  }

  console.log(`🔄 [recenter] Calling openDlmmPosition with calculated balances...`);
  console.log(`   • Token X: ${(lamX?.toNumber() || 0) / Math.pow(10, dlmmPool.tokenX.decimal)} tokens`);  
  console.log(`   • Token Y: ${(lamY?.toNumber() || 0) / Math.pow(10, dlmmPool.tokenY.decimal)} tokens`);
  console.log(`   • Strategy: ${strategyToUse}`);
  console.log(`   • Bin Span: ${originalParams.swaplessConfig?.binSpan || originalParams.binSpan}`);

  // Skip rebalancing if we have no tokens to work with
  if ((!lamX || lamX.isZero()) && (!lamY || lamY.isZero())) {
    console.log(`⚠️ [DEBUG] No tokens available after position close - skipping rebalance`);
    return { dlmmPool, positionPubKey: null, signature: null };
  }

  // Determine if this should be swapless or normal rebalancing based on user configuration
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
  
  // Create new position with exact balances and correct strategy
  const result = await openDlmmPosition(
    connection,
    userKeypair, 
    null, // No SOL limit for rebalancing - use the full position value including gains/fees
    tokenRatioForRebalance, // Use original token ratio for normal rebalancing, null for swapless
    originalParams.swaplessConfig?.binSpan || originalParams.binSpan,
    originalParams.poolAddress,
    strategyToUse, // Use the rebalance strategy, not initial strategy
    swaplessOptions, // Swapless options based on user configuration
    { lamX, lamY }, // Provide exact balances from closed position
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
  // Compute position USD value from deposited amounts (position-only, excludes any wallet fees)
  let positionValueOnly = null;
  try {
    const priceX = await getPrice(dlmmPool.tokenX.publicKey.toString());
    const priceY = await getPrice(dlmmPool.tokenY.publicKey.toString());
    // Ensure decimals present
    for (const t of [dlmmPool.tokenX, dlmmPool.tokenY]) {
      if (typeof t.decimal !== 'number') t.decimal = await getMintDecimals(connection, t.publicKey);
    }
    const dx = dlmmPool.tokenX.decimal;
    const dy = dlmmPool.tokenY.decimal;
    const uiX = lamX ? (lamX.toNumber() / 10 ** dx) : 0;
    const uiY = lamY ? (lamY.toNumber() / 10 ** dy) : 0;
    positionValueOnly = (uiX * (priceX || 0)) + (uiY * (priceY || 0));
    console.log(`   • Position-only USD value: $${positionValueOnly.toFixed(2)}`);
  } catch {}

  return {
    dlmmPool,
    positionPubKey: result.positionPubKey,
    signature: result.signature,
    // PnL/baseline helpers for caller
    feesEarnedUsd: (claimedFeesUsd + unswappedFeesUsd),
    claimedFeesUsd,
    unswappedFeesUsd,
    compounded: false,
    positionValueOnly,
    newDepositValue: positionValueOnly
  };
}
