// ───────────────────────────────────────────────
// ~/main.js
// ───────────────────────────────────────────────
import BN from 'bn.js';
import { loadWalletKeypair, getMintDecimals, safeGetBalance } from './lib/solana.js';
import { openDlmmPosition, recenterPosition } from './lib/dlmm.js';
import 'dotenv/config';
import { getPrice } from './lib/price.js';
import { promptSolAmount, promptTokenRatio, promptBinSpan, promptPoolAddress, promptLiquidityStrategy, promptSwaplessRebalance, promptAutoCompound, promptTakeProfitStopLoss } from './balance-prompt.js';
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
  const PRIORITY_FEE_MICRO_LAMPORTS = 50_000;
  
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
  const { safeGetBalance } = await import('./lib/solana.js');
  const { getJupiterSwapQuote, executeJupiterSwap } = await import('./lib/jupiter.js');
  
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
  
  console.log(`   🔍 Pool tokens: SOL and ${altTokenMint.substring(0, 8)}...`);
  
  // Get balance of the alt token
  const altTokenBalance = await safeGetBalance(connection, altTokenMint, userKeypair.publicKey);
  
  if (altTokenBalance <= 0.0001) {
    console.log(`   ℹ️  Alt token balance too low (${altTokenBalance}) - skipping swap`);
    return;
  }
  
  console.log(`   🔄 Swapping ${altTokenBalance} alt tokens to SOL...`);
  
  try {
    // Get token decimals for proper amount calculation
    const { getMintDecimals } = await import('./lib/solana.js');
    const decimals = await getMintDecimals(connection, altTokenMint);
    const swapAmount = Math.floor(altTokenBalance * 0.99 * (10 ** decimals));
    
    const quote = await getJupiterSwapQuote(
      altTokenMint,
      SOL_MINT,
      swapAmount,
      1 // 1% slippage
    );
    
    if (quote && quote.outAmount > 0) {
      await executeJupiterSwap(connection, userKeypair, quote);
      console.log(`     ✅ Swapped alt tokens to SOL successfully`);
    } else {
      console.log(`     ⚠️  Could not get valid swap quote`);
    }
  } catch (swapError) {
    console.log(`     ⚠️  Could not swap alt tokens: ${swapError.message}`);
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
  console.log(`Rebalancing logic: Only triggers when price moves outside position range`);
  
  // P&L Tracking Variables
  let totalFeesEarnedUsd = 0;
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

  /* ─── 3. heading ────────────────────────────────────────────────── */
  console.log(
    "Time         | Total($)  | P&L($)   | P&L(%)   | Fees($)  | Rebalances | TP/SL Status"
  );

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
      
      // 🔧 SIMPLIFIED P&L: Position + fees only (swapless rebalancing already includes everything)
      const totalUsd = liqUsd + feesUsd;

      /* 4-C rebalance if ACTUALLY AT position edges ------------------- */
      const lowerBin = pos.positionData.lowerBinId;
      const upperBin = pos.positionData.upperBinId;
      const activeBinId = activeBin.binId;

      // Check if price moved COMPLETELY OUTSIDE position range 
      const outsideLowerRange = activeBinId < lowerBin;
      const outsideUpperRange = activeBinId > upperBin;
      
      console.log(`📊 Position Status: Active bin ${activeBinId}, Range: ${lowerBin} to ${upperBin}`);
      
      if (outsideLowerRange) {
        console.log(`   ⬇️  Price moved BELOW position range (${activeBinId} < ${lowerBin})`);
      } else if (outsideUpperRange) {
        console.log(`   ⬆️  Price moved ABOVE position range (${activeBinId} > ${upperBin})`);
      } else {
        const binsFromLower = activeBinId - lowerBin;
        const binsFromUpper = upperBin - activeBinId;
        console.log(`   ✅ Price within range (${binsFromLower} bins from lower, ${binsFromUpper} bins from upper)`);
      }

      if (outsideLowerRange || outsideUpperRange) {
        const direction = outsideLowerRange ? 'BELOW' : 'ABOVE';
        
        console.log(`🔄 REBALANCING TRIGGERED: Price moved ${direction} position range!`);
        console.log(`   Active bin: ${activeBinId}, Position range: ${lowerBin} to ${upperBin}`);

        // Determine rebalance direction for swapless mode
        const rebalanceDirection = outsideLowerRange ? 'DOWN' : 'UP';
        const res = await recenterPosition(connection, dlmmPool, userKeypair, positionPubKey, originalParams, rebalanceDirection);
        if (!res) break;

        dlmmPool        = res.dlmmPool;
        positionPubKey  = res.positionPubKey;
        
        // Update P&L tracking
        totalFeesEarnedUsd += res.feesEarnedUsd || 0;
        rebalanceCount += 1;
        
        console.log(`✅ Rebalancing complete - resuming monitoring every ${intervalSeconds}s`);
        console.log(`📈 P&L Update: Total fees earned: $${totalFeesEarnedUsd.toFixed(4)}, Rebalances: ${rebalanceCount}`);
        
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
          const newFeesUsd = newFeeAmtX * (pxX || 0) + newFeeAmtY * (pxY || 0);
          
          // 🔧 SIMPLIFIED P&L: Position + fees only (swapless rebalancing already includes everything)
          const totalUsd = newLiqUsd + newFeesUsd;
          
          // Calculate P&L metrics with UPDATED position value + wallet value
          const currentPnL = totalUsd - initialCapitalUsd;
          const pnlPercentage = ((currentPnL / initialCapitalUsd) * 100);
          
          // Show TP/SL status in rebalance display
          const tpStatus = originalParams.takeProfitEnabled ? `TP:+${originalParams.takeProfitPercentage}%` : 'TP:OFF';
          const slStatus = originalParams.stopLossEnabled ? `SL:-${originalParams.stopLossPercentage}%` : 'SL:OFF';
          
          console.log(
            `${new Date().toLocaleTimeString()} | ` +
            `${totalUsd.toFixed(2).padStart(8)} | ` +
            `${currentPnL >= 0 ? '+' : ''}${currentPnL.toFixed(2).padStart(7)} | ` +
            `${pnlPercentage >= 0 ? '+' : ''}${pnlPercentage.toFixed(1).padStart(6)}% | ` +
            `${totalFeesEarnedUsd.toFixed(2).padStart(7)} | ` +
            `${rebalanceCount.toString().padStart(9)} | ` +
            `${tpStatus} | ${slStatus}`
          );
        }
        
        // Skip normal P&L calculation since we already did it above
        await new Promise(r => setTimeout(r, intervalSeconds * 1_000));
        continue;
      }

      // Calculate P&L metrics (for normal monitoring cycles)
      const currentPnL = totalUsd - initialCapitalUsd;
      const pnlPercentage = ((currentPnL / initialCapitalUsd) * 100);
      
      // Show TP/SL status in display
      const tpStatus = originalParams.takeProfitEnabled ? `TP:+${originalParams.takeProfitPercentage}%` : 'TP:OFF';
      const slStatus = originalParams.stopLossEnabled ? `SL:-${originalParams.stopLossPercentage}%` : 'SL:OFF';
      
      console.log(
        `${new Date().toLocaleTimeString()} | ` +
        `${totalUsd.toFixed(2).padStart(8)} | ` +
        `${currentPnL >= 0 ? '+' : ''}${currentPnL.toFixed(2).padStart(7)} | ` +
        `${pnlPercentage >= 0 ? '+' : ''}${pnlPercentage.toFixed(1).padStart(6)}% | ` +
        `${totalFeesEarnedUsd.toFixed(2).padStart(7)} | ` +
        `${rebalanceCount.toString().padStart(9)} | ` +
        `${tpStatus} | ${slStatus}`
      );

      // 🎯 TAKE PROFIT & STOP LOSS CHECK
      if ((originalParams.takeProfitEnabled || originalParams.stopLossEnabled) && !isNaN(pnlPercentage)) {
        let shouldClose = false;
        let closeReason = '';
        
        // Check Take Profit
        if (originalParams.takeProfitEnabled && pnlPercentage >= originalParams.takeProfitPercentage) {
          shouldClose = true;
          closeReason = `🎯 TAKE PROFIT triggered at +${pnlPercentage.toFixed(1)}% (target: +${originalParams.takeProfitPercentage}%)`;
        }
        
        // Check Stop Loss  
        if (originalParams.stopLossEnabled && pnlPercentage <= -originalParams.stopLossPercentage) {
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

    } catch (err) {
      console.error('Error during monitor tick:', err?.message ?? err);
    }

    await new Promise(r => setTimeout(r, intervalSeconds * 1_000));
  }

  console.log('Monitoring ended.');
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
    
    // Calculate bin distribution for display
    const binsForSOL = Math.floor(binSpanInfo.binSpan * tokenRatio.ratioX);
    const binsForToken = Math.floor(binSpanInfo.binSpan * (1 - tokenRatio.ratioX));
    const solCoverage = (binsForSOL * binStep / 100).toFixed(2);
    const tokenCoverage = (binsForToken * binStep / 100).toFixed(2);
    
    console.log('');
    console.log('📍 Position Configuration Summary:');
    console.log('==================================');
    console.log(`💰 Capital: ${solAmount.toFixed(6)} SOL`);
    console.log(`⚖️  Ratio: ${(tokenRatio.ratioX * 100).toFixed(1)}% ${poolInfo.tokenXSymbol} / ${(tokenRatio.ratioY * 100).toFixed(1)}% ${poolInfo.tokenYSymbol}`);
    console.log(`📊 Bin Span: ${binSpanInfo.binSpan} bins (${binSpanInfo.coverage}% total coverage)`);
    console.log(`   - ${poolInfo.tokenXSymbol} Bins: ${binsForSOL} bins below active price (-${solCoverage}% range)`);
    console.log(`   - ${poolInfo.tokenYSymbol} Bins: ${binsForToken} bins above active price (+${tokenCoverage}% range)`);
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
      stopLossPercentage: tpslConfig.stopLossPercentage
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