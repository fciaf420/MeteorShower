# MeteorShower - Advanced DLMM Liquidity Bot

![MeteorShower Bot](https://img.shields.io/badge/Bot-DLMM%20Liquidity-blue) ![Solana](https://img.shields.io/badge/Blockchain-Solana-green) ![Node.js](https://img.shields.io/badge/Runtime-Node.js-brightgreen) ![License](https://img.shields.io/badge/License-MIT-yellow)

## 🌟 Introduction

MeteorShower is a sophisticated, open-source automated liquidity bot for Meteora's Dynamic Liquidity Market Maker (DLMM) pools on Solana. Built for professional DeFi traders and liquidity providers, it features advanced rebalancing strategies, real-time P&L tracking, and comprehensive risk management tools.

### ✨ Advanced Features Overview

- **🎯 Take Profit & Stop Loss** - Automated exit conditions with position-specific triggers
- **🔄 Smart Swapless Rebalancing** - Minimize fees with intelligent single-sided rebalancing
- **💰 Auto-Compounding** - Reinvest earned fees automatically for compound growth
- **📈 Live P&L Tracking** - Real-time profit/loss monitoring with fee accumulation
- **🛡️ Advanced Safety Systems** - SOL buffer management, retry logic, graceful error handling
- **🎛️ Interactive Configuration** - User-friendly prompts for all settings
- **🔧 Professional Tools** - Comprehensive testing, monitoring, and emergency controls

---

## ⚠️ Important Disclaimers

### **No Financial Advice**
This tool is for informational purposes only and does not constitute financial, investment, or trading advice. Use at your sole discretion and risk.

### **Risk of Financial Loss**
Providing liquidity carries significant risks including impermanent loss, price volatility, and potential loss of capital. The automated nature does not eliminate these risks.

### **Open-Source Software**
Provided "as is" without warranties. Users are responsible for reviewing and understanding the code before use.

### **Smart Contract Risk**
Interacts with Meteora smart contracts and third-party protocols like Jupiter. Smart contracts may have vulnerabilities.

---

## 🚀 Quick Start Guide

### 1. Prerequisites

- **Node.js** (v16 or higher) - [Download here](https://nodejs.org/)
- **Solana wallet** with JSON keypair format
- **SOL for fees** (minimum 0.1 SOL recommended)
- **Tokens for target pool** or SOL to swap

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/MeteorShower.git
cd MeteorShower

# Install dependencies
npm install

# Create configuration file
cp .env.example .env
# Edit .env with your settings
```

### 3. Basic Usage

```bash
# Start the bot with interactive setup
node cli.js run

# Start with custom monitoring interval (60 seconds)
node cli.js run --interval 60

# Close all positions and swap to SOL
node cli.js close

# Get help
node cli.js --help
```

---

## 📋 Available Commands

### Core Commands

| Command | Description | Example |
|---------|-------------|---------|
| `node cli.js run` | Start the liquidity bot with interactive setup | `node cli.js run --interval 30` |
| `node cli.js close` | Close all positions and swap to SOL | `node cli.js close` |

### Utility Commands

| Command | Description | Use Case |
|---------|-------------|----------|
| `node balance-prompt.js` | Check wallet balance and get funding address | Balance verification |
| `node close-position.js` | Manual position closing (emergency use) | Emergency position closure |
| `node configure.js` | Interactive configuration setup | Initial setup |
| `node scroll.js` | Animated position display monitor | Visual monitoring |


### CLI Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--interval` | `-i` | Monitor interval in seconds | 5 |
| `--help` | `-h` | Show help information | - |

---

## ⚙️ Configuration

### Environment Variables (.env)

Create a `.env` file in the project directory:

```env
# Required Settings
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE
WALLET_PATH=~/id.json

# Monitoring Settings
MONITOR_INTERVAL_SECONDS=60           # Default monitoring interval

# Fee & Trading Settings
PRIORITY_FEE_MICRO_LAMPORTS=50000     # Transaction priority fee
SLIPPAGE=10                           # Slippage tolerance in basis points (0.1%)
PRICE_IMPACT=0.5                      # Max price impact for swaps (0.5%)

# Advanced Settings
MANUAL=true                           # Use manual configuration mode
LOG_LEVEL=info                        # Logging level: error, warn, info, debug
```

### Interactive Configuration

The bot provides step-by-step interactive prompts for:

1. **Pool Selection** - Choose from popular pools or enter custom address
2. **Capital Amount** - Specify SOL amount with automatic balance checking
3. **Token Allocation** - Select ratio (100% SOL, 50/50, 100% Token, or custom)
4. **Position Range** - Configure bin span with price coverage visualization
5. **Liquidity Strategy** - Choose distribution pattern (Spot, Curve, BidAsk)
6. **Rebalancing Mode** - Enable swapless rebalancing with custom bin spans
7. **Auto-Compounding** - Configure fee reinvestment settings
8. **Take Profit/Stop Loss** - Set automated exit conditions

---

## 🎯 Advanced Features

### Take Profit & Stop Loss

**Position-Specific Risk Management**
- Configurable profit targets (0.1% - 200%)
- Configurable loss limits (0.1% - 100%)
- **Only closes the monitored position** (not all wallet positions)
- **Only swaps tokens from that specific pool** to SOL
- Real-time P&L monitoring with TP/SL status display

```
📊 Time      │ 💰 Value   │ 📈 P&L     │ 📊 P&L%   │ 💎 Fees   │ 🔄 Rebal │ 🎯 Exit
⏰ 7:05:47   │ $   21.77  │ ✅+$  2.15 │   +10.9%  │ $   0.48  │     3    │ 🔥+15% 🛡️-10%
```

### Swapless Rebalancing Strategy

**Intelligent Direction-Based Rebalancing**
- **Price moves UP** → Stay in SOL, create position BELOW new price
- **Price moves DOWN** → Switch to TOKEN, create position ABOVE new price
- Minimizes swap fees and slippage
- Configurable bin spans independent of initial position
- Always starts at current active bin (0 distance from price)

### Auto-Compounding

**Automated Fee Reinvestment**
- Automatically adds earned fees to new positions during rebalancing
- Compounds both Token X and Token Y fees proportionally
- Increases position size over time through fee accumulation
- Configurable enable/disable setting

### Live P&L Tracking

**Real-Time Performance Monitoring**
- Tracks profit/loss from initial deposit in USD
- Monitors total fees earned across all rebalances
- Counts rebalancing events
- Displays current position value
- Shows P&L percentage and absolute amounts

```
📈 P&L Tracking Display:
📊 Time      │ 💰 Value   │ 📈 P&L     │ 📊 P&L%   │ 💎 Fees   │ 🔄 Rebal │ 🎯 Exit
⏰ 7:05:47   │ $   21.77  │ ❌-$  0.08 │    -0.4%  │ $   0.48  │     1    │ 📈+15% ⚪OFF
```

---

## 🔧 Core Functionality

### Position Management

#### **Automated Position Lifecycle**
- **Open Position**: Creates DLMM liquidity position centered around active bin
- **Monitor Position**: Continuously tracks position health and price movements  
- **Smart Rebalancing**: Only triggers when price moves **completely outside** position range
- **Emergency Close**: Manual position closure with token swapping

#### **Rebalancing Trigger Logic**
- Monitors active bin ID vs position range (lower bin to upper bin)
- Triggers rebalancing **only when price moves outside the range**, not at edges
- Uses `activeBinId < lowerBin` or `activeBinId > upperBin` logic
- Prevents premature rebalancing at position boundaries

#### **Token Balancing & Swapping**
- Jupiter DEX integration for optimal token swaps
- Slippage protection on all swaps
- Support for any token ratio (100% SOL, 50/50, 80/20, 100% Token, custom)
- Automatic token identification (SOL vs alt-token)

### Safety & Reliability Features

#### **SOL Buffer Management**
- Reserves 0.07 SOL automatically for transaction fees
- Prevents account closure due to insufficient SOL
- Balance validation before all operations

#### **Advanced Error Handling**
- Retry logic with exponential backoff for failed transactions
- Graceful handling of network issues and RPC failures
- Continues monitoring despite temporary failures
- Comprehensive error logging and recovery

#### **Position Protection**
- Uses exact balances from closed positions during rebalancing
- Prevents double-counting or balance inflation issues
- Accurate capital usage calculations

---

## 📊 Testing & Validation

### Comprehensive Test Suite

The bot includes extensive testing capabilities:

```bash
# Test files are not currently available in this repository
# Testing should be done manually using the core bot commands with small amounts
```

### Manual Testing Recommendations
- Start with small amounts (0.01-0.05 SOL) to test functionality
- Use the visual monitor: `node scroll.js` to observe position changes
- Test different configurations through `node configure.js`
- Monitor console output for errors and performance metrics

---

## 🛠️ Architecture

### Project Structure

```
MeteorShower/
├── cli.js                 # Command line interface with yargs
├── main.js                # Core bot logic, monitoring loop, TP/SL
├── balance-prompt.js      # Interactive configuration prompts
├── close-position.js      # Position closing and emergency functions
├── configure.js           # Setup and configuration utilities
├── scroll.js              # Animated monitoring display
├── lib/
│   ├── dlmm.js           # DLMM position management and rebalancing
│   ├── solana.js         # Solana blockchain utilities
│   ├── jupiter.js        # Jupiter DEX integration
│   ├── price.js          # CoinGecko price feed integration
│   ├── retry.js          # Retry logic for failed operations
│   └── math.js           # Mathematical utilities and calculations
├── package.json          # Dependencies and npm scripts
└── .env                  # Environment configuration
```

### Operation Flow

1. **Interactive Setup** → User-friendly prompts for all configuration
2. **Position Creation** → Open DLMM position with specified parameters
3. **Monitoring Loop** → Continuously track price, position health, and P&L
4. **Smart Rebalancing** → Close and reopen position when price exits range
5. **Fee Compounding** → Automatically reinvest earned fees (if enabled)
6. **Risk Management** → Monitor TP/SL conditions and auto-close if triggered

### Key Components

- **Main Loop**: Real-time monitoring with configurable intervals
- **Position Manager**: DLMM SDK integration for position operations
- **Rebalancing Engine**: Swapless and traditional rebalancing strategies
- **Risk Manager**: Take profit, stop loss, and safety systems
- **Price Oracle**: CoinGecko integration for USD valuations
- **Swap Engine**: Jupiter integration for token exchanges

---

## 🔍 Monitoring & Logs

### Real-Time Console Output

```
🚀 Welcome to MeteorShower DLMM Bot!

🎯 Position Monitor Active
═══════════════════════════════════════════════════════════════════════════════════════
📊 Time      │ 💰 Value   │ 📈 P&L     │ 📊 P&L%   │ 💎 Fees   │ 🔄 Rebal │ 🎯 Exit
─────────────────────────────────────────────────────────────────────────────────────
⏰ 7:05:47   │ $   21.77  │ ✅+$  1.32 │    +6.4%  │ $   0.48  │     1    │ 📈+15% 🛡️-10%
📊 Position: Bin 8193 │ Range 8180-8210 │ Status: 🟢 IN-RANGE
   🟢 Position healthy (13↕17 bins from edges)
```

### Monitoring Features

- **Position Health**: Active bin tracking vs position range
- **P&L Metrics**: Real-time profit/loss, percentage, and fees
- **Rebalancing Events**: Detailed logs with transaction signatures
- **TP/SL Status**: Current take profit and stop loss settings
- **Price Movement Analysis**: Bins from edges, price coverage

### Log Levels

Configure logging detail in `.env`:
- `error` - Only critical errors
- `warn` - Warnings and errors  
- `info` - Standard operation info (recommended)
- `debug` - Detailed debugging information

---

## 🚨 Safety Guidelines & Best Practices

### Before Running

1. **Start with small amounts** to test strategy
2. **Understand liquidity provision risks** (impermanent loss, volatility)
3. **Backup your wallet** keypair securely
4. **Test on devnet first** if available
5. **Review all configuration** settings carefully

### During Operation

1. **Monitor console output** for errors or unusual activity
2. **Keep sufficient SOL** for transaction fees (>0.1 SOL recommended)
3. **Check position performance** regularly through P&L display
4. **Be aware of high volatility** periods that may trigger frequent rebalancing
5. **Use Ctrl+C to stop** the bot gracefully

### Risk Management Recommendations

1. **Set appropriate TP/SL levels** based on your risk tolerance
2. **Use wider bin spans** for less frequent rebalancing
3. **Monitor during high volatility** periods more closely
4. **Have exit strategies** prepared for different market conditions
5. **Don't invest more than you can afford to lose**

---

## 🆘 Troubleshooting

### Common Issues & Solutions

#### **"RPC_URL is not set" Error**
    ```bash
# Solution: Check .env file
echo "RPC_URL=https://your-rpc-endpoint" >> .env
```

#### **"Transfer: insufficient lamports" Error**
- **Cause**: Insufficient SOL for transaction fees
- **Solution**: Add more SOL to wallet (minimum 0.1 SOL recommended)
- **Check**: Verify `PRIORITY_FEE_MICRO_LAMPORTS` setting

#### **"No positions found" in close-position.js**
- **Cause**: Position detection issue or no active positions
- **Solution**: Verify positions exist with wallet explorer
- **Check**: Ensure correct RPC endpoint and wallet path

#### **Position Not Rebalancing**
- **Cause**: Price hasn't moved outside position range
- **Solution**: Check position range vs current active bin
- **Verify**: Monitor interval and rebalancing trigger logic

#### **TP/SL Not Triggering**
- **Cause**: P&L hasn't reached threshold or calculation error
- **Solution**: Verify P&L calculation and threshold settings
- **Check**: Monitor TP/SL status in console output

#### **High Gas Fees**
- **Cause**: Network congestion or high priority fees
- **Solution**: Adjust `PRIORITY_FEE_MICRO_LAMPORTS` in .env
- **Consider**: Using lower priority during off-peak hours

### Emergency Procedures

#### **Stop the Bot Immediately**
```bash
# Press Ctrl+C in the terminal
^C
# Bot will complete current operation and stop safely
```

#### **Emergency Position Closure**
```bash
# Close all positions and swap to SOL
node cli.js close

# Manual closure if CLI fails
node close-position.js
```

#### **Check Current Status**
```bash
# View wallet balances and position status
node balance-prompt.js

# Check recent transactions on Solana explorer
# Use your wallet address: https://solscan.io/account/YOUR_WALLET_ADDRESS
```

#### **Reset Configuration**
```bash
# Backup current settings
cp .env .env.backup

# Reconfigure from scratch
node configure.js
```

---

## 🔗 Additional Resources

### Documentation Links
- [Meteora DLMM Documentation](https://docs.meteora.ag/overview/products/dlmm)
- [Jupiter DEX Documentation](https://docs.jup.ag/)
- [Solana Web3.js Guide](https://solana-labs.github.io/solana-web3.js/)
- [CoinGecko API](https://www.coingecko.com/api/documentation)

### Community & Support
- **GitHub Issues**: Report bugs and request features
- **Meteora Discord**: Join for DLMM strategy discussions
- **Solana Discord**: General Solana development support

### Development Information
- **Language**: JavaScript (ES modules)
- **Runtime**: Node.js 16+
- **Testing**: Comprehensive integration test suite
- **Contributing**: Community contributions welcome

---

## 📄 License

This project is open-source software provided under the MIT License. See [LICENSE](LICENSE) file for details.

---

## ⚡ Recent Updates & Version History

### Latest Version (v3.0) - Current Features

#### 🎯 **Take Profit & Stop Loss System**
- Position-specific TP/SL triggers (not wallet-wide)
- Configurable profit/loss thresholds
- Automatic position closure and token swapping
- Real-time TP/SL status monitoring

#### 🔄 **Enhanced Swapless Rebalancing**
- Direction-based strategy implementation
- Configurable bin spans for swapless positions
- Proper active bin positioning (0 distance from current price)
- Minimized swap fees and slippage

#### 💰 **Advanced Auto-Compounding**
- Fee-only compounding to prevent wallet drainage
- Proportional Token X and Token Y fee reinvestment
- Accurate fee tracking and P&L calculation

#### 📈 **Comprehensive P&L Tracking**
- Real-time profit/loss monitoring from initial deposit
- Total fees earned tracking across rebalances
- Rebalance counter and performance metrics
- USD-denominated position valuation

#### 🛡️ **Improved Safety & Reliability**
- Fixed "insufficient lamports" errors during rebalancing
- Proper SOL buffer management
- Enhanced error handling and retry logic
- Position-specific balance usage (no double-counting)

#### 🎛️ **Interactive Configuration System**
- User-friendly step-by-step prompts
- Visual bin coverage and price range displays
- Comprehensive configuration validation
- Graceful cancellation handling

### Key Technical Improvements

- **Exact Balance Usage**: Uses precise amounts from closed positions
- **Position Detection**: Robust SDK data structure handling
- **Module Import Handling**: Fixed Windows path compatibility issues
- **Swapless Logic**: Proper token allocation based on rebalance direction
- **Error Recovery**: Enhanced retry mechanisms for network issues

---

*Built with ❤️ for the Solana DeFi ecosystem*

**Disclaimer**: This software is experimental. Always test with small amounts and understand the risks involved in liquidity provision and automated trading.