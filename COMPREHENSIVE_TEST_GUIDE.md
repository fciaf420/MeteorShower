# MeteorShower DLMM Bot - Comprehensive Integration Test Guide

## Overview

The `test-comprehensive.js` script provides complete end-to-end validation of the MeteorShower DLMM bot's functionality using real blockchain transactions. It tests the entire workflow from position creation through rebalancing with comprehensive logging and validation.

## Features

### Complete Workflow Validation
- **Position Creation**: Tests position creation with specified bin counts and token ratios
- **Bin Math Validation**: Verifies bin calculations match expected ranges and spans
- **Monitoring System**: Real-time position monitoring with price movement tracking
- **Rebalancing Logic**: Tests trigger conditions and execution of rebalancing
- **Auto-Compounding**: Validates fee reinvestment functionality
- **Swapless Mode**: Tests single-sided rebalancing without token swaps

### Enhanced Testing Capabilities
- **Real Transactions**: Uses actual blockchain transactions (not simulated)
- **Multiple Test Ratios**: Supports 100% SOL, 100% token, 50/50, and 80/20 allocations
- **Detailed Logging**: Comprehensive transaction and validation logging
- **Emergency Cleanup**: Automatic position cleanup with emergency fallback
- **Performance Metrics**: Tracks execution times and success rates

## Quick Start

### Basic Test
```bash
npm run test:comprehensive
```

### Test Specific Scenarios
```bash
# Test 100% SOL allocation
npm run test:comprehensive:sol

# Test 100% token allocation  
npm run test:comprehensive:token

# Test balanced 50/50 allocation
npm run test:comprehensive:balanced

# Test swapless rebalancing
npm run test:comprehensive:swapless

# Test auto-compounding
npm run test:comprehensive:compound

# Full comprehensive test (all features)
npm run test:comprehensive:full
```

## Command Line Options

### Core Configuration
- `--bin-span <number>` - Number of bins for position (default: 20)
- `--test-ratio <ratio>` - Token allocation ratio to test
  - `SOL_ONLY` - 100% SOL allocation (default)
  - `TOKEN_ONLY` - 100% token allocation  
  - `BALANCED` - 50/50 split
  - `SOL_HEAVY` - 80/20 SOL heavy
- `--duration <seconds>` - Monitoring duration (default: 60)
- `--pool <address>` - Override pool address for testing

### Feature Testing
- `--force-rebalance` - Create conditions to trigger rebalancing test
- `--test-compound` - Test auto-compounding functionality
- `--test-swapless` - Test swapless rebalancing mode
- `--cleanup` - Clean up positions after test (default: true)

### Examples
```bash
# Test with 30 bins, balanced allocation, 2-minute monitoring
node test-comprehensive.js --bin-span 30 --test-ratio BALANCED --duration 120

# Test swapless rebalancing with forced trigger
node test-comprehensive.js --test-swapless --force-rebalance --duration 60

# Test auto-compounding with custom pool
node test-comprehensive.js --test-compound --pool YOUR_POOL_ADDRESS --force-rebalance
```

## Test Phases

### Phase 1: Environment Validation
- ✅ RPC connection test
- ✅ Wallet loading and balance verification  
- ✅ Pool connection validation
- ✅ Price feed availability check
- ✅ Minimum balance requirements (0.02 SOL)

### Phase 2: Position Creation Testing
- ✅ Creates position with specified parameters
- ✅ Validates bin span matches specification
- ✅ Verifies position placement (above/below/spanning active bin)
- ✅ Confirms token allocation ratios
- ✅ Checks position value calculation

### Phase 3: Monitoring & Movement Detection
- ✅ Real-time position monitoring
- ✅ Price movement tracking and logging
- ✅ Range status validation (in/out of range)
- ✅ Fee accumulation monitoring
- ✅ Rebalancing trigger condition detection

### Phase 4: Rebalancing Execution
- ✅ Detects when rebalancing is needed
- ✅ Executes position closure and recreation
- ✅ Validates new position parameters
- ✅ Tests swapless vs normal rebalancing modes
- ✅ Verifies auto-compounding functionality

### Phase 5: Validation & Cleanup
- ✅ Validates end-to-end workflow completion
- ✅ Generates comprehensive test report
- ✅ Performs position cleanup (if enabled)
- ✅ Emergency cleanup on failures

## Validation Tests

### Position Creation Validation
- **Bin Span Accuracy**: Verifies actual bin span matches requested span (±2 bins tolerance)
- **Position Placement**: Validates position placement logic based on token ratio:
  - 100% SOL → Position placed BELOW active bin
  - 100% Token → Position placed ABOVE active bin  
  - Mixed ratios → Position SPANS active bin
- **Value Calculation**: Confirms position USD value is reasonable ($0.01 - $1000 range)

### Rebalancing Logic Validation
- **Trigger Conditions**: Validates rebalancing triggers when active bin moves outside position range
- **Direction Detection**: Confirms correct direction (UP/DOWN) based on price movement
- **Position Recreation**: Verifies new position uses correct parameters and placement
- **Swapless Logic**: Tests single-sided position creation in appropriate direction

### Auto-Compounding Validation
- **Fee Inclusion**: Verifies fees are added to new position capital when enabled
- **Value Growth**: Confirms position value increases when compounding fees
- **Fee Separation**: Tests that fees remain separate when compounding disabled

## Test Output & Reporting

### Real-time Logging
```
[10:30:15] [+5.2s] ✅ Position Creation
  └─ {
    "positionKey": "ABC123...",
    "binSpan": 20,
    "ratio": "100% SOL"
  }

[10:30:18] [+8.1s] 🔍 Monitoring Cycle 3 (+8.1s)
  └─ {
    "status": "✅ IN RANGE",
    "activeBin": 12345,
    "positionRange": "12340 - 12360",
    "valueUsd": "0.0048"
  }

[10:30:22] [+12.5s] 🔄 Rebalancing Condition Detected  
  └─ {
    "direction": "DOWN",
    "trigger": "Price below position"
  }
```

### Final Report
```
═══════════════════════════════════════════════════════════════════════════
📋 COMPREHENSIVE TEST REPORT - MeteorShower Integration Test - SOL_ONLY
═══════════════════════════════════════════════════════════════════════════
⏱️  Duration: 45.2 seconds
🔗 Transactions: 3
🔎 Validations: 12/12 passed (100.0%)
❌ Errors: 0
📊 Bin Analyses: 8  
📈 Price Movements: 2
🔄 Rebalance Events: 1
🎯 Overall Result: ✅ SUCCESS
```

## Safety Features

### Emergency Handling
- **Automatic Cleanup**: Failed tests trigger emergency position cleanup
- **Manual Override**: Positions can be manually closed if cleanup fails  
- **Error Logging**: Detailed error tracking for debugging
- **Signal Handling**: Graceful shutdown on CTRL+C

### Safe Testing Amounts
- **Default Amount**: 0.005 SOL (safe for testing)
- **Minimum Balance**: Requires 0.02 SOL minimum wallet balance
- **Fee Reserve**: Automatically reserves SOL for transaction fees
- **Transaction Timeouts**: 60-second timeout for blockchain confirmations

## Common Issues & Troubleshooting

### Environment Issues
```
❌ Missing required environment variables
```
**Solution**: Ensure `.env` file contains `RPC_URL`, `WALLET_PATH`, `POOL_ADDRESS`

### Balance Issues
```
❌ Insufficient balance: 0.015 SOL (need 0.02 SOL)  
```
**Solution**: Add more SOL to testing wallet (minimum 0.02 SOL required)

### Position Creation Failures
```  
❌ Position Creation Failed: Swap failed
```
**Solution**: Check if pool has sufficient liquidity or try different token ratio

### Rebalancing Not Triggering
```
✅ Position in range - no rebalancing needed
```
**Solution**: Use `--force-rebalance` flag to test rebalancing logic even when in range

### Price Feed Issues
```
❌ Price Feeds: Both available Expected: Both available, Actual: X: N/A, Y: $1.2345
```
**Solution**: Wait a moment and retry, or check if token has valid price feed

## Advanced Usage

### Custom Pool Testing
```bash
# Test with specific Meteora DLMM pool
node test-comprehensive.js --pool 6wJ7W3oHj7ex6MVFp2o26NSof3aey7U8Brs8E371WCXA --test-ratio BALANCED
```

### Extended Monitoring
```bash
# Monitor for 5 minutes to catch more price movements
node test-comprehensive.js --duration 300 --bin-span 40
```

### Multiple Feature Testing  
```bash
# Test all features in one comprehensive run
node test-comprehensive.js --force-rebalance --test-compound --test-swapless --duration 180
```

## Integration with CI/CD

### Basic Test Pipeline
```bash
# Quick validation test
npm run test:comprehensive:sol

# If successful, run full test suite  
npm run test:comprehensive:full
```

### Test Matrix
- Test each token ratio (SOL_ONLY, TOKEN_ONLY, BALANCED, SOL_HEAVY)
- Test different bin spans (10, 20, 40, 60)  
- Test feature combinations (swapless, compound)
- Validate across different pools

## Performance Benchmarks

### Expected Performance
- **Position Creation**: < 30 seconds
- **Monitoring Cycle**: < 5 seconds per cycle
- **Rebalancing Execution**: < 45 seconds  
- **Total Test Duration**: 1-3 minutes (depending on configuration)

### Success Criteria
- **Validation Success Rate**: 100% (all validations must pass)
- **Transaction Success**: All blockchain transactions confirm
- **No Errors**: Zero errors in final report
- **Proper Cleanup**: All positions closed or flagged for manual cleanup

This comprehensive test suite ensures the MeteorShower DLMM bot works correctly with real transactions and provides confidence for production deployment.