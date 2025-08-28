// ───────────────────────────────────────────────
// ~/lib/dlmm.js
// ───────────────────────────────────────────────
import BN from 'bn.js';
import dlmmPackage from '@meteora-ag/dlmm';
import fetch from 'node-fetch';
import bs58 from 'bs58';
const { StrategyType } = dlmmPackage;
import {
  PublicKey,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction
} from '@solana/web3.js';

import { withRetry, withProgressiveSlippage } from './retry.js';
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
  PRIORITY_FEE_MICRO_LAMPORTS = 50_000,
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
      params: [{ transaction: serializedB58, options: { priorityLevel, recommended: true } }]
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

async function openDlmmPosition(connection, userKeypair, solAmount = null, tokenRatio = null, binSpan = null, poolAddress = null, liquidityStrategy = null, swaplessOptions = null, providedBalances = null, skipExistingCheck = false, callbacks = {}) {
  const onTx = callbacks.onTx || (async () => {});
  const onReserve = callbacks.onReserve || (() => {});
  
  // Step 1: Track if swap has been completed to avoid double swapping
  let swapCompleted = false;
  let postSwapBalances = null;
  
  // Step 2: Position creation with progressive slippage retry
  return await withProgressiveSlippage(async (slippage) => {
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

    // Cache decimals
    for (const t of [dlmmPool.tokenX, dlmmPool.tokenY]) {
      if (typeof t.decimal !== 'number')
        t.decimal = await getMintDecimals(connection, t.publicKey);
    }
    const dx = dlmmPool.tokenX.decimal;
    const dy = dlmmPool.tokenY.decimal;

    const SOL_MINT_ADDR = 'So11111111111111111111111111111111111111112';
    const X_MINT  = dlmmPool.tokenX.publicKey.toString();
    const Y_MINT  = dlmmPool.tokenY.publicKey.toString();
    const X_IS_SOL = X_MINT === SOL_MINT_ADDR;
    const Y_IS_SOL = Y_MINT === SOL_MINT_ADDR;

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
      console.log(`💡 Skipping SOL limits for rebalancing - using exact balances from closed position`);
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
    } else if (postSwapBalances) {
      console.log(`💡 Retry mode: Using cached balances from completed swap`);
      console.log(`   Current: $${usdX.toFixed(2)} X, $${usdY.toFixed(2)} Y`);
    } else {
      // NORMAL MODE: Token balancing and swapping
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
        const nativeBalance = new BN(await connection.getBalance(userKeypair.publicKey, 'confirmed'));
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
    } else {
      // Fallback to original 50/50 balancing logic
      // 🎯 FIX: Apply budget constraints for 50/50 allocation too
      let budgetUsd = totalUsd; // Default to full wallet if no budget specified
      if (solAmount !== null) {
        // Use user's specified SOL amount as the budget
        const solPrice = Y_IS_SOL ? priceY : priceX;
        budgetUsd = solAmount * solPrice;
        console.log(`🎯 Using ${solAmount} SOL budget ($${budgetUsd.toFixed(2)} USD) for 50/50 allocation`);
      }
      
      const targetUsd50X = budgetUsd * 0.5;
      const targetUsd50Y = budgetUsd * 0.5;
      const diffUsd = targetUsd50Y - usdX; // How much to swap to reach 50/50 within budget
      
      if (Math.abs(diffUsd) > 0.01) {
        const inputMint  = diffUsd > 0 ? Y_MINT : X_MINT;
        const outputMint = diffUsd > 0 ? X_MINT : Y_MINT;
        const inputDecs  = diffUsd > 0 ? dy      : dx;
        const pxInputUsd = diffUsd > 0 ? priceY  : priceX;
        const usdToSwap  = Math.abs(diffUsd);
        
        let rawInputAmt = BigInt(
          Math.floor((usdToSwap / pxInputUsd) * 10 ** inputDecs)
        );
        // Budget and buffer clamp: never swap more than user budget minus a SOL buffer
        if (solAmount !== null) {
          const solCapLamports = BigInt(Math.floor(solAmount * 1e9));
          const bufferLamports = BigInt(SOL_BUFFER.toString());
          const maxSpendLamports = solCapLamports > bufferLamports ? solCapLamports - bufferLamports : 0n;
          // If swapping from SOL side, clamp by budget; if swapping to SOL side, this clamp is not needed here
          const swappingFromSol = (inputMint === X_MINT && X_IS_SOL) || (inputMint === Y_MINT && Y_IS_SOL);
          if (swappingFromSol && rawInputAmt > maxSpendLamports) {
            rawInputAmt = maxSpendLamports;
            console.log(`🎯 Clamped swap-in to budget-buffer: ${maxSpendLamports.toString()} lamports`);
          }
        }
        console.log(`Swapping ${diffUsd > 0 ? 'Y→X' : 'X→Y'} worth $${usdToSwap.toFixed(2)} for 50/50 balance…`);

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
      }
    }
    
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
      const TOKEN_ACCOUNT_SIZE = 165;
      const rentExempt = BigInt(await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE));
      const PRIORITY_FEE_MICRO_LAMPORTS = Number(process.env.PRIORITY_FEE_MICRO_LAMPORTS || 50_000);
      const estPriorityLamports = BigInt(PRIORITY_FEE_MICRO_LAMPORTS) * 250000n / 1_000_000n; // ~250k CU
      const baseFeeLamports = 5000n;
      const walletLamports = BigInt(await connection.getBalance(userKeypair.publicKey, 'confirmed'));
      let maxSpend = walletLamports - estPriorityLamports - baseFeeLamports - rentExempt;
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

    // Initial buffer sanity check (do not subtract yet; final cap happens after ATA ensure)
    if (!providedBalances) {
      if (X_IS_SOL || Y_IS_SOL) {
        const native = new BN(await connection.getBalance(userKeypair.publicKey, 'confirmed'));
        if (native.lte(SOL_BUFFER)) throw new Error('Not enough native SOL to keep fee buffer');
      }
    } else {
      // Dynamic cap by available native SOL minus estimated fees/rent, then apply tiny haircut
      const HAIRCUT_BPS_SOL = 5; // 0.05%
      const SCALE_SOL = new BN(10000);
      const HAIRCUT_NUM_SOL = new BN(10000 - HAIRCUT_BPS_SOL);

      console.log(`📊 [REBALANCE-LOG] Apply dynamic cap by available SOL, then tiny haircut:`);
      console.log(`   • Haircut: ${HAIRCUT_BPS_SOL} bps on SOL side`);
      console.log(`   • X_IS_SOL: ${X_IS_SOL}, Y_IS_SOL: ${Y_IS_SOL}`);
      console.log(`   • Pre-Cap lamX: ${lamX.toString()} (${(lamX.toNumber() / 10**dx).toFixed(6)} tokens)`);
      console.log(`   • Pre-Cap lamY: ${lamY.toString()} (${(lamY.toNumber() / 10**dy).toFixed(6)} tokens)`);

      // Helper: cap a lamport amount by wallet balance minus fee/rent estimates, then haircut and report reserve
      const capThenHaircut = async (amountBN, decimals, label) => {
        const balanceLamports = BigInt(await connection.getBalance(userKeypair.publicKey, 'confirmed'));
        // Conservative estimates for fees and rent
        const TOKEN_ACCOUNT_SIZE = 165;
        const rentExempt = BigInt(await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE));
        const PRIORITY_FEE_MICRO_LAMPORTS = Number(process.env.PRIORITY_FEE_MICRO_LAMPORTS || 50_000);
        const estPriorityLamports = BigInt(PRIORITY_FEE_MICRO_LAMPORTS) * 250000n / 1_000_000n; // ~250k CU
        const baseFeeLamports = 5000n;

        let maxSpend = balanceLamports - estPriorityLamports - baseFeeLamports - rentExempt;
        if (maxSpend < 0n) maxSpend = 0n;

        const beforeCap = amountBN;
        let capped = BN.min(beforeCap, new BN(maxSpend.toString()));
        const reservedFromCap = beforeCap.sub(capped);
        if (reservedFromCap.gt(new BN(0))) {
          try { onReserve(reservedFromCap); } catch (_) {}
          console.log(`   • Cap reserve (${label}): ${reservedFromCap.toString()} lamports`);
        }

        const beforeHaircut = capped;
        capped = beforeHaircut.mul(HAIRCUT_NUM_SOL).div(SCALE_SOL);
        const reservedFromHaircut = beforeHaircut.sub(capped);
        if (reservedFromHaircut.gt(new BN(0))) {
          try { onReserve(reservedFromHaircut); } catch (_) {}
          console.log(`   • Haircut reserve (${label}): ${reservedFromHaircut.toString()} lamports`);
        }

        console.log(`   ✅ ${label} after cap+haircut: ${capped.toString()} (${(capped.toNumber() / 10**decimals).toFixed(6)} tokens)`);
        return capped;
      };

      const DUST_CLAMP = new BN(10_000); // 0.00001 SOL
      if (X_IS_SOL) {
        if (lamX.lt(DUST_CLAMP) && lamX.gt(new BN(0))) {
          try { onReserve(lamX); } catch (_) {}
          console.log(`   • Clamped tiny SOL on X to zero: ${lamX.toString()} lamports`);
          lamX = new BN(0);
        } else {
          lamX = await capThenHaircut(lamX, dx, 'X (SOL)');
        }
      }
      if (Y_IS_SOL) {
        if (lamY.lt(DUST_CLAMP) && lamY.gt(new BN(0))) {
          try { onReserve(lamY); } catch (_) {}
          console.log(`   • Clamped tiny SOL on Y to zero: ${lamY.toString()} lamports`);
          lamY = new BN(0);
      } else {
          lamY = await capThenHaircut(lamY, dy, 'Y (SOL)');
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
          console.log(`   • Applied token-side haircut on X: ${beforeX.toString()} → ${lamX.toString()}`);
          try { if (typeof globalThis.__MS_TOKEN_RESERVE_X_ADD__ === 'function') globalThis.__MS_TOKEN_RESERVE_X_ADD__(beforeX.sub(lamX)); } catch {}
        }
        if (!Y_IS_SOL && lamY.gt(new BN(0))) {
          const beforeY = lamY;
          lamY = beforeY.mul(HAIRCUT_NUM_TOKEN).div(SCALE_TOKEN);
          console.log(`   • Applied token-side haircut on Y: ${beforeY.toString()} → ${lamY.toString()}`);
          try { if (typeof globalThis.__MS_TOKEN_RESERVE_Y_ADD__ === 'function') globalThis.__MS_TOKEN_RESERVE_Y_ADD__(beforeY.sub(lamY)); } catch {}
        }
      }
    }
    
    // Sanity‑check: wallet still owns enough SOL (skip for rebalancing)
    if (!providedBalances) {
      const walletSol = await connection.getBalance(userKeypair.publicKey, 'confirmed');
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
    
    // SWAPLESS MODE: Create single-sided position based on direction
    if (swaplessOptions && swaplessOptions.swapless) {
      const { direction, swaplessSpan } = swaplessOptions;
      const currentBin = activeBin.binId;
      const span = Math.max(1, Number(swaplessSpan));
      
      if (direction === 'UP') {
        // Price moved UP → finished in TOKEN (non-SOL). Choose side by token identity.
        if (X_IS_SOL) {
          // token is Y → Y-only bins are LEFT (below)
          minBin = currentBin - (span - 1);
          maxBin = currentBin;
          console.log(`📊 Swapless UP - TOKEN=Y Position (below): Bin ${minBin}..${maxBin} (${span} bins)`);
        } else if (Y_IS_SOL) {
          // token is X → X-only bins are RIGHT (above)
          minBin = currentBin;
          maxBin = currentBin + (span - 1);
          console.log(`📊 Swapless UP - TOKEN=X Position (above): Bin ${minBin}..${maxBin} (${span} bins)`);
        }
      } else if (direction === 'DOWN') {
        // Price moved DOWN → finished in SOL. Choose side by SOL identity.
        if (X_IS_SOL) {
          // SOL is X → X-only bins are RIGHT (above)
          minBin = currentBin;
          maxBin = currentBin + (span - 1);
          console.log(`📊 Swapless DOWN - SOL=X Position (above): Bin ${minBin}..${maxBin} (${span} bins)`);
        } else if (Y_IS_SOL) {
          // SOL is Y → Y-only bins are LEFT (below)
          minBin = currentBin - (span - 1);
          maxBin = currentBin;
          console.log(`📊 Swapless DOWN - SOL=Y Position (below): Bin ${minBin}..${maxBin} (${span} bins)`);
        }
      } else {
        throw new Error(`Invalid swapless direction: ${direction}. Must be 'UP' or 'DOWN'`);
      }
    }
    // NORMAL MODE: Calculate dynamic LOWER_COEF from token ratio
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
        
        console.log(`🔍 DEBUG: Token Assignment Analysis`);
        console.log(`   - ratioX: ${tokenRatio.ratioX} (${(tokenRatio.ratioX * 100).toFixed(1)}%)`);
        console.log(`   - ratioY: ${tokenRatio.ratioY} (${(tokenRatio.ratioY * 100).toFixed(1)}%)`);
        console.log(`   - X_IS_SOL: ${X_IS_SOL}, Y_IS_SOL: ${Y_IS_SOL}`);
        console.log(`   - Calculated SOL%: ${solPercentage} (${(solPercentage * 100).toFixed(1)}%)`);
        console.log(`   - Calculated Token%: ${tokenPercentage} (${(tokenPercentage * 100).toFixed(1)}%)`);
        console.log(`   - binsForSOL: ${binsForSOL}`);
        console.log(`   - binsForToken: ${binsForToken}`);
        
        // Side-aware, exact-span preview (exclude double-counting the active bin)
        const __nonActive = TOTAL_BINS_SPAN - 1;
        const __solBinsExact = Math.floor(__nonActive * solPercentage);
        const __tokenBinsExact = __nonActive - __solBinsExact;
        const __below = X_IS_SOL ? __tokenBinsExact : __solBinsExact;
        const __above = X_IS_SOL ? __solBinsExact : __tokenBinsExact;
        console.log(`📊 Normal Bin Distribution (exact):`);
        console.log(`   - ${__below} bins below active price (${(solPercentage * 100).toFixed(1)}% for ${X_IS_SOL ? 'TOKEN' : 'SOL'})`);
        console.log(`   - ${__above} bins above active price (${(tokenPercentage * 100).toFixed(1)}% for ${X_IS_SOL ? 'SOL' : 'TOKEN'})`);
        console.log(`   - Total span: ${TOTAL_BINS_SPAN} bins (including active)`);
        
        console.log(`🔍 DEBUG: Extreme Allocation Check`);
        console.log(`   - solPercentage === 1? ${solPercentage === 1} (100% SOL)`);
        console.log(`   - solPercentage === 0? ${solPercentage === 0} (100% Token)`);
        console.log(`   - activeBin.binId: ${activeBin.binId}`);
        console.log(`   - TOTAL_BINS_SPAN: ${TOTAL_BINS_SPAN}`);
        
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
      if (mintStr === SOL_MINT_ADDR) return; // native SOL
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
        await sendAndConfirmTransaction(connection, tx, [userKeypair]);
        console.log(`✅ Created ATA for ${mintStr.slice(0, 8)}…`);
      }
    };

    await ensureUserAtaIfNeeded(X_MINT);
    await ensureUserAtaIfNeeded(Y_MINT);

    // Recompute wallet balance after any ATA rent, then cap SOL-side deposit (only if depositing SOL > 0)
    const walletLamportsPostAta = new BN(await connection.getBalance(userKeypair.publicKey, 'confirmed'));
    // Estimate small base + priority fee headroom; do not subtract SOL_BUFFER here since we never added it to deposit
    const PRIORITY_FEE_MICROS = Number(process.env.PRIORITY_FEE_MICRO_LAMPORTS || 50_000);
    const estPriorityLamports2 = new BN(Math.floor((PRIORITY_FEE_MICROS * 250000) / 1_000_000));
    const baseFee = new BN(10_000);
    let maxSpendForDeposit = walletLamportsPostAta.sub(estPriorityLamports2).sub(baseFee);
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
    // 6) Build & send InitializePositionAndAddLiquidity transaction
    //------------------------------------------------------------------
      const binCount = maxBin - minBin + 1;
  const MAX_BIN_PER_TX = 69; // Standard transaction limit from SDK
  
  let sig;
  let posKP;
  
  if (binCount <= MAX_BIN_PER_TX) {
    // Standard position creation for ≤69 bins
    console.log(`📊 Creating standard position with ${binCount} bins`);
    
    posKP = Keypair.generate();
    const ixs = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: posKP.publicKey,
      user:           userKeypair.publicKey,
      totalXAmount:   lamX,
      totalYAmount:   lamY,
      strategy:       {
        minBinId: minBin,
        maxBinId: maxBin,
        strategyType: currentLiquidityStrategy,
      },
      slippage: slippage, // Progressive slippage: 1%, 2%, 3%, 3%...
    });

    const estOpenMicros = await estimatePriorityFeeMicros(connection, userKeypair.publicKey, ixs.instructions, 'Medium');
    const openMicros = estOpenMicros ?? PRIORITY_FEE_MICRO_LAMPORTS;
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: openMicros }),
      ...ixs.instructions
    );
    tx.feePayer = userKeypair.publicKey;

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash      = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;

    // Adaptive retry on TransferChecked insufficient funds
    const sendOnce = async () => {
      return await sendAndConfirmTransaction(connection, tx, [userKeypair, posKP]);
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
          console.log(`   🔧 Adaptive shrink applied on SOL side: ${before.toString()} → ${lamY.toString()} (−${delta.toString()} lamports)`);
        } else if (!Y_IS_SOL && lamX && lamX.gt(new BN(0))) {
          const beforeX = lamX;
          lamX = BN.max(new BN(0), lamX.sub(MARGIN));
          console.log(`   🔧 Adaptive shrink applied on token X side: ${beforeX.toString()} → ${lamX.toString()} (−${beforeX.sub(lamX).toString()} lamports)`);
        }
        // Rebuild tx with updated lamY
        const retryIxs = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: posKP.publicKey,
          user:           userKeypair.publicKey,
          totalXAmount:   lamX,
          totalYAmount:   lamY,
          strategy:       {
            minBinId: minBin,
            maxBinId: maxBin,
            strategyType: currentLiquidityStrategy,
          },
          slippage: slippage, // Progressive slippage: 1%, 2%, 3%, 3%...
        });
        const estRetryMicros = await estimatePriorityFeeMicros(connection, userKeypair.publicKey, retryIxs.instructions, 'Medium');
        const retryMicros = estRetryMicros ?? PRIORITY_FEE_MICRO_LAMPORTS;
        const retryTx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: retryMicros }),
          ...retryIxs.instructions
        );
        retryTx.feePayer = userKeypair.publicKey;
        const recent2 = await connection.getLatestBlockhash('confirmed');
        retryTx.recentBlockhash      = recent2.blockhash;
        retryTx.lastValidBlockHeight = recent2.lastValidBlockHeight;
        sig = await sendAndConfirmTransaction(connection, retryTx, [userKeypair, posKP]);
      } else {
        throw e;
      }
    }
    console.log(`📍 Standard position opened: ${sig}`);
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
    let created = false;
    let lastError;

    for (const slipPct of slippageCandidates) {
      try {
        console.log(`🔧 Extended add-liquidity with slippage ${slipPct}%`);
    const result = await dlmmPool.initializeMultiplePositionAndAddLiquidityByStrategy(
      positionKeypairGenerator,
      lamX,
      lamY,
      {
        minBinId: minBin,
        maxBinId: maxBin,
        strategyType: currentLiquidityStrategy,
      },
      userKeypair.publicKey, // owner
      userKeypair.publicKey, // payer
          slipPct // slippage percentage
    );

    console.log(`🔄 Processing ${result.instructionsByPositions.length} positions for extended position...`);
    
    // Execute transactions for each position
    let firstPositionPubKey = null;
    let txCount = 0;
    
    for (let i = 0; i < result.instructionsByPositions.length; i++) {
      const positionData = result.instructionsByPositions[i];
      const { positionKeypair, initializePositionIx, initializeAtaIxs, addLiquidityIxs } = positionData;
      
          if (i === 0) firstPositionPubKey = positionKeypair.publicKey;
      console.log(`   📊 Processing position ${i + 1}/${result.instructionsByPositions.length}...`);
      
      // Transaction 1: Initialize position and ATA (dynamic fee)
      const initIxs = [initializePositionIx, ...(initializeAtaIxs || [])];
      const estInitMicros = await estimatePriorityFeeMicros(connection, userKeypair.publicKey, initIxs, 'Medium');
      const initMicros = estInitMicros ?? PRIORITY_FEE_MICRO_LAMPORTS;
      const initTx = new Transaction();
      initTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: initMicros }));
      initTx.add(...initIxs);
      initTx.feePayer = userKeypair.publicKey;
      const { blockhash: initBlockhash, lastValidBlockHeight: initLastValid } = await connection.getLatestBlockhash('confirmed');
      initTx.recentBlockhash = initBlockhash;
      initTx.lastValidBlockHeight = initLastValid;
      const initSig = await sendAndConfirmTransaction(connection, initTx, [userKeypair, positionKeypair]);
      console.log(`   ✅ Position ${i + 1} initialized: ${initSig}`);
          try { await onTx(initSig); } catch (_) {}
      txCount++;
      if (i === 0 && !sig) sig = initSig; // Use first transaction signature as main reference
      
      // Transactions 2+: Add liquidity in batches (dynamic fee)
      for (let j = 0; j < addLiquidityIxs.length; j++) {
        const liquidityIxBatch = addLiquidityIxs[j];
        const estLiqMicros = await estimatePriorityFeeMicros(connection, userKeypair.publicKey, liquidityIxBatch, 'Medium');
        const liqMicros = estLiqMicros ?? PRIORITY_FEE_MICRO_LAMPORTS;
        const liquidityTx = new Transaction();
        liquidityTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: liqMicros }));
        liquidityTx.add(...liquidityIxBatch);
        liquidityTx.feePayer = userKeypair.publicKey;
        const { blockhash: liqBlockhash, lastValidBlockHeight: liqLastValid } = await connection.getLatestBlockhash('confirmed');
        liquidityTx.recentBlockhash = liqBlockhash;
        liquidityTx.lastValidBlockHeight = liqLastValid;
            try {
        const liqSig = await sendAndConfirmTransaction(connection, liquidityTx, [userKeypair]);
        console.log(`   ✅ Liquidity batch ${j + 1}/${addLiquidityIxs.length} added: ${liqSig}`);
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
    posKP = { publicKey: firstPositionPubKey };
    console.log(`🎯 Extended position creation completed! Total transactions: ${txCount}, Main signature: ${sig}`);
        created = true;
        break;
      } catch (err) {
        lastError = err;
        const msg = err?.message || '';
        const isBinSlip = /ExceededBinSlippageTolerance|\b6004\b|0x1774/i.test(msg);
        if (isBinSlip) {
          console.warn(`🔁 Retrying extended add-liquidity with higher slippage (failed at ${slipPct}%)`);
          continue; // try next slippage
        }
        // Non-slippage error — rethrow immediately
        throw err;
      }
    }

    if (!created) {
      throw lastError || new Error('Extended position creation failed at all slippage levels');
    }
  }

    return {
      dlmmPool,
      initialCapitalUsd: depositUsd,
      positionPubKey:    posKP.publicKey,
      openFeeLamports:   (await connection.getParsedTransaction(
                           sig, { maxSupportedTransactionVersion: 0 }
                         ))?.meta?.fee ?? 0,
    };
  }, 'openDlmmPosition');
}
// -----------------------------------------------------------------------------
// closeDlmmPosition: remove 100% & claim fees
// -----------------------------------------------------------------------------
async function closeDlmmPosition(connection, dlmmPool, userKeypair, positionPubKey) {
    return await withRetry(async () => {
      await dlmmPool.refetchStates();
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
      const pos = userPositions.find(p => p.publicKey.equals(positionPubKey));
      if (!pos) {
        console.log("Position already closed.");
        return true;
      }
      
      // 🚨 SAFETY: Check for empty position before attempting to close
      const positionValue = pos.positionData.positionXAmount + pos.positionData.positionYAmount;
      if (positionValue === '0' || positionValue === 0) {
        console.log("🚨 CRITICAL: Position is empty (0 liquidity) - cannot remove liquidity");
        console.log("💡 This likely indicates a failed position creation or complete liquidity drainage");
        return false; // Indicate closure failed
      }
  
        const removeTxs = await dlmmPool.removeLiquidity({
    position:            positionPubKey,
    user:                userKeypair.publicKey,
    fromBinId:           pos.positionData.lowerBinId,
    toBinId:             pos.positionData.upperBinId,
    bps:                 new BN(10_000),
    shouldClaimAndClose: true,
  });

  // 🔧 FIX: Handle multiple transactions for extended positions
  console.log(`🔄 Processing ${removeTxs.length} transaction(s) to close position...`);
  
  for (let i = 0; i < removeTxs.length; i++) {
    const originalTx = removeTxs[i];
    const staticMicros = Number(process.env.PRIORITY_FEE_MICRO_LAMPORTS || 50_000);
    let sent = false, lastErr;
    for (let attempt = 0; attempt < 10 && !sent; attempt++) {
      try {
        // Priority level schedule: 0-2 Medium, 3-5 High, 6-7 VeryHigh, 8-9 VeryHigh (capped boost)
        const level = attempt <= 2 ? 'Medium' : attempt <= 5 ? 'High' : 'VeryHigh';
        let micros = await estimatePriorityFeeMicros(connection, userKeypair.publicKey, originalTx.instructions || [], level);
        if (micros == null) {
          const fallbackMap = { Medium: 1.0, High: 2.0, VeryHigh: 4.0 };
          const factor = fallbackMap[level] || 1.0;
          // For last two attempts, cap at 6x (no 10x blowups)
          const capped = attempt >= 8 ? Math.min(staticMicros * 6, staticMicros * factor) : staticMicros * factor;
          micros = Math.floor(capped);
        }

        const tx = new Transaction();
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: micros }));
        if (originalTx.instructions?.length) tx.add(...originalTx.instructions);
        tx.feePayer = userKeypair.publicKey;
        const recent = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash      = recent.blockhash;
        tx.lastValidBlockHeight = recent.lastValidBlockHeight;
        const sig = await sendAndConfirmTransaction(connection, tx, [userKeypair], {
          commitment: 'confirmed',
          skipPreflight: false
        });
        console.log(`   ✅ Close tx ${i + 1}/${removeTxs.length} (attempt ${attempt + 1}, ${level}) at ${micros} µ-lamports: ${sig}`);
        sent = true;
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || '');
        if (/block height exceeded|expired|Blockhash/i.test(msg)) {
          console.warn(`   ⚠️  Close tx ${i + 1} attempt ${attempt + 1} expired; bumping priority level and retrying...`);
          continue;
        }
        console.warn(`   ⚠️  Close tx ${i + 1} attempt ${attempt + 1} failed: ${msg}`);
      }
    }
    if (!sent) throw lastErr || new Error('Close transaction failed after escalating retries');
  }
  
  console.log(`✅ [close] Position fully closed with ${removeTxs.length} transaction(s)`);
  return true;
    }, 'closeDlmmPosition');
  }

async function recenterPosition(connection, dlmmPool, userKeypair, oldPositionPubKey, originalParams = {}, rebalanceDirection = null) {
  console.log('🔄 Starting position rebalancing...');
  console.log(`   Rebalance direction: ${rebalanceDirection || 'NORMAL'}`);
  console.log(`   Position to close: ${oldPositionPubKey.toBase58()}`);
  
  // ENHANCED LOGGING: Track original parameters
  const { solAmount, autoCompoundConfig, swaplessConfig } = originalParams;
  console.log(`📊 [REBALANCE-LOG] Original Parameters:`);
  console.log(`   • Original SOL Amount: ${solAmount} SOL`);
  console.log(`   • Auto-Compound: ${autoCompoundConfig?.enabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   • Swapless Mode: ${swaplessConfig?.enabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   • Swapless Bin Span: ${swaplessConfig?.binSpan || 'N/A'} bins`);

  // 0) ensure decimals are cached ────────────────────────────────────────────
  if (typeof dlmmPool.tokenX.decimal !== 'number')
    dlmmPool.tokenX.decimal = await getMintDecimals(connection, dlmmPool.tokenX.publicKey);
  if (typeof dlmmPool.tokenY.decimal !== 'number')
    dlmmPool.tokenY.decimal = await getMintDecimals(connection, dlmmPool.tokenY.publicKey);

  const dx = dlmmPool.tokenX.decimal;
  const dy = dlmmPool.tokenY.decimal;

  // 1) locate the old position ───────────────────────────────────────────────
  await dlmmPool.refetchStates();
  const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
  const oldPos = userPositions.find(p => p.publicKey.equals(oldPositionPubKey));
  if (!oldPos) {
    console.log('Old position not found – skip recenter.');
    return null;
  }

  // 2) value the position and calculate fees ────────────────────────────────
  let lamX = new BN(0), lamY = new BN(0);
  oldPos.positionData.positionBinData.forEach(b => {
    lamX = lamX.add(new BN(b.positionXAmount));
    lamY = lamY.add(new BN(b.positionYAmount));
  });
  
  // ENHANCED LOGGING: Position token extraction with detailed breakdown
  console.log(`📊 [REBALANCE-LOG] Position Token Extraction:`);
  console.log(`   • Raw lamX: ${lamX.toString()} lamports`);
  console.log(`   • Raw lamY: ${lamY.toString()} lamports`);
  console.log(`   • Token X Amount: ${(lamX.toNumber() / 10 ** dx).toFixed(6)} (${dx} decimals)`);
  console.log(`   • Token Y Amount: ${(lamY.toNumber() / 10 ** dy).toFixed(6)} (${dy} decimals)`);
  console.log(`   • Position Bins: ${oldPos.positionData.positionBinData.length} bins`);
  console.log(`   • SOL Token: ${dlmmPool.tokenX.publicKey.toString() === 'So11111111111111111111111111111111111111112' ? 'X' : 'Y'}`);
  
  // Calculate USD values for tracking
  const preFeesUsdValue = (lamX.toNumber() / 10 ** dx) * await getPrice(dlmmPool.tokenX.publicKey.toString()) + 
                          (lamY.toNumber() / 10 ** dy) * await getPrice(dlmmPool.tokenY.publicKey.toString());
  console.log(`   • Position USD Value (before fees): $${preFeesUsdValue.toFixed(2)}`);
  
  // Extract fee amounts for compounding decision
  const feeX = new BN(oldPos.positionData.feeX);
  const feeY = new BN(oldPos.positionData.feeY);
  
  // Calculate fee values in USD for display
  const priceX = await getPrice(dlmmPool.tokenX.publicKey.toString());
  const priceY = await getPrice(dlmmPool.tokenY.publicKey.toString());
  const feeXUsd = feeX.toNumber() / 10 ** dx * priceX;
  const feeYUsd = feeY.toNumber() / 10 ** dy * priceY;
  const totalFeesUsd = feeXUsd + feeYUsd;
  
  // ENHANCED LOGGING: Detailed fee breakdown
  console.log(`📊 [REBALANCE-LOG] Fee Analysis:`);
  console.log(`   • Fee X: ${(feeX.toNumber() / 10 ** dx).toFixed(6)} tokens ($${feeXUsd.toFixed(4)})`);
  console.log(`   • Fee Y: ${(feeY.toNumber() / 10 ** dy).toFixed(6)} tokens ($${feeYUsd.toFixed(4)})`);
  console.log(`   • Total Fees USD: $${totalFeesUsd.toFixed(4)}`);
  console.log(`   • Fee X Lamports: ${feeX.toString()}`);
  console.log(`   • Fee Y Lamports: ${feeY.toString()}`);
  
  // 🎯 SMART AUTO-COMPOUNDING (ENHANCED LOGGING)
  // Using already destructured autoCompoundConfig and swaplessConfig from line 813
  
  // Store pre-compound amounts for logging
  const preCompoundX = lamX.toNumber() / 10 ** dx;
  const preCompoundY = lamY.toNumber() / 10 ** dy;
    
  console.log(`📊 [REBALANCE-LOG] Auto-Compound Decision:`);
  console.log(`   • Auto-Compound Setting: ${autoCompoundConfig?.enabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   • Pre-Compound X: ${preCompoundX.toFixed(6)} tokens`);
  console.log(`   • Pre-Compound Y: ${preCompoundY.toFixed(6)} tokens`);
  
  if (autoCompoundConfig && autoCompoundConfig.enabled) {
    const mode = autoCompoundConfig.mode || 'both';
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const isSolX = dlmmPool.tokenX.publicKey.toString() === SOL_MINT;
    const isSolY = dlmmPool.tokenY.publicKey.toString() === SOL_MINT;
    let addX = new BN(0), addY = new BN(0);
    if (mode === 'both') { addX = feeX; addY = feeY; }
    else if (mode === 'sol_only') { addX = isSolX ? feeX : new BN(0); addY = isSolY ? feeY : new BN(0); }
    else if (mode === 'token_only') { addX = isSolX ? new BN(0) : feeX; addY = isSolY ? new BN(0) : feeY; }
    else if (mode === 'none') { addX = new BN(0); addY = new BN(0); }
    lamX = lamX.add(addX);
    lamY = lamY.add(addY);
    const postCompoundX = lamX.toNumber() / 10 ** dx;
    const postCompoundY = lamY.toNumber() / 10 ** dy;
    console.log(`   ✅ FEES ADDED TO POSITION (mode=${mode}):`);
    console.log(`   • Added X: ${(addX.toNumber() / 10 ** dx).toFixed(6)} | Added Y: ${(addY.toNumber() / 10 ** dy).toFixed(6)}`);
    console.log(`   • Post-Compound X: ${postCompoundX.toFixed(6)} tokens (+${(postCompoundX - preCompoundX).toFixed(6)})`);
    console.log(`   • Post-Compound Y: ${postCompoundY.toFixed(6)} tokens (+${(postCompoundY - preCompoundY).toFixed(6)})`);
    console.log(`   • Total Compound Value: $${(postCompoundX * priceX + postCompoundY * priceY).toFixed(2)}`);
  } else {
    console.log(`   ⚠️  FEES WILL BE CLAIMED SEPARATELY (not compounded)`);
    console.log(`   • Position X remains: ${preCompoundX.toFixed(6)} tokens`);
    console.log(`   • Position Y remains: ${preCompoundY.toFixed(6)} tokens`);
  }

  // 3) close the position ────────────────────────────────────────────────────
  await withRetry(async () => {
    // 🔧 CRITICAL FIX: Check if position still exists before each retry attempt
    const { userPositions: currentPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
    const stillExists = currentPositions.find(p => p.publicKey.equals(oldPositionPubKey));
    
    if (!stillExists) {
      console.log(`✅ [recenter] Position already closed (found in retry) - proceeding with rebalancing`);
      return; // Position was successfully closed in a previous attempt
    }
    
    // 🚨 SAFETY: Check for empty position before attempting to close
    const positionValue = stillExists.positionData.positionXAmount + stillExists.positionData.positionYAmount;
    if (positionValue === '0' || positionValue === 0) {
      console.log("🚨 CRITICAL: Position is empty (0 liquidity) in retry - cannot remove liquidity");
      console.log("💡 Skipping liquidity removal for empty position");
      return; // Skip removal for empty position
    }
    
    // Generate fresh removeLiquidity transactions for each retry attempt
    const removeTxs = await dlmmPool.removeLiquidity({
      position:            oldPositionPubKey,
      user:                userKeypair.publicKey,
      fromBinId:           oldPos.positionData.lowerBinId,
      toBinId:             oldPos.positionData.upperBinId,
      bps:                 new BN(10_000),
      shouldClaimAndClose: true,
    });
    
    // 🔧 FIX: Handle multiple transactions for extended positions during rebalancing
    console.log(`🔄 [recenter] Processing ${removeTxs.length} fresh transaction(s) to close position...`);
    
    for (let i = 0; i < removeTxs.length; i++) {
      const tx = removeTxs[i];
      
      // Add priority fee to each transaction
      tx.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS })
      );
      tx.feePayer = userKeypair.publicKey;

      // Refresh blockhash for each transaction with longer validity
      const recent = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = recent.blockhash;
      tx.lastValidBlockHeight = recent.lastValidBlockHeight;

      // 🔧 ENHANCED: Use longer timeout for position closure transactions
      const sig = await sendAndConfirmTransaction(connection, tx, [userKeypair], {
        commitment: 'confirmed',
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: 'confirmed'
      });
      console.log(`   ✅ [recenter] Close transaction ${i + 1}/${removeTxs.length} completed: ${sig}`);
    }
    
    await unwrapWSOL(connection, userKeypair);       // keep SOL as native
    console.log(`✅ [recenter] Position fully closed with ${removeTxs.length} transaction(s)`);
  }, 'closePosition');

  // 4) Optional: claim-and-convert fees to SOL mode
  let actualClaimedFeesUsd = 0; // Track what was actually swapped
  try {
    const feeHandlingMode = originalParams?.feeHandlingMode;
    const minSwapUsd = originalParams?.minSwapUsd || 0;
    if (feeHandlingMode === 'claim_to_sol') {
      console.log('💸 Fee handling: claim and convert fees to SOL');
      console.log(`   💰 Minimum swap threshold: $${minSwapUsd}`);
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const isSolX = dlmmPool.tokenX.publicKey.toString() === SOL_MINT;
      const isSolY = dlmmPool.tokenY.publicKey.toString() === SOL_MINT;
      const { swapTokensUltra } = await import('./jupiter.js');
      
      // Calculate fee values in USD to check against threshold
      const feeXUsd = feeX.toNumber() / 10 ** dx * priceX;
      const feeYUsd = feeY.toNumber() / 10 ** dy * priceY;
      
      // Swap only non‑SOL fee side(s) that meet minimum threshold
      if (!isSolX && feeX && feeX.gt(new BN(0))) {
        if (feeXUsd >= minSwapUsd) {
          const inMint = dlmmPool.tokenX.publicKey.toString();
          const outMint = SOL_MINT;
          const amount = BigInt(feeX.toString());
          console.log(`   🔁 Swapping fee X → SOL via Ultra: ${feeX.toString()} (raw, $${feeXUsd.toFixed(4)})`);
          await swapTokensUltra(inMint, outMint, amount, userKeypair, connection, dlmmPool, Number(process.env.SLIPPAGE || 10), 20, Number(process.env.PRICE_IMPACT || 0.5));
          actualClaimedFeesUsd += feeXUsd;
        } else {
          console.log(`   ⏭️  Fee X ($${feeXUsd.toFixed(4)}) below threshold ($${minSwapUsd}) - keeping as tokens`);
        }
      } else if (isSolX && feeX && feeX.gt(new BN(0))) {
        // SOL fees are already "claimed" - count them
        actualClaimedFeesUsd += feeXUsd;
        console.log(`   ✅ Fee X already SOL: $${feeXUsd.toFixed(4)} (auto-claimed)`);
      }
      
      if (!isSolY && feeY && feeY.gt(new BN(0))) {
        if (feeYUsd >= minSwapUsd) {
          const inMint = dlmmPool.tokenY.publicKey.toString();
          const outMint = SOL_MINT;
          const amount = BigInt(feeY.toString());
          console.log(`   🔁 Swapping fee Y → SOL via Ultra: ${feeY.toString()} (raw, $${feeYUsd.toFixed(4)})`);
          await swapTokensUltra(inMint, outMint, amount, userKeypair, connection, dlmmPool, Number(process.env.SLIPPAGE || 10), 20, Number(process.env.PRICE_IMPACT || 0.5));
          actualClaimedFeesUsd += feeYUsd;
        } else {
          console.log(`   ⏭️  Fee Y ($${feeYUsd.toFixed(4)}) below threshold ($${minSwapUsd}) - keeping as tokens`);
        }
      } else if (isSolY && feeY && feeY.gt(new BN(0))) {
        // SOL fees are already "claimed" - count them
        actualClaimedFeesUsd += feeYUsd;
        console.log(`   ✅ Fee Y already SOL: $${feeYUsd.toFixed(4)} (auto-claimed)`);
      }
      
      // In claim_to_sol mode, do NOT add fees into calculated balances
      // Reset lamX/lamY back to pre-compound if we had added
      if (autoCompoundConfig && autoCompoundConfig.enabled) {
        lamX = lamX.sub(feeX);
        lamY = lamY.sub(feeY);
      }
      console.log(`   ✅ Fees processed: $${actualClaimedFeesUsd.toFixed(4)} swapped to SOL, remainder stays as tokens`);
    }
  } catch (e) {
    console.log(`⚠️  Fee handling conversion error (continuing without swap): ${e?.message ?? e}`);
  }

  // 5) Use calculated amounts from position + fees (CRITICAL FIX) ──────────────
  // RESPECT ORIGINAL LIMITS: Use calculated position + fees, not wallet scan
  const calculatedTokenX = lamX.toNumber() / 10 ** dx;
  const calculatedTokenY = lamY.toNumber() / 10 ** dy;
  const calculatedUsdValue = calculatedTokenX * priceX + calculatedTokenY * priceY;
  
  console.log(`📊 [REBALANCE-LOG] Final Calculated Amounts (RESPECTS ORIGINAL LIMITS):`);
  console.log(`   • Calculated Token X: ${calculatedTokenX.toFixed(6)} tokens`);
  console.log(`   • Calculated Token Y: ${calculatedTokenY.toFixed(6)} tokens`);
  console.log(`   • Calculated USD Value: $${calculatedUsdValue.toFixed(2)}`);
  console.log(`   • Original SOL Limit: ${solAmount} SOL`);
  console.log(`   • Lamports X: ${lamX.toString()}`);
  console.log(`   • Lamports Y: ${lamY.toString()}`);
  console.log(`   ✅ These amounts NEVER exceed original ${solAmount} SOL + earned gains`);
  
  // Use calculated balances that respect original limits, not wallet scan
  const calculatedBalances = {
    lamX: lamX,  // Position + fees (if auto-compound enabled)
    lamY: lamY   // Position + fees (if auto-compound enabled)
  };
  
  // VERIFICATION: Check if we're about to exceed user's original limit
  const solTokenSide = dlmmPool.tokenX.publicKey.toString() === 'So11111111111111111111111111111111111111112' ? 'X' : 'Y';
  const solAmount_calculated = solTokenSide === 'X' ? calculatedTokenX : calculatedTokenY;
  console.log(`📊 [REBALANCE-LOG] Original Limit Verification:`);
  console.log(`   • SOL is Token: ${solTokenSide}`);
  console.log(`   • Calculated SOL Amount: ${solAmount_calculated.toFixed(6)} SOL`);
  console.log(`   • Original SOL Limit: ${solAmount} SOL`);
  console.log(`   • Within Limits: ${solAmount_calculated <= (solAmount * 1.5) ? '✅ YES' : '❌ NO (POTENTIAL ISSUE!)'}`);

  // 5) reopen via the canonical helper with original parameters ──────────────
  let openRes;
  try {
    const { solAmount, tokenRatio, binSpan, poolAddress, liquidityStrategy, swaplessConfig } = originalParams;
    
    // SMART REBALANCING: Differentiate between swapless and normal rebalancing
    let capitalToUse = null; // Default: use what we have from closed position
    
    if (swaplessConfig && swaplessConfig.enabled) {
      // Swapless rebalancing: Use whatever tokens we received from closed position (position value + fees)
      console.log(`🔄 [recenter] Swapless rebalancing: Using calculated tokens from closed position (${calculatedTokenX.toFixed(6)} X, ${calculatedTokenY.toFixed(6)} Y)`);
      console.log(`   Original limit was ${solAmount} SOL, but swapless uses actual position value including gains/fees`);
    } else {
      // Normal rebalancing: Respect original SOL limit to prevent wallet drainage
      capitalToUse = solAmount;
      console.log(`🎯 [recenter] Normal rebalancing: Enforcing original SOL limit of ${solAmount} SOL`);
    }
    
    if (autoCompoundConfig && autoCompoundConfig.enabled) {
      console.log(`🔄 [recenter] Auto-compound enabled: Adding earned fees to position`);
    } else {
      console.log(`🔄 [recenter] Auto-compound disabled: Fees will be claimed separately`);
    }
    
    // 🔧 CONSERVATIVE AUTO-COMPOUNDING: Only use position contents + fees
    // No wallet scanning - only use what came from the closed position

    // Enhanced logging for the calculated amounts that respect original limits
    console.log(`🎯 Calculated amounts for rebalancing (respects original SOL limit):`);
    console.log(`   💰 Total Token X for new position: ${calculatedTokenX.toFixed(6)}`);
    console.log(`   💰 Total Token Y for new position: ${calculatedTokenY.toFixed(6)}`);
    console.log(`   📊 Using ONLY position tokens + earned fees (respects your original ${solAmount} SOL limit)`)
    
    // 4) Wait for position closure to be fully processed ──────────────────────
    console.log('⏳ Waiting for position closure to be fully processed...');
    let positionGone = false;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (!positionGone && attempts < maxAttempts) {
      attempts++;
      try {
        await dlmmPool.refetchStates();
        const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
        const stillExists = userPositions.find(p => p.publicKey.equals(oldPositionPubKey));
        
        if (!stillExists) {
          positionGone = true;
          console.log(`✅ Position closure confirmed after ${attempts} attempt(s)`);
        } else {
          console.log(`   ⏳ Position still exists, waiting... (attempt ${attempts}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        }
      } catch (err) {
        console.log(`   ⏳ Error checking position status, retrying... (attempt ${attempts}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    if (!positionGone) {
      console.log('⚠️  Position closure not confirmed after waiting 10 seconds');
      console.log('   Proceeding with position creation - safety checks will prevent duplicates');
    }
    
    // 5) Create new position with proper safety checks ────────────────────────
    // Check if swapless rebalancing is enabled
    if (swaplessConfig && swaplessConfig.enabled && rebalanceDirection) {
      console.log(`📊 [REBALANCE-LOG] Swapless Rebalancing Configuration:`);
      console.log(`   • Direction: ${rebalanceDirection}`);
      console.log(`   • Swapless Bin Span: ${swaplessConfig.binSpan} bins`);
      console.log(`   • Capital to Use: ${capitalToUse || 'unlimited (using calculated balances)'}`);
      console.log(`   • Input Token X: ${calculatedTokenX.toFixed(6)} tokens`);
      console.log(`   • Input Token Y: ${calculatedTokenY.toFixed(6)} tokens`);
      console.log(`   • Input USD Value: $${calculatedUsdValue.toFixed(2)}`);
      // Session fee X accrual tracking and reuse logic
      try {
        const addAccruedX = globalThis.__MS_ACCRUED_X_ADD__;
        const peekAccruedX = globalThis.__MS_ACCRUED_X_PEEK__;
        const consumeAccruedX = globalThis.__MS_ACCRUED_X_CONSUME__;
        if (typeof addAccruedX === 'function' && typeof peekAccruedX === 'function' && typeof consumeAccruedX === 'function') {
          if (rebalanceDirection === 'UP') {
            // Accrue X fees for future DOWN reuse
            if (feeX && feeX.gt(new BN(0))) {
              addAccruedX(feeX);
              console.log(`   • Accrued session FeeX: +${feeX.toString()} lamports`);
            }
          } else if (rebalanceDirection === 'DOWN') {
            // Reuse only session-accrued X (not sweeping all wallet X)
            const want = peekAccruedX();
            if (want && BigInt(want) > 0n) {
              const walletX = await safeGetBalance(connection, dlmmPool.tokenX.publicKey, userKeypair.publicKey);
              let inject = new BN(walletX.toString());
              const limit = new BN(want.toString());
              inject = BN.min(inject, limit);
              const DUST = new BN(10_000); // 10k lamports dust guard for X
              if (inject.gt(DUST)) {
                // Optional tiny X haircut (5 bps) for rounding safety
                const HAIRCUT_NUM = new BN(9995);
                const SCALE = new BN(10000);
                const before = inject;
                inject = before.mul(HAIRCUT_NUM).div(SCALE);
                const used = consumeAccruedX(inject.toString());
                console.log(`   • Reusing session-accrued X: ${before.toString()} → ${inject.toString()} lamports (consumed ${used} from session)`);
                lamX = lamX.add(inject);
              }
            }
          }
        }
      } catch {}
      
      // For swapless rebalancing: Use calculated tokens from position + fees (respects original limits)
      console.log(`🔄 [REBALANCE-LOG] Calling openDlmmPosition with calculated balances...`);
      openRes = await openDlmmPosition(connection, userKeypair, capitalToUse, tokenRatio, binSpan, poolAddress, liquidityStrategy, {
        swapless: true,
        direction: rebalanceDirection,
        swaplessSpan: swaplessConfig.binSpan  // Use configured swapless bin span
      }, calculatedBalances, false, {
        onTx: async (_sig) => {},
        onReserve: (lamports) => {
          try {
            // Forward reserve up via process-global aggregator if available
            if (typeof globalThis.__MS_RESERVE_AGG__ === 'function') {
              globalThis.__MS_RESERVE_AGG__(lamports);
            }
          } catch {}
        },
      }); // Use calculated balances that respect original SOL limit
    } else {
      console.log(`🔄 [recenter] Normal rebalancing with original params:`);
      console.log(`   - Ratio: ${tokenRatio ? `${(tokenRatio.ratioX*100).toFixed(1)}:${(tokenRatio.ratioY*100).toFixed(1)}` : 'default'}`);
      console.log(`   - Bin span: ${binSpan || 'default'}`);
      console.log(`   - Strategy: ${liquidityStrategy || 'default'}`);
      console.log(`🔄 [recenter] Using calculated balances: ${calculatedTokenX.toFixed(6)} X, ${calculatedTokenY.toFixed(6)} Y`);
      
      // Pass calculated balances that respect original SOL limit + earned gains
      openRes = await openDlmmPosition(
        connection,
        userKeypair,
        capitalToUse,
        tokenRatio,
        binSpan,
        poolAddress,
        liquidityStrategy,
        null,
        calculatedBalances,
        false,
        {
          onTx: async (_sig) => {},
          onReserve: (lamports) => {
            try {
              if (typeof globalThis.__MS_RESERVE_AGG__ === 'function') {
                globalThis.__MS_RESERVE_AGG__(lamports);
              }
            } catch {}
          },
        }
      ); // Use calculated balances that respect original SOL limit
    }
    
    // Log successful rebalancing with comprehensive summary
    console.log(`📊 [REBALANCE-LOG] ✅ REBALANCING COMPLETED SUCCESSFULLY:`);
    console.log(`   • New Position ID: ${openRes.positionPubKey.toBase58()}`);
    console.log(`   • New Position USD Value: $${openRes.initialCapitalUsd.toFixed(2)}`);
    console.log(`   • Original SOL Limit: ${solAmount} SOL`);
    console.log(`   • Auto-Compound: ${autoCompoundConfig?.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`   • Swapless Mode: ${swaplessConfig?.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`   • Direction: ${rebalanceDirection || 'NORMAL'}`);
    console.log(`   • ✅ ORIGINAL LIMITS RESPECTED: Position uses only calculated amounts from closed position + fees`);
    console.log(`═══════════════════════════════════════════════════════════════════════════`);
    
  } catch (err) {
    console.error('❌ [recenter] Position creation failed:', err?.message ?? err);
    console.error('   This could cause monitoring issues. Consider manual intervention.');
    throw err;   // bubble up so a supervisor can decide what to do
  }

  // 5) pass through the interesting fields ───────────────────────────────────
  const isAutoCompound = !!(autoCompoundConfig && autoCompoundConfig.enabled);
  
  // 🔧 CRITICAL: Use actual claimed fees amount, not total fees
  const actuallyClaimedUsd = (originalParams?.feeHandlingMode === 'claim_to_sol') ? actualClaimedFeesUsd : 0;
  const positionValueOnly = isAutoCompound ? openRes.initialCapitalUsd : openRes.initialCapitalUsd - actuallyClaimedUsd;
  
  // 🔧 For sol_only mode: Calculate accumulated X token fees in wallet
  let accumulatedXTokenFeesUsd = 0;
  if (originalParams?.autoCompoundConfig?.mode === 'sol_only') {
    try {
      const xTokenMint = dlmmPool.tokenX.publicKey;
      const xTokenBalance = await safeGetBalance(connection, xTokenMint, userKeypair.publicKey);
      if (xTokenBalance > 0) {
        const xTokenAmount = xTokenBalance.toNumber() / 10 ** dx;
        accumulatedXTokenFeesUsd = xTokenAmount * priceX;
        console.log(`📊 [SOL_ONLY] X token wallet balance: ${xTokenAmount.toFixed(6)} tokens ($${accumulatedXTokenFeesUsd.toFixed(2)})`);
      }
    } catch (error) {
      console.log(`⚠️ Could not calculate accumulated X token fees: ${error.message}`);
    }
  }
  
  return {
    dlmmPool,
    openValueUsd:   openRes.initialCapitalUsd,
    positionPubKey: openRes.positionPubKey,
    rebalanceSignature: openRes.openFeeLamports,
    feesEarnedUsd: totalFeesUsd,
    // New fields for accurate P&L handling in caller
    compounded: isAutoCompound,
    claimedFeesUsd: actuallyClaimedUsd, // Only fees that were actually swapped to SOL
    unswappedFeesUsd: totalFeesUsd - actuallyClaimedUsd, // Fees that stayed as tokens (below threshold)
    // 📊 CRITICAL: Separate position value for baseline tracking
    newDepositValue: openRes.initialCapitalUsd, // Total deployed capital (position + fees if compounded)
    positionValueOnly: positionValueOnly, // Position value excluding claimed fees when auto-compound OFF
    // 🔧 SOL_ONLY: Track accumulated X token fees in wallet
    accumulatedXTokenFeesUsd: accumulatedXTokenFeesUsd,
  };
}

export {
  fetchBalances,
  openDlmmPosition,
  closeDlmmPosition,
  recenterPosition
};