// ───────────────────────────────────────────────
// ~/lib/retry.js
// ───────────────────────────────────────────────
import { withProgressivePriorityFee, getProgressivePriorityLevel } from './priority-fee.js';

async function withRetry(fn, label, maxAttempts = 3, delayMs = 500) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        console.error(`❌ [${label}] attempt ${attempt} failed: ${err.message}`);
        if (attempt < maxAttempts) {
          console.log(`↻ [${label}] retrying in ${delayMs}ms…`);
          await new Promise(r => setTimeout(r, delayMs));
        } else {
          console.error(`🚨 [${label}] all ${maxAttempts} attempts failed.`);
          throw err;
        }
      }
    }
  }

// Enhanced retry with dynamic priority fee escalation
async function withDynamicRetry(fn, label, options = {}) {
  const { 
    maxAttempts = 3, 
    delayMs = 500, 
    connection = null, 
    getTransaction = null,
    escalatePriorityFees = true 
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let priorityLevel = null;
      
      if (escalatePriorityFees) {
        priorityLevel = getProgressivePriorityLevel(attempt - 1);
        if (attempt > 1) {
          console.log(`💰 Escalating to ${priorityLevel} priority fees (attempt ${attempt})`);
        }
      }

      return await fn(attempt - 1, priorityLevel);
      
    } catch (err) {
      console.error(`❌ [${label}] attempt ${attempt} failed: ${err.message}`);
      
      if (attempt < maxAttempts) {
        const nextPriorityLevel = escalatePriorityFees ? getProgressivePriorityLevel(attempt) : null;
        const priorityMsg = nextPriorityLevel ? ` with ${nextPriorityLevel} priority fees` : '';
        console.log(`↻ [${label}] retrying in ${delayMs}ms${priorityMsg}…`);
        
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        console.error(`🚨 [${label}] all ${maxAttempts} attempts failed.`);
        throw err;
      }
    }
  }
}

// Progressive slippage retry for DLMM position creation
async function withProgressiveSlippage(fn, label, maxAttempts = 6, delayMs = 500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Progressive slippage: 1%, 2%, 3%, then 3% for remaining attempts
      const slippage = Math.min(attempt, 3);
      return await fn(slippage);
    } catch (err) {
      console.error(`❌ [${label}] attempt ${attempt} failed (${Math.min(attempt, 3)}% slippage): ${err.message}`);
      if (attempt < maxAttempts) {
        console.log(`↻ [${label}] retrying in ${delayMs}ms with ${Math.min(attempt + 1, 3)}% slippage…`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        console.error(`🚨 [${label}] all ${maxAttempts} attempts failed.`);
        throw err;
      }
    }
  }
}

// Enhanced progressive slippage with dynamic priority fee escalation  
async function withProgressiveSlippageAndFees(fn, label, options = {}) {
  const { 
    maxAttempts = 6, 
    delayMs = 500, 
    connection = null, 
    escalatePriorityFees = true 
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Progressive slippage: 1%, 2%, 3%, then 3% for remaining attempts
      const slippage = Math.min(attempt, 3);
      let priorityLevel = null;
      
      if (escalatePriorityFees) {
        priorityLevel = getProgressivePriorityLevel(attempt - 1);
        if (attempt > 1) {
          console.log(`💰🎯 Escalating to ${priorityLevel} priority fees + ${slippage}% slippage (attempt ${attempt})`);
        }
      }

      return await fn(slippage, attempt - 1, priorityLevel);
      
    } catch (err) {
      const currentSlippage = Math.min(attempt, 3);
      console.error(`❌ [${label}] attempt ${attempt} failed (${currentSlippage}% slippage): ${err.message}`);
      
      if (attempt < maxAttempts) {
        const nextSlippage = Math.min(attempt + 1, 3);
        const nextPriorityLevel = escalatePriorityFees ? getProgressivePriorityLevel(attempt) : null;
        const priorityMsg = nextPriorityLevel ? ` + ${nextPriorityLevel} priority fees` : '';
        console.log(`↻ [${label}] retrying in ${delayMs}ms with ${nextSlippage}% slippage${priorityMsg}…`);
        
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        console.error(`🚨 [${label}] all ${maxAttempts} attempts failed.`);
        throw err;
      }
    }
  }
}

export { 
  withRetry, 
  withDynamicRetry, 
  withProgressiveSlippage, 
  withProgressiveSlippageAndFees,
  withProgressivePriorityFee  // Re-export from priority-fee.js
};