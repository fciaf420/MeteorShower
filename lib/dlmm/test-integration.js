/**
 * test-integration.js - Test the refactored DLMM module structure
 * Per REFACTORING_PLAN.md Phase 3
 */

import { Connection, Keypair } from '@solana/web3.js';
import * as dlmm from '../dlmm.js';

console.log('🧪 Testing refactored DLMM module integration...\n');

// Test 1: Check all exports are available
console.log('✓ Test 1: Checking exports');
const expectedExports = [
  'openDlmmPosition',
  'recenterPosition',
  'checkExistingPosition',
  'calculatePositionValue',
  'checkRebalanceNeeded',
  'scanWalletForCompatibleTokens',
  'fetchBalances',
  'logPositionBinDistribution',
  'resolveTotalBinsSpan',
  'validatePositionParams',
  'analyzeFees',
  'claimFeesFromPosition',
  'balanceTokenRatio',
  'calculateSwapAmount',
  'handleError',
  'ERROR_CODES',
  'StrategyType'
];

let missingExports = [];
for (const exportName of expectedExports) {
  if (!(exportName in dlmm)) {
    missingExports.push(exportName);
  }
}

if (missingExports.length > 0) {
  console.log('❌ Missing exports:', missingExports);
  process.exit(1);
} else {
  console.log('   All expected exports are available ✅');
}

// Test 2: Check function types
console.log('\n✓ Test 2: Checking function types');
const functionExports = [
  'openDlmmPosition',
  'recenterPosition',
  'checkExistingPosition',
  'calculatePositionValue',
  'checkRebalanceNeeded',
  'scanWalletForCompatibleTokens',
  'fetchBalances',
  'logPositionBinDistribution',
  'resolveTotalBinsSpan',
  'validatePositionParams',
  'analyzeFees',
  'claimFeesFromPosition',
  'balanceTokenRatio',
  'calculateSwapAmount',
  'handleError'
];

let nonFunctions = [];
for (const funcName of functionExports) {
  if (typeof dlmm[funcName] !== 'function') {
    nonFunctions.push(`${funcName} (type: ${typeof dlmm[funcName]})`);
  }
}

if (nonFunctions.length > 0) {
  console.log('❌ Non-function exports:', nonFunctions);
  process.exit(1);
} else {
  console.log('   All functions have correct types ✅');
}

// Test 3: Check ERROR_CODES object
console.log('\n✓ Test 3: Checking ERROR_CODES');
if (typeof dlmm.ERROR_CODES !== 'object') {
  console.log(`❌ ERROR_CODES is not an object (type: ${typeof dlmm.ERROR_CODES})`);
  process.exit(1);
}

const expectedErrorCodes = [
  'POSITION_EXISTS',
  'INSUFFICIENT_BALANCE',
  'POOL_NOT_FOUND',
  'TRANSACTION_FAILED',
  'SLIPPAGE_EXCEEDED',
  'NETWORK_ERROR',
  'VALIDATION_ERROR',
  'UNKNOWN_ERROR'
];

let missingErrorCodes = [];
for (const code of expectedErrorCodes) {
  if (!(code in dlmm.ERROR_CODES)) {
    missingErrorCodes.push(code);
  }
}

if (missingErrorCodes.length > 0) {
  console.log('❌ Missing error codes:', missingErrorCodes);
  process.exit(1);
} else {
  console.log('   All error codes present ✅');
}

// Test 4: Check StrategyType
console.log('\n✓ Test 4: Checking StrategyType');
if (typeof dlmm.StrategyType !== 'object') {
  console.log(`❌ StrategyType is not an object (type: ${typeof dlmm.StrategyType})`);
  process.exit(1);
} else {
  console.log('   StrategyType is available ✅');
}

// Test 5: Test validatePositionParams
console.log('\n✓ Test 5: Testing validation function');
const validationResult = dlmm.validatePositionParams({
  connection: {},
  userKeypair: { publicKey: {} },
  poolAddress: 'test'
});

if (typeof validationResult !== 'object' || !('valid' in validationResult)) {
  console.log('❌ validatePositionParams return format incorrect');
  process.exit(1);
} else {
  console.log('   Validation function works ✅');
}

console.log('\n🎉 All integration tests passed!');
console.log('✅ The refactored module structure is working correctly\n');

console.log('📊 Module Statistics:');
console.log(`   • Total exports: ${Object.keys(dlmm).length}`);
console.log(`   • Functions: ${functionExports.length}`);
console.log(`   • Constants/Objects: ${Object.keys(dlmm).length - functionExports.length}`);

console.log('\n🚀 Phase 3 Integration Test Complete!');
