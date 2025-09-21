/**
 * error-handler.js - Centralized error handling
 * Per REFACTORING_PLAN.md lines 35-37
 * 
 * New module for consistent error handling across DLMM operations
 */

import { logger } from '../../logger.js';

/**
 * Custom error class for DLMM operations
 */
export class DLMMError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'DLMMError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Error codes for DLMM operations
 */
export const ERROR_CODES = {
  // Position errors
  POSITION_EXISTS: 'POSITION_EXISTS',
  POSITION_NOT_FOUND: 'POSITION_NOT_FOUND',
  POSITION_CREATION_FAILED: 'POSITION_CREATION_FAILED',
  
  // Balance errors
  INSUFFICIENT_SOL: 'INSUFFICIENT_SOL',
  INSUFFICIENT_TOKEN: 'INSUFFICIENT_TOKEN',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  
  // Swap errors
  SWAP_FAILED: 'SWAP_FAILED',
  SLIPPAGE_EXCEEDED: 'SLIPPAGE_EXCEEDED',
  PRICE_IMPACT_TOO_HIGH: 'PRICE_IMPACT_TOO_HIGH',
  
  // Fee errors
  FEE_CLAIM_FAILED: 'FEE_CLAIM_FAILED',
  FEE_THRESHOLD_NOT_MET: 'FEE_THRESHOLD_NOT_MET',
  
  // Network errors
  RPC_ERROR: 'RPC_ERROR',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  
  // Validation errors
  INVALID_PARAMS: 'INVALID_PARAMS',
  INVALID_POOL: 'INVALID_POOL',
  INVALID_STRATEGY: 'INVALID_STRATEGY',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  
  // Pool errors
  POOL_NOT_FOUND: 'POOL_NOT_FOUND',
  
  // General errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * Handle and log errors consistently
 * 
 * @param {Error} error - Error to handle
 * @param {string} context - Context where error occurred
 * @param {Object} metadata - Additional metadata
 * @returns {DLMMError} Formatted error
 */
export function handleError(error, context, metadata = {}) {
  // Log the error
  logger.error(`[${context}] ${error.message}`, {
    error: error.stack,
    ...metadata
  });
  
  // Determine error code based on error message
  let errorCode = ERROR_CODES.RPC_ERROR;
  
  if (error.message.includes('insufficient')) {
    if (error.message.includes('SOL')) {
      errorCode = ERROR_CODES.INSUFFICIENT_SOL;
    } else {
      errorCode = ERROR_CODES.INSUFFICIENT_FUNDS;
    }
  } else if (error.message.includes('slippage')) {
    errorCode = ERROR_CODES.SLIPPAGE_EXCEEDED;
  } else if (error.message.includes('position')) {
    if (error.message.includes('not found')) {
      errorCode = ERROR_CODES.POSITION_NOT_FOUND;
    } else if (error.message.includes('exists')) {
      errorCode = ERROR_CODES.POSITION_EXISTS;
    } else {
      errorCode = ERROR_CODES.POSITION_CREATION_FAILED;
    }
  } else if (error.message.includes('swap')) {
    errorCode = ERROR_CODES.SWAP_FAILED;
  }
  
  // Return formatted error
  return new DLMMError(
    error.message,
    errorCode,
    {
      originalError: error,
      context,
      ...metadata
    }
  );
}

/**
 * Retry operation with error handling
 * 
 * @param {Function} operation - Operation to retry
 * @param {Object} options - Retry options
 * @returns {Promise<any>} Operation result
 */
export async function retryWithErrorHandling(operation, options = {}) {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    context = 'operation',
    exponentialBackoff = true
  } = options;
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      
      // Don't retry on certain errors
      if (error.code === ERROR_CODES.INVALID_PARAMS ||
          error.code === ERROR_CODES.INVALID_POOL) {
        throw error;
      }
      
      if (attempt < maxAttempts) {
        const delay = exponentialBackoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;
        console.log(`⚠️ [${context}] Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw handleError(lastError, context, { attempts: maxAttempts });
}

/**
 * Extract error message from various error types
 * 
 * @param {any} error - Error object
 * @returns {string} Error message
 */
export function extractErrorMessage(error) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error?.message) return error.message;
  if (error?.error) return extractErrorMessage(error.error);
  if (error?.logs && Array.isArray(error.logs)) {
    const errorLog = error.logs.find(log => log.includes('Error') || log.includes('failed'));
    if (errorLog) return errorLog;
  }
  return 'Unknown error';
}

/**
 * Check if error is retryable
 * 
 * @param {Error} error - Error to check
 * @returns {boolean} True if retryable
 */
export function isRetryableError(error) {
  const nonRetryableCodes = [
    ERROR_CODES.INVALID_PARAMS,
    ERROR_CODES.INVALID_POOL,
    ERROR_CODES.INVALID_STRATEGY,
    ERROR_CODES.POSITION_EXISTS,
    ERROR_CODES.FEE_THRESHOLD_NOT_MET
  ];
  
  if (error instanceof DLMMError) {
    return !nonRetryableCodes.includes(error.code);
  }
  
  // Check for specific error messages
  const message = extractErrorMessage(error).toLowerCase();
  const nonRetryableMessages = [
    'invalid',
    'not found',
    'already exists',
    'unauthorized'
  ];
  
  return !nonRetryableMessages.some(msg => message.includes(msg));
}

/**
 * Format error for user display
 * 
 * @param {Error} error - Error to format
 * @returns {string} User-friendly error message
 */
export function formatErrorForUser(error) {
  if (error instanceof DLMMError) {
    switch (error.code) {
      case ERROR_CODES.INSUFFICIENT_SOL:
        return 'Insufficient SOL balance. Please add more SOL to your wallet.';
      case ERROR_CODES.INSUFFICIENT_FUNDS:
        return 'Insufficient token balance for this operation.';
      case ERROR_CODES.POSITION_EXISTS:
        return 'A position already exists for this pool.';
      case ERROR_CODES.POSITION_NOT_FOUND:
        return 'Position not found. It may have been closed.';
      case ERROR_CODES.SLIPPAGE_EXCEEDED:
        return 'Transaction failed due to slippage. Try increasing slippage tolerance.';
      case ERROR_CODES.SWAP_FAILED:
        return 'Token swap failed. Please try again.';
      case ERROR_CODES.RPC_ERROR:
        return 'Network error. Please check your connection and try again.';
      default:
        return error.message;
    }
  }
  
  return extractErrorMessage(error);
}
