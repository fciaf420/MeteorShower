# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MeteorShower is a sophisticated automated liquidity bot for Meteora DLMM (Dynamic Liquidity Market Maker) pools on Solana. The bot provides advanced features including take profit/stop loss, swapless rebalancing, auto-compounding, and real-time P&L tracking while automatically managing liquidity positions for optimal fee capture.

## Tech Stack

- **Runtime**: Node.js with ES modules (`"type": "module"`)
- **Language**: JavaScript 
- **Blockchain**: Solana
- **Key Dependencies**:
  - `@meteora-ag/dlmm` - Core DLMM integration
  - `@solana/web3.js` - Solana blockchain interaction
  - `@solana/spl-token` - SPL token operations
  - `dotenv` - Environment configuration
  - `yargs` - CLI argument parsing

## Development Commands

### Setup & Configuration
```bash
# Install dependencies
npm install

# Interactive configuration setup with all advanced features
node configure.js

# Check wallet balance and get funding address
node balance-prompt.js

# Create .env from template
cp .env.example .env
```

### Running the Bot
```bash
# Run with default 5-second monitoring interval
node cli.js run

# Run with custom interval (in seconds)
node cli.js run --interval 30
node cli.js run -i 60

# Emergency close all positions and swap to SOL
node cli.js close

# Get help and see all commands
node cli.js --help
```

### Testing & Validation
```bash
# Available test scripts (real blockchain transactions)
npm run test:ultra-swap                  # Test Jupiter Ultra swap functionality
npm run test:regular-swap               # Test regular Jupiter swap functionality  
npm run test:swap-comparison            # Compare swap methods performance

# Manual testing recommendations
node cli.js run --interval 60           # Test with longer monitoring intervals
node balance-prompt.js                  # Verify wallet setup and balances
node configure.js                       # Test interactive configuration
```

### Utility Commands
```bash
# Manual position closure (emergency use)
node close-position.js

# Animated position display monitor
node scroll.js

# View detailed balance information
node balance-prompt.js
```

## Architecture

### Core Components

**Entry Points:**
- `cli.js` - Command line interface with yargs integration
- `main.js` - Core bot logic with P&L tracking and TP/SL system

**Utility Scripts:**
- `configure.js` - Interactive configuration with all advanced features
- `balance-prompt.js` - Balance checking and interactive prompts
- `close-position.js` - Emergency position closure
- `scroll.js` - Animated monitoring display

**Library Modules (`lib/`):**
- `dlmm.js` - DLMM position management with swapless rebalancing
- `solana.js` - Solana blockchain utilities (wallet, balances, WSOL)
- `jupiter.js` - Jupiter DEX integration for optimal token swaps
- `price.js` - CoinGecko price feed integration for USD P&L tracking
- `retry.js` - Exponential backoff retry logic
- `math.js` - Mathematical utilities for position calculations
- `logger.js` - Session-based logging with date-organized output
- `pnl-tracker.js` - Comprehensive P&L analysis with bin-level precision
- `priority-fee.js` - Dynamic priority fee management using Helius API
- `constants.js` - Shared constants to prevent conflicts across modules
- `fee-utils.js` - Transaction cost calculations and overhead management
- `balance-utils.js` - Wallet balance utilities and validation

### Advanced Features

**Take Profit & Stop Loss System:**
- Position-specific TP/SL triggers (not wallet-wide)
- Configurable profit/loss thresholds
- Automatic position closure and SOL swapping
- Real-time status monitoring in console output

**Swapless Rebalancing Strategy:**
- Direction-based rebalancing to minimize swap fees
- Price moves UP → Stay in SOL, create position BELOW price
- Price moves DOWN → Switch to TOKEN, create position ABOVE price
- Independent bin span configuration for swapless positions

**Auto-Compounding:**
- Reinvests earned fees automatically during rebalancing
- Compounds both Token X and Token Y fees proportionally
- Fee-only compounding prevents wallet balance drainage
- Configurable enable/disable setting

**Live P&L Tracking:**
- Real-time profit/loss from initial deposit in USD using comprehensive bin-level analysis
- Multiple baseline comparisons (vs hold original mix, hold all SOL, hold all token)
- Unclaimed and claimed fee tracking across all rebalances
- Session-based logging with date-organized output (`logs/YYYY-MM-DD/`)
- Clean TUI with debug toggle ('D' key) and comprehensive P&L panels

### Bot Operation Flow

1. **Interactive Setup**: User-friendly prompts for all configuration including advanced features
2. **Position Creation**: Creates DLMM position with specified parameters and liquidity strategy
3. **Monitoring Loop**: Continuous tracking with P&L calculation and TP/SL monitoring  
4. **Smart Rebalancing**: Swapless or traditional rebalancing when price exits position range
5. **Fee Compounding**: Automatic reinvestment of earned fees (if enabled)
6. **Risk Management**: Automatic position closure if TP/SL conditions are met

### Key Configuration Parameters

**Pool & Position Configuration:**
- `POOL_ADDRESS` - Target Meteora DLMM pool address
- `TOTAL_BINS_SPAN` - Number of bins in initial position
- `LOWER_COEF` - Fraction of bins below active price (0.5 = symmetric)
- `TOKEN_RATIO` - Allocation ratio (SOL_ONLY, BALANCED, TOKEN_ONLY, or custom percentage)

**Strategy Configuration:**
- `LIQUIDITY_STRATEGY` - Distribution pattern (Spot, Curve, BidAsk)
- `SWAPLESS_REBALANCE` - Enable swapless rebalancing strategy
- `SWAPLESS_BIN_SPAN` - Bin span for swapless positions (independent of initial span)
- `AUTO_COMPOUND` - Enable automatic fee reinvestment

**Risk Management:**
- `TAKE_PROFIT_PERCENT` - Take profit threshold (0.1% - 200%)
- `STOP_LOSS_PERCENT` - Stop loss threshold (0.1% - 100%)
- `CENTER_DISTANCE_THRESHOLD` - Rebalance trigger (default: 0.45)

**Technical Settings:**
- `PRIORITY_FEE_FALLBACK_MICROS` - Base fallback priority fee per compute unit in micro‑lamports (default: 50,000). Medium uses this value; High/VeryHigh use 3x and 10x when dynamic fees are unavailable.
- `PNL_CHECK_INTERVAL_SECONDS` - P&L update and TP/SL check frequency (default: 10)
- `MONITOR_INTERVAL_SECONDS` - Rebalance logic check frequency (default: 60)
- `SLIPPAGE` - Slippage tolerance in basis points (default: 10 = 0.1%)
- `PRICE_IMPACT` - Max price impact for swaps (default: 0.5%)

### Safety Features

- **SOL Buffer Management**: Reserves 0.07 SOL for transaction fees
- **Advanced Error Handling**: Retry logic with exponential backoff
- **Balance Validation**: Checks before all operations
- **Position Protection**: Uses exact balances from closed positions
- **Graceful Shutdown**: Ctrl+C handling with operation completion

### Testing System

The project includes testing scripts that perform real blockchain transactions:

**Available Test Scripts:**
- **Swap Testing**: Jupiter Ultra vs regular swap comparison
- **Performance Testing**: Response time and success rate metrics
- **Manual Testing**: Interactive configuration and balance verification

**Test Safety:**
- Start with small amounts (0.01-0.05 SOL recommended)
- All operations are on mainnet - use caution
- Monitor console output for errors and warnings
- Test configuration changes in `.env` file thoroughly

## Environment Variables

Essential variables for `.env` file:

```env
# Connection & Wallet (Required)
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE
WALLET_PATH=path/to/your/wallet.json

# Position Configuration  
POOL_ADDRESS=pool_address_here
TOTAL_BINS_SPAN=20
TOKEN_RATIO=BALANCED
LIQUIDITY_STRATEGY=Spot

# Advanced Features
SWAPLESS_REBALANCE=false
SWAPLESS_BIN_SPAN=15
AUTO_COMPOUND=false
TAKE_PROFIT_PERCENT=15
STOP_LOSS_PERCENT=10

# Technical Settings
PRIORITY_FEE_FALLBACK_MICROS=50000
PNL_CHECK_INTERVAL_SECONDS=10
MONITOR_INTERVAL_SECONDS=60
SLIPPAGE=10
LOG_LEVEL=info
```

## Important Development Notes

- **Real Blockchain Operations**: All operations execute real transactions on Solana mainnet
- **SOL Pair Requirement**: Bot only works with pools containing SOL as one token
- **WSOL Handling**: Automatically wraps/unwraps WSOL for operations
- **Fee Management**: Implements priority fees for faster confirmations
- **Position Monitoring**: Uses active bin tracking vs position range for rebalancing triggers
- **USD Valuation**: Integrates CoinGecko for real-time USD P&L calculations
- **Interactive Configuration**: All settings configurable through user-friendly prompts
- **Emergency Procedures**: Multiple ways to close positions and recover funds safely
- **Multi-Project Structure**: Contains both JavaScript bot (`MeteorShower/`) and Rust SDK (`dlmm-sdk/`)
- **ES Modules**: Uses `"type": "module"` - all imports must use `.js` extensions
- **No Build Step**: Direct Node.js execution - no compilation required
- **Windows Path Compatibility**: Handles Windows file paths in wallet loading

## DLMM SDK TypeScript Reference

**CRITICAL**: When implementing any DLMM on-chain operations, ALWAYS reference the comprehensive TypeScript documentation located at:

```
./dlmmts.info.md
```

This file contains:
- **Complete function signatures** with TypeScript types for all DLMM SDK methods
- **Working code examples** for pool operations, position management, swaps, and liquidity provision
- **Parameter specifications** with detailed explanations and data types
- **Return value documentation** for all SDK functions
- **Real-world usage patterns** showing proper implementation approaches

**Key sections include:**
- Pool creation and management (`create`, `createMultiple`, etc.)
- Position operations (`initializePositionAndAddLiquidityByStrategy`, `removeLiquidity`, etc.)
- Trading functions (`swap`, `swapQuote`, `swapExactOut`, etc.)
- State queries (`getActiveBin`, `getPosition`, `refetchStates`, etc.)
- Helper utilities (`toPricePerLamport`, `fromPricePerLamport`, etc.)

**Usage Guidelines:**
- Use TypeScript examples as the authoritative source for correct SDK usage
- Follow the exact parameter types and structure shown in the documentation
- Reference the working examples when implementing new DLMM functionality
- Ensure all imports and data types match the TypeScript patterns

## Development Workflow

### Project Structure Context
- **Multi-Project Repository**: Contains both JavaScript bot (`MeteorShower/`) and Rust SDK (`dlmm-sdk/`)
- **Modular Library Design**: Core functionality separated into `lib/` modules for maintainability
- **Test Scripts Location**: Testing utilities located in `scripts/` directory
- **Session Logging**: Automated logging to `logs/YYYY-MM-DD/` with structured output

### Code Organization Patterns
- **ES Module Imports**: All imports must use `.js` extensions (e.g., `import { foo } from './lib/bar.js'`)
- **Environment Configuration**: Use `.env.example` as template, never commit `.env` file
- **Library Modules**: Each `lib/` module has single responsibility (dlmm, solana, jupiter, etc.)
- **Error Handling**: Retry logic with exponential backoff implemented via `lib/retry.js`
- **Logging Strategy**: Structured logging via `lib/logger.js` with session-based organization

### Development Safety Protocols
- **Mainnet Operations**: ALL operations execute real transactions on Solana mainnet
- **SOL Buffer Requirements**: Always maintain 0.07+ SOL buffer for transaction fees
- **Position Validation**: Verify position state before any DLMM operations
- **Balance Checks**: Use `balance-prompt.js` to verify wallet state before testing
- **Small Amount Testing**: Start with 0.01-0.05 SOL for initial testing

### Common Development Tasks

**Setting Up Development Environment:**
```bash
# Copy environment template and configure
cp .env.example .env
# Edit .env with your RPC_URL and WALLET_PATH

# Verify wallet setup and balances
node balance-prompt.js

# Interactive configuration for bot parameters
node configure.js
```

**Running Tests Safely:**
```bash
# Test swap functionality with small amounts
npm run test:ultra-swap      # Jupiter Ultra swap testing
npm run test:regular-swap    # Standard Jupiter swap testing
npm run test:swap-comparison # Performance comparison

# Manual testing with extended intervals
node cli.js run --interval 60   # Safer for testing
```

**Debugging and Monitoring:**
```bash
# Check current positions and balances
node balance-prompt.js

# Emergency position closure
node cli.js close
# Or manual closure
node close-position.js

# Monitor with animated display
node scroll.js
```

### Architecture Dependencies
- **Position Management Flow**: `main.js` → `lib/dlmm.js` → `@meteora-ag/dlmm` SDK
- **Price Monitoring**: `lib/price.js` (CoinGecko) → P&L calculations → TP/SL triggers
- **Transaction Flow**: `lib/solana.js` → `lib/priority-fee.js` → `lib/sender.js` (optional)
- **Rebalancing Logic**: Active bin tracking → distance threshold → swapless vs traditional rebalancing

### Advanced Features Implementation Notes
- **Swapless Rebalancing**: Implemented in `lib/dlmm.js` using direction-based single-sided positions
- **P&L Tracking**: `lib/pnl-tracker.js` provides bin-level precision analysis with multiple baselines
- **Priority Fee Management**: `lib/priority-fee.js` integrates Helius API with fallback strategies
- **Transaction Optimization**: `lib/sender.js` provides ultra-low latency submission via Helius Sender
- **Position Monitoring**: Uses active bin position vs total range for precise rebalancing triggers
