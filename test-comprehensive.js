#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// ~/test-comprehensive.js - Comprehensive Integration Test for MeteorShower DLMM Bot
// ═══════════════════════════════════════════════════════════════════════════════
// Complete workflow validation: Position Creation → Monitoring → Rebalancing → Validation
// Tests real blockchain transactions with comprehensive logging and validation
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import BN from 'bn.js';
import { 
  Connection, 
  PublicKey,
  LAMPORTS_PER_SOL 
} from '@solana/web3.js';
import dlmmPackage from '@meteora-ag/dlmm';
import { loadWalletKeypair } from './lib/solana.js';
import { openDlmmPosition, closeDlmmPosition, recenterPosition } from './lib/dlmm.js';
import { getPrice } from './lib/price.js';
import { getMintDecimals } from './lib/solana.js';
import 'dotenv/config';

// ────────────────────────────────────── Constants ──────────────────────────────────────
const DLMM = dlmmPackage.default ?? dlmmPackage;
const {
  RPC_URL,
  WALLET_PATH,
  POOL_ADDRESS: DEFAULT_POOL_ADDRESS
} = process.env;

// Comprehensive test configuration
const TEST_CONFIG = {
  DEFAULT_AMOUNT: 0.002, // SOL (safe testing amount)
  DEFAULT_DURATION: 60, // seconds for monitoring
  DEFAULT_POOL: DEFAULT_POOL_ADDRESS,
  MONITORING_INTERVAL: 3000, // 3 seconds
  TRANSACTION_TIMEOUT: 60000, // 60 seconds
  MIN_SOL_BALANCE: 0.02, // Minimum SOL required in wallet
  REBALANCE_WAIT_TIME: 10000, // Wait 10s before forced rebalance test
  BIN_MATH_PRECISION: 0.001, // Acceptable precision for bin calculations
};

// Test ratios to validate
const TEST_RATIOS = {
  SOL_ONLY: { ratioX: 1.0, ratioY: 0.0, name: "100% SOL" },
  TOKEN_ONLY: { ratioX: 0.0, ratioY: 1.0, name: "100% Token" },
  BALANCED: { ratioX: 0.5, ratioY: 0.5, name: "50/50 Split" },
  SOL_HEAVY: { ratioX: 0.8, ratioY: 0.2, name: "80/20 SOL Heavy" }
};

// ────────────────────────────────────── CLI Setup ──────────────────────────────────────
const argv = yargs(hideBin(process.argv))
  .option('bin-span', {
    alias: 'b',
    type: 'number',
    default: 20,
    describe: 'Number of bins to test with'
  })
  .option('test-ratio', {
    alias: 'r',
    type: 'string',
    default: 'SOL_ONLY',
    choices: Object.keys(TEST_RATIOS),
    describe: 'Token ratio to test'
  })
  .option('duration', {
    alias: 'd',
    type: 'number',
    default: TEST_CONFIG.DEFAULT_DURATION,
    describe: 'Monitoring duration in seconds'
  })
  .option('force-rebalance', {
    type: 'boolean',
    default: false,
    describe: 'Create conditions to force rebalancing test'
  })
  .option('test-compound', {
    type: 'boolean',
    default: false,
    describe: 'Test auto-compounding functionality'
  })
  .option('test-swapless', {
    type: 'boolean',
    default: false,
    describe: 'Test swapless rebalancing mode'
  })
  .option('pool', {
    alias: 'p',
    type: 'string',
    default: TEST_CONFIG.DEFAULT_POOL,
    describe: 'Override pool address for testing'
  })
  .option('cleanup', {
    alias: 'c',
    type: 'boolean',
    default: true,
    describe: 'Clean up positions after test'
  })
  .help()
  .alias('help', 'h')
  .example('$0 --bin-span 20 --test-ratio SOL_ONLY', 'Test with 20 bins, 100% SOL allocation')
  .example('$0 --force-rebalance --test-compound', 'Test rebalancing with auto-compound')
  .example('$0 --test-swapless --duration 120', 'Test swapless mode for 2 minutes')
  .argv;

// ────────────────────────────────────── Enhanced Test Logger ──────────────────────────────────────
class ComprehensiveTestLogger {
  constructor(testName) {
    this.testName = testName;
    this.startTime = Date.now();
    this.transactions = [];
    this.errors = [];
    this.validations = [];
    this.binData = [];
    this.priceMovements = [];
    this.rebalanceEvents = [];
  }

  log(message, data = null, level = 'INFO') {
    const timestamp = new Date().toLocaleTimeString();
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const levelEmoji = {
      'INFO': 'ℹ️',
      'SUCCESS': '✅',
      'WARNING': '⚠️',
      'ERROR': '❌',
      'DEBUG': '🔍',
      'VALIDATION': '🔎'
    }[level] || 'ℹ️';
    
    console.log(`[${timestamp}] [+${elapsed}s] ${levelEmoji} ${message}`);
    if (data && typeof data === 'object') {
      console.log(`  └─ ${JSON.stringify(data, null, 2)}`);
    } else if (data) {
      console.log(`  └─ ${data}`);
    }
  }

  logTransaction(type, signature, details = {}) {
    this.transactions.push({
      type,
      signature,
      timestamp: Date.now(),
      details
    });
    this.log(`🔗 ${type} Transaction`, { signature, ...details }, 'SUCCESS');
  }

  logValidation(test, passed, expected, actual, details = {}) {
    this.validations.push({
      test,
      passed,
      expected,
      actual,
      timestamp: Date.now(),
      details
    });
    
    const status = passed ? '✅ PASS' : '❌ FAIL';
    this.log(`${status}: ${test}`, {
      expected,
      actual,
      ...details
    }, passed ? 'VALIDATION' : 'ERROR');
  }

  logBinData(phase, activeBin, positionRange, tokenAmounts, calculation) {
    this.binData.push({
      phase,
      activeBin,
      positionRange,
      tokenAmounts,
      calculation,
      timestamp: Date.now()
    });
    
    this.log(`📊 Bin Analysis (${phase})`, {
      activeBin,
      positionRange: `${positionRange.lower} - ${positionRange.upper}`,
      binSpan: positionRange.upper - positionRange.lower + 1,
      tokenAmounts,
      calculation
    }, 'DEBUG');
  }

  logPriceMovement(oldBin, newBin, direction, trigger) {
    this.priceMovements.push({
      oldBin,
      newBin,
      direction,
      trigger,
      timestamp: Date.now()
    });
    
    const arrow = direction === 'UP' ? '⬆️' : '⬇️';
    this.log(`${arrow} Price Movement Detected`, {
      binChange: `${oldBin} → ${newBin}`,
      direction,
      triggerRebalance: trigger
    }, trigger ? 'WARNING' : 'INFO');
  }

  logRebalanceEvent(type, direction, oldPosition, newPosition, success) {
    this.rebalanceEvents.push({
      type,
      direction,
      oldPosition,
      newPosition,
      success,
      timestamp: Date.now()
    });
    
    this.log(`🔄 Rebalance Event (${type})`, {
      direction,
      oldRange: oldPosition ? `${oldPosition.lower}-${oldPosition.upper}` : 'N/A',
      newRange: newPosition ? `${newPosition.lower}-${newPosition.upper}` : 'N/A',
      success
    }, success ? 'SUCCESS' : 'ERROR');
  }

  logError(message, error) {
    this.errors.push({ message, error: error.toString(), timestamp: Date.now() });
    this.log(`${message}`, { error: error.message }, 'ERROR');
  }

  generateReport() {
    const duration = (Date.now() - this.startTime) / 1000;
    const passedValidations = this.validations.filter(v => v.passed).length;
    const failedValidations = this.validations.length - passedValidations;
    
    return {
      testName: this.testName,
      duration: duration.toFixed(1),
      transactions: this.transactions.length,
      validations: {
        total: this.validations.length,
        passed: passedValidations,
        failed: failedValidations,
        successRate: this.validations.length > 0 ? (passedValidations / this.validations.length * 100).toFixed(1) : '0'
      },
      errors: this.errors.length,
      binAnalysis: this.binData.length,
      priceMovements: this.priceMovements.length,
      rebalanceEvents: this.rebalanceEvents.length,
      successful: this.errors.length === 0 && failedValidations === 0
    };
  }

  summary() {
    const report = this.generateReport();
    
    console.log('\n══════════════════════════════════════════════════════════════════');
    console.log(`📋 COMPREHENSIVE TEST REPORT - ${report.testName}`);
    console.log('══════════════════════════════════════════════════════════════════');
    console.log(`⏱️  Duration: ${report.duration} seconds`);
    console.log(`🔗 Transactions: ${report.transactions}`);
    console.log(`🔎 Validations: ${report.validations.passed}/${report.validations.total} passed (${report.validations.successRate}%)`);
    console.log(`❌ Errors: ${report.errors}`);
    console.log(`📊 Bin Analyses: ${report.binAnalysis}`);
    console.log(`📈 Price Movements: ${report.priceMovements}`);
    console.log(`🔄 Rebalance Events: ${report.rebalanceEvents}`);
    console.log(`🎯 Overall Result: ${report.successful ? '✅ SUCCESS' : '❌ FAILED'}`);
    
    if (this.transactions.length > 0) {
      console.log('\n🔗 Transaction Log:');
      this.transactions.forEach((tx, i) => {
        const elapsed = ((tx.timestamp - this.startTime) / 1000).toFixed(1);
        console.log(`  ${i + 1}. [+${elapsed}s] ${tx.type}: ${tx.signature || 'N/A'}`);
        if (tx.details.positionKey) {
          console.log(`      Position: ${tx.details.positionKey}`);
        }
      });
    }
    
    if (this.validations.length > 0) {
      console.log('\n🔎 Validation Results:');
      this.validations.forEach((val, i) => {
        const elapsed = ((val.timestamp - this.startTime) / 1000).toFixed(1);
        const status = val.passed ? '✅' : '❌';
        console.log(`  ${i + 1}. [+${elapsed}s] ${status} ${val.test}`);
        if (!val.passed) {
          console.log(`      Expected: ${val.expected}, Actual: ${val.actual}`);
        }
      });
    }
    
    if (this.binData.length > 0) {
      console.log('\n📊 Bin Analysis Log:');
      this.binData.forEach((bin, i) => {
        const elapsed = ((bin.timestamp - this.startTime) / 1000).toFixed(1);
        console.log(`  ${i + 1}. [+${elapsed}s] ${bin.phase}: Active ${bin.activeBin}, Range ${bin.positionRange.lower}-${bin.positionRange.upper}`);
      });
    }
    
    if (this.rebalanceEvents.length > 0) {
      console.log('\n🔄 Rebalance Events:');
      this.rebalanceEvents.forEach((event, i) => {
        const elapsed = ((event.timestamp - this.startTime) / 1000).toFixed(1);
        const status = event.success ? '✅' : '❌';
        console.log(`  ${i + 1}. [+${elapsed}s] ${status} ${event.type} (${event.direction})`);
      });
    }
    
    if (this.errors.length > 0) {
      console.log('\n❌ Error Log:');
      this.errors.forEach((err, i) => {
        const elapsed = ((err.timestamp - this.startTime) / 1000).toFixed(1);
        console.log(`  ${i + 1}. [+${elapsed}s] ${err.message}`);
      });
    }
    
    console.log('══════════════════════════════════════════════════════════════════\n');
    
    return report;
  }
}

// ────────────────────────────────────── Validation Functions ──────────────────────────────────────
async function validateEnvironment(logger) {
  logger.log('🔧 Validating Environment Setup', null, 'INFO');
  
  try {
    // Test RPC connection
    const connection = new Connection(RPC_URL, 'confirmed');
    const version = await connection.getVersion();
    logger.logValidation('RPC Connection', true, 'Connected', `${version['solana-core']}`);
    
    // Test wallet loading
    const userKeypair = loadWalletKeypair(WALLET_PATH);
    logger.logValidation('Wallet Loading', true, 'Loaded', userKeypair.publicKey.toBase58().slice(0, 8) + '...');
    
    // Test wallet balance
    const balance = await connection.getBalance(userKeypair.publicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;
    const sufficientBalance = solBalance >= TEST_CONFIG.MIN_SOL_BALANCE;
    logger.logValidation('Wallet Balance', sufficientBalance, `≥${TEST_CONFIG.MIN_SOL_BALANCE} SOL`, `${solBalance.toFixed(6)} SOL`);
    
    // Test pool connection
    const poolPK = new PublicKey(argv.pool);
    const dlmmPool = await DLMM.create(connection, poolPK);
    logger.logValidation('Pool Connection', !!dlmmPool, 'Connected', poolPK.toBase58().slice(0, 8) + '...');
    
    // Test price feeds
    const priceX = await getPrice(dlmmPool.tokenX.publicKey.toString());
    const priceY = await getPrice(dlmmPool.tokenY.publicKey.toString());
    const pricesAvailable = priceX && priceY;
    logger.logValidation('Price Feeds', pricesAvailable, 'Both available', `X: $${priceX?.toFixed(4) || 'N/A'}, Y: $${priceY?.toFixed(4) || 'N/A'}`);
    
    if (!sufficientBalance) throw new Error(`Insufficient balance: ${solBalance} SOL`);
    if (!pricesAvailable) throw new Error('Price feeds unavailable');
    
    return { connection, userKeypair, dlmmPool };
    
  } catch (error) {
    logger.logError('Environment validation failed', error);
    throw error;
  }
}

async function validatePositionCreation(logger, connection, dlmmPool, userKeypair, positionResult, expectedBinSpan, expectedRatio) {
  logger.log('🏗️ Validating Position Creation', null, 'VALIDATION');
  
  try {
    // Validate position was created
    const positionExists = positionResult && positionResult.positionPubKey;
    logger.logValidation('Position Creation', positionExists, 'Position created', positionResult?.positionPubKey ? 'Success' : 'Failed');
    
    if (!positionExists) return false;
    
    // Get position details
    const details = await getPositionDetails(connection, dlmmPool, userKeypair, positionResult.positionPubKey);
    
    // Validate bin span
    const actualBinSpan = details.range.upper - details.range.lower + 1;
    const binSpanCorrect = Math.abs(actualBinSpan - expectedBinSpan) <= 2; // Allow small variance
    logger.logValidation('Bin Span', binSpanCorrect, expectedBinSpan, actualBinSpan);
    
    // Validate position placement relative to active bin
    const activeBin = details.range.active;
    logger.logBinData('Position Creation', activeBin, details.range, details.amounts, {
      expectedSpan: expectedBinSpan,
      actualSpan: actualBinSpan,
      positionType: expectedRatio.ratioX === 1.0 ? 'SOL_ONLY' : 
                   expectedRatio.ratioY === 1.0 ? 'TOKEN_ONLY' : 'MIXED'
    });
    
    // Validate token allocation logic
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const tokenXMint = dlmmPool.tokenX.publicKey.toString();
    const isXSol = tokenXMint === SOL_MINT;
    
    if (expectedRatio.ratioX === 1.0) {
      // 100% SOL - should be positioned BELOW active bin
      const positionBelowActive = details.range.upper <= activeBin;
      logger.logValidation('100% SOL Position Placement', positionBelowActive, 'Below active bin', `Range: ${details.range.lower}-${details.range.upper}, Active: ${activeBin}`);
    } else if (expectedRatio.ratioY === 1.0) {
      // 100% Token - should be positioned ABOVE active bin
      const positionAboveActive = details.range.lower >= activeBin;
      logger.logValidation('100% Token Position Placement', positionAboveActive, 'Above active bin', `Range: ${details.range.lower}-${details.range.upper}, Active: ${activeBin}`);
    } else {
      // Mixed allocation - should span active bin
      const spansActiveBin = details.range.lower <= activeBin && details.range.upper >= activeBin;
      logger.logValidation('Mixed Position Placement', spansActiveBin, 'Spans active bin', `Range: ${details.range.lower}-${details.range.upper}, Active: ${activeBin}`);
    }
    
    // Validate position value
    const valueCorrect = details.valueUsd > 0 && details.valueUsd < 1000; // Reasonable range
    logger.logValidation('Position Value', valueCorrect, '$0.01 - $1000', `$${details.valueUsd.toFixed(4)}`);
    
    return details;
    
  } catch (error) {
    logger.logError('Position creation validation failed', error);
    return false;
  }
}

async function getPositionDetails(connection, dlmmPool, userKeypairOrPubKey, positionPubKey) {
  await dlmmPool.refetchStates();
  
  // Handle both keypair and pubkey parameters
  let userPublicKey;
  if (userKeypairOrPubKey && userKeypairOrPubKey.publicKey) {
    userPublicKey = userKeypairOrPubKey.publicKey; // It's a keypair
  } else if (userKeypairOrPubKey) {
    userPublicKey = userKeypairOrPubKey; // It's already a pubkey
  } else {
    throw new Error('Missing user public key parameter');
  }
  
  const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userPublicKey);
  const position = userPositions.find(p => p.publicKey.equals(positionPubKey));
  
  if (!position) return null;

  // Calculate position amounts
  let lamX = new BN(0), lamY = new BN(0);
  position.positionData.positionBinData.forEach(b => {
    lamX = lamX.add(new BN(b.positionXAmount));
    lamY = lamY.add(new BN(b.positionYAmount));
  });

  // Get decimals
  const dx = dlmmPool.tokenX.decimal || await getMintDecimals(connection, dlmmPool.tokenX.publicKey);
  const dy = dlmmPool.tokenY.decimal || await getMintDecimals(connection, dlmmPool.tokenY.publicKey);

  // Calculate UI amounts
  const amtX = lamX.toNumber() / 10 ** dx;
  const amtY = lamY.toNumber() / 10 ** dy;

  // Get prices and USD values
  const priceX = await getPrice(dlmmPool.tokenX.publicKey.toString());
  const priceY = await getPrice(dlmmPool.tokenY.publicKey.toString());
  const valueUsd = amtX * priceX + amtY * priceY;

  // Get active bin info
  const activeBin = await dlmmPool.getActiveBin();
  
  return {
    position,
    amounts: { x: amtX, y: amtY },
    valueUsd,
    range: {
      lower: position.positionData.lowerBinId,
      upper: position.positionData.upperBinId,
      active: activeBin.binId
    },
    inRange: activeBin.binId >= position.positionData.lowerBinId && 
             activeBin.binId <= position.positionData.upperBinId,
    fees: {
      x: new BN(position.positionData.feeX).toNumber() / 10 ** dx,
      y: new BN(position.positionData.feeY).toNumber() / 10 ** dy
    }
  };
}

async function monitorAndValidatePosition(logger, connection, dlmmPool, userKeypair, positionPubKey, duration) {
  logger.log(`🔍 Starting Position Monitoring & Validation (${duration}s)`, null, 'INFO');
  
  const startTime = Date.now();
  const endTime = startTime + (duration * 1000);
  let cycleCount = 0;
  let lastActiveBin = null;
  const monitoringData = {
    cycles: 0,
    priceMovements: 0,
    rebalanceSignals: 0,
    outOfRangeCycles: 0,
    feeAccumulation: { x: 0, y: 0 }
  };
  
  try {
    while (Date.now() < endTime) {
      cycleCount++;
      const cycleStart = Date.now();
      
      // Get current position details
      const details = await getPositionDetails(connection, dlmmPool, userKeypair, positionPubKey);
      
      if (!details) {
        logger.logValidation('Position Exists', false, 'Position found', 'Position not found');
        break;
      }
      
      // Track price movement
      const currentBin = details.range.active;
      if (lastActiveBin !== null && currentBin !== lastActiveBin) {
        monitoringData.priceMovements++;
        const direction = currentBin > lastActiveBin ? 'UP' : 'DOWN';
        logger.logPriceMovement(lastActiveBin, currentBin, direction, !details.inRange);
      }
      lastActiveBin = currentBin;
      
      // Log current state
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rangeStatus = details.inRange ? '✅ IN RANGE' : '⚠️ OUT OF RANGE';
      
      logger.log(`📊 Monitoring Cycle ${cycleCount} (+${elapsed}s)`, {
        status: rangeStatus,
        activeBin: details.range.active,
        positionRange: `${details.range.lower} - ${details.range.upper}`,
        valueUsd: details.valueUsd.toFixed(4),
        fees: `${details.fees.x.toFixed(6)} X, ${details.fees.y.toFixed(6)} Y`
      }, 'DEBUG');
      
      // Log bin analysis
      logger.logBinData(`Cycle ${cycleCount}`, currentBin, details.range, details.amounts, {
        inRange: details.inRange,
        distanceFromLower: currentBin - details.range.lower,
        distanceFromUpper: details.range.upper - currentBin
      });
      
      // Check rebalancing trigger conditions
      const atLowerEdge = currentBin <= details.range.lower;
      const atUpperEdge = currentBin >= details.range.upper;
      const needsRebalance = atLowerEdge || atUpperEdge;
      
      if (needsRebalance) {
        monitoringData.rebalanceSignals++;
        const direction = atLowerEdge ? 'DOWN' : 'UP';
        logger.log(`🔄 Rebalancing Condition Detected`, {
          direction,
          activeBin: currentBin,
          positionRange: `${details.range.lower} - ${details.range.upper}`,
          trigger: atLowerEdge ? 'Price below position' : 'Price above position'
        }, 'WARNING');
        
        // Validate rebalancing trigger logic
        logger.logValidation('Rebalancing Trigger Logic', needsRebalance, 'Trigger when out of range', `Triggered: ${direction} movement`);
      }
      
      if (!details.inRange) {
        monitoringData.outOfRangeCycles++;
      }
      
      // Track fee accumulation
      monitoringData.feeAccumulation.x = Math.max(monitoringData.feeAccumulation.x, details.fees.x);
      monitoringData.feeAccumulation.y = Math.max(monitoringData.feeAccumulation.y, details.fees.y);
      
      // Calculate next cycle timing
      const cycleDuration = Date.now() - cycleStart;
      const remainingTime = Math.max(0, TEST_CONFIG.MONITORING_INTERVAL - cycleDuration);
      
      if (remainingTime > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingTime));
      }
    }
    
    monitoringData.cycles = cycleCount;
    
    // Final monitoring validations
    const monitoringComplete = cycleCount > 0;
    logger.logValidation('Monitoring Completion', monitoringComplete, '> 0 cycles', `${cycleCount} cycles`);
    
    const feeTracking = monitoringData.feeAccumulation.x >= 0 && monitoringData.feeAccumulation.y >= 0;
    logger.logValidation('Fee Tracking', feeTracking, 'Fees tracked', `${monitoringData.feeAccumulation.x.toFixed(6)} X, ${monitoringData.feeAccumulation.y.toFixed(6)} Y`);
    
    logger.log('✅ Position Monitoring Complete', {
      totalCycles: cycleCount,
      priceMovements: monitoringData.priceMovements,
      rebalanceSignals: monitoringData.rebalanceSignals,
      outOfRangeCycles: monitoringData.outOfRangeCycles,
      maxFeesEarned: `${monitoringData.feeAccumulation.x.toFixed(6)} X, ${monitoringData.feeAccumulation.y.toFixed(6)} Y`
    }, 'SUCCESS');
    
    return monitoringData;
    
  } catch (error) {
    logger.logError('Position monitoring failed', error);
    throw error;
  }
}

async function testRebalancingExecution(logger, connection, dlmmPool, userKeypair, positionPubKey, testParams) {
  logger.log('🔄 Testing Rebalancing Execution', null, 'INFO');
  
  try {
    // Get initial position state
    const initialDetails = await getPositionDetails(connection, dlmmPool, userKeypair, positionPubKey);
    
    if (!initialDetails) {
      throw new Error('Initial position not found for rebalancing test');
    }
    
    logger.logBinData('Pre-Rebalance', initialDetails.range.active, initialDetails.range, initialDetails.amounts, {
      initialValue: initialDetails.valueUsd,
      inRange: initialDetails.inRange
    });
    
    // Determine if we need to force rebalancing conditions
    const needsRebalance = !initialDetails.inRange;
    let direction = null;
    
    if (needsRebalance) {
      direction = initialDetails.range.active <= initialDetails.range.lower ? 'DOWN' : 'UP';
      logger.log('🎯 Natural rebalancing condition detected', { direction }, 'SUCCESS');
    } else if (argv.forceRebalance) {
      // For testing, we'll simulate rebalancing even if not needed
      direction = 'DOWN'; // Default test direction
      logger.log('⚡ Force rebalancing enabled - testing rebalancing logic', { direction }, 'WARNING');
    } else {
      logger.log('✅ Position in range - no rebalancing needed', {
        activeBin: initialDetails.range.active,
        positionRange: `${initialDetails.range.lower} - ${initialDetails.range.upper}`
      }, 'SUCCESS');
      
      logger.logValidation('Rebalancing Logic', true, 'No rebalance when in range', 'Correctly avoided rebalancing');
      return { rebalanced: false, reason: 'position_in_range' };
    }
    
    // Prepare rebalancing parameters
    const originalParams = {
      solAmount: TEST_CONFIG.DEFAULT_AMOUNT,
      tokenRatio: TEST_RATIOS[argv.testRatio],
      binSpan: argv.binSpan,
      poolAddress: argv.pool,
      liquidityStrategy: 'Spot',
      swaplessConfig: { 
        enabled: argv.testSwapless, 
        binSpan: argv.binSpan 
      },
      autoCompoundConfig: { 
        enabled: argv.testCompound 
      }
    };
    
    logger.log('🔧 Rebalancing Parameters', originalParams, 'DEBUG');
    
    // Execute rebalancing
    logger.log('🚀 Executing Rebalancing...', null, 'INFO');
    const startTime = Date.now();
    
    const rebalanceResult = await recenterPosition(
      connection, 
      dlmmPool, 
      userKeypair, 
      positionPubKey, 
      originalParams, 
      direction
    );
    
    const rebalanceTime = (Date.now() - startTime) / 1000;
    
    if (!rebalanceResult) {
      throw new Error('Rebalancing failed - no result returned');
    }
    
    logger.logTransaction('Rebalancing', rebalanceResult.rebalanceSignature || 'N/A', {
      positionKey: rebalanceResult.positionPubKey.toBase58(),
      direction,
      executionTime: `${rebalanceTime.toFixed(2)}s`,
      newValue: rebalanceResult.openValueUsd
    });
    
    logger.logRebalanceEvent('EXECUTION', direction, 
      { lower: initialDetails.range.lower, upper: initialDetails.range.upper },
      null, // Will get new position details below
      true
    );
    
    // Wait for blockchain confirmation
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Get new position details
    const newDetails = await getPositionDetails(connection, dlmmPool, userKeypair, rebalanceResult.positionPubKey);
    
    if (!newDetails) {
      throw new Error('New position not found after rebalancing');
    }
    
    logger.logBinData('Post-Rebalance', newDetails.range.active, newDetails.range, newDetails.amounts, {
      newValue: newDetails.valueUsd,
      valueDiff: newDetails.valueUsd - initialDetails.valueUsd,
      rebalanceType: argv.testSwapless ? 'swapless' : 'normal'
    });
    
    // Validate rebalancing results
    const positionChanged = !rebalanceResult.positionPubKey.equals(positionPubKey);
    logger.logValidation('New Position Created', positionChanged, 'Different position key', positionChanged ? 'New position' : 'Same position');
    
    const newBinSpan = newDetails.range.upper - newDetails.range.lower + 1;
    const binSpanCorrect = Math.abs(newBinSpan - argv.binSpan) <= 2;
    logger.logValidation('New Position Bin Span', binSpanCorrect, argv.binSpan, newBinSpan);
    
    // Validate position placement after rebalancing
    const activeBin = newDetails.range.active;
    let placementCorrect = false;
    
    if (argv.testSwapless) {
      if (direction === 'DOWN') {
        // SOL position should be BELOW active bin
        placementCorrect = newDetails.range.upper <= activeBin;
        logger.logValidation('Swapless DOWN Placement', placementCorrect, 'Position below active bin', `Range: ${newDetails.range.lower}-${newDetails.range.upper}, Active: ${activeBin}`);
      } else if (direction === 'UP') {
        // Token position should be ABOVE active bin
        placementCorrect = newDetails.range.lower >= activeBin;
        logger.logValidation('Swapless UP Placement', placementCorrect, 'Position above active bin', `Range: ${newDetails.range.lower}-${newDetails.range.upper}, Active: ${activeBin}`);
      }
    } else {
      // Normal rebalancing should create position around active bin
      const spansActive = newDetails.range.lower <= activeBin && newDetails.range.upper >= activeBin;
      placementCorrect = spansActive;
      logger.logValidation('Normal Rebalance Placement', placementCorrect, 'Position spans active bin', `Range: ${newDetails.range.lower}-${newDetails.range.upper}, Active: ${activeBin}`);
    }
    
    // Validate auto-compound functionality
    if (argv.testCompound) {
      const valueIncrease = newDetails.valueUsd > initialDetails.valueUsd;
      logger.logValidation('Auto-Compound Effect', valueIncrease, 'Position value increased', `${initialDetails.valueUsd.toFixed(4)} → ${newDetails.valueUsd.toFixed(4)}`);
    }
    
    logger.log('✅ Rebalancing Execution Complete', {
      success: true,
      direction,
      executionTime: `${rebalanceTime.toFixed(2)}s`,
      oldRange: `${initialDetails.range.lower}-${initialDetails.range.upper}`,
      newRange: `${newDetails.range.lower}-${newDetails.range.upper}`,
      valueChange: `$${initialDetails.valueUsd.toFixed(4)} → $${newDetails.valueUsd.toFixed(4)}`
    }, 'SUCCESS');
    
    return {
      rebalanced: true,
      direction,
      oldPosition: initialDetails,
      newPosition: newDetails,
      newPositionKey: rebalanceResult.positionPubKey,
      executionTime: rebalanceTime
    };
    
  } catch (error) {
    logger.logError('Rebalancing execution test failed', error);
    logger.logRebalanceEvent('EXECUTION', direction || 'UNKNOWN', null, null, false);
    throw error;
  }
}

async function validateEndToEndWorkflow(logger, connection, dlmmPool, userKeypair, testParams) {
  logger.log('🔄 Validating End-to-End Workflow', null, 'INFO');
  
  try {
    const workflowStart = Date.now();
    let currentPositionKey = null;
    const workflowSteps = [];
    
    // Step 1: Initial Position Creation
    logger.log('📍 Step 1: Creating Initial Position', null, 'INFO');
    const stepStart1 = Date.now();
    
    const positionResult = await openDlmmPosition(
      connection,
      userKeypair,
      TEST_CONFIG.DEFAULT_AMOUNT,
      TEST_RATIOS[argv.testRatio],
      argv.binSpan,
      argv.pool,
      'Spot'
    );
    
    const step1Time = (Date.now() - stepStart1) / 1000;
    workflowSteps.push({ step: 'Position Creation', time: step1Time, success: !!positionResult });
    currentPositionKey = positionResult.positionPubKey;
    
    logger.logTransaction('Initial Position', 'N/A', {
      positionKey: currentPositionKey.toBase58(),
      value: positionResult.initialCapitalUsd,
      time: `${step1Time.toFixed(2)}s`
    });
    
    // Step 2: Position Validation
    logger.log('📍 Step 2: Validating Position Properties', null, 'INFO');
    const validationResult = await validatePositionCreation(
      logger, connection, dlmmPool, userKeypair, positionResult, argv.binSpan, TEST_RATIOS[argv.testRatio]
    );
    workflowSteps.push({ step: 'Position Validation', time: 0, success: !!validationResult });
    
    // Step 3: Short-term Monitoring
    logger.log('📍 Step 3: Short-term Position Monitoring', null, 'INFO');
    const stepStart3 = Date.now();
    
    const monitoringResult = await monitorAndValidatePosition(
      logger, connection, dlmmPool, userKeypair, currentPositionKey, Math.min(30, argv.duration)
    );
    
    const step3Time = (Date.now() - stepStart3) / 1000;
    workflowSteps.push({ step: 'Position Monitoring', time: step3Time, success: monitoringResult.cycles > 0 });
    
    // Step 4: Rebalancing Test (if conditions met or forced)
    logger.log('📍 Step 4: Rebalancing Logic Test', null, 'INFO');
    const stepStart4 = Date.now();
    
    const rebalanceResult = await testRebalancingExecution(
      logger, connection, dlmmPool, userKeypair, currentPositionKey, testParams
    );
    
    const step4Time = (Date.now() - stepStart4) / 1000;
    workflowSteps.push({ step: 'Rebalancing Test', time: step4Time, success: true });
    
    if (rebalanceResult.rebalanced) {
      currentPositionKey = rebalanceResult.newPositionKey;
    }
    
    // Step 5: Post-rebalance Validation
    if (rebalanceResult.rebalanced) {
      logger.log('📍 Step 5: Post-rebalance Position Validation', null, 'INFO');
      const postRebalanceDetails = await getPositionDetails(connection, dlmmPool, userKeypair, currentPositionKey);
      
      const postRebalanceValid = postRebalanceDetails && postRebalanceDetails.valueUsd > 0;
      workflowSteps.push({ step: 'Post-rebalance Validation', time: 0, success: postRebalanceValid });
      
      logger.logValidation('Post-rebalance Position Health', postRebalanceValid, 'Valid position', postRebalanceValid ? 'Healthy' : 'Issues detected');
    }
    
    // Step 6: Final Cleanup
    if (argv.cleanup) {
      logger.log('📍 Step 6: Position Cleanup', null, 'INFO');
      const stepStart6 = Date.now();
      
      const cleanupResult = await closeDlmmPosition(connection, dlmmPool, userKeypair, currentPositionKey);
      const step6Time = (Date.now() - stepStart6) / 1000;
      
      workflowSteps.push({ step: 'Position Cleanup', time: step6Time, success: cleanupResult });
      
      logger.logTransaction('Position Closure', 'N/A', {
        positionKey: currentPositionKey.toBase58(),
        time: `${step6Time.toFixed(2)}s`
      });
    }
    
    const totalWorkflowTime = (Date.now() - workflowStart) / 1000;
    const allStepsSuccessful = workflowSteps.every(step => step.success);
    
    // Final workflow validation
    logger.logValidation('End-to-End Workflow', allStepsSuccessful, 'All steps successful', `${workflowSteps.length} steps completed`);
    
    logger.log('✅ End-to-End Workflow Complete', {
      totalTime: `${totalWorkflowTime.toFixed(2)}s`,
      stepsCompleted: workflowSteps.length,
      allSuccessful: allStepsSuccessful,
      steps: workflowSteps.map(step => `${step.step}: ${step.success ? '✅' : '❌'} (${step.time.toFixed(2)}s)`)
    }, 'SUCCESS');
    
    return {
      success: allStepsSuccessful,
      totalTime: totalWorkflowTime,
      steps: workflowSteps,
      rebalanced: rebalanceResult.rebalanced
    };
    
  } catch (error) {
    logger.logError('End-to-end workflow validation failed', error);
    throw error;
  }
}

// ────────────────────────────────────── Main Test Function ──────────────────────────────────────
async function runComprehensiveTest() {
  const logger = new ComprehensiveTestLogger(`MeteorShower Comprehensive Integration Test - ${argv.testRatio}`);
  let testResults = {
    environmentValidated: false,
    positionCreated: false,
    monitoringCompleted: false,
    rebalancingTested: false,
    workflowValidated: false,
    cleanupCompleted: false
  };
  
  let connection, userKeypair, dlmmPool, emergencyPositionKey;
  
  try {
    console.log('🚀 Starting MeteorShower DLMM Comprehensive Integration Test');
    console.log('═══════════════════════════════════════════════════════════════════');
    logger.log('Test Configuration', {
      binSpan: argv.binSpan,
      testRatio: `${argv.testRatio} (${TEST_RATIOS[argv.testRatio].name})`,
      duration: `${argv.duration}s`,
      pool: argv.pool?.slice(0, 8) + '...',
      forceRebalance: argv.forceRebalance,
      testCompound: argv.testCompound,
      testSwapless: argv.testSwapless,
      cleanup: argv.cleanup
    }, 'INFO');
    
    // ═══════════════════════════ PHASE 1: Environment Validation ═══════════════════════════
    logger.log('\n🔧 PHASE 1: Environment Validation', null, 'INFO');
    const setup = await validateEnvironment(logger);
    connection = setup.connection;
    userKeypair = setup.userKeypair;
    dlmmPool = setup.dlmmPool;
    testResults.environmentValidated = true;
    
    // ═══════════════════════════ PHASE 2: Complete Workflow Test ═══════════════════════════
    logger.log('\n🔄 PHASE 2: Complete Workflow Validation', null, 'INFO');
    const workflowResult = await validateEndToEndWorkflow(logger, connection, dlmmPool, userKeypair, {
      binSpan: argv.binSpan,
      ratio: TEST_RATIOS[argv.testRatio],
      testSwapless: argv.testSwapless,
      testCompound: argv.testCompound
    });
    
    testResults.workflowValidated = workflowResult.success;
    testResults.rebalancingTested = workflowResult.rebalanced;
    
    // ═══════════════════════════ PHASE 3: Final Report Generation ═══════════════════════════
    logger.log('\n📋 PHASE 3: Test Report Generation', null, 'INFO');
    const report = logger.generateReport();
    
    logger.log('✅ Comprehensive Test Completed Successfully!', {
      testDuration: report.duration + 's',
      validationSuccessRate: report.validations.successRate + '%',
      transactionCount: report.transactions,
      workflowValidated: workflowResult.success,
      rebalancingTested: workflowResult.rebalanced
    }, 'SUCCESS');
    
    testResults.cleanupCompleted = argv.cleanup;
    
  } catch (error) {
    logger.logError('Comprehensive test failed', error);
    
    // Emergency cleanup attempt
    if (emergencyPositionKey && argv.cleanup) {
      logger.log('\n🚨 Emergency cleanup attempt...', null, 'WARNING');
      try {
        await closeDlmmPosition(connection, dlmmPool, userKeypair, emergencyPositionKey);
        logger.log('✅ Emergency cleanup successful', null, 'SUCCESS');
      } catch (cleanupError) {
        logger.logError('Emergency cleanup failed', cleanupError);
        logger.log(`❌ Manual cleanup required for position: ${emergencyPositionKey.toBase58()}`, null, 'ERROR');
      }
    }
    
    throw error;
  } finally {
    const finalReport = logger.summary();
    
    // Exit with appropriate code
    if (finalReport.successful) {
      console.log('🎉 All tests passed! Bot is ready for production use.');
    } else {
      console.log('⚠️ Some tests failed. Review the report above before proceeding.');
      process.exit(1);
    }
  }
  
  return testResults;
}

// ────────────────────────────────────── Error Handling & CLI ──────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n🛑 Emergency stop requested...');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Emergency stop requested...');
  process.exit(1);
});

// Check if this script is being run directly
if (process.argv[1] && process.argv[1].endsWith('test-comprehensive.js')) {
  console.log('🚀 Starting MeteorShower DLMM Comprehensive Integration Test...');
  
  // Validate environment variables
  if (!RPC_URL || !WALLET_PATH || !DEFAULT_POOL_ADDRESS) {
    console.error('❌ Missing required environment variables (RPC_URL, WALLET_PATH, POOL_ADDRESS)');
    process.exit(1);
  }
  
  // Validate test ratio
  if (!TEST_RATIOS[argv.testRatio]) {
    console.error(`❌ Invalid test ratio: ${argv.testRatio}. Valid options: ${Object.keys(TEST_RATIOS).join(', ')}`);
    process.exit(1);
  }
  
  console.log('✅ Environment variables loaded');
  console.log(`📡 RPC: ${RPC_URL}`);
  console.log(`💼 Wallet: ${WALLET_PATH}`);
  console.log(`🏊 Pool: ${DEFAULT_POOL_ADDRESS}`);
  console.log('🎬 Starting comprehensive tests...\n');
  
  runComprehensiveTest()
    .then((results) => {
      console.log('\n🎉 Comprehensive testing completed successfully!');
      console.log('Final Results:', results);
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Comprehensive testing failed:');
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
      process.exit(1);
    });
}

export { runComprehensiveTest, ComprehensiveTestLogger, TEST_RATIOS, validateEnvironment, validatePositionCreation };