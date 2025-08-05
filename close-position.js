// ───────────────────────────────────────────────
// ~/close-position.js - Standalone position closer
// ───────────────────────────────────────────────
import 'dotenv/config';
import BN from 'bn.js';
import { Connection, PublicKey, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { loadWalletKeypair, unwrapWSOL } from './lib/solana.js';
import { withRetry } from './lib/retry.js';
import dlmmPackage from '@meteora-ag/dlmm';

const DLMM = dlmmPackage.default ?? dlmmPackage;
const PRIORITY_FEE_MICRO_LAMPORTS = Number(process.env.PRIORITY_FEE_MICRO_LAMPORTS || 50_000);

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
    
    // Check final balance
    const finalBalance = await connection.getBalance(userKeypair.publicKey);
    console.log('');
    console.log('🎉 All positions closed successfully!');
    console.log('Final wallet balance:', finalBalance / 1e9, 'SOL');
    
  } catch (error) {
    console.error('❌ Error closing positions:', error.message);
  }
}

// Run the close function
closeAllPositions();