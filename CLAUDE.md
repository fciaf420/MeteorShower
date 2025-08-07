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
# Comprehensive integration test suite
npm run test:comprehensive

# Test specific allocation strategies
npm run test:comprehensive:sol           # 100% SOL allocation
npm run test:comprehensive:token         # 100% Token allocation  
npm run test:comprehensive:balanced      # 50/50 allocation

# Test advanced features
npm run test:comprehensive:swapless      # Swapless rebalancing
npm run test:comprehensive:compound      # Auto-compounding
npm run test:comprehensive:full          # All features (2 minutes)

# Live testing with small amounts
npm run test:live                        # Live test with defaults
npm run test:live:dry                    # Dry run mode
npm run test:live:quick                  # Quick test (0.005 SOL, 15 seconds)
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
- Real-time profit/loss from initial deposit in USD
- Total fees earned tracking across all rebalances
- Rebalance counter and performance metrics
- Console display with comprehensive status information

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
- `PRIORITY_FEE_MICRO_LAMPORTS` - Transaction priority fee (default: 50,000)
- `SLIPPAGE` - Slippage tolerance in basis points (default: 10 = 0.1%)
- `PRICE_IMPACT` - Max price impact for swaps (default: 0.5%)

### Safety Features

- **SOL Buffer Management**: Reserves 0.07 SOL for transaction fees
- **Advanced Error Handling**: Retry logic with exponential backoff
- **Balance Validation**: Checks before all operations
- **Position Protection**: Uses exact balances from closed positions
- **Graceful Shutdown**: Ctrl+C handling with operation completion

### Testing System

The project includes a comprehensive testing system that performs real blockchain transactions:

**Test Categories:**
- **Allocation Strategy Testing**: Tests different token allocation ratios
- **Feature Testing**: Validates swapless rebalancing and auto-compounding
- **Integration Testing**: End-to-end workflow validation
- **Performance Testing**: Success rate and timing metrics

**Test Safety:**
- Uses small amounts (0.02 SOL default)
- Automatic cleanup after tests
- Force rebalancing for edge case testing
- Comprehensive validation of all bot functions

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
PRIORITY_FEE_MICRO_LAMPORTS=50000
SLIPPAGE=10
MONITOR_INTERVAL_SECONDS=60
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