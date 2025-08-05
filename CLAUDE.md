# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MeteorShower is an automated liquidity bot for Meteora DLMM (Dynamic Liquidity Market Maker) pools on Solana. The bot automatically re-centers liquidity positions to optimize fee capture by monitoring price movements and rebalancing when positions drift too far from the active bin.

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

### Setup
```bash
# Install dependencies
npm install

# Generate configuration file interactively
node configure.js run
```

### Running the Bot
```bash
# Run with default settings (5 second interval)
node cli.js run

# Run with custom monitoring interval
node cli.js run --interval 30
```

### Configuration
- Configuration is managed through `.env` file
- Use `configure.js` to interactively generate configuration
- Template available in `.env.example`
- Wallet keypair auto-generated if not found

## Architecture

### Core Components

**Entry Points:**
- `cli.js` - Command line interface with yargs integration
- `main.js` - Core bot logic and monitoring loop

**Library Modules (`lib/`):**
- `dlmm.js` - DLMM position management (open/close/recenter)
- `solana.js` - Solana blockchain utilities (wallet, balances, WSOL)
- `jupiter.js` - Jupiter DEX integration for token swaps
- `price.js` - Price feed integration
- `retry.js` - Retry logic for failed operations
- `math.js` - Mathematical utilities for position calculations

### Bot Operation Flow

1. **Position Opening**: Creates initial DLMM position centered around active bin
2. **Token Balancing**: Uses Jupiter to balance token ratios for optimal liquidity provision
3. **Monitoring Loop**: Continuously tracks position health and price movements
4. **Recentering**: Automatically closes and reopens positions when price drifts beyond threshold

### Key Configuration Parameters

- `POOL_ADDRESS` - Target Meteora DLMM pool address
- `TOTAL_BINS_SPAN` - Total number of bins across both sides of position
- `LOWER_COEF` - Fraction of bins allocated below active price (0.5 = symmetric)
- `CENTER_DISTANCE_THRESHOLD` - Drift threshold that triggers rebalancing (0.45 = 45% of half-width)
- `MANUAL` - Whether to use fixed span (`true`) or dynamic API-based span (`false`)

### Safety Features

- SOL buffer reservation for transaction fees (default: 0.07 SOL)
- Slippage protection on swaps
- Retry logic for failed transactions
- Balance validation before operations
- Graceful error handling and logging

## Important Notes

- Bot requires SOL pairs only - validates pool contains SOL as one of the tokens
- Handles WSOL wrapping/unwrapping automatically
- Implements priority fees for faster transaction confirmation
- Supports both manual span configuration and dynamic API-based optimization
- All position operations are atomic with proper error handling