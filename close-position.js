// ───────────────────────────────────────────────
// ~/close-position.js - Standalone position closer
// ───────────────────────────────────────────────
import 'dotenv/config';
import BN from 'bn.js';
import { Connection, PublicKey, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { loadWalletKeypair, unwrapWSOL, safeGetBalance, getMintDecimals } from './lib/solana.js';
import { withRetry } from './lib/retry.js';
import { swapTokensUltra } from './lib/jupiter.js';
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
    
    // Execute Ultra API swap
    const sig = await swapTokensUltra(
      tokenToSwap,        // input mint (non-SOL token)
      SOL_MINT,          // output mint (SOL)
      BigInt(swapBalance.toString()),  // amount to swap (all of it)
      userKeypair,
      connection,
      dlmmPool,
      SLIPPAGE_BPS,
      20,
      PRICE_IMPACT_PCT
    );
    
    if (sig) {
      console.log(`✅ Ultra API swap completed! Signature: ${sig}`);
    } else {
      console.log('❌ Ultra API swap failed');
    }
    
  } catch (error) {
    console.error('❌ Error during token swap:', error.message);
    console.log('⚠️  Continuing without swap...');
  }
}

async function closeAllPositions() {
  try {
    console.log('🔄 Starting position closure...');
    
    // Check environment variables
    if (!process.env.RPC_URL) {
      throw new Error('RPC_URL not found in environment variables');
    }
    if (!process.env.WALLET_PATH) {
      throw new Error('WALLET_PATH not found in environment variables');
    }
    
    console.log('✅ Environment variables loaded successfully');
    console.log(`🌐 RPC URL: ${process.env.RPC_URL.substring(0, 50)}...`);
    console.log(`💳 Wallet: ${process.env.WALLET_PATH}`);
    
    const connection = new Connection(process.env.RPC_URL, 'confirmed');
    const userKeypair = loadWalletKeypair(process.env.WALLET_PATH);
    
    // 🔧 FIX: Get ALL positions across ALL pools (not just one specific pool)
    console.log('🔍 Searching for ALL positions across ALL DLMM pools...');
    console.log('🔍 User wallet:', userKeypair.publicKey.toBase58());
    
    // Use the correct DLMM SDK function to get all user positions across all pools
    const allPositionsMap = await DLMM.getAllLbPairPositionsByUser(connection, userKeypair.publicKey);
    
    console.log(`🔍 Found ${allPositionsMap.size} pools with positions`);
    
    // Convert the Map to an array of all positions
    let allPositions = [];
    let poolCount = 0;
    for (const [poolAddress, positionsInfo] of allPositionsMap.entries()) {
      poolCount++;
      console.log(`🏊 Pool ${poolCount}: ${poolAddress}`);
      
      // 🔧 FIX: Handle different possible data structures safely
      let userPositions = [];
      if (positionsInfo && positionsInfo.userPositions && Array.isArray(positionsInfo.userPositions)) {
        userPositions = positionsInfo.userPositions;
        console.log(`   📍 Found positions in userPositions array`);
      } else if (positionsInfo && positionsInfo.lbPairPositionsData && Array.isArray(positionsInfo.lbPairPositionsData)) {
        // SDK returns positions in lbPairPositionsData array
        userPositions = positionsInfo.lbPairPositionsData;
        console.log(`   📍 Found positions in lbPairPositionsData array`);
      } else if (Array.isArray(positionsInfo)) {
        // Sometimes the SDK might return positions directly as an array
        userPositions = positionsInfo;
        console.log(`   📍 Found positions as direct array`);
      } else {
        console.log(`   ⚠️  Unexpected structure for pool ${poolAddress}:`, positionsInfo);
        console.log(`   🔍 Available keys:`, Object.keys(positionsInfo || {}));
        continue;
      }
      
      console.log(`   └─ ${userPositions.length} position(s)`);
      
      // Add pool info to each position for later reference
      userPositions.forEach(pos => {
        pos.poolAddress = poolAddress;
        pos.dlmmPoolInfo = positionsInfo;
      });
      
      allPositions.push(...userPositions);
    }
    
    console.log(`📊 Total positions found: ${allPositions.length}`);
    
    if (allPositions.length === 0) {
      console.log('❌ No DLMM positions found for this wallet');
      console.log('💡 This means either:');
      console.log('   - You have no active DLMM positions');
      console.log('   - The bot hasn\'t created any positions yet');
      console.log('   - RPC data might be delayed');
      return;
    }
    
    console.log(`📋 Found ${allPositions.length} position(s) to close across ${poolCount} pool(s)`);
    
    // Close each position using the working logic from recenterPosition
    for (let i = 0; i < allPositions.length; i++) {
      const position = allPositions[i];
      console.log(`\n🔄 Closing position ${i + 1}/${allPositions.length}:`);
      console.log(`   Position: ${position.publicKey.toBase58()}`);
      console.log(`   Pool: ${position.poolAddress}`);
      
      // Create DLMM instance for this specific pool
      const poolPK = new PublicKey(position.poolAddress);
      const dlmmPool = await DLMM.create(connection, poolPK);
      
      await withRetry(async () => {
        // This is the working close logic from recenterPosition
        const removeTxs = await dlmmPool.removeLiquidity({
          position:            position.publicKey,
          user:                userKeypair.publicKey,
          fromBinId:           position.positionData.lowerBinId,
          toBinId:             position.positionData.upperBinId,
          bps:                 new BN(10_000), // 100% removal
          shouldClaimAndClose: true,
        });
        
        // 🔧 FIX: Handle multiple transactions for extended positions
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
          console.log(`      ✅ Close transaction ${i + 1}/${removeTxs.length} completed: ${sig}`);
        }
        
        await unwrapWSOL(connection, userKeypair);       // keep SOL as native
        console.log(`   ✅ Position fully closed with ${removeTxs.length} transaction(s)`);
        
      }, 'closePosition');
      
      // Swap any remaining tokens to SOL for this pool
      console.log(`   🔄 Swapping remaining tokens from pool ${position.poolAddress.substring(0, 8)}...`);
      await swapAllToSol(connection, userKeypair, dlmmPool);
    }
    
    console.log('\n🔄 Final cleanup - checking for any remaining tokens to swap to SOL...');
    
    // 🔧 ENHANCEMENT: Final comprehensive token cleanup
    // Check all token accounts and swap any non-SOL tokens to SOL
    try {
      const tokenAccounts = await connection.getTokenAccountsByOwner(userKeypair.publicKey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      });

      for (const tokenAccountInfo of tokenAccounts.value) {
        const tokenAccount = tokenAccountInfo.account;
        const tokenBalance = tokenAccount.data.parsed?.info?.tokenAmount?.uiAmount || 0;
        const mintAddress = tokenAccount.data.parsed?.info?.mint;
        
        // Skip if balance is 0 or very small, or if it's wrapped SOL (we handle that separately)
        if (tokenBalance < 0.0001 || mintAddress === 'So11111111111111111111111111111111111111112') {
          continue;
        }
        
        console.log(`   🔄 Found ${tokenBalance} of token ${mintAddress.substring(0, 8)}... - swapping to SOL`);
        
        try {
          // Execute Ultra API swap
          const swapAmount = Math.floor(tokenBalance * (10 ** (tokenAccount.data.parsed?.info?.tokenAmount?.decimals || 9)));
          const signature = await swapTokensUltra(
            mintAddress,
            'So11111111111111111111111111111111111111112', // SOL
            BigInt(swapAmount),
            userKeypair,
            connection,
            null,
            100, // 1% slippage in bps
            20,
            1.0 // 1% price impact
          );
          
          if (signature) {
            console.log(`     ✅ Ultra API swap to SOL successful`);
          } else {
            console.log(`     ⚠️  Ultra API swap failed for ${mintAddress.substring(0, 8)}...`);
          }
        } catch (swapError) {
          console.log(`     ⚠️  Could not swap ${mintAddress.substring(0, 8)}...: ${swapError.message}`);
        }
      }
    } catch (error) {
      console.log(`   ⚠️  Error during final token cleanup: ${error.message}`);
    }
    
    // Check final balance after potential swaps
    await unwrapWSOL(connection, userKeypair); // Unwrap any WSOL to native SOL
    const finalBalance = await connection.getBalance(userKeypair.publicKey);
    console.log('');
    console.log('🎉 All positions closed and tokens swapped to SOL!');
    console.log('💰 Final SOL balance:', (finalBalance / 1e9).toFixed(6), 'SOL');
    
  } catch (error) {
    console.error('❌ DEBUG: Error in closeAllPositions():', error.message);
    console.error('❌ DEBUG: Full error:', error);
    console.error('❌ DEBUG: Stack trace:', error.stack);
  }
}

// Export the function for CLI use
export { closeAllPositions };

// Run the close function only if this file is executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                    import.meta.url.endsWith('close-position.js') && process.argv[1] && process.argv[1].endsWith('close-position.js');

if (isMainModule) {
  closeAllPositions().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });
}