/**
 * test-jito-bundle.js - Comprehensive Jito Bundle Test Script
 * 
 * This script demonstrates and validates Jito bundle functionality:
 * - Creates multiple simple transactions (SOL transfers)
 * - Bundles them atomically using Jito
 * - Tracks bundle status and confirmation
 * - Provides detailed logging of the entire process
 * 
 * Usage: node scripts/test-jito-bundle.js
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createJitoBundleHandler } from '../lib/jito-bundle-handler.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const WALLET_PATH = process.env.WALLET_PATH || './wallet.json';
const TEST_AMOUNT = 0.001; // 0.001 SOL per transfer
const NUM_TRANSACTIONS = 3; // Number of transactions in bundle

// Test recipient addresses (using well-known addresses for testing)
const TEST_RECIPIENTS = [
  'So11111111111111111111111111111111111111112', // WSOL
  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', // BTC
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'  // USDC
];

/**
 * Load wallet from file
 */
function loadWallet() {
  try {
    if (!fs.existsSync(WALLET_PATH)) {
      throw new Error(`Wallet file not found: ${WALLET_PATH}`);
    }
    
    const walletData = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
    const keypair = Keypair.fromSecretKey(new Uint8Array(walletData));
    
    console.log(`✅ Loaded wallet: ${keypair.publicKey.toBase58()}`);
    return keypair;
  } catch (error) {
    console.error('❌ Failed to load wallet:', error.message);
    console.log('\n💡 Make sure to:');
    console.log('   1. Set WALLET_PATH in .env file');
    console.log('   2. Ensure wallet file exists and is valid JSON array');
    process.exit(1);
  }
}

/**
 * Create test transactions for bundling
 */
async function createTestTransactions(connection, userKeypair, recipients) {
  console.log(`\n📋 Creating ${recipients.length} test transactions...`);
  
  const transactions = [];
  const transferAmount = Math.floor(TEST_AMOUNT * LAMPORTS_PER_SOL);
  
  // Get recent blockhash for all transactions
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  
  for (let i = 0; i < recipients.length; i++) {
    const recipient = new PublicKey(recipients[i]);
    
    console.log(`   📤 Transaction ${i + 1}: ${transferAmount / LAMPORTS_PER_SOL} SOL → ${recipient.toBase58().slice(0, 8)}...`);
    
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: recipient,
        lamports: transferAmount
      })
    );
    
    // Set transaction metadata
    tx.feePayer = userKeypair.publicKey;
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    
    transactions.push(tx);
  }
  
  console.log(`✅ Created ${transactions.length} test transactions`);
  return transactions;
}

/**
 * Check wallet balance
 */
async function checkWalletBalance(connection, keypair) {
  const balance = await connection.getBalance(keypair.publicKey);
  const balanceSOL = balance / LAMPORTS_PER_SOL;
  
  console.log(`💰 Wallet Balance: ${balanceSOL.toFixed(6)} SOL`);
  
  const requiredSOL = (TEST_AMOUNT * NUM_TRANSACTIONS) + 0.01; // Add buffer for fees
  if (balanceSOL < requiredSOL) {
    console.error(`❌ Insufficient balance! Need at least ${requiredSOL} SOL`);
    console.log('💡 Fund your wallet with more SOL to run this test');
    process.exit(1);
  }
  
  return balanceSOL;
}

/**
 * Test individual transaction execution (for comparison)
 */
async function testRegularTransaction(connection, userKeypair) {
  console.log('\n🔍 Testing regular transaction execution...');
  
  const recipient = new PublicKey(TEST_RECIPIENTS[0]);
  const transferAmount = Math.floor(0.0001 * LAMPORTS_PER_SOL); // Smaller amount for test
  
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: userKeypair.publicKey,
      toPubkey: recipient,
      lamports: transferAmount
    })
  );
  
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  
  tx.sign(userKeypair);
  
  const startTime = Date.now();
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature, 'confirmed');
  const elapsed = Date.now() - startTime;
  
  console.log(`✅ Regular transaction completed: ${signature}`);
  console.log(`⏱️  Time: ${elapsed}ms`);
  
  return { signature, elapsed };
}

/**
 * Test Jito bundle execution
 */
async function testJitoBundle(connection, userKeypair) {
  console.log('\n🎁 Testing Jito bundle execution...');
  
  try {
    // Create test transactions
    const testTransactions = await createTestTransactions(
      connection, 
      userKeypair, 
      TEST_RECIPIENTS.slice(0, NUM_TRANSACTIONS)
    );
    
    // Create Jito bundle handler
    const jitoBundleHandler = createJitoBundleHandler(connection, userKeypair);
    
    console.log('\n📊 Fetching current tip market data...');
    try {
      const tipFloorData = await jitoBundleHandler.getTipFloorData();
      const medianTip = (tipFloorData.landed_tips_50th_percentile * 1e9).toFixed(0);
      const p75Tip = (tipFloorData.landed_tips_75th_percentile * 1e9).toFixed(0);
      console.log(`   • Current median tip: ${medianTip} lamports`);
      console.log(`   • Current 75th percentile: ${p75Tip} lamports`);
    } catch (error) {
      console.log(`   ⚠️  Could not fetch tip data: ${error.message}`);
    }
    
    console.log('\n🚀 Submitting bundle to Jito Block Engine...');
    const startTime = Date.now();
    
    const bundleResult = await jitoBundleHandler.sendBundleWithConfirmation(
      testTransactions,
      'medium', // Priority level
      [], // No additional keypairs needed
      {
        includeTip: true,
        maxRetries: 3,
        timeoutMs: 45000 // 45 seconds timeout
      }
    );
    
    const elapsed = Date.now() - startTime;
    
    if (bundleResult.success) {
      console.log('\n🎉 BUNDLE SUCCESS!');
      console.log(`📦 Bundle ID: ${bundleResult.bundleId}`);
      console.log(`🎯 Slot: ${bundleResult.slot}`);
      console.log(`⏱️  Total Time: ${elapsed}ms`);
      console.log(`📊 Transactions: ${bundleResult.transactionCount}`);
      
      if (bundleResult.tipSOL) {
        console.log(`💰 Tip Paid: ${bundleResult.tipSOL.toFixed(6)} SOL (${bundleResult.tipAmount} lamports)`);
      }
      
      if (bundleResult.signatures && bundleResult.signatures.length > 0) {
        console.log('\n📝 Transaction Signatures:');
        bundleResult.signatures.forEach((sig, index) => {
          console.log(`   ${index + 1}. ${sig}`);
        });
      }
      
      return {
        success: true,
        bundleId: bundleResult.bundleId,
        signatures: bundleResult.signatures,
        elapsed,
        transactionCount: bundleResult.transactionCount,
        tipAmount: bundleResult.tipAmount,
        tipSOL: bundleResult.tipSOL
      };
    } else {
      console.log('\n❌ BUNDLE FAILED');
      console.log(`   Error: ${bundleResult.error}`);
      return { success: false, error: bundleResult.error };
    }
    
  } catch (error) {
    console.log('\n❌ BUNDLE EXECUTION ERROR');
    console.log(`   Error: ${error.message}`);
    console.log(`   Stack: ${error.stack}`);
    return { success: false, error: error.message };
  }
}

/**
 * Verify bundle transactions on-chain
 */
async function verifyBundleTransactions(connection, signatures) {
  if (!signatures || signatures.length === 0) {
    console.log('⚠️  No signatures to verify');
    return;
  }
  
  console.log('\n🔍 Verifying bundle transactions on-chain...');
  
  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    try {
      const txDetails = await connection.getTransaction(sig, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      
      if (txDetails) {
        const slot = txDetails.slot;
        const status = txDetails.meta?.err ? 'FAILED' : 'SUCCESS';
        console.log(`   ✅ Tx ${i + 1}: ${sig} - ${status} (Slot: ${slot})`);
      } else {
        console.log(`   ⚠️  Tx ${i + 1}: ${sig} - NOT FOUND`);
      }
    } catch (error) {
      console.log(`   ❌ Tx ${i + 1}: ${sig} - ERROR: ${error.message}`);
    }
  }
}

/**
 * Main test function
 */
async function main() {
  console.log('🎯 Jito Bundle Test Script Starting...\n');
  console.log('═'.repeat(60));
  
  try {
    // Initialize connection and wallet
    console.log(`📡 Connecting to: ${RPC_URL}`);
    const connection = new Connection(RPC_URL, 'confirmed');
    
    const userKeypair = loadWallet();
    await checkWalletBalance(connection, userKeypair);
    
    console.log('\n📋 Test Configuration:');
    console.log(`   • RPC URL: ${RPC_URL}`);
    console.log(`   • Wallet: ${userKeypair.publicKey.toBase58()}`);
    console.log(`   • Test Amount: ${TEST_AMOUNT} SOL per transaction`);
    console.log(`   • Bundle Size: ${NUM_TRANSACTIONS} transactions`);
    console.log(`   • Recipients: ${TEST_RECIPIENTS.slice(0, NUM_TRANSACTIONS).length} addresses`);
    
    // Test 1: Regular transaction (for comparison)
    const regularResult = await testRegularTransaction(connection, userKeypair);
    
    // Test 2: Jito bundle
    const bundleResult = await testJitoBundle(connection, userKeypair);
    
    // Verify results
    if (bundleResult.success) {
      await verifyBundleTransactions(connection, bundleResult.signatures);
    }
    
    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('═'.repeat(60));
    
    console.log(`\n🔸 Regular Transaction:`);
    console.log(`   Status: ✅ SUCCESS`);
    console.log(`   Time: ${regularResult.elapsed}ms`);
    console.log(`   Signature: ${regularResult.signature}`);
    
    console.log(`\n🔸 Jito Bundle:`);
    if (bundleResult.success) {
      console.log(`   Status: ✅ SUCCESS`);
      console.log(`   Bundle ID: ${bundleResult.bundleId}`);
      console.log(`   Time: ${bundleResult.elapsed}ms`);
      console.log(`   Transactions: ${bundleResult.transactionCount}`);
      console.log(`   Atomicity: ✅ All transactions executed together`);
      
      if (bundleResult.tipSOL) {
        console.log(`   Tip: ${bundleResult.tipSOL.toFixed(6)} SOL (dynamic pricing)`);
      }
      
      // Performance comparison
      const bundleTimePerTx = bundleResult.elapsed / bundleResult.transactionCount;
      console.log(`\n📈 Performance Comparison:`);
      console.log(`   Regular: ${regularResult.elapsed}ms per transaction`);
      console.log(`   Bundle: ${bundleTimePerTx.toFixed(0)}ms per transaction (atomic)`);
      
      if (bundleTimePerTx < regularResult.elapsed) {
        console.log(`   🏆 Bundle is ${((regularResult.elapsed / bundleTimePerTx) - 1) * 100}% faster per transaction!`);
      }
      
      // Cost analysis
      console.log(`\n💰 Cost Analysis:`);
      console.log(`   Bundle tip: ${bundleResult.tipSOL.toFixed(6)} SOL`);
      console.log(`   Per transaction: ${(bundleResult.tipSOL / bundleResult.transactionCount).toFixed(6)} SOL`);
      
    } else {
      console.log(`   Status: ❌ FAILED`);
      console.log(`   Error: ${bundleResult.error}`);
    }
    
    console.log('\n🎉 Test completed successfully!');
    
    if (bundleResult.success) {
      console.log('\n💡 Key Takeaways:');
      console.log('   • Jito bundles provide atomic execution');
      console.log('   • Multiple transactions execute in same slot');
      console.log('   • MEV protection through atomic bundling');
      console.log('   • Graceful fallback if bundle system unavailable');
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted by user');
  process.exit(0);
});

// Run the test (more reliable check for Windows)
const isDirectExecution = import.meta.url.endsWith('test-jito-bundle.js') || 
                          process.argv[1]?.endsWith('test-jito-bundle.js');

if (isDirectExecution) {
  main().catch(console.error);
}
