// ───────────────────────────────────────────────
// ~/close-position.js - Standalone position closer
// ───────────────────────────────────────────────
import 'dotenv/config';
import BN from 'bn.js';
import { Connection, PublicKey, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { loadWalletKeypair, unwrapWSOL, safeGetBalance, getMintDecimals } from './lib/solana.js';
import { withRetry } from './lib/retry.js';
import { getSwapQuote, executeSwap } from './lib/jupiter.js';
import { getPrice } from './lib/price.js';
import dlmmPackage from '@meteora-ag/dlmm';

const DLMM = dlmmPackage.default ?? dlmmPackage;
const PRIORITY_FEE_MICRO_LAMPORTS = Number(process.env.PRIORITY_FEE_MICRO_LAMPORTS || 50_000);
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE || 10);
const PRICE_IMPACT_PCT = Number(process.env.PRICE_IMPACT || 0.5);

async function swapAllToSol(connection, userKeypair, dlmmPool) {
  console.log('💱 Checking for remaining tokens to swap to SOL...');
  
  try {
    const tokenXMint = dlmmPool.tokenX.publicKey.toString();
    const tokenYMint = dlmmPool.tokenY.publicKey.toString();
    
    // Ensure decimals are available
    if (typeof dlmmPool.tokenX.decimal !== 'number') {
      dlmmPool.tokenX.decimal = await getMintDecimals(connection, dlmmPool.tokenX.publicKey);
    }
    if (typeof dlmmPool.tokenY.decimal !== 'number') {
      dlmmPool.tokenY.decimal = await getMintDecimals(connection, dlmmPool.tokenY.publicKey);
    }
    
    const balanceX = await safeGetBalance(connection, dlmmPool.tokenX.publicKey, userKeypair.publicKey);
    const balanceY = await safeGetBalance(connection, dlmmPool.tokenY.publicKey, userKeypair.publicKey);
    
    const dx = dlmmPool.tokenX.decimal;
    const dy = dlmmPool.tokenY.decimal;
    
    console.log(`Token X balance: ${balanceX.toNumber() / 10 ** dx} (${tokenXMint === SOL_MINT ? 'SOL' : tokenXMint.slice(0, 6)}...)`);
    console.log(`Token Y balance: ${balanceY.toNumber() / 10 ** dy} (${tokenYMint === SOL_MINT ? 'SOL' : tokenYMint.slice(0, 6)}...)`);
    
    // Determine which token is NOT SOL and swap it
    let tokenToSwap = null;
    let swapBalance = null;
    let swapDecimals = null;
    
    if (tokenXMint !== SOL_MINT && balanceX.gt(new BN(0))) {
      tokenToSwap = tokenXMint;
      swapBalance = balanceX;
      swapDecimals = dx;
      console.log(`📊 Found ${swapBalance.toNumber() / 10 ** swapDecimals} non-SOL tokens (X) to swap`);
    } else if (tokenYMint !== SOL_MINT && balanceY.gt(new BN(0))) {
      tokenToSwap = tokenYMint;
      swapBalance = balanceY;
      swapDecimals = dy;
      console.log(`📊 Found ${swapBalance.toNumber() / 10 ** swapDecimals} non-SOL tokens (Y) to swap`);
    }
    
    if (!tokenToSwap || swapBalance.eq(new BN(0))) {
      console.log('✅ No non-SOL tokens found or all balances are zero - nothing to swap');
      return;
    }
    
    // Check if amount is worth swapping (avoid dust)
    const tokenPrice = await getPrice(tokenToSwap);
    const tokenAmount = swapBalance.toNumber() / 10 ** swapDecimals;
    const tokenValueUsd = tokenAmount * tokenPrice;
    
    console.log(`💰 Token value: $${tokenValueUsd.toFixed(4)} USD`);
    
    if (tokenValueUsd < 0.01) {
      console.log('⚠️  Token value too small ($0.01 minimum) - skipping swap to avoid fees');
      return;
    }
    
    console.log(`🔄 Swapping ${tokenAmount.toFixed(6)} tokens to SOL...`);
    
    // Get swap quote
    const quote = await getSwapQuote(
      tokenToSwap,        // input mint (non-SOL token)
      SOL_MINT,          // output mint (SOL)
      BigInt(swapBalance.toString()),  // amount to swap (all of it)
      SLIPPAGE_BPS,
      undefined,
      PRICE_IMPACT_PCT
    );
    
    if (!quote) {
      console.log('❌ Could not get swap quote - skipping swap');
      return;
    }
    
    console.log(`📈 Quote: ${tokenAmount.toFixed(6)} → ${(Number(quote.outAmount) / 1e9).toFixed(6)} SOL`);
    
    // Execute swap
    const sig = await executeSwap(quote, userKeypair, connection, dlmmPool);
    if (sig) {
      console.log(`✅ Swap completed! Signature: ${sig}`);
    } else {
      console.log('❌ Swap failed');
    }
    
  } catch (error) {
    console.error('❌ Error during token swap:', error.message);
    console.log('⚠️  Continuing without swap...');
  }
}

async function closeAllPositions() {
  try {
    console.log('🔄 Starting position closure...');
    
    const connection = new Connection(process.env.RPC_URL, 'confirmed');
    const userKeypair = loadWalletKeypair(process.env.WALLET_PATH);
    const poolPK = new PublicKey(process.env.POOL_ADDRESS);
    const dlmmPool = await DLMM.create(connection, poolPK);
    
    // Find all existing positions
    await dlmmPool.refetchStates();
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
    
    if (userPositions.length === 0) {
      console.log('❌ No positions found to close');
      return;
    }
    
    console.log(`Found ${userPositions.length} position(s) to close`);
    
    // Close each position using the working logic from recenterPosition
    for (const position of userPositions) {
      console.log(`Closing position: ${position.publicKey.toBase58()}`);
      
      await withRetry(async () => {
        // This is the working close logic from recenterPosition
        const closeResult = await dlmmPool.removeLiquidity({
          position:            position.publicKey,
          user:                userKeypair.publicKey,
          fromBinId:           position.positionData.lowerBinId,
          toBinId:             position.positionData.upperBinId,
          bps:                 new BN(10_000), // 100% removal
          shouldClaimAndClose: true,
        });
        
        // removeLiquidity returns an array with a Transaction
        const tx = closeResult[0];
        tx.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS })
        );
        tx.feePayer = userKeypair.publicKey;

        const recent = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash      = recent.blockhash;
        tx.lastValidBlockHeight = recent.lastValidBlockHeight;

        const sig = await sendAndConfirmTransaction(connection, tx, [userKeypair]);
        await unwrapWSOL(connection, userKeypair);       // keep SOL as native
        console.log(`✅ Closed position, signature: ${sig}`);
        
      }, 'closePosition');
    }
    
    // Swap any remaining tokens to SOL
    console.log('');
    await swapAllToSol(connection, userKeypair, dlmmPool);
    
    // Check final balance after potential swaps
    await unwrapWSOL(connection, userKeypair); // Unwrap any WSOL to native SOL
    const finalBalance = await connection.getBalance(userKeypair.publicKey);
    console.log('');
    console.log('🎉 All positions closed and tokens swapped to SOL!');
    console.log('💰 Final SOL balance:', (finalBalance / 1e9).toFixed(6), 'SOL');
    
  } catch (error) {
    console.error('❌ Error closing positions:', error.message);
  }
}

// Export the function for CLI use
export { closeAllPositions };

// Run the close function only if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  closeAllPositions();
}