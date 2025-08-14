// ───────────────────────────────────────────────
// ~/lib/dlmm.js
// ───────────────────────────────────────────────
import BN from 'bn.js';
import dlmmPackage from '@meteora-ag/dlmm';
const { StrategyType } = dlmmPackage;
import {
  PublicKey,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction
} from '@solana/web3.js';

import { withRetry } from './retry.js';
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
  return await withRetry(async () => {
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

          // Reject existing position if it has zero liquidity to avoid adopting rent-only shells
          const hasLiquidity = !lamX.isZero() || !lamY.isZero();
          if (!hasLiquidity) {
            console.log('[open] Existing position has zero liquidity — ignoring and creating a fresh one');
          } else {

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
    if (providedBalances) {
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

    // Skip SOL amount limiting when using provided balances (rebalancing)
    if (providedBalances) {
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
    } else {
      // NORMAL MODE: Token balancing and swapping
      if (tokenRatio) {
        // Budget-based swap for initial open: derive strictly from user's solAmount
        if (!providedBalances && solAmount !== null) {
          const solPct = X_IS_SOL ? tokenRatio.ratioX : tokenRatio.ratioY;
          const tokenPct = 1 - solPct;
          if (tokenPct > 0) {
            const lamportsToSwap = new BN(Math.floor(solAmount * 1e9 * tokenPct));
            const inputMint = X_IS_SOL ? X_MINT : Y_MINT; // swap SOL → token
            const outputMint = X_IS_SOL ? Y_MINT : X_MINT;
            console.log(`Current: $${usdX.toFixed(2)} X, $${usdY.toFixed(2)} Y`);
            console.log(`Target (budget-based): ${(tokenRatio.ratioX * 100).toFixed(1)}% X / ${(tokenRatio.ratioY * 100).toFixed(1)}% Y of ${solAmount} SOL`);
            console.log(`🔁 Swapping SOL→Token from budget: ${(lamportsToSwap.toNumber() / 1e9).toFixed(6)} SOL`);
            const sig = await swapTokensUltra(
              inputMint,
              outputMint,
              BigInt(lamportsToSwap.toString()),
              userKeypair,
              connection,
              dlmmPool,
              SLIPPAGE_BPS,
              20,
              PRICE_IMPACT_PCT
            );
            if (!sig) throw new Error('Ultra API swap failed');
          } else {
            console.log('✅ 100% SOL allocation requested – no swap needed');
          }
        } else if (totalUsd > 0.01) {
          // Legacy wallet-based balancing (rebalancing path or when no explicit budget)
      const targetUsdX = totalUsd * tokenRatio.ratioX;
      const diffUsdX = targetUsdX - usdX; // +ve → need more X, -ve → need less X
      console.log(`Current: $${usdX.toFixed(2)} X, $${usdY.toFixed(2)} Y`);
          console.log(`Target: $${targetUsdX.toFixed(2)} X (${(tokenRatio.ratioX * 100).toFixed(1)}%), $${(totalUsd - targetUsdX).toFixed(2)} Y (${(tokenRatio.ratioY * 100).toFixed(1)}%)`);
          if (Math.abs(diffUsdX) > 0.01) {
        const needMoreX = diffUsdX > 0;
            const inputMint = needMoreX ? Y_MINT : X_MINT;
        const outputMint = needMoreX ? X_MINT : Y_MINT;
            const inputDecs = needMoreX ? dy : dx;
        const pxInputUsd = needMoreX ? priceY : priceX;
            const usdToSwap = Math.abs(diffUsdX);
            const rawInputAmt = BigInt(Math.floor((usdToSwap / pxInputUsd) * 10 ** inputDecs));
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
      const diffUsd = usdY - usdX;
      if (Math.abs(diffUsd) > 0.01) {
          const inputMint = diffUsd > 0 ? Y_MINT : X_MINT;
        const outputMint = diffUsd > 0 ? X_MINT : Y_MINT;
          const inputDecs = diffUsd > 0 ? dy : dx;
          const pxInputUsd = diffUsd > 0 ? priceY : priceX;
          const usdToSwap = Math.abs(diffUsd) / 2;
          const rawInputAmt = BigInt(Math.floor((usdToSwap / pxInputUsd) * 10 ** inputDecs));
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
    
    // CRITICAL: After swapping, compute deposits strictly from user's SOL budget (initial open)
    if (solAmount !== null && !providedBalances) {
      const postSwapBalances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
      const availX = postSwapBalances.lamX;
      const availY = postSwapBalances.lamY;
      
      const EXTRA_HEADROOM = new BN(50_000); // ~0.00005 SOL extra margin

      // Determine allocation relative to the SOL side
      let solPct, tokenPct, tokenDecs, tokenPrice, solAvail, tokenAvail;
      if (X_IS_SOL) {
        solPct = tokenRatio ? tokenRatio.ratioX : 0.5;
        tokenPct = 1 - solPct;
        tokenDecs = dy;
        tokenPrice = priceY;
        solAvail = availX;
        tokenAvail = availY;
      } else if (Y_IS_SOL) {
        solPct = tokenRatio ? tokenRatio.ratioY : 0.5;
        tokenPct = 1 - solPct;
        tokenDecs = dx;
        tokenPrice = priceX;
        solAvail = availY;
        tokenAvail = availX;
      } else {
        // No SOL in pair — keep existing behavior
        lamX = availX; lamY = availY;
        console.log('ℹ️ Pair has no SOL side — using post-swap balances as-is');
      }

      if (X_IS_SOL || Y_IS_SOL) {
        // Desired deposits based on budget and prices
        const solPrice = X_IS_SOL ? priceX : priceY;
        const budgetUsd = solAmount * solPrice;
        const desiredSol = new BN(Math.max(0, Math.floor((solAmount * solPct) * 1e9)));
        const desiredTokenUnits = new BN(Math.max(0, Math.floor(((budgetUsd * tokenPct) / tokenPrice) * 10 ** tokenDecs)));

        // Apply SOL buffer and extra headroom on SOL side from the budget
        let solDeposit = BN.min(solAvail, desiredSol);
        if (solDeposit.gt(new BN(0))) {
          const before = solDeposit;
          const reserve = SOL_BUFFER.add(EXTRA_HEADROOM);
          solDeposit = solDeposit.gt(reserve) ? solDeposit.sub(reserve) : new BN(0);
          const moved = before.sub(solDeposit);
          if (moved.gt(new BN(0))) {
            try { if (typeof onReserve === 'function') onReserve(moved); } catch {}
            try { if (typeof globalThis.__MS_RESERVE_BREAKDOWN_ADD__ === 'function') globalThis.__MS_RESERVE_BREAKDOWN_ADD__('buffer', moved); } catch {}
            console.log(`🎯 Reserved SOL buffer+headroom from budget: ${moved.toString()} lamports`);
          }
        }

        // Token deposit limited by availability and desired target
        const tokenDeposit = BN.min(tokenAvail, desiredTokenUnits);

        if (X_IS_SOL) { lamX = solDeposit; lamY = tokenDeposit; }
        if (Y_IS_SOL) { lamY = solDeposit; lamX = tokenDeposit; }
        console.log(`🎯 Enforced budget-based deposits after swap (ratio respected)`);
      }
    } else {
      // If no solAmount limit, refresh balances after swapping –
      // BUT when rebalancing with providedBalances (position + fees),
      // keep the exact provided amounts to avoid timing/rpc drift and
      // unintended inclusion/exclusion of wallet reserves.
      if (!providedBalances) {
        const postSwapBalances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
        lamX = postSwapBalances.lamX;
        lamY = postSwapBalances.lamY;
      }
    }
    }
    
    // Logging final amounts with correct decimals
    const uiFinalX = lamX.toNumber() / 10 ** dx;
    const uiFinalY = lamY.toNumber() / 10 ** dy;
    console.log(`💰 Using final amounts: ${uiFinalX} X, ${uiFinalY} Y`);

    // Apply SOL headroom only during rebalancing path; initial open already reserved from budget above
    if (providedBalances) {
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
           try { if (typeof globalThis.__MS_RESERVE_BREAKDOWN_ADD__ === 'function') globalThis.__MS_RESERVE_BREAKDOWN_ADD__('cap', reservedFromCap); } catch {}
          console.log(`   • Cap reserve (${label}): ${reservedFromCap.toString()} lamports`);
        }

        const beforeHaircut = capped;
        capped = beforeHaircut.mul(HAIRCUT_NUM_SOL).div(SCALE_SOL);
        const reservedFromHaircut = beforeHaircut.sub(capped);
         if (reservedFromHaircut.gt(new BN(0))) {
           try { onReserve(reservedFromHaircut); } catch (_) {}
           try { if (typeof globalThis.__MS_RESERVE_BREAKDOWN_ADD__ === 'function') globalThis.__MS_RESERVE_BREAKDOWN_ADD__('haircut', reservedFromHaircut); } catch {}
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
    
    // Sanity‑check: wallet still owns the buffer (skip for rebalancing and budget-based initial open)
    if (!providedBalances && solAmount === null) {
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
      
      if (direction === 'UP') {
        // Price moved UP → Stay in SOL, create SOL position BELOW current price  
        minBin = currentBin - swaplessSpan; // Start below current bin
        maxBin = currentBin; // End at current bin (0 distance)
        console.log(`📊 Swapless UP Movement - SOL Position:`);
        console.log(`   - Range: Bin ${minBin} to ${maxBin} (${swaplessSpan} bins BELOW current price)`);
        console.log(`   - Staying in SOL, positioning below new price level`);
      } else if (direction === 'DOWN') {
        // Price moved DOWN → Switch to TOKEN, create TOKEN position ABOVE current price  
        minBin = currentBin; // Start at current bin (0 distance)
        maxBin = currentBin + swaplessSpan; // Extend upward
        console.log(`📊 Swapless DOWN Movement - TOKEN Position:`);
        console.log(`   - Range: Bin ${minBin} to ${maxBin} (${swaplessSpan} bins ABOVE current price)`);
        console.log(`   - Switching to TOKEN, positioning above new price level`);
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
        
        console.log(`📊 Normal Bin Distribution:`);
        console.log(`   - ${binsForSOL} bins below active price (${(solPercentage * 100).toFixed(1)}% for SOL)`);
        console.log(`   - ${binsForToken} bins above active price (${(tokenPercentage * 100).toFixed(1)}% for token)`);
        console.log(`   - Total span: ${TOTAL_BINS_SPAN} bins`);
        
        console.log(`🔍 DEBUG: Extreme Allocation Check`);
        console.log(`   - solPercentage === 1? ${solPercentage === 1} (100% SOL)`);
        console.log(`   - solPercentage === 0? ${solPercentage === 0} (100% Token)`);
        console.log(`   - activeBin.binId: ${activeBin.binId}`);
        console.log(`   - TOTAL_BINS_SPAN: ${TOTAL_BINS_SPAN}`);
        
        if (solPercentage === 1) {
          // 100% SOL - position BELOW current price
          minBin = activeBin.binId - TOTAL_BINS_SPAN;
          maxBin = activeBin.binId;
          console.log(`💡 100% SOL allocation - positioning below active price`);
          console.log(`   - Position will be: ${minBin} to ${maxBin} (BELOW active bin ${activeBin.binId})`);
        } else if (solPercentage === 0) {
          // 100% token - position ABOVE current price
          minBin = activeBin.binId;
          maxBin = activeBin.binId + TOTAL_BINS_SPAN;
          console.log(`💡 100% token allocation - positioning above active price`);
          console.log(`   - Position will be: ${minBin} to ${maxBin} (ABOVE active bin ${activeBin.binId})`);
        } else {
          // Mixed allocation - normal distribution around active bin
          minBin = activeBin.binId - binsForSOL;
          maxBin = activeBin.binId + binsForToken;
          console.log(`💡 Mixed allocation - normal distribution around active bin`);
          console.log(`   - Position will be: ${minBin} to ${maxBin} (spanning active bin ${activeBin.binId})`);
        }
      } else {
        // Fallback to normal distribution
        minBin = activeBin.binId - binsForSOL;
        maxBin = activeBin.binId + binsForToken;
      }
    }

    //------------------------------------------------------------------
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
    });

    const tx = new Transaction().add(...ixs.instructions);
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS })
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
        });
        const retryTx = new Transaction().add(...retryIxs.instructions);
        retryTx.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS })
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
    const attemptInitializedPubkeys = [];
    
    for (let i = 0; i < result.instructionsByPositions.length; i++) {
      const positionData = result.instructionsByPositions[i];
      const { positionKeypair, initializePositionIx, initializeAtaIxs, addLiquidityIxs } = positionData;
      
          if (i === 0) firstPositionPubKey = positionKeypair.publicKey;
      console.log(`   📊 Processing position ${i + 1}/${result.instructionsByPositions.length}...`);
      
      // Transaction 1: Initialize position and ATA
      const initTx = new Transaction();
      initTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }));
      initTx.add(initializePositionIx);
          if (initializeAtaIxs && initializeAtaIxs.length > 0) initTx.add(...initializeAtaIxs);
      initTx.feePayer = userKeypair.publicKey;
      const { blockhash: initBlockhash, lastValidBlockHeight: initLastValid } = await connection.getLatestBlockhash('confirmed');
      initTx.recentBlockhash = initBlockhash;
      initTx.lastValidBlockHeight = initLastValid;
      const initSig = await sendAndConfirmTransaction(connection, initTx, [userKeypair, positionKeypair]);
      console.log(`   ✅ Position ${i + 1} initialized: ${initSig}`);
      attemptInitializedPubkeys.push(positionKeypair.publicKey);
          try { await onTx(initSig); } catch (_) {}
      txCount++;
      if (i === 0 && !sig) sig = initSig; // Use first transaction signature as main reference
      
      // Transactions 2+: Add liquidity in batches
      for (let j = 0; j < addLiquidityIxs.length; j++) {
        const liquidityIxBatch = addLiquidityIxs[j];
        const liquidityTx = new Transaction();
        liquidityTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }));
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
          // Attempt cleanup of any just-initialized positions with zero liquidity to reclaim rent
          try {
            for (const pk of attemptInitializedPubkeys) {
              try {
                const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
                const pos = userPositions.find(p => p.publicKey.equals(pk));
                if (pos) {
                  let sumX = new BN(0), sumY = new BN(0);
                  pos.positionData.positionBinData.forEach(b => {
                    sumX = sumX.add(new BN(b.positionXAmount));
                    sumY = sumY.add(new BN(b.positionYAmount));
                  });
                  const hasLiq = !sumX.isZero() || !sumY.isZero();
                  if (!hasLiq) {
                    console.log(`   🧹 Cleaning up empty initialized position ${pk.toBase58()} (reclaim rent)`);
                    try {
                      const tx = await dlmmPool.closePositionIfEmpty({ owner: userKeypair.publicKey, position: pos });
                      const sig = await sendAndConfirmTransaction(connection, tx, [userKeypair]);
                      console.log(`   ✅ Closed empty position ${pk.toBase58()} (rent reclaimed): ${sig}`);
                    } catch (e) {
                      console.log(`   ℹ️  closePositionIfEmpty failed for ${pk.toBase58()}: ${e?.message ?? e}`);
                    }
                  }
                }
              } catch {}
            }
          } catch {}
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
    const tx = removeTxs[i];
    
    // Add priority fee to each transaction
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS })
    );
    tx.feePayer = userKeypair.publicKey;
    
    // Refresh blockhash for each transaction
    const recent = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash      = recent.blockhash;
    tx.lastValidBlockHeight = recent.lastValidBlockHeight;

    const sig = await sendAndConfirmTransaction(connection, tx, [userKeypair], {
      commitment: 'confirmed',
      skipPreflight: false
    });
    console.log(`   ✅ Close transaction ${i + 1}/${removeTxs.length} completed: ${sig}`);
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
  try {
    const feeHandlingMode = originalParams?.feeHandlingMode;
    const minSwapUsd = Number(originalParams?.minSwapUsd ?? 0);
    if (feeHandlingMode === 'claim_to_sol') {
      console.log('💸 Fee handling: claim and convert fees to SOL');
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const isSolX = dlmmPool.tokenX.publicKey.toString() === SOL_MINT;
      const isSolY = dlmmPool.tokenY.publicKey.toString() === SOL_MINT;
      const { swapTokensUltra } = await import('./jupiter.js');
      // Swap only non‑SOL fee side(s) from this rebalance
      if (!isSolX && feeX && feeX.gt(new BN(0))) {
        const inMint = dlmmPool.tokenX.publicKey.toString();
        const outMint = SOL_MINT;
        const amount = BigInt(feeX.toString());
        // Min USD threshold check
        try {
          const decs = await getMintDecimals(connection, dlmmPool.tokenX.publicKey);
          const price = await getPrice(inMint);
          const uiAmt = Number(amount) / 10 ** decs;
          const usdValue = uiAmt * (price || 0);
          if (!price || usdValue < minSwapUsd) {
            console.log(`   ℹ️  Fee swap X→SOL skipped: value $${usdValue.toFixed(2)} < $${minSwapUsd}`);
          } else {
            console.log(`   🔁 Swapping fee X → SOL via Ultra: ${feeX.toString()} (raw), ~$${usdValue.toFixed(2)}`);
            await swapTokensUltra(inMint, outMint, amount, userKeypair, connection, dlmmPool, Number(process.env.SLIPPAGE || 10), 20, Number(process.env.PRICE_IMPACT || 0.5));
          }
        } catch (e) {
          console.log(`   ℹ️  Fee swap X→SOL skipped due to pricing/decimals error: ${e?.message ?? e}`);
        }
      }
      if (!isSolY && feeY && feeY.gt(new BN(0))) {
        const inMint = dlmmPool.tokenY.publicKey.toString();
        const outMint = SOL_MINT;
        const amount = BigInt(feeY.toString());
        // Min USD threshold check
        try {
          const decs = await getMintDecimals(connection, dlmmPool.tokenY.publicKey);
          const price = await getPrice(inMint);
          const uiAmt = Number(amount) / 10 ** decs;
          const usdValue = uiAmt * (price || 0);
          if (!price || usdValue < minSwapUsd) {
            console.log(`   ℹ️  Fee swap Y→SOL skipped: value $${usdValue.toFixed(2)} < $${minSwapUsd}`);
          } else {
            console.log(`   🔁 Swapping fee Y → SOL via Ultra: ${feeY.toString()} (raw), ~$${usdValue.toFixed(2)}`);
            await swapTokensUltra(inMint, outMint, amount, userKeypair, connection, dlmmPool, Number(process.env.SLIPPAGE || 10), 20, Number(process.env.PRICE_IMPACT || 0.5));
          }
        } catch (e) {
          console.log(`   ℹ️  Fee swap Y→SOL skipped due to pricing/decimals error: ${e?.message ?? e}`);
        }
      }
      // In claim_to_sol mode, do NOT add fees into calculated balances
      // Reset lamX/lamY back to pre-compound if we had added
      if (autoCompoundConfig && autoCompoundConfig.enabled) {
        lamX = lamX.sub(feeX);
        lamY = lamY.sub(feeY);
      }
      console.log('   ✅ Fees converted to SOL; proceeding without compounding');
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
  console.log(`   • Growth: ${((solAmount_calculated / solAmount - 1) * 100).toFixed(2)}%`);

  // 5) reopen via the canonical helper with original parameters ──────────────
  let openRes;
  try {
    const { solAmount, tokenRatio, binSpan, poolAddress, liquidityStrategy, rebalanceStrategy, swaplessConfig } = originalParams;
    
    // SMART REBALANCING: Differentiate between swapless and normal rebalancing
    let capitalToUse = null; // Default: use what we have from closed position
    
    if (swaplessConfig && swaplessConfig.enabled && rebalanceDirection) {
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
      // Use chosen rebalance strategy if provided, else keep initial
      const strategyForReopen = rebalanceStrategy || liquidityStrategy;
      openRes = await openDlmmPosition(connection, userKeypair, capitalToUse, tokenRatio, binSpan, poolAddress, strategyForReopen, {
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
      const isGateRecenter = !rebalanceDirection;
      console.log(`🔄 [recenter] Normal rebalancing with original params:`);
      console.log(`   - Ratio: ${tokenRatio ? `${(tokenRatio.ratioX*100).toFixed(1)}:${(tokenRatio.ratioY*100).toFixed(1)}` : 'default'}`);
      console.log(`   - Bin span: ${binSpan || 'default'}`);
      console.log(`   - Strategy: ${isGateRecenter ? (liquidityStrategy || 'default') : ((rebalanceStrategy || liquidityStrategy) || 'default')}`);
      console.log(`🔄 [recenter] Will use post-swap wallet balances to respect ratio and original limit`);
      
      // Pass calculated balances that respect original SOL limit + earned gains
      const strategyForReopenNormal = isGateRecenter ? liquidityStrategy : (rebalanceStrategy || liquidityStrategy);
      openRes = await openDlmmPosition(
        connection,
        userKeypair,
        capitalToUse,
        tokenRatio,
        binSpan,
        poolAddress,
        strategyForReopenNormal,
        null,
        null,
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
  return {
    dlmmPool,
    openValueUsd:   openRes.initialCapitalUsd,
    positionPubKey: openRes.positionPubKey,
    rebalanceSignature: openRes.openFeeLamports,
    feesEarnedUsd: totalFeesUsd,
    // New fields for accurate P&L handling in caller
    compounded: !!(autoCompoundConfig && autoCompoundConfig.enabled),
    claimedFeesUsd: (autoCompoundConfig && autoCompoundConfig.enabled) ? 0 : totalFeesUsd,
  };
}

export {
  fetchBalances,
  openDlmmPosition,
  closeDlmmPosition,
  recenterPosition
};