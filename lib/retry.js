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
export { withRetry };