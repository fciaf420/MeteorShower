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
import { getSwapQuote, executeSwap } from './jupiter.js';
import {
  getMintDecimals,
  safeGetBalance,
  unwrapWSOL,
} from './solana.js';

import 'dotenv/config';
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

async function openDlmmPosition(connection, userKeypair, solAmount = null, tokenRatio = null, binSpan = null, poolAddress = null, liquidityStrategy = null, swaplessOptions = null, providedBalances = null, skipExistingCheck = false) {
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
    if (providedBalances) {
      console.log(`💡 Using provided balances from closed position (swapless rebalancing)`);
      balances = providedBalances;
    } else {
      balances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
    }

    let lamX = balances.lamX;      // BN
    let lamY = balances.lamY;      // BN

    // Skip SOL amount limiting when using provided balances (rebalancing)
    if (providedBalances) {
      console.log(`💡 Skipping SOL limits for rebalancing - using exact balances from closed position`);
    } else if (solAmount !== null) {
      const solAmountLamports = new BN(Math.floor(solAmount * 1e9));
      
      if (X_IS_SOL) {
        if (lamX.lt(SOL_BUFFER)) throw new Error('Not enough SOL (tokenX) to keep fee‑buffer');
        const availableSOL = lamX.sub(SOL_BUFFER);
        if (solAmountLamports.gt(availableSOL)) {
          throw new Error(`Requested ${solAmount} SOL but only ${availableSOL.toNumber() / 1e9} available after fee buffer`);
        }
        lamX = solAmountLamports.add(SOL_BUFFER); // Use only requested amount + buffer
        lamY = new BN(0); // No token Y for SOL-only testing
        console.log(`🎯 Limited to ${solAmount} SOL (tokenX) for testing`);
      } else if (Y_IS_SOL) {
        if (lamY.lt(SOL_BUFFER)) throw new Error('Not enough SOL (tokenY) to keep fee‑buffer');
        const availableSOL = lamY.sub(SOL_BUFFER);
        if (solAmountLamports.gt(availableSOL)) {
          throw new Error(`Requested ${solAmount} SOL but only ${availableSOL.toNumber() / 1e9} available after fee buffer`);
        }
        lamY = solAmountLamports.add(SOL_BUFFER); // Use only requested amount + buffer
        lamX = new BN(0); // No token X for SOL-only testing
        console.log(`🎯 Limited to ${solAmount} SOL (tokenY) for testing`);
      } else {
        const native = new BN(await connection.getBalance(userKeypair.publicKey, 'confirmed'));
        if (native.lt(SOL_BUFFER)) throw new Error('Not enough native SOL for rent + fees');
      }
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
      if (tokenRatio && totalUsd > 0.01) {
      const targetUsdX = totalUsd * tokenRatio.ratioX;
      const targetUsdY = totalUsd * tokenRatio.ratioY;
      const diffUsdX = targetUsdX - usdX; // +ve → need more X, -ve → need less X
      
      console.log(`Current: $${usdX.toFixed(2)} X, $${usdY.toFixed(2)} Y`);
      console.log(`Target: $${targetUsdX.toFixed(2)} X (${(tokenRatio.ratioX * 100).toFixed(1)}%), $${targetUsdY.toFixed(2)} Y (${(tokenRatio.ratioY * 100).toFixed(1)}%)`);
      
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

        const quote = await getSwapQuote(
          inputMint,
          outputMint,
          rawInputAmt,
          SLIPPAGE_BPS,
          undefined,
          PRICE_IMPACT_PCT
        );
        if (!quote) throw new Error('Could not obtain swap quote');

        const sig = await executeSwap(quote, userKeypair, connection, dlmmPool);
        if (!sig) throw new Error('Swap failed');
      } else {
        console.log('✅ Tokens already at desired ratio, no swap needed');
      }
    } else {
      // Fallback to original 50/50 balancing logic
      const diffUsd = usdY - usdX;
      
      if (Math.abs(diffUsd) > 0.01) {
        const inputMint  = diffUsd > 0 ? Y_MINT : X_MINT;
        const outputMint = diffUsd > 0 ? X_MINT : Y_MINT;
        const inputDecs  = diffUsd > 0 ? dy      : dx;
        const pxInputUsd = diffUsd > 0 ? priceY  : priceX;
        const usdToSwap  = Math.abs(diffUsd) / 2;
        
        const rawInputAmt = BigInt(
          Math.floor((usdToSwap / pxInputUsd) * 10 ** inputDecs)
        );
        console.log(`Swapping ${diffUsd > 0 ? 'Y→X' : 'X→Y'} worth $${usdToSwap.toFixed(2)} for 50/50 balance…`);

        const quote = await getSwapQuote(
          inputMint,
          outputMint,
          rawInputAmt,
          SLIPPAGE_BPS,
          undefined,
          PRICE_IMPACT_PCT
        );
        if (!quote) throw new Error('Could not obtain swap quote');

        const sig = await executeSwap(quote, userKeypair, connection, dlmmPool);
        if (!sig) throw new Error('Swap failed');
      }
    }
    
    // CRITICAL: After swapping, we need to reapply solAmount limitation since swaps changed wallet balances
    if (solAmount !== null) {
      const postSwapBalances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
      const solAmountLamports = new BN(Math.floor(solAmount * 1e9));
      
      if (X_IS_SOL) {
        if (postSwapBalances.lamX.lt(SOL_BUFFER)) throw new Error('Not enough SOL (tokenX) to keep fee‑buffer after swap');
        const availableSOL = postSwapBalances.lamX.sub(SOL_BUFFER);
        if (solAmountLamports.gt(availableSOL)) {
          throw new Error(`Requested ${solAmount} SOL but only ${availableSOL.toNumber() / 1e9} available after swap and fee buffer`);
        }
        lamX = solAmountLamports.add(SOL_BUFFER); // Re-limit to requested amount + buffer
        console.log(`🎯 Re-applied SOL limit after swap: ${solAmount} SOL (tokenX)`);
      } else if (Y_IS_SOL) {
        if (postSwapBalances.lamY.lt(SOL_BUFFER)) throw new Error('Not enough SOL (tokenY) to keep fee‑buffer after swap');
        const availableSOL = postSwapBalances.lamY.sub(SOL_BUFFER);
        if (solAmountLamports.gt(availableSOL)) {
          throw new Error(`Requested ${solAmount} SOL but only ${availableSOL.toNumber() / 1e9} available after swap and fee buffer`);
        }
        lamY = solAmountLamports.add(SOL_BUFFER); // Re-limit to requested amount + buffer
        console.log(`🎯 Re-applied SOL limit after swap: ${solAmount} SOL (tokenY)`);
      }
    } else {
      // If no solAmount limit, refresh balances after swapping
      const postSwapBalances = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);
      lamX = postSwapBalances.lamX;
      lamY = postSwapBalances.lamY;
      }
    }
    
    console.log(`💰 Using final amounts: ${lamX.toNumber() / 1e9} SOL (X), ${lamY.toNumber() / 1e9} SOL (Y)`);

    // Apply SOL buffer reservation (skip for provided balances during rebalancing)
    if (!providedBalances) {
    if (X_IS_SOL) {
      if (lamX.lt(SOL_BUFFER)) throw new Error('Not enough SOL (tokenX) to keep fee‑buffer');
      lamX = lamX.sub(SOL_BUFFER);
    } else if (Y_IS_SOL) {
      if (lamY.lt(SOL_BUFFER)) throw new Error('Not enough SOL (tokenY) to keep fee‑buffer');
      lamY = lamY.sub(SOL_BUFFER);
    } else {
      const native = new BN(await connection.getBalance(userKeypair.publicKey, 'confirmed'));
      if (native.lt(SOL_BUFFER)) throw new Error('Not enough native SOL for rent + fees');
    }
    } else {
      console.log(`💡 Skipping SOL buffer subtraction for rebalancing - using exact amounts from closed position`);
    }
    
    // Sanity‑check: wallet still owns the buffer (skip for rebalancing)
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
        console.log(`   - ${binsForSOL} bins below active price (${(tokenRatio.ratioX * 100).toFixed(1)}% for SOL)`);
        console.log(`   - ${binsForToken} bins above active price (${(tokenRatio.ratioY * 100).toFixed(1)}% for token)`);
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

    sig = await sendAndConfirmTransaction(connection, tx, [userKeypair, posKP]);
    console.log(`📍 Standard position opened: ${sig}`);
    
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

    // Use the extended SDK function
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
      1.0 // slippage percentage
    );

    console.log(`🔄 Processing ${result.instructionsByPositions.length} positions for extended position...`);
    
    // Execute transactions for each position
    let firstPositionPubKey = null;
    let txCount = 0;
    
    for (let i = 0; i < result.instructionsByPositions.length; i++) {
      const positionData = result.instructionsByPositions[i];
      const { positionKeypair, initializePositionIx, initializeAtaIxs, addLiquidityIxs } = positionData;
      
      // Store first position as the main reference
      if (i === 0) {
        firstPositionPubKey = positionKeypair.publicKey;
      }
      
      console.log(`   📊 Processing position ${i + 1}/${result.instructionsByPositions.length}...`);
      
      // Transaction 1: Initialize position and ATA
      const initTx = new Transaction();
      initTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }));
      initTx.add(initializePositionIx);
      
      if (initializeAtaIxs && initializeAtaIxs.length > 0) {
        initTx.add(...initializeAtaIxs);
      }
      
      initTx.feePayer = userKeypair.publicKey;
      const { blockhash: initBlockhash, lastValidBlockHeight: initLastValid } = await connection.getLatestBlockhash('confirmed');
      initTx.recentBlockhash = initBlockhash;
      initTx.lastValidBlockHeight = initLastValid;

      const initSig = await sendAndConfirmTransaction(connection, initTx, [userKeypair, positionKeypair]);
      console.log(`   ✅ Position ${i + 1} initialized: ${initSig}`);
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

        const liqSig = await sendAndConfirmTransaction(connection, liquidityTx, [userKeypair]);
        console.log(`   ✅ Liquidity batch ${j + 1}/${addLiquidityIxs.length} added: ${liqSig}`);
        txCount++;
      }
    }
    
    // Use the first position as the main position reference
    posKP = { publicKey: firstPositionPubKey };
    console.log(`🎯 Extended position creation completed! Total transactions: ${txCount}, Main signature: ${sig}`);
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
  
  // DEBUG: Log position amounts to diagnose the scaling issue
  console.log(`🔍 DEBUG: Position token extraction:`);
  console.log(`   Raw lamX: ${lamX.toString()} (${(lamX.toNumber() / 10 ** dx).toFixed(6)} tokens)`);
  console.log(`   Raw lamY: ${lamY.toString()} (${(lamY.toNumber() / 10 ** dy).toFixed(6)} tokens)`);
  console.log(`   Position had ${oldPos.positionData.positionBinData.length} bins`);
  
  // Extract fee amounts for compounding decision
  const feeX = new BN(oldPos.positionData.feeX);
  const feeY = new BN(oldPos.positionData.feeY);
  
  // Calculate fee values in USD for display
  const priceX = await getPrice(dlmmPool.tokenX.publicKey.toString());
  const priceY = await getPrice(dlmmPool.tokenY.publicKey.toString());
  const feeXUsd = feeX.toNumber() / 10 ** dx * priceX;
  const feeYUsd = feeY.toNumber() / 10 ** dy * priceY;
  const totalFeesUsd = feeXUsd + feeYUsd;
  
  console.log(`💰 Earned fees: ${(feeX.toNumber() / 10 ** dx).toFixed(6)} X + ${(feeY.toNumber() / 10 ** dy).toFixed(6)} Y = $${totalFeesUsd.toFixed(4)}`);
  
  // 🎯 SMART AUTO-COMPOUNDING (SIMPLIFIED)
  const { autoCompoundConfig, swaplessConfig } = originalParams;
    
  if (autoCompoundConfig && autoCompoundConfig.enabled) {
    console.log(`✅ Auto-compounding enabled: Adding fees to position`);
    lamX = lamX.add(feeX);
    lamY = lamY.add(feeY);
  } else {
    console.log(`⚠️  Auto-compounding disabled: Fees will be claimed separately`);
  }

  // 3) close the position ────────────────────────────────────────────────────
  await withRetry(async () => {
    const removeTxs = await dlmmPool.removeLiquidity({
      position:            oldPositionPubKey,
      user:                userKeypair.publicKey,
      fromBinId:           oldPos.positionData.lowerBinId,
      toBinId:             oldPos.positionData.upperBinId,
      bps:                 new BN(10_000),
      shouldClaimAndClose: true,
    });
    
    // 🔧 FIX: Handle multiple transactions for extended positions during rebalancing
    console.log(`🔄 [recenter] Processing ${removeTxs.length} transaction(s) to close position...`);
    
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

      const sig = await sendAndConfirmTransaction(connection, tx, [userKeypair]);
      console.log(`   ✅ [recenter] Close transaction ${i + 1}/${removeTxs.length} completed: ${sig}`);
    }
    
    await unwrapWSOL(connection, userKeypair);       // keep SOL as native
    console.log(`✅ [recenter] Position fully closed with ${removeTxs.length} transaction(s)`);
  }, 'closePosition');

  // 4) reopen via the canonical helper with original parameters ──────────────
  let openRes;
  try {
    const { solAmount, tokenRatio, binSpan, poolAddress, liquidityStrategy, swaplessConfig } = originalParams;
    
    // For rebalancing, use whatever tokens are available from the closed position, not the original limit
    let capitalToUse = null; // Don't enforce original SOL limit during rebalancing
    if (autoCompoundConfig && autoCompoundConfig.enabled) {
      // Auto-compound: Use all available tokens from closed position + fees
      console.log(`🔄 [recenter] Auto-compound enabled: Using all available tokens from closed position + fees`);
    } else {
      // Use available tokens from closed position, excluding fees
      console.log(`🔄 [recenter] Auto-compound disabled: Using tokens from closed position only`);
    }
    
    // Prepare exact token amounts from closed position + auto-compounding
    const exactBalances = {
      lamX: lamX,  // Auto-compounded amounts (position + fees)
      lamY: lamY
    };
    
    // Enhanced logging for compounding
    const finalTokenXAmount = lamX.toNumber() / 10 ** dx;
    const finalTokenYAmount = lamY.toNumber() / 10 ** dy;
    console.log(`🎯 Auto-compounding result:`);
    console.log(`   💰 Total Token X for new position: ${finalTokenXAmount.toFixed(6)}`);
    console.log(`   💰 Total Token Y for new position: ${finalTokenYAmount.toFixed(6)}`);
    console.log(`   📊 Using position tokens + fees (no wallet scanning)`)
    
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
      console.log(`🔄 [recenter] Swapless rebalancing - Direction: ${rebalanceDirection}, Using swapless bin span: ${swaplessConfig.binSpan} bins`);
      console.log(`🔄 [recenter] Using exact balances from closed position: ${lamX.toNumber() / 10**dx} X, ${lamY.toNumber() / 10**dy} Y`);
      
      // Pass exact balances, keep safety checks enabled
      openRes = await openDlmmPosition(connection, userKeypair, capitalToUse, tokenRatio, binSpan, poolAddress, liquidityStrategy, {
        swapless: true,
        direction: rebalanceDirection,
        swaplessSpan: swaplessConfig.binSpan  // Use configured swapless bin span
      }, exactBalances, false); // Keep existing position check for safety
    } else {
      console.log(`🔄 [recenter] Normal rebalancing with original params:`);
      console.log(`   - Ratio: ${tokenRatio ? `${(tokenRatio.ratioX*100).toFixed(1)}:${(tokenRatio.ratioY*100).toFixed(1)}` : 'default'}`);
      console.log(`   - Bin span: ${binSpan || 'default'}`);
      console.log(`   - Strategy: ${liquidityStrategy || 'default'}`);
      
      // Pass exact balances, keep safety checks enabled
      openRes = await openDlmmPosition(connection, userKeypair, capitalToUse, tokenRatio, binSpan, poolAddress, liquidityStrategy, null, exactBalances, false); // Keep existing position check for safety
    }
    
    // Log successful rebalancing
    console.log(`✅ [recenter] New position created successfully:`);
    console.log(`   - Position: ${openRes.positionPubKey.toBase58()}`);
    console.log(`   - Value: $${openRes.initialCapitalUsd.toFixed(2)}`);
    
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
  };
}

export {
  fetchBalances,
  openDlmmPosition,
  closeDlmmPosition,
  recenterPosition
};