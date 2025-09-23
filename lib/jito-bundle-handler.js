/**
 * jito-bundle-handler.js - Jito Bundle Integration for Atomic Multi-Transaction Operations
 * 
 * Provides atomic execution for:
 * - Extended DLMM position creation (>69 bins)
 * - Multi-step rebalancing operations
 * - Position closure + new position creation
 * - Fee claiming + swapping + position creation
 * 
 * Features:
 * - Automatic tip calculation and random tip account selection
 * - Bundle status tracking with confirmation
 * - Fallback to regular transactions if bundle fails
 * - MEV protection through atomic execution
 */

import { JitoJsonRpcClient } from 'jito-js-rpc';
import { 
  Transaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  PublicKey
} from '@solana/web3.js';
import { logger } from './logger.js';
import fetch from 'node-fetch';

// Jito configuration
const JITO_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf';
const JITO_BUNDLE_API_URL = 'https://mainnet.block-engine.jito.wtf:443/api/v1/bundles';
const JITO_TIP_FLOOR_API = 'https://bundles.jito.wtf/api/v1/bundles/tip_floor';
const MAX_BUNDLE_SIZE = 5; // Maximum transactions per bundle
const DEFAULT_TIP_LAMPORTS = 10000; // 0.00001 SOL fallback tip (50th percentile)
const MIN_TIP_LAMPORTS = 6000; // 0.000006 SOL minimum (25th percentile)
const MAX_TIP_LAMPORTS = 1400000; // 0.0014 SOL maximum (95th percentile)
const BUNDLE_TIMEOUT_MS = 30000; // 30 seconds timeout
const STATUS_CHECK_INTERVAL_MS = 2000; // Check status every 2 seconds

/**
 * Jito Bundle Handler Class
 */
export class JitoBundleHandler {
  constructor(connection, userKeypair) {
    this.connection = connection;
    this.userKeypair = userKeypair;
    this.tipAccounts = null;
    this.lastTipAccountsRefresh = 0;
    this.TIP_ACCOUNTS_CACHE_MS = 5 * 60 * 1000; // 5 minutes
    
    // Tip floor data caching
    this.tipFloorData = null;
    this.lastTipFloorRefresh = 0;
    this.TIP_FLOOR_CACHE_MS = 30 * 1000; // 30 seconds (tips change frequently)
    
    // Create Jito RPC client
    this.jitoClient = new JitoJsonRpcClient(JITO_BLOCK_ENGINE_URL);
    // Enable logging for debugging (can be disabled in production)
    this.jitoClient.enableConsoleLog();
  }

  /**
   * Get tip accounts with caching
   */
  async getTipAccounts() {
    const now = Date.now();
    if (!this.tipAccounts || (now - this.lastTipAccountsRefresh) > this.TIP_ACCOUNTS_CACHE_MS) {
      try {
        // NOTE: jitoClient.getTipAccounts() returns 404 - API method appears unavailable
        // Using hardcoded mainnet tip accounts instead
        console.log('🎯 Using current mainnet Jito tip accounts (API unavailable)...');
        throw new Error('getTipAccounts API method returns 404, using fallback');
      } catch (error) {
        // Using current mainnet tip accounts (as of December 2024)
        // These are the official Jito tip accounts for mainnet bundles
        console.log('✅ Using hardcoded mainnet tip accounts');
        this.tipAccounts = [
          'T1pyyaTNZsKv2WcRAl8oZ2FkzBqKuha7C7VBuF1kWbCr',  // Tip account 1
          'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',  // Tip account 2  
          'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',  // Tip account 3
          '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',  // Tip account 4
          'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',  // Tip account 5
          'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',  // Tip account 6
          'ADuUkR4vqLUMWXxW9gh6D6L8xhm6g4VF7FwjBZNxnHBx',  // Tip account 7  
          '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'   // Tip account 8
        ];
        this.lastTipAccountsRefresh = now;
      }
    }
    return this.tipAccounts;
  }

  /**
   * Select random tip account to reduce contention
   */
  async getRandomTipAccount() {
    const tipAccounts = await this.getTipAccounts();
    const randomIndex = Math.floor(Math.random() * tipAccounts.length);
    return new PublicKey(tipAccounts[randomIndex]);
  }

  /**
   * Fetch current tip floor data from Jito API
   */
  async getTipFloorData() {
    const now = Date.now();
    if (!this.tipFloorData || (now - this.lastTipFloorRefresh) > this.TIP_FLOOR_CACHE_MS) {
      try {
        console.log('📊 Fetching current tip floor data...');
        const response = await fetch(JITO_TIP_FLOOR_API);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (Array.isArray(data) && data.length > 0) {
          this.tipFloorData = data[0]; // Most recent tip data
          this.lastTipFloorRefresh = now;
          
          const median = Math.floor(this.tipFloorData.landed_tips_50th_percentile * LAMPORTS_PER_SOL);
          const p75 = Math.floor(this.tipFloorData.landed_tips_75th_percentile * LAMPORTS_PER_SOL);
          
          console.log(`✅ Updated tip floor data - Median: ${median} lamports, 75th: ${p75} lamports`);
        } else {
          throw new Error('Invalid tip floor response format');
        }
      } catch (error) {
        console.warn('⚠️  Failed to fetch tip floor data, using cached/default:', error.message);
        
        // Fallback to reasonable defaults if no cached data
        if (!this.tipFloorData) {
          this.tipFloorData = {
            landed_tips_25th_percentile: 6e-6,     // 6,000 lamports
            landed_tips_50th_percentile: 1e-5,     // 10,000 lamports  
            landed_tips_75th_percentile: 3.6e-5,   // 36,000 lamports
            landed_tips_95th_percentile: 0.0014,   // 1,400,000 lamports
            ema_landed_tips_50th_percentile: 1e-5  // 10,000 lamports
          };
        }
      }
    }
    return this.tipFloorData;
  }

  /**
   * Calculate appropriate tip based on current market conditions, transaction priority and count
   */
  async calculateTip(transactionCount, priorityLevel = 'medium') {
    try {
      const tipFloorData = await this.getTipFloorData();
      
      // Base tip selection based on priority level
      let baseTipSOL;
      switch (priorityLevel.toLowerCase()) {
        case 'veryhigh':
          // Use 95th percentile for very high priority
          baseTipSOL = tipFloorData.landed_tips_95th_percentile;
          break;
        case 'high':
          // Use 75th percentile for high priority
          baseTipSOL = tipFloorData.landed_tips_75th_percentile;
          break;
        case 'medium':
        default:
          // Use EMA 50th percentile (more stable) for medium priority
          baseTipSOL = tipFloorData.ema_landed_tips_50th_percentile || tipFloorData.landed_tips_50th_percentile;
          break;
        case 'low':
          // Use 25th percentile for low priority (may not land quickly)
          baseTipSOL = tipFloorData.landed_tips_25th_percentile;
          break;
      }
      
      // Convert to lamports
      let baseTipLamports = Math.floor(baseTipSOL * LAMPORTS_PER_SOL);
      
      // Scale with transaction count (more complex bundles may need higher tips)
      const scalingFactor = 1 + (Math.sqrt(transactionCount) - 1) * 0.2; // 20% increase per sqrt(txCount)
      let finalTip = Math.floor(baseTipLamports * scalingFactor);
      
      // Apply min/max bounds
      finalTip = Math.max(MIN_TIP_LAMPORTS, Math.min(finalTip, MAX_TIP_LAMPORTS));
      
      const tipSOL = finalTip / LAMPORTS_PER_SOL;
      console.log(`💰 Dynamic tip calculation: ${priorityLevel} priority, ${transactionCount} txs → ${finalTip} lamports (${tipSOL.toFixed(6)} SOL)`);
      
      return finalTip;
      
    } catch (error) {
      console.warn(`⚠️  Dynamic tip calculation failed, using fallback: ${error.message}`);
      
      // Fallback to static calculation
      const baseTip = DEFAULT_TIP_LAMPORTS;
      let multiplier = 1;

      switch (priorityLevel.toLowerCase()) {
        case 'veryhigh':
          multiplier = 10;
          break;
        case 'high':
          multiplier = 3;
          break;
        case 'medium':
        default:
          multiplier = 1;
          break;
        case 'low':
          multiplier = 0.6;
          break;
      }

      const tip = Math.min(baseTip * multiplier * Math.sqrt(transactionCount), MAX_TIP_LAMPORTS);
      return Math.floor(tip);
    }
  }

  /**
   * Create tip transaction with dynamic tip calculation
   */
  async createTipTransaction(transactionCount, priorityLevel = 'medium') {
    const tipLamports = await this.calculateTip(transactionCount, priorityLevel);
    const tipAccount = await this.getRandomTipAccount();
    
    console.log(`💰 Creating tip: ${(tipLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL to ${tipAccount.toBase58().slice(0, 8)}...`);
    
    const tipTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.userKeypair.publicKey,
        toPubkey: tipAccount,
        lamports: tipLamports
      })
    );

    // Set transaction metadata
    tipTx.feePayer = this.userKeypair.publicKey;
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    tipTx.recentBlockhash = blockhash;
    tipTx.lastValidBlockHeight = lastValidBlockHeight;

    return { tipTx, tipLamports };
  }

  /**
   * Prepare transactions for bundle (sign and serialize)
   */
  async prepareTransactionsForBundle(transactions, includeKeyPairs = []) {
    const preparedTxs = [];
    
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      
      // Ensure recent blockhash is set
      if (!tx.recentBlockhash) {
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
      }
      
      // Smart signer detection: only sign with required signers
      const requiredSigners = [this.userKeypair]; // User always signs
      
      // Add position keypairs only if they're needed for this transaction
      for (const keypair of includeKeyPairs) {
        // Check if this transaction references this keypair's public key
        const pubkeyString = keypair.publicKey.toBase58();
        const txString = JSON.stringify(tx.compileMessage());
        
        if (txString.includes(pubkeyString)) {
          requiredSigners.push(keypair);
        }
      }
      
      console.log(`📋 Transaction ${i + 1}: Signing with ${requiredSigners.length} keypairs`);
      
      // Sign transaction with only the required signers
      tx.sign(...requiredSigners);
      
      // Serialize to base64
      const serializedTx = tx.serialize().toString('base64');
      preparedTxs.push(serializedTx);
    }
    
    return preparedTxs;
  }

  /**
   * Send bundle with status tracking
   */
  async sendBundleWithConfirmation(
    transactions, 
    priorityLevel = 'medium',
    includeKeyPairs = [],
    options = {}
  ) {
    const {
      includeTip = true,
      maxRetries = 2,
      timeoutMs = BUNDLE_TIMEOUT_MS
    } = options;

    if (transactions.length === 0) {
      throw new Error('Cannot send empty bundle');
    }

    if (transactions.length > MAX_BUNDLE_SIZE) {
      throw new Error(`Bundle too large: ${transactions.length} > ${MAX_BUNDLE_SIZE} transactions`);
    }

    console.log(`🚀 Preparing Jito bundle with ${transactions.length} transactions...`);
    
    // Add tip transaction if requested
    let bundleTransactions = [...transactions];
    let tipAmount = 0;
    if (includeTip) {
      const { tipTx, tipLamports } = await this.createTipTransaction(transactions.length, priorityLevel);
      bundleTransactions.unshift(tipTx); // Tip goes first
      tipAmount = tipLamports;
    }

    // Prepare transactions for bundle
    const preparedTxs = await this.prepareTransactionsForBundle(bundleTransactions, includeKeyPairs);
    
    let attempt = 0;
    let lastError;
    
    while (attempt < maxRetries) {
      attempt++;
      console.log(`🎯 Sending bundle attempt ${attempt}/${maxRetries}...`);
      
      try {
        // Send bundle
        const response = await this.jitoClient.sendBundle([preparedTxs, { encoding: 'base64' }]);
        
        if (!response.result) {
          throw new Error('Bundle submission failed: no result');
        }
        
        const bundleId = response.result;
        
        console.log(`✅ Bundle submitted: ${bundleId}`);
        logger.info(`Bundle submitted: ${bundleId}`, { 
          bundleId, 
          transactionCount: bundleTransactions.length,
          attempt
        });
        
        // Wait for confirmation
        const result = await this.waitForBundleConfirmation(bundleId, timeoutMs);
        
        if (result.success) {
          console.log(`🎉 Bundle landed successfully in slot ${result.slot}`);
          const tipSOL = tipAmount / LAMPORTS_PER_SOL;
          console.log(`💰 Total tip paid: ${tipSOL.toFixed(6)} SOL`);
          
          return {
            success: true,
            bundleId,
            slot: result.slot,
            signatures: result.signatures,
            transactionCount: bundleTransactions.length,
            tipAmount: tipAmount, // Include tip amount for tracking
            tipSOL: tipSOL
          };
        } else {
          throw new Error(`Bundle failed: ${result.error}`);
        }
        
      } catch (error) {
        lastError = error;
        console.warn(`⚠️  Bundle attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < maxRetries) {
          console.log(`🔄 Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    // All retries failed
    console.error(`❌ Bundle failed after ${maxRetries} attempts: ${lastError.message}`);
    throw new Error(`Bundle execution failed: ${lastError.message}`);
  }

  /**
   * Wait for bundle confirmation with status tracking
   */
  async waitForBundleConfirmation(bundleId, timeoutMs = BUNDLE_TIMEOUT_MS) {
    const startTime = Date.now();
    let lastStatus = 'pending';
    
    console.log(`⏳ Waiting for bundle confirmation: ${bundleId.slice(0, 16)}...`);
    
    while ((Date.now() - startTime) < timeoutMs) {
      try {
        // Check inflight status first (faster)
        const inflightResponse = await this.jitoClient.getInFlightBundleStatuses([[bundleId]]);
        
        if (inflightResponse.result && inflightResponse.result.value && inflightResponse.result.value.length > 0) {
          const status = inflightResponse.result.value[0];
          
          if (status.status !== lastStatus) {
            console.log(`📊 Bundle status: ${lastStatus} → ${status.status}`);
            lastStatus = status.status;
          }
          
          if (status.status === 'Landed') {
            // Get final confirmation from bundle statuses
            const bundleResponse = await this.jitoClient.getBundleStatuses([[bundleId]]);
            
            if (bundleResponse.result && bundleResponse.result.value && bundleResponse.result.value.length > 0 && bundleResponse.result.value[0]) {
              const finalStatus = bundleResponse.result.value[0];
              return {
                success: true,
                slot: finalStatus.slot,
                signatures: finalStatus.transactions,
                confirmationStatus: finalStatus.confirmation_status
              };
            }
            
            // Fallback if bundle status not available yet
            return {
              success: true,
              slot: status.landed_slot,
              signatures: [],
              confirmationStatus: 'processed'
            };
          }
          
          if (status.status === 'Failed' || status.status === 'Invalid') {
            return {
              success: false,
              error: `Bundle ${status.status.toLowerCase()}`
            };
          }
        }
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, STATUS_CHECK_INTERVAL_MS));
        
      } catch (error) {
        console.warn(`⚠️  Error checking bundle status: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, STATUS_CHECK_INTERVAL_MS));
      }
    }
    
    // Timeout reached
    return {
      success: false,
      error: 'Bundle confirmation timeout'
    };
  }

  /**
   * Execute with bundle or fallback to regular transactions
   */
  async executeWithBundleOrFallback(
    transactions, 
    fallbackExecutor,
    priorityLevel = 'medium',
    options = {}
  ) {
    const {
      forceFallback = false,
      includeKeyPairs = []
    } = options;

    // Skip bundle if forced or single transaction
    if (forceFallback || transactions.length === 1) {
      console.log('📤 Using regular transaction execution (fallback)');
      return await fallbackExecutor();
    }

    try {
      console.log(`🎁 Attempting atomic bundle execution for ${transactions.length} transactions...`);
      
      const result = await this.sendBundleWithConfirmation(
        transactions, 
        priorityLevel, 
        includeKeyPairs,
        options
      );
      
      console.log(`✅ Bundle execution successful!`);
      return result;
      
    } catch (error) {
      console.warn(`⚠️  Bundle execution failed: ${error.message}`);
      console.log(`🔄 Falling back to regular transaction execution...`);
      
      try {
        const fallbackResult = await fallbackExecutor();
        console.log(`✅ Fallback execution successful`);
        return fallbackResult;
      } catch (fallbackError) {
        console.error(`❌ Both bundle and fallback execution failed`);
        throw new Error(`Bundle failed (${error.message}), Fallback failed (${fallbackError.message})`);
      }
    }
  }
}

/**
 * Detect if Jito bundles should be used - ONLY for multi-position operations
 * 
 * ✅ USE JITO BUNDLES FOR:
 * - Extended DLMM positions (>69 bins) requiring multiple positions
 * - Operations that create/close multiple positions atomically
 * 
 * ❌ DO NOT USE JITO BUNDLES FOR:
 * - Single position operations (≤69 bins) - use regular RPC
 * - Jupiter Ultra swaps - ALWAYS keep using Jupiter Ultra
 * - Any token swapping - use existing Jupiter/swap logic  
 * - Single position rebalancing - use regular RPC
 * - Standard operations - Jito is ONLY for multi-position atomicity
 */
export function shouldUseJitoBundles(transactionCount, options = {}) {
  const {
    forceDisable = false,
    network = 'mainnet',
    isExtendedPosition = false,      // ONLY for >69 bin positions requiring multiple positions
    isMultiPositionOperation = false // ONLY for operations involving multiple positions
  } = options;

  // Disable if forced or not mainnet
  if (forceDisable || network !== 'mainnet') {
    return false;
  }

  // STRICT RULE: Only use for operations involving multiple positions
  if (!isExtendedPosition && !isMultiPositionOperation) {
    console.log(`📤 Single position operation - using regular RPC (not Jito bundles)`);
    return false;
  }

  // Must have multiple transactions AND be a multi-position operation
  // Max 5 transactions per Jito bundle
  const validTransactionCount = transactionCount > 1 && transactionCount <= 5;
  
  if (isExtendedPosition) {
    console.log(`🎁 Extended position (>69 bins) with ${transactionCount} transactions - bundle candidate: ${validTransactionCount}`);
  }
  
  if (isMultiPositionOperation) {
    console.log(`🎁 Multi-position operation with ${transactionCount} transactions - bundle candidate: ${validTransactionCount}`);
  }
  
  return validTransactionCount;
}

/**
 * Create configured Jito bundle handler
 */
export function createJitoBundleHandler(connection, userKeypair) {
  return new JitoBundleHandler(connection, userKeypair);
}

export default JitoBundleHandler;
