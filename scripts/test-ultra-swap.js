#!/usr/bin/env node
// ───────────────────────────────────────────────
// ~/scripts/test-ultra-swap.js
// Comprehensive Jupiter Ultra API Swap Testing Script
// ───────────────────────────────────────────────

import { Connection, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { loadWalletKeypair, safeGetBalance } from '../lib/solana.js';
import fetch from 'node-fetch';
import BN from 'bn.js';
import readline from 'readline';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const WALLET_PATH = process.env.WALLET_PATH || '~/.config/solana/id.json';

// Common token mints
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

// Utility functions
function formatNumber(num, decimals = 6) {
  return (num / Math.pow(10, decimals)).toFixed(decimals);
}

async function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Ultra API Functions
async function getUltraOrder(inputMint, outputMint, amount, taker, maxAttempts = 20, priceImpact = 0.5) {
  console.log(`\n🔥 Jupiter Ultra API - Getting Order`);
  console.log(`   Input: ${inputMint}`);
  console.log(`   Output: ${outputMint}`);
  console.log(`   Amount: ${amount}`);
  console.log(`   Taker: ${taker}`);
  console.log(`   Max Price Impact: ${priceImpact}%`);

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      console.log(`\n⚡ Ultra API attempt ${attempt}/${maxAttempts}...`);
      
      const url = new URL('https://lite-api.jup.ag/ultra/v1/order');
      url.searchParams.set('inputMint', inputMint);
      url.searchParams.set('outputMint', outputMint);
      url.searchParams.set('amount', amount.toString());
      url.searchParams.set('taker', taker);
      
      console.log(`📡 Requesting: ${url.toString()}`);
      
      const response = await fetch(url.toString());
      console.log(`📨 Response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`❌ Ultra API HTTP error: ${errorText}`);
        throw new Error(`Ultra API failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const order = await response.json();
      console.log(`📋 Ultra API Response:`, JSON.stringify(order, null, 2));
      
      // Critical validation: Check for transaction field
      if (!order.transaction) {
        console.log(`❌ CRITICAL: Ultra API order missing transaction field`);
        console.log(`   This indicates Jupiter Ultra API backend issues`);
        console.log(`   Order structure: ${Object.keys(order).join(', ')}`);
        throw new Error('Ultra API returned order without transaction field - service issue');
      }
      
      console.log(`✅ Ultra API order validation passed:`);
      console.log(`   ✓ Has transaction: ${!!order.transaction}`);
      console.log(`   ✓ Swap type: ${order.swapType || 'N/A'}`);
      console.log(`   ✓ Router: ${order.router || 'N/A'}`);
      console.log(`   ✓ Input amount: ${order.inAmount}`);
      console.log(`   ✓ Output amount: ${order.outAmount}`);
      console.log(`   ✓ Slippage: ${order.slippageBps || 'N/A'} bps`);
      console.log(`   ✓ Price impact: ${order.priceImpactPct || 'N/A'}%`);
      console.log(`   ✓ Request ID: ${order.requestId || 'N/A'}`);
      
      const impact = Math.abs(Number(order.priceImpactPct || 0));
      console.log(`📊 Price impact check: ${impact.toFixed(5)}% vs ${priceImpact}% limit`);
      
      // Check if under our desired price impact
      if (impact < priceImpact) {
        console.log(`✅ Price impact acceptable - returning order`);
        return order;
      } else {
        console.log(`⚠️  Price impact (${impact.toFixed(5)}%) above ${priceImpact}% limit`);
        console.log(`   Retrying... (attempt ${attempt}/${maxAttempts})`);
      }
    } catch (error) {
      console.error(`❌ Ultra API error (attempt ${attempt}):`, error.message);
      if (attempt >= maxAttempts) {
        console.log(`💀 Reached max attempts (${maxAttempts}) - returning null`);
        return null;
      }
    }
    
    console.log(`⏳ Waiting 500ms before next attempt...`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  
  console.log(`💀 Max attempts reached. Price impact still above ${priceImpact}%. Returning null.`);
  return null;
}

async function executeUltraOrder(order, userKeypair, connection, maxAttempts = 20) {
  console.log(`\n🚀 Jupiter Ultra API - Executing Order`);
  console.log(`   Request ID: ${order.requestId || 'N/A'}`);
  console.log(`   Input amount: ${order.inAmount}`);
  console.log(`   Output amount: ${order.outAmount}`);

  let attempt = 0;
  
  while (attempt < maxAttempts) {
    attempt += 1;
    console.log(`\n⚡ Ultra execution attempt ${attempt}/${maxAttempts}`);
    
    try {
      if (!order.transaction) {
        throw new Error('No transaction in order response');
      }
      
      console.log(`🔧 Deserializing transaction...`);
      const transaction = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
      console.log(`✅ Transaction deserialized successfully`);
      
      console.log(`🕐 Getting fresh blockhash...`);
      const fresh = await connection.getLatestBlockhash('confirmed');
      console.log(`✅ Fresh blockhash: ${fresh.blockhash}`);
      console.log(`   Last valid block height: ${fresh.lastValidBlockHeight}`);
      
      transaction.message.recentBlockhash = fresh.blockhash;
      transaction.sign([userKeypair]);
      console.log(`✅ Transaction signed`);
      
      const signedTransaction = Buffer.from(transaction.serialize()).toString('base64');
      console.log(`✅ Transaction serialized for execution`);
      
      console.log(`📡 Executing Ultra API order...`);
      const executeResponse = await fetch('https://lite-api.jup.ag/ultra/v1/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signedTransaction: signedTransaction,
          requestId: order.requestId,
        }),
      });
      
      console.log(`📨 Execute response status: ${executeResponse.status}`);
      
      if (!executeResponse.ok) {
        const errorText = await executeResponse.text();
        console.log(`❌ Ultra execute HTTP error: ${errorText}`);
        throw new Error(`Ultra execute failed: ${executeResponse.status} - ${errorText}`);
      }
      
      const result = await executeResponse.json();
      console.log(`📋 Execute result:`, JSON.stringify(result, null, 2));
      
      if (result.status === "Success") {
        console.log(`🎉 Ultra API swap successful!`);
        console.log(`   ✅ Signature: ${result.signature}`);
        console.log(`   ✅ Input amount result: ${result.inputAmountResult || 'N/A'}`);
        console.log(`   ✅ Output amount result: ${result.outputAmountResult || 'N/A'}`);
        
        console.log(`⏳ Confirming transaction...`);
        await connection.confirmTransaction(
          {
            signature: result.signature,
            blockhash: fresh.blockhash,
            lastValidBlockHeight: fresh.lastValidBlockHeight,
          },
          'confirmed'
        );
        
        console.log(`🎯 Ultra swap confirmed & succeeded!`);
        console.log(`🔗 View transaction: https://solscan.io/tx/${result.signature}`);
        return result.signature;
      } else {
        console.log(`❌ Ultra API swap failed:`, JSON.stringify(result));
        throw new Error(`Ultra API swap failed: ${JSON.stringify(result)}`);
      }
      
    } catch (error) {
      console.error(`❌ Ultra execution error (attempt ${attempt}):`, error.message);
      
      if (attempt >= maxAttempts) {
        console.error(`💀 All Ultra execution attempts exhausted. Returning null.`);
        return null;
      }
      
      console.log(`⏳ Waiting 1000ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  
  return null;
}

// Main test function
async function testUltraSwap() {
  console.log(`\n🔥 Jupiter Ultra API Comprehensive Swap Test`);
  console.log(`=============================================`);

  try {
    console.log(`\n1️⃣ Setting up connection and wallet...`);
    const connection = new Connection(RPC_URL, 'confirmed');
    const wallet = loadWalletKeypair(WALLET_PATH);
    
    console.log(`✅ Connection: ${RPC_URL}`);
    console.log(`✅ Wallet: ${wallet.publicKey.toString()}`);

    console.log(`\n2️⃣ Checking wallet balance...`);
    const solBalance = await safeGetBalance(connection, new PublicKey(SOL_MINT), wallet.publicKey);
    const solUi = formatNumber(solBalance.toString(), 9);
    
    console.log(`💰 SOL Balance: ${solUi} SOL`);
    
    if (solBalance.lt(new BN('10000000'))) { // Less than 0.01 SOL
      console.log(`❌ Insufficient SOL balance for testing`);
      return;
    }

    console.log(`\n3️⃣ Setting up swap parameters...`);
    
    // Interactive setup or defaults
    const inputMint = await askQuestion(`Input mint (default SOL): `) || SOL_MINT;
    const outputMint = await askQuestion(`Output mint (default USDC): `) || USDC_MINT;
    const amountInput = await askQuestion(`Amount in UI units (default 3000): `) || '3000';
    const priceImpactInput = await askQuestion(`Max price impact % (default 0.5): `) || '0.5';
    
    // Get token decimals dynamically
    console.log(`🔍 Fetching token decimals from blockchain...`);
    const inputDecimals = inputMint === SOL_MINT ? 9 : (await connection.getParsedAccountInfo(new PublicKey(inputMint))).value?.data?.parsed?.info?.decimals || 9;
    console.log(`   Input token (${inputMint}) decimals: ${inputDecimals}`);
    
    // Convert UI amount to raw amount
    const amountRaw = new BN(parseFloat(amountInput) * Math.pow(10, inputDecimals));
    const priceImpact = parseFloat(priceImpactInput);
    
    console.log(`\n📊 Swap Configuration:`);
    console.log(`   Input mint: ${inputMint}`);
    console.log(`   Output mint: ${outputMint}`);
    console.log(`   Amount (UI): ${amountInput}`);
    console.log(`   Amount (raw): ${amountRaw.toString()}`);
    console.log(`   Max price impact: ${priceImpact}%`);

    console.log(`\n4️⃣ Adding Jupiter balance index delay...`);
    console.log(`⏳ Waiting 1.5s for Jupiter balance indexing...`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log(`✅ Ready to proceed with Ultra API`);

    console.log(`\n5️⃣ Getting Ultra API order...`);
    const order = await getUltraOrder(
      inputMint,
      outputMint,
      amountRaw,
      wallet.publicKey.toBase58(),
      20,
      priceImpact
    );
    
    if (!order) {
      console.log(`💀 Failed to get Ultra API order`);
      return;
    }

    console.log(`\n6️⃣ Confirming swap execution...`);
    const confirm = await askQuestion(`Execute this Ultra API swap? (y/N): `);
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log(`❌ Swap cancelled by user`);
      return;
    }

    console.log(`\n7️⃣ Executing Ultra API swap...`);
    const signature = await executeUltraOrder(order, wallet, connection, 20);
    
    if (signature) {
      console.log(`\n🎉 ULTRA API SWAP COMPLETED SUCCESSFULLY! 🎉`);
      console.log(`🔗 Transaction: https://solscan.io/tx/${signature}`);
      
      console.log(`\n8️⃣ Final balance check...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for balance update
      const finalSolBalance = await safeGetBalance(connection, new PublicKey(SOL_MINT), wallet.publicKey);
      const finalSolUi = formatNumber(finalSolBalance.toString(), 9);
      console.log(`💰 Final SOL Balance: ${finalSolUi} SOL`);
      
    } else {
      console.log(`\n💀 ULTRA API SWAP FAILED`);
      console.log(`❌ No signature returned - swap did not complete`);
    }

  } catch (error) {
    console.error(`\n💥 Test failed with error:`, error.message);
    console.error(error.stack);
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testUltraSwap().catch(console.error);
}

export { testUltraSwap, getUltraOrder, executeUltraOrder };