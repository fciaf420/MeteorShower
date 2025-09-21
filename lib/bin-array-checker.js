/**
 * bin-array-checker.js - Checks for bin array initialization fees
 * Per DLMM SDK, new bin arrays may need initialization with associated costs
 */

import dlmmPackage from '@meteora-ag/dlmm';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import readline from 'readline';

const { DLMM, StrategyType } = dlmmPackage;

/**
 * Detect RPC provider type from endpoint URL
 * @param {string} rpcEndpoint - RPC endpoint URL
 * @returns {string} Provider type ('helius', 'quicknode', 'alchemy', 'solana', 'other')
 */
function detectRpcProvider(rpcEndpoint) {
  const url = rpcEndpoint.toLowerCase();
  if (url.includes('helius') || url.includes('rpc.helius.xyz')) return 'helius';
  if (url.includes('quicknode') || url.includes('.quiknode.pro')) return 'quicknode';
  if (url.includes('alchemy') || url.includes('.alchemyapi.io')) return 'alchemy';
  if (url.includes('api.mainnet-beta.solana.com') || url.includes('api.devnet.solana.com')) return 'solana';
  return 'other';
}

/**
 * Checks if bin array initialization fees are required for a given bin span
 * and prompts user for confirmation if fees are detected
 * 
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} poolAddress - DLMM pool address
 * @param {number} binSpan - Number of bins for the position
 * @param {string} liquidityStrategy - Strategy type ('Spot', 'Curve', etc.)
 * @param {Object} tokenRatio - Token ratio object with ratioX, ratioY
 * @returns {Promise<boolean>} - true if user confirms to proceed, false otherwise
 */
export async function checkBinArrayInitializationFees(
  connection,
  poolAddress, 
  binSpan,
  liquidityStrategy = 'Spot',
  tokenRatio = null
) {
  try {
    console.log('');
    console.log('🔍 Checking for bin array initialization requirements...');
    
    // Detect RPC provider for context
    const rpcProvider = detectRpcProvider(connection.rpcEndpoint);
    if (rpcProvider !== 'helius') {
      console.log(`📡 RPC Provider: ${rpcProvider} - bin array check may be less accurate`);
    }
    
    // Create DLMM pool instance
    const dlmmPool = await DLMM.create(connection, new PublicKey(poolAddress));
    
    // Get active bin to calculate position range
    const activeBin = await dlmmPool.getActiveBin();
    const activeBinId = activeBin.binId;
    
    // Calculate bin range based on strategy and token ratio
    let minBinId, maxBinId;
    
    if (tokenRatio && tokenRatio.ratioX === 1 && tokenRatio.ratioY === 0) {
      // 100% Token X (above active price)
      minBinId = activeBinId;
      maxBinId = activeBinId + binSpan - 1;
    } else if (tokenRatio && tokenRatio.ratioX === 0 && tokenRatio.ratioY === 1) {
      // 100% Token Y/SOL (below active price)
      minBinId = activeBinId - binSpan + 1;
      maxBinId = activeBinId;
    } else {
      // Balanced or custom ratio (centered around active)
      const halfSpan = Math.floor(binSpan / 2);
      minBinId = activeBinId - halfSpan;
      maxBinId = activeBinId + halfSpan;
      
      // Adjust if binSpan is odd
      if (binSpan % 2 === 1) {
        maxBinId += 1;
      }
    }
    
    console.log(`📊 Projected position range: Bins ${minBinId} to ${maxBinId}`);
    console.log(`📊 Active bin: ${activeBinId}`);
    
    // Create strategy parameters for quote
    const strategy = {
      minBinId,
      maxBinId,
      strategyType: getStrategyType(liquidityStrategy)
    };
    
    // Quote position creation cost
    const quote = await dlmmPool.quoteCreatePosition({ strategy });
    
    // Check if there are bin array initialization costs
    let hasInitializationFees = false;
    let totalInitializationCost = 0;
    
    if (quote && quote.binArraysInitializationCost) {
      totalInitializationCost = quote.binArraysInitializationCost;
      hasInitializationFees = totalInitializationCost > 0;
    }
    
    // If no initialization fees, proceed without prompting
    if (!hasInitializationFees || totalInitializationCost === 0) {
      console.log('✅ No bin array initialization required - existing arrays cover your range');
      return true;
    }
    
    // Show initialization fee information
    const costInSOL = totalInitializationCost / 1e9;
    console.log('');
    console.log('⚠️  BIN ARRAY INITIALIZATION REQUIRED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`💰 Initialization Fee: ${costInSOL.toFixed(4)} SOL`);
    console.log(`📊 Bin Range: ${minBinId} to ${maxBinId} (${binSpan} bins)`);
    console.log('');
    console.log('📋 What this means:');
    console.log('   • Your position range extends into uninitialized bin arrays');
    console.log('   • One-time fee required to initialize these bin arrays');  
    console.log('   • This fee is NOT recoverable - it goes to Solana for account rent');
    console.log('   • Other users will benefit from these initialized arrays');
    console.log('   • This is a normal part of DLMM pools when creating wide positions');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Prompt for confirmation
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    try {
      const answer = await rl.question(`\n💡 Do you want to proceed with ${costInSOL.toFixed(4)} SOL initialization fee? (yes/no): `);
      const input = answer.trim().toLowerCase();
      
      if (input === 'yes' || input === 'y') {
        console.log('✅ Proceeding with bin array initialization');
        return true;
      } else {
        console.log('❌ Operation cancelled - please select a smaller bin span or different range');
        return false;
      }
    } finally {
      rl.close();
    }
    
  } catch (error) {
    const rpcProvider = detectRpcProvider(connection.rpcEndpoint);
    
    if (rpcProvider !== 'helius') {
      console.warn(`⚠️  Bin array fee check limited on ${rpcProvider} RPC:`, error.message);
      console.log('💡 For comprehensive fee checking, consider using Helius RPC');
    } else {
      console.warn('⚠️  Could not check bin array initialization fees:', error.message);
    }
    
    console.log('💡 Proceeding without fee check - initialization fees may still apply during position creation');
    console.log('💡 Large bin spans (>100 bins) typically require 0.2-0.4 SOL in initialization fees');
    
    return true; // Default to proceeding if check fails
  }
}

/**
 * Maps strategy name to SDK StrategyType enum
 */
function getStrategyType(liquidityStrategy) {
  switch (liquidityStrategy?.toLowerCase()) {
    case 'spot':
      return StrategyType.SpotBalanced;
    case 'curve':
      return StrategyType.CurveBalanced;  
    case 'bidask':
      return StrategyType.BidAskBalanced;
    default:
      return StrategyType.SpotBalanced;
  }
}

/**
 * Estimates bin array count needed for a given bin range
 * Each bin array typically covers ~70 bins
 */
export function estimateBinArrayCount(binSpan) {
  const BINS_PER_ARRAY = 70; // Approximate bins per bin array
  return Math.ceil(binSpan / BINS_PER_ARRAY);
}

/**
 * Estimates total initialization cost based on bin span
 * Each bin array initialization costs ~0.2 SOL rent
 */
export function estimateInitializationCost(binSpan) {
  const COST_PER_ARRAY_SOL = 0.2; // Approximate cost per bin array
  const arrayCount = estimateBinArrayCount(binSpan);
  return arrayCount * COST_PER_ARRAY_SOL;
}
