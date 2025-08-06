# MeteorShower - DLMM Liquidity Bot

![MeteorShower Bot](https://img.shields.io/badge/Bot-DLMM%20Liquidity-blue) ![Solana](https://img.shields.io/badge/Blockchain-Solana-green) ![Node.js](https://img.shields.io/badge/Runtime-Node.js-brightgreen)

## 🌟 Introduction

MeteorShower is an open-source automated liquidity bot for Meteora's Dynamic Liquidity Market Maker (DLMM) pools on Solana. The bot intelligently manages your liquidity positions by automatically re-centering them when price movements occur, optimizing fee capture and maintaining position effectiveness.

### 🎯 Key Features

- **Automated Position Management** - Opens, monitors, and rebalances DLMM positions
- **Smart Rebalancing** - Triggers only when price moves completely outside position range
- **Swapless Strategy** - Supports single-sided rebalancing to minimize swap fees
- **Auto-Compounding** - Automatically reinvests earned fees back into positions
- **Live P&L Tracking** - Real-time profit/loss monitoring with fee tracking
- **Jupiter Integration** - Automatic token swapping for optimal liquidity ratios
- **Safety Features** - SOL buffer management, slippage protection, retry logic

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
# Clone or download the repository
git clone https://github.com/fciaf420/MeteorShower.git
cd MeteorShower

# Install dependencies
npm install

# Create configuration (interactive setup)
node configure.js run
```

### 3. Basic Usage

```bash
# Start the bot with default settings (5-second monitoring)
node cli.js run

# Start with custom monitoring interval (60 seconds = 1 minute)
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
| `node cli.js run` | Start the liquidity bot | `node cli.js run --interval 30` |
| `node cli.js close` | Close all positions and swap to SOL | `node cli.js close` |
| `node configure.js run` | Interactive configuration setup | `node configure.js run` |
| `node balance-prompt.js` | Check wallet balance and get funding address | `node balance-prompt.js` |

### Advanced Commands

| Command | Description | Use Case |
|---------|-------------|----------|
| `node close-position.js` | Manual position closing | Emergency position closure |
| `node scroll.js` | View animated position display | Visual monitoring |
| `npm run test:comprehensive` | Run full integration tests | Testing setup |

### CLI Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--interval` | `-i` | Monitor interval in seconds | 5 |
| `--help` | `-h` | Show help information | - |

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the project directory:

```env
# Required Settings
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE
WALLET_PATH=~/id.json
POOL_ADDRESS=YOUR_METEORA_POOL_ADDRESS

# Position Configuration
TOTAL_BINS_SPAN=20                    # Number of bins in position
LOWER_COEF=0.5                        # Fraction of bins below active price (0.5 = symmetric)
LIQUIDITY_STRATEGY_TYPE=Spot          # Liquidity distribution: Spot, Curve, or BidAsk

# Monitoring & Rebalancing
MONITOR_INTERVAL_SECONDS=30           # Check interval in seconds
SAFETY_BUFFER_BINS=2                  # Bins from edge that triggers rebalancing

# Fee & Trading Settings
PRIORITY_FEE_MICRO_LAMPORTS=50000     # Transaction priority fee
SOL_FEE_BUFFER_LAMPORTS=70000000      # SOL buffer (0.07 SOL)
SLIPPAGE=10                           # Slippage tolerance in basis points (0.1%)
PRICE_IMPACT=0.1                      # Max price impact for swaps (0.1%)

# Advanced Settings
MANUAL=true                           # Use fixed span vs API optimization
LOG_LEVEL=info                        # Logging level: error, warn, info, debug
```

### Key Configuration Parameters

#### **Position Settings**
- `TOTAL_BINS_SPAN` - Total bins across position (wider = less rebalancing, narrower = more concentrated)
- `LOWER_COEF` - Position symmetry (0.5 = balanced, <0.5 = more upside, >0.5 = more downside)
- `SAFETY_BUFFER_BINS` - Rebalance trigger distance from position edge

#### **Monitoring Settings**
- `MONITOR_INTERVAL_SECONDS` - How often to check position (recommended: 30-300 seconds)
- `MANUAL` - `true` for fixed span, `false` for dynamic API-based optimization

#### **Safety Settings**
- `SOL_FEE_BUFFER_LAMPORTS` - Reserved SOL for transactions (70M lamports = 0.07 SOL)
- `SLIPPAGE` - Maximum acceptable slippage in basis points
- `PRICE_IMPACT` - Maximum price impact for Jupiter swaps

---

## 🔧 Bot Functions & Features

### Core Functionality

#### **Position Management**
- **Open Position**: Creates DLMM liquidity position centered around active bin
- **Monitor Position**: Continuously tracks position health and price movements
- **Rebalance Position**: Automatically closes and reopens when price drifts outside range
- **Close Position**: Removes all liquidity and optionally swaps to SOL

#### **Smart Rebalancing**
- **Trigger Logic**: Only rebalances when active price is completely outside position range
- **Swapless Mode**: Creates single-sided positions to minimize swap fees
- **Direction-Based Strategy**: 
  - Price moves UP → Create SOL position below new price
  - Price moves DOWN → Create TOKEN position above new price

#### **Auto-Compounding**
- Automatically reinvests earned fees back into new positions
- Increases position size over time through fee accumulation
- Configurable through environment settings

### Advanced Features

#### **Live P&L Tracking**
```
Time         | Total($)  | P&L($)   | P&L(%)   | Fees($)  | Rebalances
7:05:47 PM  |    21.77  |   -0.08  |   -0.4%  |    0.48  |         1
```

- **Real-time position value** in USD
- **Profit/Loss tracking** from initial deposit
- **Fee accumulation** monitoring
- **Rebalance counter** to track activity

#### **Token Balancing**
- Automatic token ratio optimization using Jupiter DEX
- Slippage protection on all swaps
- Support for custom token ratios (50/50, 80/20, 100% single-sided)

#### **Safety & Reliability**
- **SOL Buffer Management**: Reserves SOL for transaction fees
- **Retry Logic**: Automatically retries failed transactions
- **Balance Validation**: Checks balances before operations
- **Graceful Error Handling**: Continues operation despite temporary failures

---

## 📊 Testing & Validation

### Comprehensive Test Suite

```bash
# Run all tests
npm run test:comprehensive

# Test specific scenarios
npm run test:comprehensive:sol      # 100% SOL allocation
npm run test:comprehensive:token    # 100% Token allocation  
npm run test:comprehensive:balanced # 50/50 allocation
npm run test:comprehensive:swapless # Swapless rebalancing
npm run test:comprehensive:compound # Auto-compounding
```

### Test Features
- **Real blockchain transactions** (not simulated)
- **Multiple allocation ratios** testing
- **Comprehensive validation** of all bot functions
- **Performance metrics** and success rate tracking
- **Emergency cleanup** procedures

---

## 🛠️ Architecture

### Core Components

```
MeteorShower/
├── cli.js              # Command line interface
├── main.js             # Core bot logic and monitoring loop
├── configure.js        # Interactive configuration setup
├── balance-prompt.js   # Wallet balance checker
├── close-position.js   # Position closing utilities
├── lib/
│   ├── dlmm.js        # DLMM position management
│   ├── solana.js      # Solana blockchain utilities
│   ├── jupiter.js     # Jupiter DEX integration
│   ├── price.js       # Price feed integration
│   ├── retry.js       # Retry logic for failed operations
│   └── math.js        # Mathematical utilities
└── test-comprehensive.js # Integration test suite
```

### Operation Flow

1. **Initialization** → Load configuration and connect to Solana
2. **Position Creation** → Open DLMM position with specified parameters
3. **Monitoring Loop** → Continuously track price and position health
4. **Rebalancing** → Close and reopen position when price moves outside range
5. **Fee Management** → Automatically compound earned fees (if enabled)

---

## 🔍 Monitoring & Logs

### Console Output

The bot provides real-time information including:

- **Position Status**: Active bin, position range, price movements
- **P&L Metrics**: Live profit/loss, fees earned, rebalance count
- **Transaction Details**: All blockchain transactions with signatures
- **Rebalancing Events**: Detailed logs of position changes

### Log Levels

Set `LOG_LEVEL` in `.env`:
- `error` - Only errors
- `warn` - Warnings and errors
- `info` - General information (recommended)
- `debug` - Detailed debugging information

---

## 🎛️ Advanced Configuration

### Manual vs Automatic Mode

#### **Manual Mode** (Recommended)
```env
MANUAL=true
TOTAL_BINS_SPAN=20
LOWER_COEF=0.5
```
- Use fixed, predictable position parameters
- Full control over position sizing
- Consistent behavior across market conditions

#### **Automatic Mode**
```env
MANUAL=false
DITHER_ALPHA_API=http://your-api-endpoint
LOOKBACK=30
```
- Dynamic position sizing based on volatility
- API-driven optimization
- Adaptive to market conditions

### Liquidity Strategies

Set `LIQUIDITY_STRATEGY_TYPE`:
- **Spot** - Uniform distribution (recommended for most cases)
- **Curve** - Concentrated around active price
- **BidAsk** - Asymmetric distribution

---

## 🚨 Safety Guidelines

### Before Running
1. **Test with small amounts** first
2. **Understand the risks** of liquidity provision
3. **Backup your wallet** keypair file securely
4. **Monitor initial runs** closely

### During Operation
1. **Keep SOL balance** above the fee buffer
2. **Monitor for errors** in console output
3. **Check position performance** regularly
4. **Stop with Ctrl+C** if needed

### Risk Management
1. **Set appropriate position sizes** for your risk tolerance
2. **Use wider bin spans** for less active management
3. **Monitor during high volatility** periods
4. **Have exit strategies** prepared

---

## 🆘 Troubleshooting

### Common Issues

#### **"RPC_URL is not set" Error**
- Ensure `.env` file exists with valid `RPC_URL`
- Get RPC endpoint from [Helius](https://www.helius.dev/) or other providers

#### **"Transfer: insufficient lamports" Error**
- Increase SOL balance in wallet
- Check `SOL_FEE_BUFFER_LAMPORTS` setting
- Ensure wallet has enough SOL for fees

#### **"Could not obtain swap quote" Error**
- Check internet connection
- Verify token liquidity on Jupiter
- Adjust `SLIPPAGE` or `PRICE_IMPACT` settings

#### **Position not rebalancing**
- Verify `SAFETY_BUFFER_BINS` setting
- Check if price movement exceeds threshold
- Review `MONITOR_INTERVAL_SECONDS` setting

### Emergency Procedures

#### **Stop the Bot**
```bash
# Press Ctrl+C in terminal running the bot
^C
```

#### **Close All Positions**
```bash
# Close positions and swap everything to SOL
node cli.js close

# Or use direct method
node close-position.js
```

#### **Check Wallet Status**
```bash
# View current balances and positions
node balance-prompt.js
```

---

## 📚 Additional Resources

### Documentation
- [Meteora DLMM Documentation](https://docs.meteora.ag/overview/products/dlmm)
- [Jupiter DEX Documentation](https://docs.jup.ag/)
- [Solana Web3.js Guide](https://solana-labs.github.io/solana-web3.js/)

### Support
- **GitHub Issues**: Report bugs and request features
- **Community**: Join Meteora Discord for general DeFi discussion

### Development
- **Node.js**: ES modules (`"type": "module"`)
- **Testing**: Comprehensive integration test suite
- **Contributing**: Open to community contributions

---

## 📄 License

This project is open-source software provided under the MIT License. See [LICENSE](LICENSE) file for details.

---

## ⚡ Version History

### Latest Updates (v2.0)
- ✅ Fixed double-counting bug in rebalancing
- ✅ Improved swapless mode functionality  
- ✅ Added live P&L tracking with fee monitoring
- ✅ Enhanced rebalancing trigger logic
- ✅ Better error handling and retry mechanisms
- ✅ Comprehensive test suite integration

### Key Improvements
- **Exact Balance Usage**: Uses precise amounts from closed positions
- **SOL Buffer Management**: Proper fee reservation during rebalancing
- **Swapless Strategy**: Optimized single-sided position creation
- **Performance Tracking**: Real-time P&L and fee accumulation

---

*Built with ❤️ for the Solana DeFi ecosystem*