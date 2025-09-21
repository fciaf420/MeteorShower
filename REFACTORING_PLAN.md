# DLMM.JS Refactoring Plan

## Current State Analysis

### File: `lib/dlmm.js`
- **Size**: ~1500 lines
- **Problems**: 
  - Persistent syntax errors (export token issues)
  - 900+ line callback function
  - Mixed responsibilities (position creation, rebalancing, fee handling, swapping)
  - Difficult to debug and maintain
  - Complex nested structure causing brace balance issues

### Dependencies Analysis
Files that import from dlmm.js:
- `main.js` - imports: `openDlmmPosition`, `recenterPosition`
- `scroll.js` - imports: `openDlmmPosition`, `recenterPosition`
- `lib/position-manager.js` - imports: `recenterPosition`, `openDlmmPosition`

---

## Refactoring Architecture

### New Module Structure
```
lib/
├── dlmm/
│   ├── core/
│   │   ├── position-creation.js    # Core position creation logic
│   │   ├── position-removal.js     # Position closing/removal logic
│   │   └── liquidity-math.js       # Liquidity calculations
│   ├── strategies/
│   │   ├── rebalance.js           # Rebalancing strategies
│   │   └── swap-logic.js          # Token swapping utilities
│   ├── handlers/
│   │   ├── fee-handler.js         # Fee claiming and processing
│   │   └── error-handler.js       # Centralized error handling
│   └── utils/
│       ├── wallet-scanner.js      # Wallet token scanning
│       ├── bin-distribution.js    # Bin calculation utilities
│       └── validation.js          # Input validation
├── dlmm-new.js                    # New clean main exports
└── dlmm.js                        # (Keep temporarily for backward compatibility)
```

---

## Module Breakdown

### 1. **`dlmm/core/position-creation.js`** (~400 lines)
**Extracted Functions:**
- `createPositionCore()` - Pure position creation without retry logic
- `initializePosition()` - Position initialization
- `addLiquidity()` - Add liquidity to position
- `calculateBinDistribution()` - Bin range calculations

**Key Logic to Extract:**
```javascript
// Lines 972-1181 from original dlmm.js
// Standard position creation (≤69 bins)
// Extended position creation (>69 bins)
// Position initialization and liquidity addition
```

### 2. **`dlmm/strategies/rebalance.js`** (~280 lines)
**Extracted Functions:**
- `recenterPosition()` - Main rebalancing function
- `closePositionForRebalance()` - Close position logic
- `calculateRebalanceParameters()` - Rebalance calculations

**Key Logic to Extract:**
```javascript
// Lines 1222-1495 from original dlmm.js
// Complete recenterPosition function
// Position closure and token recovery
```

### 3. **`dlmm/handlers/fee-handler.js`** (~150 lines)
**Extracted Functions:**
- `analyzeFees()` - Fee analysis logic
- `claimFeesToSol()` - Fee claiming and conversion
- `calculateFeeThresholds()` - Threshold calculations

**Key Logic to Extract:**
```javascript
// Lines 1382-1478 from original dlmm.js
// Fee claiming and threshold logic
// Alt token to SOL swapping
```

### 4. **`dlmm/strategies/swap-logic.js`** (~200 lines)
**Extracted Functions:**
- `balanceTokenRatio()` - Token ratio balancing
- `performSwap()` - Execute token swaps
- `calculateSwapAmount()` - Swap amount calculations

**Key Logic to Extract:**
```javascript
// Lines 430-545 from original dlmm.js
// Token ratio balancing and swapping
```

### 5. **`dlmm/utils/wallet-scanner.js`** (~100 lines)
**Extracted Functions:**
- `scanWalletForCompatibleTokens()` - Wallet scanning
- `fetchBalances()` - Balance fetching

**Key Logic to Extract:**
```javascript
// Lines 47-103 and 262-275 from original dlmm.js
```

### 6. **`dlmm/utils/bin-distribution.js`** (~150 lines)
**Extracted Functions:**
- `calculateBinRange()` - Dynamic bin distribution
- `resolveTotalBinsSpan()` - Bin span resolution
- `logPositionBinDistribution()` - Bin logging

**Key Logic to Extract:**
```javascript
// Lines 127-151 and 208-260 from original dlmm.js
```

### 7. **`dlmm-new.js`** (Main Export) (~100 lines)
**Clean Interface:**
```javascript
import { createPositionCore } from './dlmm/core/position-creation.js';
import { recenterPosition } from './dlmm/strategies/rebalance.js';
import { withProgressiveSlippageAndFees } from './retry.js';

export async function openDlmmPosition(...args) {
  // Thin wrapper with retry logic
  const executePosition = async (slippage, attempt, priority) => {
    return await createPositionCore({ ...args, slippage, priority });
  };
  
  return await withProgressiveSlippageAndFees(executePosition, 'openDlmmPosition');
}

export { recenterPosition } from './dlmm/strategies/rebalance.js';
```

---

## Migration Strategy

### Phase 1: Create New Structure (Day 1)
1. Create folder structure: `lib/dlmm/`
2. Create all new module files with basic structure
3. Copy helper functions first (utils modules)
4. Ensure no circular dependencies

### Phase 2: Extract Core Logic (Day 2)
1. Extract position creation logic → `position-creation.js`
2. Extract rebalancing logic → `rebalance.js`
3. Extract fee handling → `fee-handler.js`
4. Test each module in isolation

### Phase 3: Integration (Day 3)
1. Create `dlmm-new.js` with clean exports
2. Update imports in test files
3. Run integration tests
4. Fix any integration issues

### Phase 4: Migration (Day 4)
1. Update `main.js` to use `dlmm-new.js`
2. Update `scroll.js` to use `dlmm-new.js`
3. Update `position-manager.js`
4. Rename `dlmm.js` → `dlmm-old.js`
5. Rename `dlmm-new.js` → `dlmm.js`

---

## Testing Strategy

### Unit Tests (Per Module)
```javascript
// test/dlmm/core/position-creation.test.js
describe('Position Creation Core', () => {
  test('creates position with valid parameters');
  test('handles bin distribution correctly');
  test('validates input parameters');
});
```

### Integration Tests
```javascript
// test/integration/dlmm.test.js
describe('DLMM Integration', () => {
  test('full position creation flow');
  test('rebalancing flow');
  test('fee handling flow');
});
```

### Smoke Tests
1. Run `node cli.js` - Should work without syntax errors
2. Test position creation via CLI
3. Test rebalancing via CLI
4. Monitor for any runtime errors

---

## Risk Mitigation

### Backup Strategy
1. Keep original `dlmm.js` as `dlmm-old.js`
2. Create git branch: `refactor/dlmm-modular`
3. Incremental commits after each successful module

### Rollback Plan
1. If critical issues: `git checkout main -- lib/dlmm.js`
2. Keep backward compatibility during migration
3. Test thoroughly before removing old code

---

## Success Criteria

✅ **Code Quality**
- No syntax errors
- All functions < 100 lines
- Clear single responsibility per module

✅ **Functionality**
- All existing features work
- No regression in performance
- Better error messages

✅ **Maintainability**
- Easy to add new strategies
- Clear module boundaries
- Comprehensive documentation

---

## Timeline

**Day 1**: Structure & Utils (4 hours)
**Day 2**: Core Extraction (6 hours)
**Day 3**: Integration & Testing (4 hours)
**Day 4**: Migration & Cleanup (2 hours)

**Total Estimated Time**: 16 hours

---

## Next Steps

1. **Approval**: Review this plan and approve/modify
2. **Branch Creation**: Create `refactor/dlmm-modular` branch
3. **Start Phase 1**: Create folder structure and utils
4. **Daily Progress**: Update at end of each phase

---

## Questions to Address

1. Should we maintain backward compatibility temporarily?
2. Any specific naming conventions preferred?
3. Should we add TypeScript definitions during refactor?
4. Priority for specific modules to extract first?
