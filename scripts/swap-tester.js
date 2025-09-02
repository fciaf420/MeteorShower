#!/usr/bin/env node
// ───────────────────────────────────────────────
// ~/scripts/swap-tester.js
// Jupiter API Testing Suite - Ultra vs Regular
// ───────────────────────────────────────────────

import { testUltraSwap } from './test-ultra-swap.js';
import { testRegularSwap } from './test-regular-swap.js';
import readline from 'readline';

function showHeader() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    🚀 JUPITER SWAP TESTER 🚀                   ║
║                                                                ║
║  Comprehensive testing suite for Jupiter Ultra API vs         ║
║  Regular Jupiter API to identify and resolve swap failures    ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
}

function showMenu() {
  console.log(`
🎯 SELECT TEST MODE:
──────────────────────────────────────────────────────────────────

1️⃣  Ultra API Test      - Test Jupiter Ultra API swap
2️⃣  Regular API Test    - Test Jupiter Regular API swap  
3️⃣  Compare Both        - Run both tests sequentially
4️⃣  Help & Info         - Show API differences and troubleshooting
5️⃣  Exit                - Quit tester

──────────────────────────────────────────────────────────────────`);
}

function showHelp() {
  console.log(`
📚 JUPITER API COMPARISON & TROUBLESHOOTING GUIDE
══════════════════════════════════════════════════════════════════

🔥 ULTRA API vs 📊 REGULAR API:

┌─────────────────┬─────────────────────┬─────────────────────┐
│   FEATURE       │     ULTRA API       │    REGULAR API      │
├─────────────────┼─────────────────────┼─────────────────────┤
│ Endpoint        │ /ultra/v1/*         │ /swap/v1/*          │
│ Slippage        │ Real-time (RTSE)    │ Fixed/Dynamic       │
│ RFQ Support     │ ✅ Yes (Jupiterz)    │ ❌ No               │
│ Optimization    │ ✅ Auto-handled      │ 🔧 Manual config    │
│ Speed           │ ⚡ Faster            │ 🐌 Standard         │
│ Complexity      │ 🟢 Simple           │ 🟡 More setup      │
│ Reliability     │ 🟡 Beta/Service     │ 🟢 Production       │
└─────────────────┴─────────────────────┴─────────────────────┘

🚨 COMMON ULTRA API ISSUES:
───────────────────────────────────────────────────────────────
• "No transaction in order response" - Backend service issues
• "Taker has insufficient input" - Balance indexing lag (needs delay)
• Missing transaction field - Jupiter Ultra API backend problems

🔧 COMMON REGULAR API ISSUES:
────────────────────────────────────────────────────────────────
• High slippage - Use dynamic slippage or increase tolerance
• Transaction timeouts - Optimize priority fees and compute limits
• Route failures - Check liquidity and token availability

💡 TROUBLESHOOTING TIPS:
────────────────────────────────────────────────────────────────
1. Test with small amounts first (0.01 SOL)
2. Use common trading pairs (SOL/USDC) for initial tests
3. Check network congestion and adjust priority fees
4. Verify wallet has sufficient balance for fees
5. Monitor Solana network status for outages

🔗 USEFUL LINKS:
─────────────────────────────────────────────────────────────────
• Jupiter Docs: https://docs.jup.ag/
• Solana Status: https://status.solana.com/
• Transaction Explorer: https://solscan.io/
• RPC Health: https://solanabeach.io/validators

`);
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

async function runComparison() {
  console.log(`
🔄 RUNNING BOTH API TESTS FOR COMPARISON
════════════════════════════════════════════════════════════════

This will run both Ultra API and Regular API tests with the same
parameters to help identify which API is working better.

Note: You'll be prompted for parameters twice (once for each test).
For accurate comparison, use the same values for both tests.

`);

  const proceed = await askQuestion(`Continue with comparison test? (y/N): `);
  if (proceed.toLowerCase() !== 'y' && proceed.toLowerCase() !== 'yes') {
    console.log(`❌ Comparison cancelled`);
    return;
  }

  console.log(`\n┌─────────────────────────────────────────────────┐`);
  console.log(`│            🔥 ULTRA API TEST                    │`);
  console.log(`└─────────────────────────────────────────────────┘`);
  
  await testUltraSwap().catch(error => {
    console.error(`Ultra API test failed:`, error.message);
  });

  console.log(`\n\n┌─────────────────────────────────────────────────┐`);
  console.log(`│            📊 REGULAR API TEST                  │`);
  console.log(`└─────────────────────────────────────────────────┘`);
  
  await testRegularSwap().catch(error => {
    console.error(`Regular API test failed:`, error.message);
  });

  console.log(`\n🏁 COMPARISON COMPLETE`);
  console.log(`Review the results above to determine which API performed better.`);
}

async function main() {
  showHeader();
  
  while (true) {
    showMenu();
    
    const choice = await askQuestion(`\nEnter your choice (1-5): `);
    
    switch (choice) {
      case '1':
        console.log(`\n🔥 Starting Ultra API Test...`);
        await testUltraSwap().catch(error => {
          console.error(`Ultra API test failed:`, error.message);
        });
        break;
        
      case '2':
        console.log(`\n📊 Starting Regular API Test...`);
        await testRegularSwap().catch(error => {
          console.error(`Regular API test failed:`, error.message);
        });
        break;
        
      case '3':
        await runComparison();
        break;
        
      case '4':
        showHelp();
        await askQuestion(`\nPress Enter to continue...`);
        break;
        
      case '5':
        console.log(`\n👋 Goodbye! Happy swapping!`);
        process.exit(0);
        break;
        
      default:
        console.log(`\n❌ Invalid choice. Please select 1-5.`);
        break;
    }
    
    console.log(`\n${'═'.repeat(60)}`);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log(`\n\n👋 Test interrupted. Goodbye!`);
  process.exit(0);
});

// Run the main function
main().catch(error => {
  console.error(`\n💥 Fatal error:`, error.message);
  process.exit(1);
});