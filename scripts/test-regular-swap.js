#!/usr/bin/env node
// ───────────────────────────────────────────────
// ~/scripts/test-regular-swap.js
// Comprehensive Jupiter Regular API Swap Testing Script
// ───────────────────────────────────────────────

import { Connection, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { loadWalletKeypair, safeGetBalance, getMintDecimals } from '../lib/solana.js';
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

// Regular Jupiter API Functions
async function getJupiterQuote(
  inputMint,
  outputMint,
  amountRaw,
  slippageBps = 50,
  maxAttempts = 20,
  priceImpact = 0.5,
  useDynamicSlippage = true
) {
  console.log(`\n📊 Jupiter Regular API - Getting Quote`);
  console.log(`   Input: ${inputMint}`);
  console.log(`   Output: ${outputMint}`);
  console.log(`   Amount: ${amountRaw}`);
  console.log(`   Slippage: ${slippageBps} bps`);
  console.log(`   Dynamic slippage: ${useDynamicSlippage}`);
  console.log(`   Max price impact: ${priceImpact}%`);

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      console.log(`\n⚡ Quote attempt ${attempt}/${maxAttempts}...`);
      
      const url = new URL('https://lite-api.jup.ag/swap/v1/quote');
      url.searchParams.set('inputMint', inputMint);
      url.searchParams.set('outputMint', outputMint);
      url.searchParams.set('amount', amountRaw.toString());
      url.searchParams.set('slippageBps', slippageBps.toString());
      url.searchParams.set('restrictIntermediateTokens', 'true');
      
      // Add dynamic slippage if requested
      if (useDynamicSlippage) {
        url.searchParams.set('dynamicSlippage', 'true');
      }
      
      console.log(`📡 Requesting: ${url.toString()}`);

      const response = await fetch(url.toString());
      console.log(`📨 Response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`❌ Quote HTTP error: ${errorText}`);
        throw new Error(`Quote failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const quote = await response.json();
      console.log(`📋 Quote Response:`, JSON.stringify(quote, null, 2));

      if (quote.error) {
        throw new Error(`Quote API error: ${quote.error}`);
      }

      console.log(`✅ Quote validation:`);
      console.log(`   ✓ Input amount: ${quote.inAmount}`);
      console.log(`   ✓ Output amount: ${quote.outAmount}`);
      console.log(`   ✓ Other amount threshold: ${quote.otherAmountThreshold || 'N/A'}`);
      console.log(`   ✓ Swap mode: ${quote.swapMode || 'N/A'}`);
      console.log(`   ✓ Price impact: ${quote.priceImpactPct || 'N/A'}%`);
      console.log(`   ✓ Route plan length: ${quote.routePlan?.length || 0}`);
      console.log(`   ✓ Context slot: ${quote.contextSlot || 'N/A'}`);
      console.log(`   ✓ Time taken: ${quote.timeTaken || 'N/A'}s`);

      const impact = Math.abs(Number(quote.priceImpactPct || 0)) * 100; // Convert decimal to percentage
      console.log(`📊 Price impact check: ${impact.toFixed(5)}% vs ${priceImpact}% limit`);

      // Check if under our desired price impact
      if (impact < priceImpact) {
        console.log(`✅ Price impact acceptable - returning quote`);
        return quote;
      } else {
        console.log(`⚠️  Price impact (${impact.toFixed(5)}%) above ${priceImpact}% limit`);
        console.log(`   Retrying... (attempt ${attempt}/${maxAttempts})`);
      }
    } catch (error) {
      console.error(`❌ Quote error (attempt ${attempt}):`, error.message);
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

async function buildJupiterSwap(
  quoteResponse,
  userPublicKey,
  useDynamicSlippage = true,
  useDynamicComputeLimit = true,
  priorityLevel = 'veryHigh',
  maxPriorityLamports = 1000000
) {
  console.log(`\n🔧 Jupiter Regular API - Building Swap Transaction`);
  console.log(`   User: ${userPublicKey}`);
  console.log(`   Dynamic slippage: ${useDynamicSlippage}`);
  console.log(`   Dynamic compute limit: ${useDynamicComputeLimit}`);
  console.log(`   Priority level: ${priorityLevel}`);
  console.log(`   Max priority lamports: ${maxPriorityLamports}`);

  try {
    const requestBody = {
      quoteResponse,
      userPublicKey: userPublicKey,
      wrapAndUnwrapSol: true,
    };

    // Add dynamic compute unit limit
    if (useDynamicComputeLimit) {
      requestBody.dynamicComputeUnitLimit = true;
    }

    // Add dynamic slippage
    if (useDynamicSlippage) {
      requestBody.dynamicSlippage = true;
    }

    // Add priority fee configuration
    requestBody.prioritizationFeeLamports = {
      priorityLevelWithMaxLamports: {
        maxLamports: maxPriorityLamports,
        priorityLevel: priorityLevel,
        global: false // Use local fee market
      }
    };

    console.log(`📡 Swap build request:`, JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`📨 Build response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ Swap build HTTP error: ${errorText}`);
      throw new Error(`Swap build failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const swapResponse = await response.json();
    console.log(`📋 Swap Build Response:`, JSON.stringify(swapResponse, null, 2));

    if (swapResponse.error) {
      throw new Error(`Swap build API error: ${swapResponse.error}`);
    }

    console.log(`✅ Swap build validation:`);
    console.log(`   ✓ Has swap transaction: ${!!swapResponse.swapTransaction}`);
    console.log(`   ✓ Last valid block height: ${swapResponse.lastValidBlockHeight || 'N/A'}`);
    console.log(`   ✓ Prioritization fee lamports: ${swapResponse.prioritizationFeeLamports || 'N/A'}`);
    console.log(`   ✓ Compute unit limit: ${swapResponse.computeUnitLimit || 'N/A'}`);
    console.log(`   ✓ Priority type: ${swapResponse.prioritizationType ? JSON.stringify(swapResponse.prioritizationType) : 'N/A'}`);
    console.log(`   ✓ Dynamic slippage report: ${swapResponse.dynamicSlippageReport ? JSON.stringify(swapResponse.dynamicSlippageReport) : 'N/A'}`);
    console.log(`   ✓ Simulation error: ${swapResponse.simulationError || 'None'}`);

    return swapResponse;

  } catch (error) {
    console.error(`❌ Swap build error:`, error.message);
    throw error;
  }
}

async function executeJupiterSwap(swapResponse, userKeypair, connection, maxAttempts = 3) {
  console.log(`\n🚀 Jupiter Regular API - Executing Swap`);
  console.log(`   Max attempts: ${maxAttempts}`);

  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    console.log(`\n⚡ Execution attempt ${attempt}/${maxAttempts}`);

    try {
      if (!swapResponse.swapTransaction) {
        throw new Error('No swapTransaction in response');
      }

      console.log(`🔧 Deserializing transaction...`);
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(swapResponse.swapTransaction, 'base64')
      );
      console.log(`✅ Transaction deserialized successfully`);

      console.log(`🕐 Getting fresh blockhash...`);
      const fresh = await connection.getLatestBlockhash('confirmed');
      console.log(`✅ Fresh blockhash: ${fresh.blockhash}`);
      console.log(`   Last valid block height: ${fresh.lastValidBlockHeight}`);

      // Update blockhash and sign
      transaction.message.recentBlockhash = fresh.blockhash;
      transaction.sign([userKeypair]);
      console.log(`✅ Transaction signed`);

      const transactionBinary = transaction.serialize();
      console.log(`✅ Transaction serialized for sending`);

      console.log(`📡 Sending transaction with optimal settings...`);
      const signature = await connection.sendRawTransaction(transactionBinary, {
        maxRetries: 2,
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });

      console.log(`📨 Transaction sent. Signature: ${signature}`);
      console.log(`⏳ Confirming transaction...`);

      const confirmation = await connection.confirmTransaction(
        {
          signature: signature,
          blockhash: fresh.blockhash,
          lastValidBlockHeight: fresh.lastValidBlockHeight,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        console.log(`❌ Transaction failed on-chain:`, JSON.stringify(confirmation.value.err));
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log(`🎯 Transaction confirmed successfully!`);
      console.log(`🔗 View transaction: https://solscan.io/tx/${signature}`);

      // Get transaction details for analysis
      console.log(`📊 Fetching transaction details...`);
      const txInfo = await connection.getParsedTransaction(
        signature,
        { 
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        }
      );

      if (txInfo && txInfo.meta) {
        console.log(`📈 Transaction Analysis:`);
        console.log(`   ✓ Fee: ${txInfo.meta.fee} lamports`);
        console.log(`   ✓ Compute units consumed: ${txInfo.meta.computeUnitsConsumed || 'N/A'}`);
        console.log(`   ✓ Log messages: ${txInfo.meta.logMessages?.length || 0}`);
        
        if (txInfo.meta.err) {
          console.log(`   ❌ Error: ${JSON.stringify(txInfo.meta.err)}`);
        } else {
          console.log(`   ✅ Status: Success`);
        }

        // Show balance changes
        if (txInfo.meta.preBalances && txInfo.meta.postBalances) {
          console.log(`💰 Balance Changes:`);
          for (let i = 0; i < txInfo.meta.preBalances.length; i++) {
            const preBalance = txInfo.meta.preBalances[i];
            const postBalance = txInfo.meta.postBalances[i];
            const change = postBalance - preBalance;
            if (change !== 0) {
              console.log(`   Account ${i}: ${change > 0 ? '+' : ''}${change} lamports`);
            }
          }
        }
      }

      return signature;

    } catch (error) {
      console.error(`❌ Execution error (attempt ${attempt}):`, error.message);

      if (attempt >= maxAttempts) {
        console.error(`💀 All execution attempts exhausted. Returning null.`);
        return null;
      }

      console.log(`⏳ Waiting 1000ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return null;
}

// Main test function
async function testRegularSwap() {
  console.log(`\n📊 Jupiter Regular API Comprehensive Swap Test`);
  console.log(`===============================================`);

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
    const slippageInput = await askQuestion(`Slippage in bps (default 50): `) || '50';
    const priceImpactInput = await askQuestion(`Max price impact % (default 0.5): `) || '0.5';
    const priorityInput = await askQuestion(`Priority level (medium/high/veryHigh, default veryHigh): `) || 'veryHigh';
    
    // Get token decimals dynamically
    console.log(`🔍 Fetching token decimals...`);
    const inputDecimals = await getMintDecimals(connection, new PublicKey(inputMint));
    const outputDecimals = await getMintDecimals(connection, new PublicKey(outputMint));
    
    console.log(`   Input token decimals: ${inputDecimals}`);
    console.log(`   Output token decimals: ${outputDecimals}`);
    
    // Convert UI amount to raw amount
    const amountRaw = new BN(parseFloat(amountInput) * Math.pow(10, inputDecimals));
    const slippageBps = parseInt(slippageInput);
    const priceImpact = parseFloat(priceImpactInput);
    
    console.log(`\n📊 Swap Configuration:`);
    console.log(`   Input mint: ${inputMint}`);
    console.log(`   Output mint: ${outputMint}`);
    console.log(`   Amount (UI): ${amountInput}`);
    console.log(`   Amount (raw): ${amountRaw.toString()}`);
    console.log(`   Slippage: ${slippageBps} bps`);
    console.log(`   Max price impact: ${priceImpact}%`);
    console.log(`   Priority level: ${priorityInput}`);

    console.log(`\n4️⃣ Getting Jupiter quote...`);
    const quote = await getJupiterQuote(
      inputMint,
      outputMint,
      amountRaw,
      slippageBps,
      20,
      priceImpact,
      true // Use dynamic slippage
    );
    
    if (!quote) {
      console.log(`💀 Failed to get Jupiter quote`);
      return;
    }

    console.log(`\n5️⃣ Building swap transaction...`);
    const swapResponse = await buildJupiterSwap(
      quote,
      wallet.publicKey.toString(),
      true, // Dynamic slippage
      true, // Dynamic compute limit
      priorityInput,
      1000000 // Max 1M lamports priority fee
    );

    if (!swapResponse) {
      console.log(`💀 Failed to build swap transaction`);
      return;
    }

    console.log(`\n6️⃣ Confirming swap execution...`);
    const confirm = await askQuestion(`Execute this regular Jupiter swap? (y/N): `);
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log(`❌ Swap cancelled by user`);
      return;
    }

    console.log(`\n7️⃣ Executing Jupiter swap...`);
    const signature = await executeJupiterSwap(swapResponse, wallet, connection, 3);
    
    if (signature) {
      console.log(`\n🎉 REGULAR JUPITER SWAP COMPLETED SUCCESSFULLY! 🎉`);
      console.log(`🔗 Transaction: https://solscan.io/tx/${signature}`);
      
      console.log(`\n8️⃣ Final balance check...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for balance update
      const finalSolBalance = await safeGetBalance(connection, new PublicKey(SOL_MINT), wallet.publicKey);
      const finalSolUi = formatNumber(finalSolBalance.toString(), 9);
      console.log(`💰 Final SOL Balance: ${finalSolUi} SOL`);
      
      if (outputMint !== SOL_MINT) {
        const outputBalance = await safeGetBalance(connection, new PublicKey(outputMint), wallet.publicKey);
        const outputUi = formatNumber(outputBalance.toString(), outputDecimals);
        console.log(`💰 Output Token Balance: ${outputUi}`);
      }
      
    } else {
      console.log(`\n💀 REGULAR JUPITER SWAP FAILED`);
      console.log(`❌ No signature returned - swap did not complete`);
    }

  } catch (error) {
    console.error(`\n💥 Test failed with error:`, error.message);
    console.error(error.stack);
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testRegularSwap().catch(console.error);
}

export { testRegularSwap, getJupiterQuote, buildJupiterSwap, executeJupiterSwap };