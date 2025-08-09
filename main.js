// ───────────────────────────────────────────────
// ~/main.js
// ───────────────────────────────────────────────
import BN from 'bn.js';
import { loadWalletKeypair, getMintDecimals, safeGetBalance } from './lib/solana.js';
import { openDlmmPosition, recenterPosition } from './lib/dlmm.js';
import 'dotenv/config';
import { getPrice } from './lib/price.js';
import { promptSolAmount, promptTokenRatio, promptBinSpan, promptPoolAddress, promptLiquidityStrategy, promptSwaplessRebalance, promptAutoCompound, promptTakeProfitStopLoss } from './balance-prompt.js';
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
  initialCapitalUsd,
  positionPubKey,
  intervalSeconds,
  originalParams = {}
) {
  console.log(`Starting monitoring - Interval ${intervalSeconds}s`);
  console.log(`Tracking Position: ${positionPubKey.toBase58()}`);
  
  // Trailing stop tracking variables
  let peakPnL = 0;                    // Highest P&L percentage since trail activation
  let trailingActive = false;         // Whether trailing is currently active
  let dynamicStopLoss = null;         // Current trailing stop level
  console.log(`Rebalancing logic: Only triggers when price moves outside position range`);
  
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
        console.log('\n🔴 CLOSING ALL POSITIONS...');
        console.log('🔄 This will close all positions and swap tokens to SOL...');
        
        try {
          const { closeAllPositions } = await import('./close-position.js');
          await closeAllPositions();
          console.log('✅ Position closure completed successfully!');
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
  console.log(`📈 P&L Tracking initialized - Initial deposit: $${initialCapitalUsd.toFixed(2)}`);

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

  /* ─── 3. heading ────────────────────────────────────────────────── */
  console.log('');
  console.log('🎯 Position Monitor Active');
  console.log('═'.repeat(100));
  console.log(
    "📊 Time      │ 💰 Value   │ 📈 P&L     │ 📊 P&L%   │ 💎 Fees   │ 🔄 Rebal │ 🎯 TP │ 🛡️ SL │ 📉 TS"
  );
  console.log('─'.repeat(100));

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
        await new Promise(r => setTimeout(r, intervalSeconds * 1_000));
        continue;
      }
      if (!pos) {
        console.log('❌ Position not found - may have been closed or failed to create');
        console.log(`   Searching for position: ${positionPubKey.toBase58()}`);
        console.log(`   Found ${userPositions.length} positions:`, userPositions.map(p => p.publicKey.toBase58()));
        break;
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
      
      // Accurate value at tick = liquidity + unclaimed fees + previously claimed fees kept in wallet
      const totalUsd = liqUsd + feesUsd + claimedFeesUsd;

      // 🎯 PRIORITY CHECK: TAKE PROFIT & STOP LOSS (BEFORE rebalancing)
      const currentPnL = totalUsd - initialCapitalUsd;
      const pnlPercentage = ((currentPnL / initialCapitalUsd) * 100);
      
      console.log(`💰 Current P&L: $${currentPnL >= 0 ? '+' : ''}${currentPnL.toFixed(2)} (${pnlPercentage >= 0 ? '+' : ''}${pnlPercentage.toFixed(1)}%)`);
      
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
          console.log('\n' + '='.repeat(80));
          console.log(closeReason);
          console.log(`💰 Final P&L: $${currentPnL.toFixed(2)} (${pnlPercentage.toFixed(1)}%)`);
          console.log(`📊 Position Value: $${totalUsd.toFixed(2)}`);
          console.log(`📈 Total Fees Earned: $${totalFeesEarnedUsd.toFixed(2)}`);
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
      } else if (outsideUpperRange) {
        console.log(`   ⬆️  REBALANCE TRIGGER: Price above range (${activeBinId} > ${upperBin})`);
      } else {
        const binsFromLower = activeBinId - lowerBin;
        const binsFromUpper = upperBin - activeBinId;
        const centerDistance = Math.min(binsFromLower, binsFromUpper);
        const healthIcon = centerDistance > 5 ? '🟢' : centerDistance > 2 ? '🟡' : '🟠';
        console.log(`   ${healthIcon} Position healthy (${binsFromLower}↕${binsFromUpper} bins from edges)`);
      }

      if (outsideLowerRange || outsideUpperRange) {
        const direction = outsideLowerRange ? 'BELOW' : 'ABOVE';
        // Determine rebalance direction for swapless mode
        const rebalanceDirection = outsideLowerRange ? 'DOWN' : 'UP';
        
        console.log('');
        console.log('🚨 REBALANCING TRIGGERED 🚨');
        console.log(`⚡ Price moved ${direction} position range!`);
        console.log(`📍 Active: ${activeBinId} │ Range: ${lowerBin}-${upperBin} │ Direction: ${rebalanceDirection}`);
        const res = await recenterPosition(connection, dlmmPool, userKeypair, positionPubKey, originalParams, rebalanceDirection);
        if (!res) break;

        dlmmPool        = res.dlmmPool;
        positionPubKey  = res.positionPubKey;
        
        // Update P&L tracking
        totalFeesEarnedUsd += res.feesEarnedUsd || 0;
        if (res && res.compounded === false) {
          claimedFeesUsd += res.claimedFeesUsd || 0;
        }
        rebalanceCount += 1;
        
        console.log(`✅ Rebalancing complete - resuming monitoring every ${intervalSeconds}s`);
        console.log(`📈 P&L Update: Total fees earned: $${totalFeesEarnedUsd.toFixed(4)}, Rebalances: ${rebalanceCount}`);
        console.log('─'.repeat(85));
        
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
          
          // Accurate value = liquidity + unclaimed fees + previously claimed fees kept in wallet
          const totalUsd = newLiqUsd + newUnclaimedFeesUsd + claimedFeesUsd;
          
          // Calculate P&L metrics with UPDATED position value + wallet value
          const currentPnL = totalUsd - initialCapitalUsd;
          const pnlPercentage = ((currentPnL / initialCapitalUsd) * 100);
          
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
          
          console.log(
            `⏰ ${new Date().toLocaleTimeString().padEnd(8)} │ ` +
            `$${totalUsd.toFixed(2).padStart(8)} │ ` +
            `${pnlColor}${pnlSign}$${Math.abs(currentPnL).toFixed(2).padStart(6)} │ ` +
            `${pnlPercentSign}${pnlPercentage.toFixed(1).padStart(6)}% │ ` +
            `$${totalFeesEarnedUsd.toFixed(2).padStart(7)} │ ` +
            `${rebalanceCount.toString().padStart(5)} │ ` +
            `${tpIcon}${tpText} ${slIcon}${slText} ${tsIcon}${tsText}`
          );
          
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
              console.log('\n' + '='.repeat(80));
              console.log(closeReason);
              console.log(`💰 Final P&L: $${currentPnL.toFixed(2)} (${pnlPercentage.toFixed(1)}%)`);
              console.log(`📊 Position Value: $${totalUsd.toFixed(2)}`);
              console.log(`📈 Total Fees Earned: $${totalFeesEarnedUsd.toFixed(2)}`);
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
        await new Promise(r => setTimeout(r, intervalSeconds * 1_000));
        continue;
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
      
      console.log(
        `⏰ ${new Date().toLocaleTimeString().padEnd(8)} │ ` +
        `$${totalUsd.toFixed(2).padStart(8)} │ ` +
        `${pnlColor}${pnlSign}$${Math.abs(currentPnL).toFixed(2).padStart(6)} │ ` +
        `${pnlPercentSign}${pnlPercentage.toFixed(1).padStart(6)}% │ ` +
        `$${totalFeesEarnedUsd.toFixed(2).padStart(7)} │ ` +
        `${rebalanceCount.toString().padStart(5)} │ ` +
        `${tpIcon}${tpText} ${slIcon}${slText} ${tsIcon}${tsText}`
      );

    } catch (err) {
      console.error('Error during monitor tick:', err?.message ?? err);
    }

    await new Promise(r => setTimeout(r, intervalSeconds * 1_000));
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

    if (swaplessConfig.enabled) {
      console.log(`✅ Swapless rebalancing enabled with ${swaplessConfig.binSpan} bin span`);
    } else {
      console.log('✅ Normal rebalancing enabled (maintains token ratios with swaps)');
    }
    
    // 💰 Prompt for auto-compound settings
    console.log('💰 Configuring fee compounding...');
    
    const autoCompoundConfig = await promptAutoCompound();
    
    if (autoCompoundConfig === null) {
      console.log('❌ Operation cancelled.');
      process.exit(0);
    }

    if (autoCompoundConfig.enabled) {
      console.log('✅ Auto-compounding enabled - fees will be reinvested automatically');
    } else {
      console.log('✅ Auto-compounding disabled - fees kept separate from position');
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
    
    // 1️⃣ Open initial position
    const {
      dlmmPool: finalPool,
      initialCapitalUsd,
      positionPubKey,
      openFeeLamports
    } = await openDlmmPosition(connection, userKeypair, solAmount, tokenRatio, binSpanInfo.binSpan, poolAddress, liquidityStrategy);
  
    if (!finalPool || !positionPubKey) {
      console.error("Failed to open position – aborting.");
      process.exit(1);
    }
  
    // 2️⃣ Start monitoring & rebalancing with original parameters
    const originalParams = {
      solAmount,
      tokenRatio,
      binSpan: binSpanInfo.binSpan,
      poolAddress,
      liquidityStrategy,
      swaplessConfig,
      autoCompoundConfig,
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
      initialCapitalUsd,
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