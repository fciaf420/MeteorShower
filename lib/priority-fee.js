// ───────────────────────────────────────────────
// ~/lib/priority-fee.js
// ───────────────────────────────────────────────
// Dynamic priority fee management using Helius API
// Implements progressive retry logic: Medium → High → VeryHigh

import { Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import 'dotenv/config';

/**
 * Priority levels for Helius API with progressive escalation
 */
export const PRIORITY_LEVELS = {
  MEDIUM: 'Medium',      // Start here (50th percentile)
  HIGH: 'High',         // First escalation (75th percentile) 
  VERY_HIGH: 'VeryHigh' // Final escalation (95th percentile)
};

/**
 * Fallback priority fees (micro-lamports) if API fails
 * Base value is configurable via env PRIORITY_FEE_FALLBACK_MICROS (default 50,000)
 * High/VeryHigh use multipliers (3x and 10x respectively)
 */
const BASE_FALLBACK_MICROS = Number(process.env.PRIORITY_FEE_FALLBACK_MICROS ?? 50_000);
const SAFE_BASE_FALLBACK = Number.isFinite(BASE_FALLBACK_MICROS) && BASE_FALLBACK_MICROS > 0
  ? Math.floor(BASE_FALLBACK_MICROS)
  : 50_000;

const FALLBACK_FEES = {
  [PRIORITY_LEVELS.MEDIUM]: Math.max(SAFE_BASE_FALLBACK, 1000),
  [PRIORITY_LEVELS.HIGH]: Math.max(Math.floor(SAFE_BASE_FALLBACK * 3), 1000),
  [PRIORITY_LEVELS.VERY_HIGH]: Math.max(Math.floor(SAFE_BASE_FALLBACK * 10), 1000)
};

export function getFallbackPriorityFee(priorityLevel = PRIORITY_LEVELS.MEDIUM) {
  return FALLBACK_FEES[priorityLevel] ?? FALLBACK_FEES[PRIORITY_LEVELS.MEDIUM];
}

/**
 * Get dynamic priority fee from Helius API using serialized transaction
 * @param {Connection} connection - Solana connection with Helius endpoint
 * @param {Transaction} transaction - The transaction to estimate fees for (without priority fee)
 * @param {string} priorityLevel - Priority level: 'Medium', 'High', or 'VeryHigh'
 * @returns {Promise<number>} Priority fee in micro-lamports
 */
export async function getDynamicPriorityFee(connection, transaction, priorityLevel = PRIORITY_LEVELS.MEDIUM) {
  try {
    // Ensure transaction has required fields for serialization
    if (!transaction.recentBlockhash) {
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
    }

    // Serialize the transaction (without priority fee instruction)
    const serializedTransaction = bs58.encode(
      transaction.serialize({ requireAllSignatures: false, verifySignatures: false })
    );

    // Call Helius Priority Fee API
    const response = await fetch(connection.rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'getPriorityFeeEstimate',
        params: [{
          transaction: serializedTransaction,
          options: {
            priorityLevel: priorityLevel,
            recommended: true
          }
        }]
      })
    });

    const result = await response.json();

    if (result.error) {
      throw new Error(`Helius API error: ${JSON.stringify(result.error)}`);
    }

    const priorityFee = result.result.priorityFeeEstimate;
    
    // Ensure we have a reasonable minimum fee (at least 1000 micro-lamports)
    const minFee = Math.max(priorityFee, 1000);
    
    console.log(`🚀 Dynamic priority fee (${priorityLevel}): ${minFee.toLocaleString()} micro-lamports`);
    return minFee;

  } catch (error) {
    console.warn(`⚠️  Dynamic priority fee failed (${priorityLevel}): ${error.message}`);
    console.log(`📋 Using fallback fee: ${FALLBACK_FEES[priorityLevel].toLocaleString()} micro-lamports`);
    return FALLBACK_FEES[priorityLevel];
  }
}

/**
 * Progressive priority fee escalation for retries
 * Tries Medium 3x, then High 3x, then VeryHigh
 * @param {number} attemptNumber - Current attempt number (0-based)
 * @returns {string} Priority level for this attempt
 */
export function getProgressivePriorityLevel(attemptNumber) {
  if (attemptNumber < 3) {
    return PRIORITY_LEVELS.MEDIUM;    // Attempts 0, 1, 2: Medium
  } else if (attemptNumber < 6) {
    return PRIORITY_LEVELS.HIGH;      // Attempts 3, 4, 5: High
  } else {
    return PRIORITY_LEVELS.VERY_HIGH; // Attempts 6+: VeryHigh
  }
}

/**
 * Add dynamic priority fee instruction to transaction
 * @param {Transaction} transaction - Transaction to add priority fee to
 * @param {Connection} connection - Solana connection
 * @param {string} priorityLevel - Priority level to use
 * @returns {Promise<Transaction>} Transaction with priority fee instruction added
 */
export async function addDynamicPriorityFee(transaction, connection, priorityLevel = PRIORITY_LEVELS.MEDIUM) {
  // Create a copy of the transaction for fee estimation (without existing priority fee instructions)
  const estimationTx = new Transaction();
  
  // Add only non-priority-fee instructions for estimation
  transaction.instructions.forEach(ix => {
    // Skip existing priority fee instructions
    if (!ix.programId.equals(ComputeBudgetProgram.programId)) {
      estimationTx.add(ix);
    }
  });

  // Set required fields
  estimationTx.feePayer = transaction.feePayer;
  estimationTx.recentBlockhash = transaction.recentBlockhash;

  // Get dynamic priority fee
  const priorityFee = await getDynamicPriorityFee(connection, estimationTx, priorityLevel);

  // Add priority fee instruction to original transaction
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: priorityFee
  });

  // Add priority fee instruction at the beginning
  transaction.instructions.unshift(priorityFeeIx);

  return transaction;
}

/**
 * Enhanced retry wrapper with progressive priority fee escalation
 * @param {Function} operation - The operation to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 3)
 * @param {Connection} options.connection - Solana connection for dynamic fees
 * @param {Function} options.getTransaction - Function that returns fresh transaction for each attempt
 * @returns {Promise<any>} Result of the operation
 */
export async function withProgressivePriorityFee(operation, options = {}) {
  // Default to 7 attempts: 3x Medium, 3x High, 1x VeryHigh
  const { maxAttempts = 7, connection, getTransaction } = options;
  
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Get progressive priority level for this attempt
      const priorityLevel = getProgressivePriorityLevel(attempt);
      
      if (attempt > 0) {
        console.log(`🔄 Retry attempt ${attempt + 1}/${maxAttempts} with ${priorityLevel} priority fees`);
      }

      // Get fresh transaction for this attempt
      const transaction = await getTransaction();
      
      // Add dynamic priority fee based on current attempt
      if (connection && transaction) {
        await addDynamicPriorityFee(transaction, connection, priorityLevel);
      }

      // Execute the operation with the enhanced transaction
      const result = await operation(transaction, priorityLevel, attempt);
      
      if (attempt > 0) {
        console.log(`✅ Operation succeeded on attempt ${attempt + 1} with ${priorityLevel} priority`);
      }
      
      return result;

    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts - 1) {
        console.error(`❌ Operation failed after ${maxAttempts} attempts. Final error:`, error.message);
        break;
      }

      // Check if this is a fee-related error that might benefit from higher priority
      const isFeeError = error.message.includes('insufficient') || 
                        error.message.includes('priority') ||
                        error.message.includes('compute') ||
                        error.message.includes('timeout') ||
                        error.message.includes('blockhash');

      if (isFeeError) {
        console.log(`💰 Fee-related error detected, will escalate priority on next attempt`);
      }

      // Exponential backoff delay
      const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Get all priority levels for comparison and monitoring
 * @param {Connection} connection - Solana connection
 * @param {Transaction} transaction - Transaction to estimate fees for
 * @returns {Promise<Object>} Object with all priority levels and their fees
 */
export async function getAllPriorityLevels(connection, transaction) {
  try {
    // Ensure transaction has required fields
    if (!transaction.recentBlockhash) {
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
    }

    const serializedTransaction = bs58.encode(
      transaction.serialize({ requireAllSignatures: false, verifySignatures: false })
    );

    const response = await fetch(connection.rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'getPriorityFeeEstimate',
        params: [{
          transaction: serializedTransaction,
          options: {
            includeAllPriorityFeeLevels: true
          }
        }]
      })
    });

    const result = await response.json();

    if (result.error) {
      throw new Error(`Helius API error: ${JSON.stringify(result.error)}`);
    }

    return result.result.priorityFeeLevels;

  } catch (error) {
    console.warn(`⚠️  Failed to get all priority levels: ${error.message}`);
    return {
      min: 0,
      low: 1000,
      medium: 5000,
      high: 15000,
      veryHigh: 50000,
      unsafeMax: 100000
    };
  }
}

/**
 * Log priority fee analysis for monitoring
 * @param {Connection} connection - Solana connection
 * @param {Transaction} transaction - Transaction to analyze
 */
export async function logPriorityFeeAnalysis(connection, transaction) {
  try {
    console.log('\n📊 Priority Fee Analysis:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const levels = await getAllPriorityLevels(connection, transaction);
    
    Object.entries(levels).forEach(([level, fee]) => {
      const feeSOL = (fee * 200000 / 1e9).toFixed(6); // Estimate for ~200k compute units
      console.log(`  ${level.padEnd(10)}: ${fee.toLocaleString().padStart(8)} μ-lamports (~${feeSOL} SOL)`);
    });
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.warn(`⚠️  Priority fee analysis failed: ${error.message}`);
  }
}
