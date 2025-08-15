// ───────────────────────────────────────────────
// ~/lib/retry.js
// ───────────────────────────────────────────────
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

export { withRetry, withProgressiveSlippage };