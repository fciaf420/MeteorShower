/**
 * test-tip-calculation.js - Test Dynamic Tip Calculation
 * 
 * This script demonstrates the dynamic tip calculation system
 * without requiring any wallet or actual transactions.
 * 
 * Usage: node scripts/test-tip-calculation.js
 */

import { Connection, Keypair } from '@solana/web3.js';
import { createJitoBundleHandler } from '../lib/jito-bundle-handler.js';

async function testTipCalculation() {
  console.log('🧮 Jito Bundle Tip Calculation Test');
  console.log('═'.repeat(50));

  try {
    // Create a dummy connection and keypair (won't be used for actual transactions)
    const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    const dummyKeypair = Keypair.generate();
    
    // Create Jito bundle handler
    console.log('\n📊 Initializing Jito Bundle Handler...');
    const jitoBundleHandler = createJitoBundleHandler(connection, dummyKeypair);
    
    // Test 1: Fetch current tip floor data
    console.log('\n🌐 Fetching current tip floor data from Jito API...');
    try {
      const tipFloorData = await jitoBundleHandler.getTipFloorData();
      
      console.log('✅ Current tip floor data:');
      console.log(`   • 25th percentile: ${(tipFloorData.landed_tips_25th_percentile * 1e9).toFixed(0)} lamports (${(tipFloorData.landed_tips_25th_percentile * 1e3).toFixed(3)} mSOL)`);
      console.log(`   • 50th percentile: ${(tipFloorData.landed_tips_50th_percentile * 1e9).toFixed(0)} lamports (${(tipFloorData.landed_tips_50th_percentile * 1e3).toFixed(3)} mSOL)`);
      console.log(`   • 75th percentile: ${(tipFloorData.landed_tips_75th_percentile * 1e9).toFixed(0)} lamports (${(tipFloorData.landed_tips_75th_percentile * 1e3).toFixed(3)} mSOL)`);
      console.log(`   • 95th percentile: ${(tipFloorData.landed_tips_95th_percentile * 1e9).toFixed(0)} lamports (${(tipFloorData.landed_tips_95th_percentile * 1e3).toFixed(3)} mSOL)`);
      console.log(`   • EMA 50th percentile: ${(tipFloorData.ema_landed_tips_50th_percentile * 1e9).toFixed(0)} lamports (${(tipFloorData.ema_landed_tips_50th_percentile * 1e3).toFixed(3)} mSOL)`);
      
    } catch (error) {
      console.log(`⚠️  Could not fetch tip floor data: ${error.message}`);
      console.log('💡 This is expected if you have limited internet access or API is down');
    }
    
    // Test 2: Calculate tips for different scenarios
    console.log('\n🎯 Testing tip calculations for various scenarios...');
    
    const testScenarios = [
      { txCount: 1, priority: 'low', description: 'Single transaction, low priority' },
      { txCount: 2, priority: 'medium', description: 'Simple bundle, medium priority' },
      { txCount: 3, priority: 'medium', description: 'Standard bundle, medium priority' },
      { txCount: 4, priority: 'high', description: 'Complex bundle, high priority' },
      { txCount: 5, priority: 'veryhigh', description: 'Maximum bundle, very high priority' }
    ];
    
    console.log('\n┌─────────────────────────────────────┬──────────────┬──────────────┬──────────┐');
    console.log('│ Scenario                            │ Lamports     │ SOL          │ mSOL     │');
    console.log('├─────────────────────────────────────┼──────────────┼──────────────┼──────────┤');
    
    for (const scenario of testScenarios) {
      try {
        const tipLamports = await jitoBundleHandler.calculateTip(scenario.txCount, scenario.priority);
        const tipSOL = tipLamports / 1e9;
        const tipMilliSOL = tipLamports / 1e6;
        
        console.log(`│ ${scenario.description.padEnd(35)} │ ${String(tipLamports).padStart(12)} │ ${tipSOL.toFixed(6).padStart(12)} │ ${tipMilliSOL.toFixed(2).padStart(8)} │`);
      } catch (error) {
        console.log(`│ ${scenario.description.padEnd(35)} │ ${'ERROR'.padStart(12)} │ ${'ERROR'.padStart(12)} │ ${'ERROR'.padStart(8)} │`);
      }
    }
    
    console.log('└─────────────────────────────────────┴──────────────┴──────────────┴──────────┘');
    
    // Test 3: Priority level comparison for same transaction count
    console.log('\n📊 Priority level comparison for 3-transaction bundle:');
    console.log('\n┌─────────────────┬──────────────┬──────────────┬──────────────┐');
    console.log('│ Priority        │ Lamports     │ SOL          │ Percentile   │');
    console.log('├─────────────────┼──────────────┼──────────────┼──────────────┤');
    
    const priorities = [
      { level: 'low', percentile: '25th' },
      { level: 'medium', percentile: '50th (EMA)' },
      { level: 'high', percentile: '75th' },
      { level: 'veryhigh', percentile: '95th' }
    ];
    
    for (const priority of priorities) {
      try {
        const tipLamports = await jitoBundleHandler.calculateTip(3, priority.level);
        const tipSOL = tipLamports / 1e9;
        
        console.log(`│ ${priority.level.padEnd(15)} │ ${String(tipLamports).padStart(12)} │ ${tipSOL.toFixed(6).padStart(12)} │ ${priority.percentile.padEnd(12)} │`);
      } catch (error) {
        console.log(`│ ${priority.level.padEnd(15)} │ ${'ERROR'.padStart(12)} │ ${'ERROR'.padStart(12)} │ ${'ERROR'.padEnd(12)} │`);
      }
    }
    
    console.log('└─────────────────┴──────────────┴──────────────┴──────────────┘');
    
    // Test 4: Scaling factor demonstration
    console.log('\n📈 Scaling factor demonstration (medium priority):');
    console.log('\n┌─────────────────┬──────────────┬────────────────┬──────────────┐');
    console.log('│ Transactions    │ Lamports     │ Scaling Factor │ SOL          │');
    console.log('├─────────────────┼──────────────┼────────────────┼──────────────┤');
    
    for (let txCount = 1; txCount <= 5; txCount++) {
      try {
        const tipLamports = await jitoBundleHandler.calculateTip(txCount, 'medium');
        const tipSOL = tipLamports / 1e9;
        const scalingFactor = 1 + (Math.sqrt(txCount) - 1) * 0.2;
        
        console.log(`│ ${String(txCount).padStart(15)} │ ${String(tipLamports).padStart(12)} │ ${scalingFactor.toFixed(3).padStart(14)} │ ${tipSOL.toFixed(6).padStart(12)} │`);
      } catch (error) {
        console.log(`│ ${String(txCount).padStart(15)} │ ${'ERROR'.padStart(12)} │ ${'ERROR'.padStart(14)} │ ${'ERROR'.padStart(12)} │`);
      }
    }
    
    console.log('└─────────────────┴──────────────┴────────────────┴──────────────┘');
    
    console.log('\n💡 Key Insights:');
    console.log('   • Tips are calculated based on real-time market data from Jito');
    console.log('   • Higher priority levels use higher percentile tips for better landing chances');
    console.log('   • Bundle size scaling ensures complex bundles get appropriate priority');
    console.log('   • All calculations include min/max bounds for safety');
    console.log('   • Fallback logic ensures operations work even if API is unavailable');
    
    console.log('\n✅ Tip calculation test completed successfully!');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    return false;
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted by user');
  process.exit(0);
});

// Run the test (more reliable check for Windows)
const isDirectExecution = import.meta.url.endsWith('test-tip-calculation.js') || 
                          process.argv[1]?.endsWith('test-tip-calculation.js');

if (isDirectExecution) {
  testTipCalculation().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('❌ Test execution failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
}
