// ───────────────────────────────────────────────
// ~/main.js
// ───────────────────────────────────────────────
import BN from 'bn.js';
import { loadWalletKeypair, getMintDecimals, safeGetBalance } from './lib/solana.js';
import { openDlmmPosition, recenterPosition } from './lib/dlmm.js';
import 'dotenv/config';
import { getPrice } from './lib/price.js';
import { promptSolAmount, promptTokenRatio, promptBinSpan, promptPoolAddress, promptLiquidityStrategy, promptSwaplessRebalance, promptAutoCompound, promptTakeProfitStopLoss, promptFeeHandling, promptCompoundingMode, promptInitialReentryBins, promptMinSwapUsd, promptRebalanceStrategy } from './balance-prompt.js';
import readline from 'readline';
import dlmmPackage from '@meteora-ag/dlmm';
import {
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
// pull vars from the environment
const {
  RPC_URL,
  WALLET_PATH,
  MONITOR_INTERVAL_SECONDS = 5,
  PNL_CHECK_INTERVAL_SECONDS = 10,
} = process.env;



/**
 * Closes a specific position and swaps its tokens to SOL (TP/SL trigger)
 * @param {Connection} connection 
 * @param {Object} dlmmPool 
 * @param {Object} userKeypair 
 * @param {PublicKey} positionPubKey 
 * @param {Object} pos - The position object
 */
async function closeSpecificPosition(connection, dlmmPool, userKeypair, positionPubKey, pos) {
  const { withRetry } = await import('./lib/retry.js');
  const { unwrapWSOL } = await import('./lib/solana.js');
  const PRIORITY_FEE_MICRO_LAMPORTS = Number(process.env.PRIORITY_FEE_MICRO_LAMPORTS || 50_000);
  
  console.log(`🎯 Closing specific position: ${positionPubKey.toBase58()}`);
  console.log(`   Pool: ${dlmmPool.pubkey.toBase58()}`);
  console.log(`   Range: Bin ${pos.positionData.lowerBinId} to ${pos.positionData.upperBinId}`);
  
  try {
    await withRetry(async () => {
      // Close the position using the same logic as close-position.js
      const removeTxs = await dlmmPool.removeLiquidity({
        position:            positionPubKey,
        user:                userKeypair.publicKey,
        fromBinId:           pos.positionData.lowerBinId,
        toBinId:             pos.positionData.upperBinId,
        bps:                 new BN(10_000), // 100% removal
        shouldClaimAndClose: true,
      });
      
      // 🔧 FIX: Handle multiple transactions for extended positions in TP/SL
      console.log(`   🔄 Processing ${removeTxs.length} transaction(s) to close position...`);
      
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
        console.log(`      ✅ TP/SL close transaction ${i + 1}/${removeTxs.length} completed: ${sig}`);
      }
      
      await unwrapWSOL(connection, userKeypair);
      console.log(`   ✅ Position fully closed with ${removeTxs.length} transaction(s)`);
      
    }, 'closeSpecificPosition');
    
    // Swap the tokens from this specific pool to SOL
    console.log(`   🔄 Swapping tokens from this position to SOL...`);
    await swapPositionTokensToSol(connection, dlmmPool, userKeypair);
    
    console.log(`✅ Successfully closed position and swapped tokens to SOL`);
    
  } catch (error) {
    console.error(`❌ Error closing specific position: ${error.message}`);
    throw error;
  }
}

/**
 * Swaps only the tokens from a specific DLMM pool to SOL
 * @param {Connection} connection 
 * @param {Object} dlmmPool 
 * @param {Object} userKeypair 
 */
async function swapPositionTokensToSol(connection, dlmmPool, userKeypair) {
  const { safeGetBalance, getMintDecimals } = await import('./lib/solana.js');
  const { swapTokensUltra } = await import('./lib/jupiter.js');
  
  // Get the token mints from this specific pool
  const tokenXMint = dlmmPool.tokenX.publicKey.toString();
  const tokenYMint = dlmmPool.tokenY.publicKey.toString();
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  
  // Determine which token is SOL and which is the alt token
  const solMint = [tokenXMint, tokenYMint].find(mint => mint === SOL_MINT);
  const altTokenMint = [tokenXMint, tokenYMint].find(mint => mint !== SOL_MINT);
  
  if (!altTokenMint) {
    console.log(`   ℹ️  Pool contains only SOL - no swapping needed`);
    return;
  }
  
  console.log(`   🔍 TP/SL Swap Analysis:`);
  console.log(`      Pool: SOL + ${altTokenMint.substring(0, 8)}...${altTokenMint.substring(altTokenMint.length - 8)}`);
  console.log(`      Target: Swap alt token → SOL`);
  
  // 🕐 JUPITER INDEX DELAY: Critical for TP/SL swaps after position closure
  // This prevents "Taker has insufficient input" errors when tokens were just claimed
  console.log(`   ⏳ Waiting 1.5s for Jupiter balance index to update after position closure...`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  console.log(`   ✅ Ready to proceed with TP/SL Ultra API swap`);
  
  try {
    // Get current token balance (safeGetBalance returns BN in raw token units)
    const { PublicKey } = await import('@solana/web3.js');
    const altTokenBalanceRaw = await safeGetBalance(connection, new PublicKey(altTokenMint), userKeypair.publicKey);
    
    console.log(`   📊 Token balance analysis:`);
    console.log(`      Raw balance: ${altTokenBalanceRaw.toString()} (atomic units)`);
    
    // Check if we have any tokens to swap
    if (altTokenBalanceRaw.isZero() || altTokenBalanceRaw.lte(new BN(1000))) {
      console.log(`   ℹ️  Alt token balance too low (${altTokenBalanceRaw.toString()}) - skipping swap`);
      return;
    }
    
    // Get token decimals for UI display only
    const decimals = await getMintDecimals(connection, new PublicKey(altTokenMint));
    const uiAmount = parseFloat(altTokenBalanceRaw.toString()) / Math.pow(10, decimals);
    
    console.log(`      Decimals: ${decimals}`);
    console.log(`      UI amount: ${uiAmount.toFixed(6)} tokens`);
    console.log(`      Mint: ${altTokenMint}`);
    
    // 🔧 CRITICAL FIX: safeGetBalance() already returns raw token amount in BN format
    // No need to multiply by decimals - that was causing massively inflated amounts!
    const swapAmount = BigInt(altTokenBalanceRaw.toString());
    
    console.log(`   🎯 Swap parameters:`);
    console.log(`      Amount (BigInt): ${swapAmount.toString()}`);
    console.log(`      From: ${altTokenMint}`);
    console.log(`      To: ${SOL_MINT}`);
    
    const SLIPPAGE_BPS = Number(process.env.SLIPPAGE || 10);
    const PRICE_IMPACT_PCT = Number(process.env.PRICE_IMPACT || 0.5);
    
    console.log(`      Slippage: ${SLIPPAGE_BPS} bps (${SLIPPAGE_BPS/100}%)`);
    console.log(`      Max price impact: ${PRICE_IMPACT_PCT}%`);
    
    console.log(`   🚀 Executing TP/SL Ultra API swap...`);
    const signature = await swapTokensUltra(
      altTokenMint,
      SOL_MINT,
      swapAmount,
      userKeypair,
      connection,
      dlmmPool,
      SLIPPAGE_BPS,
      20,
      PRICE_IMPACT_PCT
    );
    
    if (signature) {
      console.log(`   🎉 TP/SL swap completed successfully!`);
      console.log(`      ✅ Ultra API signature: ${signature}`);
      console.log(`      🔗 View: https://solscan.io/tx/${signature}`);
    } else {
      console.log(`   ❌ TP/SL Ultra API swap failed - no signature returned`);
      console.log(`      This indicates Jupiter Ultra API backend issues or insufficient liquidity`);
    }
    
  } catch (swapError) {
    console.log(`   ❌ TP/SL swap error: ${swapError.message}`);
    console.log(`      Error details for debugging:`);
    console.log(`      - Pool: ${dlmmPool.pubkey.toBase58()}`);
    console.log(`      - Alt token: ${altTokenMint}`);
    console.log(`      - Wallet: ${userKeypair.publicKey.toBase58()}`);
    if (swapError.stack) {
      console.log(`      - Stack: ${swapError.stack.substring(0, 200)}...`);
    }
  }
}

async function monitorPositionLoop(
  connection,
  dlmmPool,
  userKeypair,
  sessionState,
  positionPubKey,
  intervalSeconds,
  originalParams = {}
) {
  // Parse timer intervals
  const pnlCheckSeconds = parseInt(PNL_CHECK_INTERVAL_SECONDS) || 10;
  const rebalanceCheckSeconds = intervalSeconds;
  
  console.log(`Starting monitoring:`);
  console.log(`  P&L updates: every ${pnlCheckSeconds}s`);
  console.log(`  Rebalance checks: every ${rebalanceCheckSeconds}s`);
  console.log(`Tracking Position: ${positionPubKey.toBase58()}`);
  
  // Timing tracking for dual intervals
  let lastRebalanceCheck = 0;
  const getTimestamp = () => Math.floor(Date.now() / 1000);
  
  // Trailing stop tracking variables
  let peakPnL = 0;                    // Highest P&L percentage since trail activation
  let trailingActive = false;         // Whether trailing is currently active
  let dynamicStopLoss = null;         // Current trailing stop level
  console.log(`Rebalancing logic: Only triggers when price moves outside position range`);
  // Initial-phase gate: suppress ANY rebalancing until price has moved OUTSIDE from the start by X bins
  const initialReentryBins = originalParams.initialReentryBins ?? 2;
  let initialRebalanceGateActive = initialReentryBins > 0;
  let lastOutDirection = null; // 'UP' | 'DOWN' | null
  // Outside-distance from START: capture start bin and initial direction based on single-sided side
  let initialGateStartBinId = null;
  let initialGateDirection = null; // 'UP' | 'DOWN' | null
  
  // ⚡ Add keyboard shortcuts for live control
  console.log(`\n⚡ LIVE CONTROLS:`);
  console.log(`   C = Close all positions & swap to SOL`);
  console.log(`   S = Show current status`);
  console.log(`   Q = Quit gracefully`);
  console.log(`   Ctrl+C twice = Emergency exit\n`);
  
  // Setup keyboard input handling
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  // Enable raw mode for single key detection
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  
  let ctrlCCount = 0;
  let isClosing = false;
  
  const handleKeyPress = async (chunk) => {
    if (isClosing) return; // Prevent multiple closures
    
    const key = chunk.toString().toLowerCase();
    
    switch (key) {
      case 'c':
        isClosing = true;
        console.log('\n🔴 CLOSING CURRENT POSITION...');
        console.log('🔄 This will close the current terminal position and swap its tokens to SOL...');
        
        try {
          // Lookup the currently monitored position by key
          const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
          const currentPosition = userPositions.find(p => p.publicKey.equals(positionPubKey));
          if (!currentPosition) {
            console.error('❌ No active position found to close.');
            process.exit(1);
          }

          // Close only the current position; swapping to SOL is handled inside closeSpecificPosition
          await closeSpecificPosition(connection, dlmmPool, userKeypair, positionPubKey, currentPosition);

          console.log('✅ Current position closed and swapped to SOL successfully!');
        } catch (error) {
          console.error('❌ Error during position closure:', error.message);
        }
        
        process.exit(0);
        break;
        
      case 's':
        console.log('\n📊 CURRENT STATUS:');
        console.log(`   Position: ${positionPubKey.toBase58()}`);
        console.log(`   Pool: ${dlmmPool.pubkey.toBase58()}`);
        console.log(`   Monitoring interval: ${intervalSeconds}s`);
        console.log(`   P&L tracking: Active`);
        console.log(`   Next update: ${intervalSeconds}s\n`);
        break;
        
      case 'q':
        console.log('\n👋 Graceful shutdown initiated...');
        console.log('📝 Position will continue running - use "node cli.js close" later to close positions');
        process.exit(0);
        break;
        
      case '\u0003': // Ctrl+C
        ctrlCCount++;
        
        if (ctrlCCount === 1) {
          console.log('\n🚨 EMERGENCY EXIT! Press Ctrl+C again within 3 seconds to confirm...');
          setTimeout(() => { ctrlCCount = 0; }, 3000);
          return;
        }
        
        if (ctrlCCount >= 2) {
          isClosing = true;
          console.log('\n🔴 EMERGENCY POSITION CLOSURE ACTIVATED!');
          console.log('🔄 Closing all positions and swapping tokens to SOL...');
          
          try {
            const { closeAllPositions } = await import('./close-position.js');
            await closeAllPositions();
            console.log('✅ Emergency closure completed successfully!');
          } catch (error) {
            console.error('❌ Error during emergency closure:', error.message);
          }
          
          process.exit(0);
        }
        break;
    }
  };
  
  process.stdin.on('data', handleKeyPress);
  
  // P&L Tracking Variables
  let totalFeesEarnedUsd = 0;
  let claimedFeesUsd = 0; // fees realized to wallet when not auto-compounded
  let rebalanceCount = 0;
  // Track accumulated X token fees in sol_only mode (fees that go to wallet instead of position)
  let accumulatedXTokenFeesUsd = 0;
  // Position-specific reserves (reset per position, not cumulative across session)
  let feeReserveLamports = 0n;
  // Reserve breakdown trackers (lamports)
  let bufferReserveLamports = 0n;  // buffer + headroom reserved during (re)open
  let capReserveLamports = 0n;     // capped amount reserved to keep under SOL limit
  let haircutReserveLamports = 0n; // tiny bps trims reserved for safety
  // Session reserves for token-side haircuts (raw token units)
  let tokenXReserveLamports = 0n;
  let tokenYReserveLamports = 0n;
  // Session-tracked X fees accrued during swapless UP cycles (lamports)
  let sessionAccruedFeeXLamports = 0n;

  // Helper function to reset reserves when creating new positions
  function resetReserveTracking() {
    feeReserveLamports = 0n;
    bufferReserveLamports = 0n;
    capReserveLamports = 0n;
    haircutReserveLamports = 0n;
    tokenXReserveLamports = 0n;
    tokenYReserveLamports = 0n;
    sessionAccruedFeeXLamports = 0n;
  }
  // Expose a process-global aggregator so lower-level helpers can report reserve
  globalThis.__MS_RESERVE_AGG__ = (lamports) => {
    try { feeReserveLamports += BigInt(lamports.toString()); } catch {}
  };
  // Reserve breakdown aggregator used by lower-level helpers
  globalThis.__MS_RESERVE_BREAKDOWN_ADD__ = (kind, lamports) => {
    try {
      const v = BigInt(lamports.toString());
      if (kind === 'buffer') bufferReserveLamports += v;
      else if (kind === 'cap') capReserveLamports += v;
      else if (kind === 'haircut') haircutReserveLamports += v;
    } catch {}
  };
  // Token-side reserve aggregators
  globalThis.__MS_TOKEN_RESERVE_X_ADD__ = (lamports) => {
    try { tokenXReserveLamports += BigInt(lamports.toString()); } catch {}
  };
  globalThis.__MS_TOKEN_RESERVE_Y_ADD__ = (lamports) => {
    try { tokenYReserveLamports += BigInt(lamports.toString()); } catch {}
  };
  // Expose session X accrual helpers for cross-module reporting/consumption
  globalThis.__MS_ACCRUED_X_ADD__ = (lamports) => {
    try { sessionAccruedFeeXLamports += BigInt(lamports.toString()); } catch {}
  };
  globalThis.__MS_ACCRUED_X_PEEK__ = () => sessionAccruedFeeXLamports;
  globalThis.__MS_ACCRUED_X_CONSUME__ = (lamports) => {
    try {
      const req = BigInt(lamports.toString());
      const take = req <= sessionAccruedFeeXLamports ? req : sessionAccruedFeeXLamports;
      sessionAccruedFeeXLamports -= take;
      return take;
    } catch { return 0n; }
  };
  console.log(`📈 P&L Tracking initialized - Initial deposit: $${sessionState.initialDepositUsd.toFixed(2)}`);

  /* ─── 1. token-decimals  ─────────────────────────────── */
  if (typeof dlmmPool.tokenX.decimal !== 'number')
    dlmmPool.tokenX.decimal = await getMintDecimals(connection, dlmmPool.tokenX.publicKey);
  if (typeof dlmmPool.tokenY.decimal !== 'number')
    dlmmPool.tokenY.decimal = await getMintDecimals(connection, dlmmPool.tokenY.publicKey);
  const dx = dlmmPool.tokenX.decimal;
  const dy = dlmmPool.tokenY.decimal;
  console.log(`Token decimals: X=${dx}, Y=${dy}`);
  console.log(`Token mints: X=${dlmmPool.tokenX.publicKey.toString()}, Y=${dlmmPool.tokenY.publicKey.toString()}`);
  
  // Debug: Check for proper SOL/token pair detection
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const xIsSOL = dlmmPool.tokenX.publicKey.toString() === SOL_MINT;
  const yIsSOL = dlmmPool.tokenY.publicKey.toString() === SOL_MINT;
  console.log(`SOL Detection: X_IS_SOL=${xIsSOL}, Y_IS_SOL=${yIsSOL}`);

  // Baseline for SOL-denominated PnL: lock at start of monitoring
  const baseSolPx = yIsSOL ? (await getPrice(dlmmPool.tokenY.publicKey.toString())) : (await getPrice(dlmmPool.tokenX.publicKey.toString()));
  const baselineSolUnits = baseSolPx ? (sessionState.initialDepositUsd / baseSolPx) : 0;

  /* ─── 3. heading ────────────────────────────────────────────────── */
  console.log('');
  console.log('🎯 Position Monitor Active');
  // Grid helpers for clearer table output
  const GRID_COLS = [
    { key: 'time',   title: 'Time',       w: 8,  align: 'left'  },
    { key: 'value',  title: 'Value',      w: 10, align: 'right' },
    { key: 'pnl',    title: 'P&L',        w: 11, align: 'right' },
    { key: 'pnlPct', title: 'P&L%',       w: 9,  align: 'right' },
    { key: 'fees',   title: 'Fees',       w: 9,  align: 'right' },
    { key: 'rebal',  title: 'Rebal',      w: 5,  align: 'right' },
    { key: 'tpslts', title: 'TP/SL/TS',   w: 17, align: 'left'  },
  ];
  const fmtCell = (s, w, align) => {
    const str = String(s);
    if (str.length >= w) return str.slice(0, w);
    const pad = ' '.repeat(w - str.length);
    return align === 'right' ? pad + str : str + pad;
  };
  const printGridBorder = (type = 'top') => {
    const join = (a, b, c) => a + GRID_COLS.map(c => '─'.repeat(c.w)).join(b) + a;
    if (type === 'top') console.log('┌' + GRID_COLS.map(c => '─'.repeat(c.w)).join('┬') + '┐');
    else if (type === 'mid') console.log('├' + GRID_COLS.map(c => '─'.repeat(c.w)).join('┼') + '┤');
    else console.log('└' + GRID_COLS.map(c => '─'.repeat(c.w)).join('┴') + '┘');
  };
  const printGridHeader = () => {
    printGridBorder('top');
    const header = '│' + GRID_COLS.map(c => fmtCell(c.title, c.w, 'left')).join('│') + '│';
    console.log(header);
    printGridBorder('mid');
  };
  const printGridRow = (row) => {
    const line = '│' + GRID_COLS.map(c => fmtCell(row[c.key] ?? '', c.w, c.align)).join('│') + '│';
    console.log(line);
  };
  let gridRowCounter = 0;
  printGridHeader();

  /* ─── 4. loop ───────────────────────────────────────────────────── */
  while (true) {
    try {
      /* 4-A refresh on-chain state --------------------------------- */
      await dlmmPool.refetchStates();
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
      const activeBin   = await dlmmPool.getActiveBin();
      const pos         = userPositions.find(p => p.publicKey.equals(positionPubKey));
      if (!activeBin) {
        console.log('❌ Could not get active bin - retrying in next cycle');
        await new Promise(r => setTimeout(r, pnlCheckSeconds * 1_000));
        continue;
      }
      if (!pos) {
        if (typeof globalThis.__MS_MISSING_POS_RETRIES__ !== 'number') globalThis.__MS_MISSING_POS_RETRIES__ = 0;
        globalThis.__MS_MISSING_POS_RETRIES__ += 1;
        const attempts = globalThis.__MS_MISSING_POS_RETRIES__;
        console.log('❌ Position not found - may be indexing lag');
        console.log(`   Searching for position: ${positionPubKey.toBase58()}`);
        console.log(`   Found ${userPositions.length} positions:`, userPositions.map(p => p.publicKey.toBase58()));
        if (attempts < 5) {
          console.log(`   ⏳ Waiting to retry (${attempts}/5)...`);
          await new Promise(r => setTimeout(r, pnlCheckSeconds * 1_000));
          continue;
        } else {
          console.log('   ❌ Still missing after retries – exiting monitor.');
          break;
        }
      } else {
        globalThis.__MS_MISSING_POS_RETRIES__ = 0;
      }

      /* 4-B amounts ------------------------------------------------- */
      let lamX = new BN(0), lamY = new BN(0);
      pos.positionData.positionBinData.forEach(b => {
        lamX = lamX.add(new BN(b.positionXAmount));
        lamY = lamY.add(new BN(b.positionYAmount));
      });
      const feeX = new BN(pos.positionData.feeX);
      const feeY = new BN(pos.positionData.feeY);

      const amtX     = lamX.toNumber() / 10 ** dx;
      const amtY     = lamY.toNumber() / 10 ** dy;
      const feeAmtX  = feeX.toNumber() / 10 ** dx;
      const feeAmtY  = feeY.toNumber() / 10 ** dy;

      const pxX      = await getPrice(dlmmPool.tokenX.publicKey.toString());
      const pxY      = await getPrice(dlmmPool.tokenY.publicKey.toString());

      const liqUsd   = amtX * (pxX || 0) + amtY * (pxY || 0);
      const feesUsd  = feeAmtX * (pxX || 0) + feeAmtY * (pxY || 0);
      
      // Include session reserve from haircuts (count only reserve, not full wallet)
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const xIsSOL = dlmmPool.tokenX.publicKey.toString() === SOL_MINT;
      const yIsSOL = dlmmPool.tokenY.publicKey.toString() === SOL_MINT;
      const solUsd = yIsSOL ? (pxY || 0) : xIsSOL ? (pxX || 0) : (pxY || 0);
      const feeReserveUsd = Number(feeReserveLamports) / 1e9 * solUsd;
      const bufferReserveUsd = Number(bufferReserveLamports) / 1e9 * solUsd;
      const capReserveUsd = Number(capReserveLamports) / 1e9 * solUsd;
      const haircutReserveUsd = Number(haircutReserveLamports) / 1e9 * solUsd;
      // Token-side reserves valued in USD using their token prices
      const tokenReserveUsd = (Number(tokenXReserveLamports) / 10 ** dx) * (pxX || 0) + (Number(tokenYReserveLamports) / 10 ** dy) * (pxY || 0);
      
      // 🔧 FIX: Calculate total USD based on session configuration pathways
      let totalUsd;
      
      // Get configuration from originalParams
      const autoCompoundMode = originalParams?.autoCompoundConfig?.mode || 'both';
      const feeHandlingMode = originalParams?.feeHandlingMode || 'compound';
      
      if (feeHandlingMode === 'compound') {
        // Auto-compound mode: Some/all fees are reinvested in position
        if (autoCompoundMode === 'both') {
          // All fees compounded into position (wallet-claimed fees should not be included)
          totalUsd = liqUsd + feesUsd;
        } else if (autoCompoundMode === 'sol_only') {
          // SOL_ONLY: SOL fees compounded, X token fees accumulate in wallet
          totalUsd = liqUsd + feesUsd + accumulatedXTokenFeesUsd; // Include accumulated X tokens as gains
        } else if (autoCompoundMode === 'token_only') {
          // TOKEN_ONLY: Token fees compounded, SOL fees claimed to wallet
          totalUsd = liqUsd + feesUsd; // Current position + current unclaimed
          // Note: Claimed SOL fees tracked separately in sessionState.totalClaimedFeesUsd
        } else {
          // Mixed compounding fallback: Some fees in position, some claimed separately
          totalUsd = liqUsd + feesUsd; // Current position + current unclaimed
          // Note: Claimed fees tracked separately in sessionState.totalClaimedFeesUsd
        }
      } else {
        // Claim-to-SOL mode: Position only (claimed fees separate)
        totalUsd = liqUsd + feesUsd; // Current position + current unclaimed
        // Note: Claimed fees tracked separately in sessionState.totalClaimedFeesUsd
      }

      // 🎯 PRIORITY CHECK: TAKE PROFIT & STOP LOSS (BEFORE rebalancing)
      // Calculate session P&L using dynamic baseline
      sessionState.sessionPnL = totalUsd - sessionState.currentBaselineUsd;
      {
        const baselineUsd = Math.max(sessionState.currentBaselineUsd || 0, 1e-9);
        sessionState.sessionPnLPercent = (sessionState.sessionPnL / baselineUsd) * 100;
      }
      
      // Calculate lifetime P&L including claimed fees as realized gains
      const autoMode = originalParams?.autoCompoundConfig?.mode || 'both';
      let lifetimeTotalValue = totalUsd;
      if (feeHandlingMode !== 'compound') {
        // claim_to_sol: claimed fees should be counted toward lifetime value
        lifetimeTotalValue = totalUsd + sessionState.totalClaimedFeesUsd;
      } else if (sessionState.autoCompound && autoMode === 'token_only') {
        // token_only: SOL fees are claimed to wallet; include them in lifetime value
        lifetimeTotalValue = totalUsd + sessionState.totalClaimedFeesUsd;
      }
      sessionState.lifetimePnL = lifetimeTotalValue - sessionState.initialDepositUsd;
      sessionState.lifetimePnLPercent = (sessionState.lifetimePnL / sessionState.initialDepositUsd) * 100;
      
      // Use session P&L for TP/SL decisions (respects current baseline)
      const currentPnL = sessionState.sessionPnL;
      const pnlPercentage = sessionState.sessionPnLPercent;
      
        console.log(`💰 Session P&L: $${currentPnL >= 0 ? '+' : ''}${currentPnL.toFixed(2)} (${pnlPercentage >= 0 ? '+' : ''}${pnlPercentage.toFixed(1)}%) vs baseline $${sessionState.currentBaselineUsd.toFixed(2)}`);
        console.log(`📈 Lifetime P&L: $${sessionState.lifetimePnL >= 0 ? '+' : ''}${sessionState.lifetimePnL.toFixed(2)} (${sessionState.lifetimePnLPercent >= 0 ? '+' : ''}${sessionState.lifetimePnLPercent.toFixed(1)}%) vs initial $${sessionState.initialDepositUsd.toFixed(2)}`);
        if (!sessionState.autoCompound && sessionState.totalClaimedFeesUsd > 0) {
          console.log(`💎 Realized gains: $${sessionState.totalClaimedFeesUsd.toFixed(2)} (claimed fees in wallet)`);
        }
      if (feeReserveUsd > 0.001) {
        console.log(`🔧 Reserve (off-position cash): +$${feeReserveUsd.toFixed(2)} [DEBUG ONLY - NOT part of P&L]`);
        // Breakdown if any component is meaningful
        const parts = [];
        if (bufferReserveUsd > 0.001) parts.push(`buffer ~$${bufferReserveUsd.toFixed(2)}`);
        if (capReserveUsd > 0.001) parts.push(`cap ~$${capReserveUsd.toFixed(2)}`);
        if (haircutReserveUsd > 0.001) parts.push(`haircut ~$${haircutReserveUsd.toFixed(2)}`);
        if (parts.length) console.log(`   ↳ Breakdown: ${parts.join(', ')}`);
      }
      if (feesUsd > 0.001) {
        const feeXUsd = feeAmtX * (pxX || 0);
        const feeYUsd = feeAmtY * (pxY || 0);
        console.log(
          `💎 Unclaimed fees (in P&L): $${feesUsd.toFixed(2)} ` +
          `(X: ${feeAmtX.toFixed(6)} → $${feeXUsd.toFixed(2)}, ` +
          `Y: ${feeAmtY.toFixed(6)} → $${feeYUsd.toFixed(2)})`
        );
      }
      if (tokenReserveUsd > 0.001) console.log(`🔧 Token reserve counted: +$${tokenReserveUsd.toFixed(2)}`);
      // SOL-denominated PnL for stability against USD fluctuations
      if (solUsd > 0 && baselineSolUnits > 0) {
        const totalSol = totalUsd / solUsd;
        const pnlSol = totalSol - baselineSolUnits;
        const pnlSolPct = (pnlSol / baselineSolUnits) * 100;
        console.log(`🪙 P&L(SOL): ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${pnlSolPct >= 0 ? '+' : ''}${pnlSolPct.toFixed(1)}%)`);
      }
      
      // Track peak P&L for trailing stop
      if (originalParams.trailingStopEnabled) {
        if (!trailingActive && pnlPercentage >= originalParams.trailTriggerPercentage) {
          trailingActive = true;
          peakPnL = pnlPercentage;
          dynamicStopLoss = peakPnL - originalParams.trailingStopPercentage;
          console.log(`🔄 TRAILING STOP activated at +${pnlPercentage.toFixed(1)}% (trigger: +${originalParams.trailTriggerPercentage}%)`);
          console.log(`   Initial trailing stop set at +${dynamicStopLoss.toFixed(1)}%`);
        }
        
        if (trailingActive && pnlPercentage > peakPnL) {
          peakPnL = pnlPercentage;
          const newDynamicStopLoss = peakPnL - originalParams.trailingStopPercentage;
          if (newDynamicStopLoss > dynamicStopLoss) {
            dynamicStopLoss = newDynamicStopLoss;
            console.log(`📈 New peak: +${peakPnL.toFixed(1)}% → Trailing stop moved to +${dynamicStopLoss.toFixed(1)}%`);
          }
        }
      }
      
      if ((originalParams.takeProfitEnabled || originalParams.stopLossEnabled || originalParams.trailingStopEnabled) && !isNaN(pnlPercentage)) {
        let shouldClose = false;
        let closeReason = '';
        
        // Check Take Profit (highest priority)
        if (originalParams.takeProfitEnabled && pnlPercentage >= originalParams.takeProfitPercentage) {
          shouldClose = true;
          closeReason = `🎯 TAKE PROFIT triggered at +${pnlPercentage.toFixed(1)}% (target: +${originalParams.takeProfitPercentage}%)`;
        }
        // Check Trailing Stop (second priority, only if active)
        else if (originalParams.trailingStopEnabled && trailingActive && dynamicStopLoss !== null && pnlPercentage <= dynamicStopLoss) {
          shouldClose = true;
          closeReason = `📉 TRAILING STOP triggered at ${pnlPercentage.toFixed(1)}% (trail: +${dynamicStopLoss.toFixed(1)}%, peak was: +${peakPnL.toFixed(1)}%)`;
        }
        // Check Stop Loss (fallback)
        else if (originalParams.stopLossEnabled && pnlPercentage <= -originalParams.stopLossPercentage) {
          shouldClose = true;
          closeReason = `🛑 STOP LOSS triggered at ${pnlPercentage.toFixed(1)}% (limit: -${originalParams.stopLossPercentage}%)`;
        }
        
        if (shouldClose) {
          // Snapshot current unclaimed fees into realized counters for TP/SL closures
          try {
            const tpSlFeesUsd = (feeAmtX * (pxX || 0)) + (feeAmtY * (pxY || 0));
            if (Number.isFinite(tpSlFeesUsd) && tpSlFeesUsd > 0) {
              totalFeesEarnedUsd += tpSlFeesUsd;
              claimedFeesUsd += tpSlFeesUsd;
            }
          } catch {}
          console.log('\n' + '='.repeat(80));
          console.log(closeReason);
          console.log(`💰 Final P&L: $${currentPnL.toFixed(2)} (${pnlPercentage.toFixed(1)}%)`);
          console.log(`📊 Position Value: $${totalUsd.toFixed(2)}`);
          console.log(`📈 Realized Fees (lifetime): $${totalFeesEarnedUsd.toFixed(2)} | Claimed to SOL: $${claimedFeesUsd.toFixed(2)}`);
          console.log(`🔄 Total Rebalances: ${rebalanceCount}`);
          console.log('='.repeat(80));
          
          try {
            console.log('🔄 Closing this specific position and swapping its tokens to SOL...');
            await closeSpecificPosition(connection, dlmmPool, userKeypair, positionPubKey, pos);
            console.log('✅ Position closed successfully due to TP/SL trigger');
            console.log('🚀 Bot execution completed - tokens from this position swapped to SOL');
            return; 
          } catch (error) {
            console.error('❌ Error closing position:', error.message);
            console.log('⚠️  Continuing monitoring despite close error...');
          }
        }
      }

      /* 4-C rebalance if ACTUALLY AT position edges ------------------- */
      const lowerBin = pos.positionData.lowerBinId;
      const upperBin = pos.positionData.upperBinId;
      const activeBinId = activeBin.binId;

      // Check if price moved COMPLETELY OUTSIDE position range 
      const outsideLowerRange = activeBinId < lowerBin;
      const outsideUpperRange = activeBinId > upperBin;
      
      // Enhanced position status with visual indicators
      const rangeStatus = outsideLowerRange ? '🔴 OUT-BELOW' : outsideUpperRange ? '🔴 OUT-ABOVE' : '🟢 IN-RANGE';
      console.log(`📊 Position: Bin ${activeBinId} │ Range ${lowerBin}-${upperBin} │ Status: ${rangeStatus}`);
      
      if (outsideLowerRange) {
        console.log(`   ⬇️  REBALANCE TRIGGER: Price below range (${activeBinId} < ${lowerBin})`);
        lastOutDirection = 'DOWN';
      } else if (outsideUpperRange) {
        console.log(`   ⬆️  REBALANCE TRIGGER: Price above range (${activeBinId} > ${upperBin})`);
        lastOutDirection = 'UP';
      } else {
        const binsFromLower = activeBinId - lowerBin;
        const binsFromUpper = upperBin - activeBinId;
        const centerDistance = Math.min(binsFromLower, binsFromUpper);
        const healthIcon = centerDistance > 5 ? '🟢' : centerDistance > 2 ? '🟡' : '🟠';
        console.log(`   ${healthIcon} Position healthy (${binsFromLower}↕${binsFromUpper} bins from edges)`);
      }

      // Capture initial gate start and direction (once)
      if (initialRebalanceGateActive && initialGateStartBinId === null) {
        initialGateStartBinId = activeBinId;
        // If upperBin equals active, we are single-sided below (SOL side) → need DOWN movement to satisfy gate
        if (upperBin === activeBinId && lowerBin < activeBinId) initialGateDirection = 'DOWN';
        else if (lowerBin === activeBinId && upperBin > activeBinId) initialGateDirection = 'UP';
        else initialGateDirection = null; // fallback to absolute distance
      }

      // Evaluate initial gate before any rebalancing
      if (initialRebalanceGateActive) {
        let movedBinsFromStart = 0;
        if (initialGateDirection === 'DOWN') movedBinsFromStart = Math.max(0, initialGateStartBinId - activeBinId);
        else if (initialGateDirection === 'UP') movedBinsFromStart = Math.max(0, activeBinId - initialGateStartBinId);
        else movedBinsFromStart = Math.abs(activeBinId - initialGateStartBinId);

        if (movedBinsFromStart < initialReentryBins) {
          const dir = outsideLowerRange ? 'BELOW' : outsideUpperRange ? 'ABOVE' : 'INSIDE';
          console.log(`   ⏸️ Holding initial template (gate active). Outside-distance ${movedBinsFromStart}/${initialReentryBins} bins from start; no rebalancing yet. [${dir}]`);
          await new Promise(r => setTimeout(r, intervalSeconds * 1_000));
          continue;
        } else {
          console.log(`   ✅ Initial movement threshold reached: ${initialGateDirection || 'ANY'} ${initialReentryBins}+ bins from start.`);
          initialRebalanceGateActive = false;
        }
      }

      // 🎯 DUAL TIMER: Only check for rebalancing on rebalance timer interval
      const currentTime = getTimestamp();
      const shouldCheckRebalance = (currentTime - lastRebalanceCheck) >= rebalanceCheckSeconds;
      
      if ((outsideLowerRange || outsideUpperRange) && shouldCheckRebalance) {
        lastRebalanceCheck = currentTime; // Update rebalance check timestamp
        
        // 🚨 SAFETY: Check for empty position to prevent infinite loops
        if (totalUsd <= 0.01) {
          console.log('🚨 CRITICAL: Empty position detected ($' + totalUsd.toFixed(2) + ')');
          console.log('🛑 Stopping monitoring to prevent infinite rebalance loop');
          console.log('💡 Possible causes: Position creation failed, liquidity drained, or price moved too far');
          
          // 🚨 EMERGENCY: Attempt to close position and swap tokens to SOL
          console.log('🔄 Emergency cleanup: Attempting to close position and swap tokens to SOL...');
          try {
            await closeSpecificPosition(connection, dlmmPool, userKeypair, positionPubKey, pos);
            console.log('✅ Emergency cleanup completed - any remaining tokens swapped to SOL');
          } catch (cleanupError) {
            console.error('⚠️ Emergency cleanup failed:', cleanupError.message);
            console.error('💡 Manual cleanup may be required - check wallet for remaining tokens');
          }
          
          break; // Exit monitoring loop
        }
        
        // Initial-phase gating (outside-distance from start): block ANY rebalancing until price moves X bins from starting active bin
        if (initialRebalanceGateActive) {
          if (initialGateActiveBinId === null) initialGateActiveBinId = activeBinId;
          const movedBinsFromStart = Math.abs(activeBinId - initialGateActiveBinId);
          if (movedBinsFromStart < initialReentryBins) {
            const direction = outsideLowerRange ? 'BELOW' : outsideUpperRange ? 'ABOVE' : 'INSIDE';
            console.log(`   ⏸️ Holding initial template (gate active). Outside-distance ${movedBinsFromStart}/${initialReentryBins} bins from start; no rebalancing yet. [${direction}]`);
            await new Promise(r => setTimeout(r, intervalSeconds * 1_000));
            continue;
          } else {
            console.log(`   ✅ Outside-distance reached (${movedBinsFromStart} ≥ ${initialReentryBins}). Rebalancing enabled.`);
            initialRebalanceGateActive = false;
          }
        }
        const direction = outsideLowerRange ? 'BELOW' : 'ABOVE';
        // Determine rebalance direction for swapless mode
        const rebalanceDirection = outsideLowerRange ? 'DOWN' : 'UP';
        
        console.log('');
        console.log('🚨 REBALANCING TRIGGERED 🚨');
        console.log(`⚡ Price moved ${direction} position range!`);
        console.log(`📍 Active: ${activeBinId} │ Range: ${lowerBin}-${upperBin} │ Direction: ${rebalanceDirection}`);
        // Preflight: ensure we have enough session SOL to safely reopen
        try {
          const SOL_MINT = 'So11111111111111111111111111111111111111112';
          const isSolX = dlmmPool.tokenX.publicKey.toString() === SOL_MINT;
          const isSolY = dlmmPool.tokenY.publicKey.toString() === SOL_MINT;
          // Estimate SOL returned on close: only the SOL side + (fees on SOL side). If claim_to_sol, non‑SOL fees are also swapped to SOL afterward, but we don't rely on them here
          let estSolLamports = new BN(0);
          if (isSolX) estSolLamports = estSolLamports.add(lamX);
          if (isSolY) estSolLamports = estSolLamports.add(lamY);
          if (originalParams.feeHandlingMode === 'claim_to_sol') {
            if (isSolX) estSolLamports = estSolLamports.add(feeX);
            if (isSolY) estSolLamports = estSolLamports.add(feeY);
          }
          // Subtract estimated fees/rent and keep a buffer
          const TOKEN_ACCOUNT_SIZE = 165;
          const rentExempt = BigInt(await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE));
          const PRIORITY_FEE_MICRO_LAMPORTS = Number(process.env.PRIORITY_FEE_MICRO_LAMPORTS || 50_000);
          const estPriorityLamports = BigInt(PRIORITY_FEE_MICRO_LAMPORTS) * 250000n / 1_000_000n; // ~250k CU
          const baseFeeLamports = 5000n;
          const PREFLIGHT_SOL_BUFFER = 20_000_000n; // 0.02 SOL buffer
          const estOverhead = rentExempt + estPriorityLamports + baseFeeLamports + PREFLIGHT_SOL_BUFFER;
          const available = BigInt(estSolLamports.toString());
          const safeSpend = available > estOverhead ? available - estOverhead : 0n;
          if (safeSpend <= 0n) {
            console.log('⚠️  Preflight: Insufficient session SOL to safely reopen. Skipping rebalance this tick.');
            await new Promise(r => setTimeout(r, intervalSeconds * 1_000));
            continue;
          }
        } catch {}
        resetReserveTracking(); // Reset reserves for new position
        const res = await recenterPosition(connection, dlmmPool, userKeypair, positionPubKey, originalParams, rebalanceDirection);
        if (!res) break;

        dlmmPool        = res.dlmmPool;
        positionPubKey  = res.positionPubKey;
        
        // Update P&L tracking
        totalFeesEarnedUsd += res.feesEarnedUsd || 0;
        if (res && res.compounded === false) {
          claimedFeesUsd += res.claimedFeesUsd || 0;
          sessionState.totalClaimedFeesUsd += res.claimedFeesUsd || 0;
        } else if (res && res.compounded === true) {
          sessionState.totalCompoundedFeesUsd += res.feesEarnedUsd || 0;
        }
        rebalanceCount += 1;
        sessionState.rebalanceCount += 1;
        
        // 📊 CRITICAL: Update Dynamic Baseline After Rebalancing
        if (res && res.newDepositValue) {
          console.log(`📊 [BASELINE UPDATE] Previous baseline: $${sessionState.currentBaselineUsd.toFixed(2)}`);
          
          // 🔧 FIX: Use correct baseline based on auto-compound mode
          const autoCompoundMode = originalParams?.autoCompoundConfig?.mode || 'both';
          
          if (sessionState.autoCompound && autoCompoundMode === 'both') {
            // Auto-compound BOTH: All fees were reinvested, use full amount
            sessionState.currentBaselineUsd = res.newDepositValue;
            sessionState.cumulativeDeposits = res.newDepositValue;
            console.log(`📊 [BASELINE UPDATE] New baseline: $${sessionState.currentBaselineUsd.toFixed(2)} (auto-compound BOTH - includes all reinvested fees)`);
          } else if (sessionState.autoCompound && autoCompoundMode === 'sol_only') {
            // Auto-compound SOL_ONLY: Only SOL fees reinvested, X token fees accumulate in wallet
            sessionState.currentBaselineUsd = res.positionValueOnly;
            sessionState.cumulativeDeposits = res.positionValueOnly;
            
            // Track accumulated X token fees as session gains
            if (res.accumulatedXTokenFeesUsd && res.accumulatedXTokenFeesUsd > 0) {
              accumulatedXTokenFeesUsd = res.accumulatedXTokenFeesUsd;
              console.log(`📊 [BASELINE UPDATE] New baseline: $${sessionState.currentBaselineUsd.toFixed(2)} (auto-compound SOL_ONLY - position + reinvested SOL fees only)`);
              console.log(`📊 [BASELINE UPDATE] Accumulated X token fees: $${accumulatedXTokenFeesUsd.toFixed(2)} (in wallet as session gains)`);
            } else {
              console.log(`📊 [BASELINE UPDATE] New baseline: $${sessionState.currentBaselineUsd.toFixed(2)} (auto-compound SOL_ONLY - position + reinvested SOL fees only)`);
              console.log(`📊 [BASELINE UPDATE] X token fees accumulating in wallet as session gains`);
            }
          } else if (sessionState.autoCompound && autoCompoundMode === 'token_only') {
            // Auto-compound TOKEN_ONLY: Only token fees reinvested, SOL fees claimed
            sessionState.currentBaselineUsd = res.positionValueOnly;
            sessionState.cumulativeDeposits = res.positionValueOnly;
            console.log(`📊 [BASELINE UPDATE] New baseline: $${sessionState.currentBaselineUsd.toFixed(2)} (auto-compound TOKEN_ONLY - position + reinvested token fees only)`);
            console.log(`📊 [BASELINE UPDATE] Claimed SOL fees: +$${(res.claimedFeesUsd || 0).toFixed(2)} (total claimed: $${sessionState.totalClaimedFeesUsd.toFixed(2)})`);
          } else {
            // Auto-compound OFF: All fees were claimed to wallet, use position value only
            sessionState.currentBaselineUsd = res.positionValueOnly;
            sessionState.cumulativeDeposits = res.positionValueOnly;
            console.log(`📊 [BASELINE UPDATE] New baseline: $${sessionState.currentBaselineUsd.toFixed(2)} (auto-compound OFF - position only)`);
            console.log(`📊 [BASELINE UPDATE] Claimed fees: +$${(res.claimedFeesUsd || 0).toFixed(2)} (total claimed: $${sessionState.totalClaimedFeesUsd.toFixed(2)})`);
            if (res.unswappedFeesUsd && res.unswappedFeesUsd > 0) {
              console.log(`📊 [BASELINE UPDATE] Unswapped fees: $${res.unswappedFeesUsd.toFixed(4)} (below threshold, staying in position)`);
            }
          }
        }
        
        console.log(`✅ Rebalancing complete - resuming monitoring every ${intervalSeconds}s`);
        console.log(`📈 P&L Update: Realized fees (lifetime): $${totalFeesEarnedUsd.toFixed(4)} | Claimed to SOL (lifetime): $${claimedFeesUsd.toFixed(4)} | Rebalances: ${rebalanceCount}`);
        // Divider between sections
        printGridBorder('mid');
        
        // 🔧 FIX: Refetch position data after rebalancing to get correct P&L
        await dlmmPool.refetchStates();
        const { userPositions: updatedPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
        const updatedPos = updatedPositions.find(p => p.publicKey.equals(positionPubKey));
        
        if (updatedPos) {
          // Recalculate amounts and USD value with NEW position data
          let newLamX = new BN(0), newLamY = new BN(0);
          updatedPos.positionData.positionBinData.forEach(b => {
            newLamX = newLamX.add(new BN(b.positionXAmount));
            newLamY = newLamY.add(new BN(b.positionYAmount));
          });
          const newFeeX = new BN(updatedPos.positionData.feeX);
          const newFeeY = new BN(updatedPos.positionData.feeY);

          const newAmtX = newLamX.toNumber() / 10 ** dx;
          const newAmtY = newLamY.toNumber() / 10 ** dy;
          const newFeeAmtX = newFeeX.toNumber() / 10 ** dx;
          const newFeeAmtY = newFeeY.toNumber() / 10 ** dy;

          const newLiqUsd = newAmtX * (pxX || 0) + newAmtY * (pxY || 0);
          const newUnclaimedFeesUsd = newFeeAmtX * (pxX || 0) + newFeeAmtY * (pxY || 0);
          
          // 🔧 FIX: Calculate total USD based on session configuration pathways
          let totalUsd;
          
          // Get configuration from originalParams
          const autoCompoundMode = originalParams?.autoCompoundConfig?.mode || 'both';
          const feeHandlingMode = originalParams?.feeHandlingMode || 'compound';
          
          if (feeHandlingMode === 'compound') {
            // Auto-compound mode: Some/all fees are reinvested in position
            if (autoCompoundMode === 'both') {
              // All fees compounded into position (wallet-claimed fees should not be included)
              totalUsd = newLiqUsd + newUnclaimedFeesUsd;
            } else {
              // Mixed compounding: Some fees in position, some claimed separately
              totalUsd = newLiqUsd + newUnclaimedFeesUsd; // Current position + current unclaimed
              // Note: Claimed fees tracked separately in sessionState.totalClaimedFeesUsd
            }
          } else {
            // Claim-to-SOL mode: Position only (claimed fees separate)
            totalUsd = newLiqUsd + newUnclaimedFeesUsd; // Current position + current unclaimed
            // Note: Claimed fees tracked separately in sessionState.totalClaimedFeesUsd
          }
          
          // Calculate P&L metrics with UPDATED position value + wallet value
          // Update sessionState with post-rebalance values
          sessionState.sessionPnL = totalUsd - sessionState.currentBaselineUsd;
          sessionState.sessionPnLPercent = (sessionState.sessionPnL / sessionState.currentBaselineUsd) * 100;
          
          // Calculate lifetime P&L including claimed fees as realized gains
          const lifetimeTotalValue = sessionState.autoCompound ? totalUsd : totalUsd + sessionState.totalClaimedFeesUsd;
          sessionState.lifetimePnL = lifetimeTotalValue - sessionState.initialDepositUsd;
          sessionState.lifetimePnLPercent = (sessionState.lifetimePnL / sessionState.initialDepositUsd) * 100;
          
          const currentPnL = sessionState.sessionPnL;
          const pnlPercentage = sessionState.sessionPnLPercent;
          
          // Show TP/SL/TS status in rebalance display with visual indicators
          const tpIcon = originalParams.takeProfitEnabled ? (pnlPercentage >= originalParams.takeProfitPercentage ? '🔥' : '📈') : '⚪';
          const slIcon = originalParams.stopLossEnabled ? (pnlPercentage <= -originalParams.stopLossPercentage ? '🛑' : '🛡️') : '⚪';
          const tsIcon = originalParams.trailingStopEnabled ? 
            (trailingActive ? 
              (dynamicStopLoss !== null && pnlPercentage <= dynamicStopLoss ? '📉' : '🔄') : '⭕') : '⚪';
          
          const tpText = originalParams.takeProfitEnabled ? `+${originalParams.takeProfitPercentage}%` : 'OFF';
          const slText = originalParams.stopLossEnabled ? `-${originalParams.stopLossPercentage}%` : 'OFF';
          const tsText = originalParams.trailingStopEnabled ? 
            (trailingActive ? 
              (dynamicStopLoss !== null ? `+${dynamicStopLoss.toFixed(1)}%` : `+${peakPnL.toFixed(1)}%`) : 
              `+${originalParams.trailTriggerPercentage}%`) : 'OFF';
          
          // Color-coded P&L display
          const pnlColor = currentPnL >= 0 ? '✅' : '❌';
          const pnlSign = currentPnL >= 0 ? '+' : '';
          const pnlPercentSign = pnlPercentage >= 0 ? '+' : '';
          
          // Grid row after rebalance
          if (gridRowCounter % 20 === 0 && gridRowCounter !== 0) printGridHeader();
          printGridRow({
            time: new Date().toLocaleTimeString().padEnd(8),
            value: `$${totalUsd.toFixed(2)}`,
            pnl: `${pnlColor}${pnlSign}$${Math.abs(currentPnL).toFixed(2)}`,
            pnlPct: `${pnlPercentSign}${pnlPercentage.toFixed(1)}%`,
            fees: `$${totalFeesEarnedUsd.toFixed(2)}`,
            rebal: rebalanceCount.toString(),
            tpslts: `${tpIcon}${tpText} ${slIcon}${slText} ${tsIcon}${tsText}`
          });
          gridRowCounter++;
          
          if (feeReserveUsd > 0.001) {
            console.log(`🔧 Reserve counted: +$${feeReserveUsd.toFixed(2)}`);
          }
          // SOL-denominated PnL after rebalance
          if (solUsd > 0 && baselineSolUnits > 0) {
            const totalSol = totalUsd / solUsd;
            const pnlSol = totalSol - baselineSolUnits;
            const pnlSolPct = (pnlSol / baselineSolUnits) * 100;
            console.log(`🪙 P&L(SOL): ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${pnlSolPct >= 0 ? '+' : ''}${pnlSolPct.toFixed(1)}%)`);
          }
          
          // Track peak P&L for trailing stop after rebalancing
          if (originalParams.trailingStopEnabled) {
            if (!trailingActive && pnlPercentage >= originalParams.trailTriggerPercentage) {
              trailingActive = true;
              peakPnL = pnlPercentage;
              dynamicStopLoss = peakPnL - originalParams.trailingStopPercentage;
              console.log(`🔄 TRAILING STOP activated at +${pnlPercentage.toFixed(1)}% (trigger: +${originalParams.trailTriggerPercentage}%)`);
              console.log(`   Initial trailing stop set at +${dynamicStopLoss.toFixed(1)}%`);
            }
            
            if (trailingActive && pnlPercentage > peakPnL) {
              peakPnL = pnlPercentage;
              const newDynamicStopLoss = peakPnL - originalParams.trailingStopPercentage;
              if (newDynamicStopLoss > dynamicStopLoss) {
                dynamicStopLoss = newDynamicStopLoss;
                console.log(`📈 New peak: +${peakPnL.toFixed(1)}% → Trailing stop moved to +${dynamicStopLoss.toFixed(1)}%`);
              }
            }
          }

          // 🎯 CHECK TP/SL AGAIN AFTER REBALANCING
          if ((originalParams.takeProfitEnabled || originalParams.stopLossEnabled || originalParams.trailingStopEnabled) && !isNaN(pnlPercentage)) {
            let shouldClose = false;
            let closeReason = '';
            
            // Check Take Profit (highest priority)
            if (originalParams.takeProfitEnabled && pnlPercentage >= originalParams.takeProfitPercentage) {
              shouldClose = true;
              closeReason = `🎯 TAKE PROFIT triggered at +${pnlPercentage.toFixed(1)}% (target: +${originalParams.takeProfitPercentage}%)`;
            }
            // Check Trailing Stop (second priority, only if active)
            else if (originalParams.trailingStopEnabled && trailingActive && dynamicStopLoss !== null && pnlPercentage <= dynamicStopLoss) {
              shouldClose = true;
              closeReason = `📉 TRAILING STOP triggered at ${pnlPercentage.toFixed(1)}% (trail: +${dynamicStopLoss.toFixed(1)}%, peak was: +${peakPnL.toFixed(1)}%)`;
            }
            // Check Stop Loss (fallback)
            else if (originalParams.stopLossEnabled && pnlPercentage <= -originalParams.stopLossPercentage) {
              shouldClose = true;
              closeReason = `🛑 STOP LOSS triggered at ${pnlPercentage.toFixed(1)}% (limit: -${originalParams.stopLossPercentage}%)`;
            }
            
            if (shouldClose) {
              // Snapshot current unclaimed fees into realized counters for TP/SL closures
              try {
                const tpSlFeesUsd = (newFeeAmtX * (pxX || 0)) + (newFeeAmtY * (pxY || 0));
                if (Number.isFinite(tpSlFeesUsd) && tpSlFeesUsd > 0) {
                  totalFeesEarnedUsd += tpSlFeesUsd;
                  claimedFeesUsd += tpSlFeesUsd;
                }
              } catch {}
              console.log('\n' + '='.repeat(80));
              console.log(closeReason);
              console.log(`💰 Final P&L: $${currentPnL.toFixed(2)} (${pnlPercentage.toFixed(1)}%)`);
              console.log(`📊 Position Value: $${totalUsd.toFixed(2)}`);
              console.log(`📈 Realized Fees (lifetime): $${totalFeesEarnedUsd.toFixed(2)} | Claimed to SOL: $${claimedFeesUsd.toFixed(2)}`);
              console.log(`🔄 Total Rebalances: ${rebalanceCount}`);
              console.log('='.repeat(80));
              
              try {
                console.log('🔄 Closing this specific position and swapping its tokens to SOL...');
                await closeSpecificPosition(connection, dlmmPool, userKeypair, positionPubKey, updatedPos);
                console.log('✅ Position closed successfully due to TP/SL trigger');
                console.log('🚀 Bot execution completed - tokens from this position swapped to SOL');
                return; 
              } catch (error) {
                console.error('❌ Error closing position:', error.message);
                console.log('⚠️  Continuing monitoring despite close error...');
              }
            }
          }
        }
        
        // Skip normal P&L calculation since we already did it above
        await new Promise(r => setTimeout(r, pnlCheckSeconds * 1_000));
        continue;
      } else if (outsideLowerRange || outsideUpperRange) {
        // Price is out of range but we're waiting for rebalance timer
        const timeUntilRebalance = rebalanceCheckSeconds - (currentTime - lastRebalanceCheck);
        console.log(`   ⏳ Rebalance delayed: ${timeUntilRebalance}s remaining (every ${rebalanceCheckSeconds}s)`);
      }

      // Show TP/SL/TS status with visual indicators
      const tpIcon = originalParams.takeProfitEnabled ? (pnlPercentage >= originalParams.takeProfitPercentage ? '🔥' : '📈') : '⚪';
      const slIcon = originalParams.stopLossEnabled ? (pnlPercentage <= -originalParams.stopLossPercentage ? '🛑' : '🛡️') : '⚪';
      const tsIcon = originalParams.trailingStopEnabled ? 
        (trailingActive ? 
          (dynamicStopLoss !== null && pnlPercentage <= dynamicStopLoss ? '📉' : '🔄') : '⭕') : '⚪';
      
      const tpText = originalParams.takeProfitEnabled ? `+${originalParams.takeProfitPercentage}%` : 'OFF';
      const slText = originalParams.stopLossEnabled ? `-${originalParams.stopLossPercentage}%` : 'OFF';
      const tsText = originalParams.trailingStopEnabled ? 
        (trailingActive ? 
          (dynamicStopLoss !== null ? `+${dynamicStopLoss.toFixed(1)}%` : `+${peakPnL.toFixed(1)}%`) : 
          `+${originalParams.trailTriggerPercentage}%`) : 'OFF';
      
      // Color-coded P&L display
      const pnlColor = currentPnL >= 0 ? '✅' : '❌';
      const pnlSign = currentPnL >= 0 ? '+' : '';
      const pnlPercentSign = pnlPercentage >= 0 ? '+' : '';
      
      if (gridRowCounter % 20 === 0 && gridRowCounter !== 0) printGridHeader();
      printGridRow({
        time: new Date().toLocaleTimeString().padEnd(8),
        value: `$${totalUsd.toFixed(2)}`,
        pnl: `${pnlColor}${pnlSign}$${Math.abs(currentPnL).toFixed(2)}`,
        pnlPct: `${pnlPercentSign}${pnlPercentage.toFixed(1)}%`,
        fees: `$${totalFeesEarnedUsd.toFixed(2)}`,
        rebal: rebalanceCount.toString(),
        tpslts: `${tpIcon}${tpText} ${slIcon}${slText} ${tsIcon}${tsText}`
      });
      gridRowCounter++;
      
      // (Wallet balances excluded from P&L and portfolio display)

    } catch (err) {
      console.error('Error during monitor tick:', err?.message ?? err);
    }

    await new Promise(r => setTimeout(r, pnlCheckSeconds * 1_000));
  }

  console.log('Monitoring ended.');
  
  // Cleanup keyboard input handling
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  rl.close();
}

async function main() {
    const userKeypair = loadWalletKeypair(WALLET_PATH);
    const connection  = new Connection(RPC_URL, 'confirmed');
  
    console.log('🚀 Welcome to MeteorShower DLMM Bot!');
    
    // 🏊 Prompt for pool address
    const poolAddress = await promptPoolAddress();
    
    if (poolAddress === null) {
      console.log('❌ Operation cancelled.');
      process.exit(0);
    }

    // ⚡ Prompt for liquidity strategy
    const liquidityStrategy = await promptLiquidityStrategy();
    
    if (liquidityStrategy === null) {
      console.log('❌ Operation cancelled.');
      process.exit(0);
    }
    
    // 💰 Prompt for SOL amount to use
    const solAmount = await promptSolAmount();
    
    if (solAmount === null) {
      console.log('❌ Operation cancelled or insufficient balance.');
      process.exit(0);
    }

    console.log(`✅ Using ${solAmount.toFixed(6)} SOL for liquidity position`);
    
    // ⚖️ Get pool info for token symbols and prompt for ratio
    console.log('📊 Getting pool information...');
    const DLMM = dlmmPackage.default ?? dlmmPackage;
    
    const poolPK = new PublicKey(poolAddress);
    const dlmmPool = await DLMM.create(connection, poolPK);
    
    // Determine token symbols (simplified for SOL pools)
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const tokenXMint = dlmmPool.tokenX.publicKey.toString();
    const tokenYMint = dlmmPool.tokenY.publicKey.toString();
    
    const tokenXSymbol = tokenXMint === SOL_MINT ? 'SOL' : 'TokenX';
    const tokenYSymbol = tokenYMint === SOL_MINT ? 'SOL' : 'TokenY';
    
    // If it's not a SOL pair, get more generic names
    const poolInfo = {
      tokenXSymbol: tokenXSymbol === 'TokenX' ? `Token (${tokenXMint.slice(0, 4)}...)` : tokenXSymbol,
      tokenYSymbol: tokenYSymbol === 'TokenY' ? `Token (${tokenYMint.slice(0, 4)}...)` : tokenYSymbol
    };
    
    const tokenRatio = await promptTokenRatio(poolInfo);
    
    if (tokenRatio === null) {
      console.log('❌ Operation cancelled.');
      process.exit(0);
    }

    console.log(`✅ Token allocation: ${(tokenRatio.ratioX * 100).toFixed(1)}% ${poolInfo.tokenXSymbol} / ${(tokenRatio.ratioY * 100).toFixed(1)}% ${poolInfo.tokenYSymbol}`);
    
    // 📊 Get bin step and prompt for bin span
    const binStep = dlmmPool?.lbPair?.binStep ?? dlmmPool?.binStep ?? dlmmPool?.stepBp ?? dlmmPool?.stepBP ?? 25;
    console.log('📊 Configuring position range...');
    
    const binSpanInfo = await promptBinSpan({ 
      binStep, 
      tokenXSymbol: poolInfo.tokenXSymbol, 
      tokenYSymbol: poolInfo.tokenYSymbol 
    });
    
    if (binSpanInfo === null) {
      console.log('❌ Operation cancelled.');
      process.exit(0);
    }

    console.log(`✅ Bin configuration: ${binSpanInfo.binSpan} bins (${binSpanInfo.coverage}% price coverage)`);
    
    // 🔄 Prompt for swapless rebalancing option
    console.log('🔄 Configuring rebalancing strategy...');
    
    const swaplessConfig = await promptSwaplessRebalance();
    
    if (swaplessConfig === null) {
      console.log('❌ Operation cancelled.');
      process.exit(0);
    }

    let rebalanceStrategy = liquidityStrategy; // Default to same as initial
    let initialReentryBins = 2; // Default value
    
    if (swaplessConfig.enabled) {
      console.log(`✅ Swapless rebalancing enabled with ${swaplessConfig.binSpan} bin span`);
      
      // 🔄 Prompt for rebalancing strategy (only for swapless mode)
      const rebalanceStrategySel1 = await promptRebalanceStrategy(liquidityStrategy);
      if (rebalanceStrategySel1 === null) { console.log('❌ Operation cancelled.'); process.exit(0); }
      rebalanceStrategy = rebalanceStrategySel1.mode === 'same' ? liquidityStrategy : rebalanceStrategySel1.mode;
      console.log(`✅ Rebalance strategy: ${rebalanceStrategySel1.mode === 'same' ? `Same as initial (${liquidityStrategy})` : rebalanceStrategy}`);
      
      // Initial outside-distance threshold prompt (only for swapless mode)
      initialReentryBins = await promptInitialReentryBins(2);
      console.log(`✅ Initial movement threshold (from start): ${initialReentryBins} bin(s)`);
    } else {
      console.log('✅ Normal rebalancing enabled (maintains token ratios with swaps)');
      console.log(`✅ Rebalance strategy: Same as initial (${liquidityStrategy})`);
    }
    
    // 💸 Prompt for fee handling
    console.log('💸 Configuring fee handling...');
    const feeHandling = await promptFeeHandling();
    if (feeHandling === null) { console.log('❌ Operation cancelled.'); process.exit(0); }
    let autoCompoundConfig;
    let minSwapUsd = null;
    if (feeHandling.mode === 'compound') {
      autoCompoundConfig = { enabled: true };
      console.log('✅ Auto-compounding enabled - fees will be reinvested automatically');
      // Optional compounding mode
      const cmp = await promptCompoundingMode();
      if (cmp === null) { console.log('❌ Operation cancelled.'); process.exit(0); }
      autoCompoundConfig.mode = cmp.compoundingMode; // both|sol_only|token_only|none
    } else {
      autoCompoundConfig = { enabled: false };
      console.log('✅ Claim-and-convert to SOL selected - fees will not be reinvested');
      // Only relevant in claim_to_sol mode: ask for min USD per swap
      minSwapUsd = await promptMinSwapUsd(1);
    }
    
    // 🎯 Prompt for Take Profit & Stop Loss settings
    console.log('🎯 Configuring exit conditions...');
    const tpslConfig = await promptTakeProfitStopLoss();
    if (tpslConfig === null) {
      console.log('❌ Operation cancelled.');
      process.exit(0);
    }
    
    if (tpslConfig.takeProfitEnabled) {
      console.log(`✅ Take Profit enabled: +${tpslConfig.takeProfitPercentage}%`);
    } else {
      console.log('✅ Take Profit disabled');
    }
    
    if (tpslConfig.stopLossEnabled) {
      console.log(`✅ Stop Loss enabled: -${tpslConfig.stopLossPercentage}%`);
    } else {
      console.log('✅ Stop Loss disabled');
    }
    
    if (tpslConfig.trailingStopEnabled) {
      console.log(`✅ Trailing Stop enabled: Trigger at +${tpslConfig.trailTriggerPercentage}%, trail ${tpslConfig.trailingStopPercentage}% behind peak`);
    } else {
      console.log('✅ Trailing Stop disabled');
    }
    
    // Calculate bin distribution for display (properly determine which is SOL)
    const poolTokenXMint = dlmmPool.tokenX.publicKey.toString();
    const poolTokenYMint = dlmmPool.tokenY.publicKey.toString();
    
    let solPercentage, tokenPercentage, binsForSOL, binsForToken, solCoverage, tokenCoverage;
    
    if (poolTokenXMint === SOL_MINT) {
      // SOL is tokenX
      solPercentage = tokenRatio.ratioX;
      tokenPercentage = tokenRatio.ratioY;
    } else if (poolTokenYMint === SOL_MINT) {
      // SOL is tokenY
      solPercentage = tokenRatio.ratioY;
      tokenPercentage = tokenRatio.ratioX;
    } else {
      // Neither is SOL - fallback
      solPercentage = tokenRatio.ratioX;
      tokenPercentage = tokenRatio.ratioY;
    }
    
    binsForSOL = Math.floor(binSpanInfo.binSpan * solPercentage);
    binsForToken = Math.floor(binSpanInfo.binSpan * tokenPercentage);
    solCoverage = (binsForSOL * binStep / 100).toFixed(2);
    tokenCoverage = (binsForToken * binStep / 100).toFixed(2);
    
    console.log('');
    console.log('📍 Position Configuration Summary:');
    console.log('==================================');
    console.log(`💰 Capital: ${solAmount.toFixed(6)} SOL`);
    console.log(`⚖️  Ratio: ${(tokenRatio.ratioX * 100).toFixed(1)}% ${poolInfo.tokenXSymbol} / ${(tokenRatio.ratioY * 100).toFixed(1)}% ${poolInfo.tokenYSymbol}`);
    console.log(`📊 Bin Span: ${binSpanInfo.binSpan} bins (${binSpanInfo.coverage}% total coverage)`);
    console.log(`   - SOL Bins: ${binsForSOL} bins below active price (-${solCoverage}% range)`);
    console.log(`   - Token Bins: ${binsForToken} bins above active price (+${tokenCoverage}% range)`);
    console.log('');
    
    // (Already selected earlier)

    // 1️⃣ Open initial position
    const {
      dlmmPool: finalPool,
      initialCapitalUsd,
      positionPubKey,
      openFeeLamports
    } = await openDlmmPosition(
      connection,
      userKeypair,
      solAmount,
      tokenRatio,
      binSpanInfo.binSpan,
      poolAddress,
      liquidityStrategy,
      null,
      null,
      false,
      {
        onTx: async (_sig) => {},
        onReserve: (lamports) => { feeReserveLamports += BigInt(lamports.toString()); },
      }
    );
  
    if (!finalPool || !positionPubKey) {
      console.error("Failed to open position – aborting.");
      process.exit(1);
    }
    
    // 🚨 CRITICAL: Validate position has actual liquidity
    if (!initialCapitalUsd || initialCapitalUsd <= 0.01) {
      console.error("🚨 CRITICAL: Position created but has no liquidity!");
      console.error(`💰 Initial capital: $${initialCapitalUsd}`);
      console.error("💡 Possible causes:");
      console.error("   • Liquidity addition transactions failed");
      console.error("   • Price moved outside narrow bin range during creation");
      console.error("   • Insufficient balance for position creation");
      console.error("   • Token allocation issues");
      console.error("🛑 Aborting to prevent empty position monitoring");
      
      // 🚨 EMERGENCY: Swap any remaining tokens to SOL before exit
      console.log("🔄 Emergency cleanup: Swapping any remaining tokens to SOL...");
      try {
        await closeSpecificPosition(connection, finalPool, userKeypair, positionPubKey, null);
        console.log("✅ Emergency cleanup completed - tokens swapped to SOL");
      } catch (cleanupError) {
        console.error("⚠️ Emergency cleanup failed:", cleanupError.message);
        console.error("💡 Manual cleanup may be required - check wallet for remaining tokens");
      }
      
      process.exit(1);
    }
    
    console.log(`✅ Position created successfully with $${initialCapitalUsd.toFixed(2)} liquidity`);
    // Wait for the newly opened position to be indexed/visible before starting monitor
    try {
      let appeared = false;
      for (let i = 0; i < 10; i++) { // up to ~10s
        await finalPool.refetchStates();
        const { userPositions } = await finalPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
        if (userPositions.find(p => p.publicKey.equals(positionPubKey))) {
          appeared = true;
          if (i > 0) console.log(`✅ Position indexed after ${i}s – starting monitor`);
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!appeared) {
        console.log('⚠️  Position not visible yet – starting monitor with retry guards');
      }
    } catch {}
  
    // 2️⃣ Initialize Session State for Dynamic Baseline Tracking
    const sessionState = {
      // Initial Setup (Never Changes)
      initialDeposit: solAmount,
      initialDepositUsd: initialCapitalUsd,
      initialTokenRatio: tokenRatio,
      
      // Current Session State (Updates During Rebalancing)
      currentBaseline: solAmount,
      currentBaselineUsd: initialCapitalUsd,
      cumulativeDeposits: solAmount,
      
      // Configuration (From Prompts)
      autoCompound: autoCompoundConfig.enabled,
      swaplessEnabled: swaplessConfig.enabled,
      swaplessBinSpan: swaplessConfig.binSpan || 15,
      
      // Tracking Accumulators
      totalClaimedFees: 0,
      totalClaimedFeesUsd: 0,
      totalCompoundedFees: 0,
      totalCompoundedFeesUsd: 0,
      rebalanceCount: 0,
      
      // Session Performance
      sessionPnL: 0,
      sessionPnLPercent: 0,
      lifetimePnL: 0,
      lifetimePnLPercent: 0
    };
    
    console.log('📊 Session State Initialized:');
    console.log(`   📊 Initial Deposit: ${sessionState.initialDeposit.toFixed(6)} SOL ($${sessionState.initialDepositUsd.toFixed(2)})`);
    console.log(`   📊 Auto-Compound: ${sessionState.autoCompound ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`   📊 Swapless Mode: ${sessionState.swaplessEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`   📊 Dynamic Baseline Tracking: ✅ ACTIVE`);

    // Start monitoring & rebalancing with original parameters
    const originalParams = {
      solAmount,
      tokenRatio,
      binSpan: binSpanInfo.binSpan,
      poolAddress,
      liquidityStrategy,
      rebalanceStrategy,
      swaplessConfig,
      autoCompoundConfig,
      feeHandlingMode: feeHandling.mode,
      initialReentryBins,
      minSwapUsd,
      takeProfitEnabled: tpslConfig.takeProfitEnabled,
      takeProfitPercentage: tpslConfig.takeProfitPercentage,
      stopLossEnabled: tpslConfig.stopLossEnabled,
      stopLossPercentage: tpslConfig.stopLossPercentage,
      trailingStopEnabled: tpslConfig.trailingStopEnabled,
      trailTriggerPercentage: tpslConfig.trailTriggerPercentage,
      trailingStopPercentage: tpslConfig.trailingStopPercentage
    };
    
    await monitorPositionLoop(
      connection,
      finalPool,
      userKeypair,
      sessionState,
      positionPubKey,
      MONITOR_INTERVAL_SECONDS,
      originalParams
    );
  
    console.log("🏁 Script finished.");
  }
  
  main().catch(err => {
    console.error("💥 Unhandled error in main:", err);
    process.exit(1);
  });
export { main, monitorPositionLoop };