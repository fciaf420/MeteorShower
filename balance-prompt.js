// ───────────────────────────────────────────────
// ~/balance-prompt.js - Interactive SOL balance selection
// ───────────────────────────────────────────────
import 'dotenv/config';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Connection } from '@solana/web3.js';
import { loadWalletKeypair } from './lib/solana.js';

const SOL_BUFFER = 0.07; // Always reserve 0.07 SOL

async function promptSolAmount() {
  const rl = readline.createInterface({ input, output });
  
  try {
    // Get current balance
    const connection = new Connection(process.env.RPC_URL, 'confirmed');
    const keypair = loadWalletKeypair(process.env.WALLET_PATH);
    const balanceLamports = await connection.getBalance(keypair.publicKey);
    const totalBalance = balanceLamports / 1e9;
    const availableBalance = totalBalance - SOL_BUFFER;
    
    console.log('');
    console.log('💰 SOL Balance Information:');
    console.log('==========================');
    console.log(`Total balance: ${totalBalance.toFixed(6)} SOL`);
    console.log(`Reserved for fees: ${SOL_BUFFER} SOL`);
    console.log(`Available for trading: ${availableBalance.toFixed(6)} SOL`);
    console.log('');
    
    if (availableBalance <= 0) {
      console.log('❌ Insufficient balance! You need at least 0.08 SOL (0.07 for fees + 0.01 minimum for trading)');
      return null;
    }
    
    while (true) {
      console.log('How much SOL would you like to use?');
      console.log('Options:');
      console.log('  1. Enter percentage (e.g., "80%" or "50%")');
      console.log('  2. Enter fixed amount (e.g., "0.1" or "0.05")');
      console.log('  3. Type "max" to use maximum available');
      console.log('  4. Type "quit" to exit');
      console.log('');
      
      const answer = await rl.question('Your choice: ');
      const input = answer.trim().toLowerCase();
      
      if (input === 'quit' || input === 'q') {
        console.log('Operation cancelled.');
        return null;
      }
      
      if (input === 'max') {
        console.log(`Selected: ${availableBalance.toFixed(6)} SOL (maximum available)`);
        return availableBalance;
      }
      
      // Handle percentage input
      if (input.includes('%')) {
        const percentStr = input.replace('%', '');
        const percent = parseFloat(percentStr);
        
        if (isNaN(percent) || percent <= 0 || percent > 100) {
          console.log('❌ Please enter a valid percentage between 1% and 100%');
          continue;
        }
        
        const amount = (availableBalance * percent) / 100;
        console.log(`Selected: ${amount.toFixed(6)} SOL (${percent}% of available)`);
        return amount;
      }
      
      // Handle fixed amount input
      const amount = parseFloat(input);
      if (isNaN(amount) || amount <= 0) {
        console.log('❌ Please enter a valid positive number');
        continue;
      }
      
      if (amount > availableBalance) {
        console.log(`❌ Amount too high! Maximum available: ${availableBalance.toFixed(6)} SOL`);
        continue;
      }
      
      if (amount < 0.001) {
        console.log('❌ Amount too small! Minimum: 0.001 SOL');
        continue;
      }
      
      console.log(`Selected: ${amount.toFixed(6)} SOL`);
      return amount;
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    return null;
  } finally {
    rl.close();
  }
}

async function promptTokenRatio(poolInfo = {}) {
  const rl = readline.createInterface({ input, output });
  
  try {
    const { tokenXSymbol = 'TokenX', tokenYSymbol = 'TokenY' } = poolInfo;
    
    console.log('');
    console.log('⚖️  Token Allocation Ratio:');
    console.log('===========================');
    console.log(`Choose your desired allocation between ${tokenXSymbol} and ${tokenYSymbol}:`);
    console.log('');
    
    while (true) {
      console.log('🚀 Quick Ratio Menu:');
      console.log('  1️⃣  100:0  → 100% ' + tokenXSymbol + ' only');
      console.log('  2️⃣  90:10  → 90% ' + tokenXSymbol + ' / 10% ' + tokenYSymbol);
      console.log('  3️⃣  80:20  → 80% ' + tokenXSymbol + ' / 20% ' + tokenYSymbol);
      console.log('  4️⃣  70:30  → 70% ' + tokenXSymbol + ' / 30% ' + tokenYSymbol);
      console.log('  5️⃣  60:40  → 60% ' + tokenXSymbol + ' / 40% ' + tokenYSymbol);
      console.log('  6️⃣  50:50  → Balanced allocation');
      console.log('  7️⃣  40:60  → 40% ' + tokenXSymbol + ' / 60% ' + tokenYSymbol);
      console.log('  8️⃣  30:70  → 30% ' + tokenXSymbol + ' / 70% ' + tokenYSymbol);
      console.log('  9️⃣  20:80  → 20% ' + tokenXSymbol + ' / 80% ' + tokenYSymbol);
      console.log('  🔟  0:100  → 100% ' + tokenYSymbol + ' only');
      console.log('  ⚙️   custom → Enter your own ratio/percentage');
      console.log('  ❌  quit   → Exit');
      console.log('');
      
      const answer = await rl.question('Select option (1-10, custom, quit): ');
      const input = answer.trim().toLowerCase();
      
      if (input === 'quit' || input === 'q') {
        console.log('Operation cancelled.');
        return null;
      }
      
      // Handle quick menu selections
      const menuOptions = {
        '1': { ratioX: 1.0, ratioY: 0.0, desc: '100% ' + tokenXSymbol + ' only' },
        '2': { ratioX: 0.9, ratioY: 0.1, desc: '90% ' + tokenXSymbol + ' / 10% ' + tokenYSymbol },
        '3': { ratioX: 0.8, ratioY: 0.2, desc: '80% ' + tokenXSymbol + ' / 20% ' + tokenYSymbol },
        '4': { ratioX: 0.7, ratioY: 0.3, desc: '70% ' + tokenXSymbol + ' / 30% ' + tokenYSymbol },
        '5': { ratioX: 0.6, ratioY: 0.4, desc: '60% ' + tokenXSymbol + ' / 40% ' + tokenYSymbol },
        '6': { ratioX: 0.5, ratioY: 0.5, desc: 'Balanced (50/50)' },
        '7': { ratioX: 0.4, ratioY: 0.6, desc: '40% ' + tokenXSymbol + ' / 60% ' + tokenYSymbol },
        '8': { ratioX: 0.3, ratioY: 0.7, desc: '30% ' + tokenXSymbol + ' / 70% ' + tokenYSymbol },
        '9': { ratioX: 0.2, ratioY: 0.8, desc: '20% ' + tokenXSymbol + ' / 80% ' + tokenYSymbol },
        '10': { ratioX: 0.0, ratioY: 1.0, desc: '100% ' + tokenYSymbol + ' only' }
      };
      
      if (menuOptions[input]) {
        const option = menuOptions[input];
        console.log(`✅ Selected: ${option.desc}`);
        return { ratioX: option.ratioX, ratioY: option.ratioY };
      }
      
      // Handle custom input
      if (input === 'custom') {
        console.log('');
        console.log('📝 Custom Ratio Entry:');
        console.log('  Examples: "85:15", "75%", "65:35"');
        console.log('');
        const customAnswer = await rl.question('Enter your custom ratio: ');
        const customInput = customAnswer.trim().toLowerCase();
        
        if (customInput === '' || customInput === 'quit' || customInput === 'q') {
          continue; // Go back to main menu
        }
        
        // Process custom input inline
        if (customInput.includes('%')) {
          const percentStr = customInput.replace('%', '');
          const percent = parseFloat(percentStr);
          
          if (isNaN(percent) || percent < 0 || percent > 100) {
            console.log('❌ Please enter a valid percentage between 0% and 100%');
            continue;
          }
          
          const ratioX = percent / 100;
          const ratioY = 1 - ratioX;
          console.log(`✅ Selected: ${percent}% ${tokenXSymbol} / ${(ratioY * 100).toFixed(0)}% ${tokenYSymbol}`);
          return { ratioX, ratioY };
        }
        
        if (customInput.includes(':')) {
          const parts = customInput.split(':');
          if (parts.length !== 2) {
            console.log('❌ Please use format "X:Y" (e.g., "75:25")');
            continue;
          }
          
          const x = parseFloat(parts[0]);
          const y = parseFloat(parts[1]);
          
          if (isNaN(x) || isNaN(y) || x < 0 || y < 0) {
            console.log('❌ Please enter valid positive numbers');
            continue;
          }
          
          if (x === 0 && y === 0) {
            console.log('❌ Both values cannot be zero');
            continue;
          }
          
          const total = x + y;
          const ratioX = x / total;
          const ratioY = y / total;
          
          console.log(`✅ Selected: ${(ratioX * 100).toFixed(1)}% ${tokenXSymbol} / ${(ratioY * 100).toFixed(1)}% ${tokenYSymbol}`);
          return { ratioX, ratioY };
        }
        
        console.log('❌ Please enter a valid format (ratio "80:20" or percentage "80%")');
        continue;
      }
      
      console.log('❌ Please select a valid option (1-10, custom, or quit)');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    return null;
  } finally {
    rl.close();
  }
}

async function promptBinSpan(poolInfo = {}) {
  const rl = readline.createInterface({ input, output });
  
  try {
    const { binStep = 25, tokenXSymbol = 'TokenX', tokenYSymbol = 'TokenY' } = poolInfo;
    
    console.log('');
    console.log('📊 Bin Span & Price Coverage:');
    console.log('==============================');
    console.log(`Pool step size: ${binStep} basis points per bin`);
    console.log('');
    
    while (true) {
      console.log('🎯 Common Bin Spans:');
      console.log('  1️⃣  20 bins  → ' + (20 * binStep / 100).toFixed(2) + '% price coverage');
      console.log('  2️⃣  40 bins  → ' + (40 * binStep / 100).toFixed(2) + '% price coverage');
      console.log('  3️⃣  60 bins  → ' + (60 * binStep / 100).toFixed(2) + '% price coverage');
      console.log('  4️⃣  80 bins  → ' + (80 * binStep / 100).toFixed(2) + '% price coverage');
      console.log('  5️⃣  100 bins → ' + (100 * binStep / 100).toFixed(2) + '% price coverage');
      console.log('  6️⃣  150 bins → ' + (150 * binStep / 100).toFixed(2) + '% price coverage');
      console.log('  ⚙️   custom  → Enter your own bin count (10-300)');
      console.log('  ❌  quit    → Exit');
      console.log('');
      console.log('💡 More bins = wider price coverage, less concentrated liquidity');
      console.log('💡 Fewer bins = narrower coverage, more concentrated liquidity');
      console.log('');
      
      const answer = await rl.question('Select option (1-6, custom, quit): ');
      const input = answer.trim().toLowerCase();
      
      if (input === 'quit' || input === 'q') {
        console.log('Operation cancelled.');
        return null;
      }
      
      // Handle quick menu selections
      const menuOptions = {
        '1': { bins: 20, desc: '20 bins (' + (20 * binStep / 100).toFixed(2) + '% coverage)' },
        '2': { bins: 40, desc: '40 bins (' + (40 * binStep / 100).toFixed(2) + '% coverage)' },
        '3': { bins: 60, desc: '60 bins (' + (60 * binStep / 100).toFixed(2) + '% coverage)' },
        '4': { bins: 80, desc: '80 bins (' + (80 * binStep / 100).toFixed(2) + '% coverage)' },
        '5': { bins: 100, desc: '100 bins (' + (100 * binStep / 100).toFixed(2) + '% coverage)' },
        '6': { bins: 150, desc: '150 bins (' + (150 * binStep / 100).toFixed(2) + '% coverage)' }
      };
      
      if (menuOptions[input]) {
        const option = menuOptions[input];
        console.log(`✅ Selected: ${option.desc}`);
        return { binSpan: option.bins, coverage: (option.bins * binStep / 100).toFixed(2) };
      }
      
      // Handle custom input
      if (input === 'custom') {
        console.log('');
        console.log('📝 Custom Bin Count:');
        console.log('  Range: 10-300 bins');
        console.log('  Example: 75 bins = ' + (75 * binStep / 100).toFixed(2) + '% coverage');
        console.log('');
        
        const customAnswer = await rl.question('Enter bin count: ');
        const binCount = parseInt(customAnswer.trim());
        
        if (isNaN(binCount)) {
          console.log('❌ Please enter a valid number');
          continue;
        }
        
        if (binCount < 10 || binCount > 300) {
          console.log('❌ Please enter a number between 10 and 300');
          continue;
        }
        
        const coverage = (binCount * binStep / 100).toFixed(2);
        console.log(`✅ Selected: ${binCount} bins (${coverage}% price coverage)`);
        return { binSpan: binCount, coverage };
      }
      
      console.log('❌ Please select a valid option (1-6, custom, or quit)');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    return null;
  } finally {
    rl.close();
  }
}

async function promptPoolAddress() {
  const rl = readline.createInterface({ input, output });
  
  try {
    console.log('');
    console.log('🏊 Pool Address Selection:');
    console.log('=========================');
    
    // Show current pool from env
    const currentPool = process.env.POOL_ADDRESS;
    if (currentPool) {
      console.log(`Current pool: ${currentPool}`);
      console.log('');
    }
    
    while (true) {
      console.log('📋 Common Meteora DLMM Pools:');
      console.log('  1️⃣  SOL/USDC (25bp) - 6wJ7W3oHj7ex6MVFp2o26NSof3aey7U8Brs8E371WCXA');
      console.log('  2️⃣  Use current pool from .env' + (currentPool ? ` (${currentPool.slice(0, 8)}...)` : ' (none set)'));
      console.log('  ⚙️   custom → Enter your own pool address');
      console.log('  ❌  quit   → Exit');
      console.log('');
      console.log('💡 You can find pool addresses on https://app.meteora.ag/dlmm/');
      console.log('');
      
      const answer = await rl.question('Select option (1-2, custom, quit): ');
      const input = answer.trim().toLowerCase();
      
      if (input === 'quit' || input === 'q') {
        console.log('Operation cancelled.');
        return null;
      }
      
      // Handle quick selections
      if (input === '1') {
        const poolAddress = '6wJ7W3oHj7ex6MVFp2o26NSof3aey7U8Brs8E371WCXA';
        console.log(`✅ Selected: SOL/USDC pool (${poolAddress})`);
        return poolAddress;
      }
      
      if (input === '2') {
        if (!currentPool) {
          console.log('❌ No pool address set in .env file');
          continue;
        }
        console.log(`✅ Using current pool from .env: ${currentPool}`);
        return currentPool;
      }
      
      // Handle custom input
      if (input === 'custom') {
        console.log('');
        console.log('📝 Custom Pool Address:');
        console.log('  Enter the Meteora DLMM pool address (44 characters)');
        console.log('  Example: 6wJ7W3oHj7ex6MVFp2o26NSof3aey7U8Brs8E371WCXA');
        console.log('');
        
        const customAnswer = await rl.question('Enter pool address: ');
        const poolAddress = customAnswer.trim();
        
        // Basic validation
        if (!poolAddress) {
          console.log('❌ Please enter a pool address');
          continue;
        }
        
        if (poolAddress.length !== 44) {
          console.log('❌ Pool address should be 44 characters long');
          continue;
        }
        
        // Check if it's a valid base58 format (basic check)
        if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(poolAddress)) {
          console.log('❌ Invalid address format. Should contain only base58 characters');
          continue;
        }
        
        console.log(`✅ Selected custom pool: ${poolAddress}`);
        return poolAddress;
      }
      
      console.log('❌ Please select a valid option (1-2, custom, or quit)');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    return null;
  } finally {
    rl.close();
  }
}

async function promptLiquidityStrategy() {
  const rl = readline.createInterface({ input, output });
  
  try {
    console.log('');
    console.log('⚡ Liquidity Strategy Selection:');
    console.log('===============================');
    
    // Show current strategy from env
    const currentStrategy = process.env.LIQUIDITY_STRATEGY_TYPE;
    if (currentStrategy) {
      console.log(`Current strategy: ${currentStrategy}`);
      console.log('');
    }
    
    while (true) {
      console.log('🚀 Quick Strategy Menu:');
      console.log('  1️⃣  Spot    → Uniform distribution (good for volatile pairs)');
      console.log('  2️⃣  Curve   → Concentrated around current price (good for stable pairs)');
      console.log('  3️⃣  BidAsk  → Market making strategy (concentrated at bid/ask)');
      console.log('  ❌  quit    → Exit');
      console.log('');
      console.log('💡 Learn more: https://docs.meteora.ag/overview/products/dlmm/1-what-is-dlmm#liquidity-shapes');
      console.log('');
      
      const answer = await rl.question('Select option (1-3, quit): ');
      const input = answer.trim().toLowerCase();
      
      if (input === 'quit' || input === 'q') {
        console.log('Operation cancelled.');
        return null;
      }
      
      // Handle selections
      const strategies = {
        '1': { type: 'Spot', desc: 'Spot (uniform distribution for volatile pairs)' },
        '2': { type: 'Curve', desc: 'Curve (concentrated around current price)' },
        '3': { type: 'BidAsk', desc: 'BidAsk (market making strategy)' }
      };
      
      if (strategies[input]) {
        const strategy = strategies[input];
        console.log(`✅ Selected: ${strategy.desc}`);
        return strategy.type;
      }
      
      console.log('❌ Please select a valid option (1-3 or quit)');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    return null;
  } finally {
    rl.close();
  }
}

async function promptSwaplessRebalance() {
  const rl = readline.createInterface({ input, output });
  
  try {
    console.log('');
    console.log('🔄 Swapless Rebalancing Option:');
    console.log('===============================');
    console.log('Swapless rebalancing avoids swap fees by creating single-sided positions');
    console.log('when rebalancing is triggered, using whatever tokens remain from the closed position.');
    console.log('');
    console.log('💡 How it works:');
    console.log('  • Price moves UP (out of range) → Keep tokens, create position ABOVE current price');
    console.log('  • Price moves DOWN (out of range) → Keep SOL, create position BELOW current price');
    console.log('  • Position always starts at current active bin (0 distance from current price)');
    console.log('');
    
    while (true) {
      console.log('🚀 Swapless Rebalance Menu:');
      console.log('  1️⃣  Enable  → Use swapless rebalancing (specify bin span)');
      console.log('  2️⃣  Disable → Use normal rebalancing (maintains token ratios with swaps)');
      console.log('  ❌  quit   → Exit');
      console.log('');
      
      const answer = await rl.question('Select option (1-2, quit): ');
      const input = answer.trim().toLowerCase();
      
      if (input === 'quit' || input === 'q') {
        console.log('Operation cancelled.');
        return null;
      }
      
      if (input === '2') {
        console.log('✅ Selected: Normal rebalancing (with token swaps to maintain ratios)');
        return { enabled: false };
      }
      
      if (input === '1') {
        console.log('');
        console.log('📝 Swapless Bin Span Configuration:');
        console.log('  This controls how many bins the new single-sided position will span');
        console.log('  Example: 10 bins = position covers 10 bins in the appropriate direction');
        console.log('  Range: 5-100 bins (recommended: 10-30 for most pools)');
        console.log('');
        
        while (true) {
          const spanAnswer = await rl.question('Enter bin span for swapless positions (5-100): ');
          const binSpan = parseInt(spanAnswer.trim());
          
          if (isNaN(binSpan)) {
            console.log('❌ Please enter a valid number');
            continue;
          }
          
          if (binSpan < 5 || binSpan > 100) {
            console.log('❌ Please enter a number between 5 and 100');
            continue;
          }
          
          console.log(`✅ Selected: Swapless rebalancing with ${binSpan} bin span`);
          console.log(`   • UP movement: Position from current bin to current+${binSpan} (token side)`);
          console.log(`   • DOWN movement: Position from current-${binSpan} to current bin (SOL side)`);
          return { enabled: true, binSpan };
        }
      }
      
      console.log('❌ Please select a valid option (1-2 or quit)');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    return null;
  } finally {
    rl.close();
  }
}

async function promptAutoCompound() {
  const rl = readline.createInterface({ input, output });
  
  try {
    console.log('');
    console.log('💰 Auto-Compound Settings:');
    console.log('==========================');
    console.log('Auto-compounding automatically reinvests earned fees back into your position');
    console.log('during rebalancing, increasing your position size over time.');
    console.log('');
    console.log('💡 How it works:');
    console.log('  • Fees are claimed when closing positions during rebalance');
    console.log('  • Claimed fees are added to your available capital');
    console.log('  • New position is created with original capital + accumulated fees');
    console.log('  • Position grows larger with each profitable rebalance cycle');
    console.log('');
    
    while (true) {
      console.log('🚀 Auto-Compound Menu:');
      console.log('  1️⃣  Enable  → Reinvest all earned fees (recommended)');
      console.log('  2️⃣  Disable → Keep fees separate, maintain original position size');
      console.log('  ❌  quit   → Exit');
      console.log('');
      
      const answer = await rl.question('Select option (1-2, quit): ');
      const input = answer.trim().toLowerCase();
      
      if (input === 'quit' || input === 'q') {
        console.log('Operation cancelled.');
        return null;
      }
      
      if (input === '2') {
        console.log('✅ Selected: Fees kept separate (original position size maintained)');
        console.log('   • Fees will be claimed but not reinvested');
        console.log('   • Position size stays constant');
        console.log('   • Fees accumulate in your wallet');
        return { enabled: false };
      }
      
      if (input === '1') {
        console.log('✅ Selected: Auto-compound enabled');
        console.log('   • All earned fees automatically reinvested');
        console.log('   • Position size grows with profitable cycles');
        console.log('   • Compounding effect increases returns over time');
        return { enabled: true };
      }
      
      console.log('❌ Please select a valid option (1-2 or quit)');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    return null;
  } finally {
    rl.close();
  }
}

// Export the function for use in other scripts
export { promptSolAmount, promptTokenRatio, promptBinSpan, promptPoolAddress, promptLiquidityStrategy, promptSwaplessRebalance, promptAutoCompound, SOL_BUFFER };

// Run directly if this file is executed
if (import.meta.url === `file://${process.argv[1]}`) {
  promptSolAmount().then(amount => {
    if (amount !== null) {
      console.log(`\n✅ You selected: ${amount.toFixed(6)} SOL for trading`);
      console.log(`Total reserved: ${SOL_BUFFER} SOL will remain in wallet`);
    }
  });
}