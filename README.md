# MeteorShower - Advanced DLMM Liquidity Bot

![MeteorShower Bot](https://img.shields.io/badge/Bot-DLMM%20Liquidity-blue) ![Solana](https://img.shields.io/badge/Blockchain-Solana-green) ![Node.js](https://img.shields.io/badge/Runtime-Node.js-brightgreen) ![License](https://img.shields.io/badge/License-MIT-yellow)

## 🌟 Introduction

MeteorShower is a sophisticated, open-source automated liquidity bot for Meteora's Dynamic Liquidity Market Maker (DLMM) pools on Solana. Built for professional DeFi traders and liquidity providers, it features advanced rebalancing strategies, real-time P&L tracking, and comprehensive risk management tools.

### ✨ Advanced Features Overview

- **🎯 Take Profit & Stop Loss** - Automated exit conditions with position-specific triggers
- **🔄 Smart Swapless Rebalancing** - Minimize fees with intelligent single-sided rebalancing
- **💸 Advanced Fee Management** - Choose between auto-compound or claim-and-convert-to-SOL
- **🔧 Selective Compounding** - Compound both tokens, SOL-only, token-only, or none
- **📈 Dual P&L Tracking** - Real-time USD and SOL-denominated profit/loss monitoring
- **🛡️ Dynamic SOL Management** - Intelligent budget caps with adaptive retry logic
- **🎛️ Interactive Configuration** - User-friendly prompts for all settings with 43-44 char pool support
- **⚡ Session Fee Optimization** - Cross-rebalance fee accrual for swapless efficiency
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
- **Git** - For cloning the repository
- **Solana CLI** (optional but recommended) - [Installation guide](https://docs.solana.com/cli/install-solana-cli-tools)

### 2. Get a Solana RPC URL

You need a reliable RPC endpoint. **Recommended providers:**

#### **Helius (Recommended)**
1. Go to [helius.xyz](https://helius.xyz) and create free account
2. Create a new project and copy your API URL
3. It will look like: `https://mainnet.helius-rpc.com/?api-key=your-key-here`

#### **Other Options:**
- **QuickNode**: Professional RPC with free tier
- **Alchemy**: Another reliable option with generous free tier
- **Public RPC**: `https://api.mainnet-beta.solana.com` (slower, rate limited)

### 3. Create/Get Your Solana Wallet

#### **Option A: Create New Wallet**
```bash
# Install Solana CLI tools first, then:
solana-keygen new --outfile ~/solana-keypair.json

# Your new wallet address:
solana-keygen pubkey ~/solana-keypair.json
```

#### **Option B: Import from Phantom/Solflare (Recommended)**
1. In Phantom: Settings → Export Private Key → Copy the private key
2. Use the enhanced configuration script (automatically converts base58 to JSON):
```bash
# Run the interactive configuration
node configure.js

# When prompted for wallet setup, choose option 2:
# "Import existing private key (base58 format from Phantom/Solflare)"
# Then paste your private key - it will auto-convert!
```

#### **Option C: Use Existing Keypair**
If you already have a `.json` wallet file, note its path.

### 4. Fund Your Wallet

Send **at least 0.2 SOL** to your wallet address for:
- Transaction fees (0.1+ SOL)  
- Liquidity provision (0.1+ SOL)
- Buffer for safety

### 5. Installation

```bash
# Clone the repository
git clone https://github.com/fciaf420/MeteorShower.git
cd MeteorShower

# Install dependencies
npm install

# Create configuration file (optional - bot will prompt if missing)
cp .env.example .env
```

### 6. Interactive Configuration (Recommended)

Run the enhanced configuration script for easy setup:

```bash
# Interactive configuration with wallet import support
node configure.js
```

**The script will:**
1. **Guide you through all settings** - RPC URL, pool selection, etc.
2. **Handle wallet setup** with 3 options:
   - Create a new wallet
   - **Import from Phantom/Solflare** (base58 → JSON conversion)
   - Use existing wallet file
3. **Auto-generate .env file** with all your settings
4. **Display your wallet address** for verification

#### **Manual Configuration (Alternative)**

If you prefer editing `.env` manually:

```env
# Required: Your RPC endpoint
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE

# Required: Path to your wallet JSON file  
WALLET_PATH=/home/user/solana-keypair.json
# Windows: WALLET_PATH=C:\Users\username\solana-keypair.json

# Optional: Monitoring interval (seconds)
MONITOR_INTERVAL_SECONDS=60

# Optional: Transaction settings
PRIORITY_FEE_MICRO_LAMPORTS=50000
SLIPPAGE=10
PRICE_IMPACT=0.5
```

### 7. First Time Setup & Verification

#### **Check Wallet Balance**
```bash
# Verify your wallet has sufficient SOL
node balance-prompt.js
```

#### **Test Your Configuration**  
```bash
# Start the bot - it will validate RPC, wallet, and walk you through setup
node cli.js run
```

**Expected First-Run Flow:**
1. Bot validates RPC connection ✅
2. Bot validates wallet access ✅  
3. Interactive pool selection (choose from popular pools or paste custom)
4. SOL amount selection with balance checking
5. Position configuration (token ratio, bin span, etc.)
6. Fee handling setup (compound vs claim-to-SOL)
7. Take profit/stop loss configuration
8. Position creation and monitoring begins

#### **Emergency Stop** 
```bash
# Stop the bot anytime with Ctrl+C
# Bot will complete current operation safely
```

### 8. Basic Usage

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
| `node configure.js` | Enhanced interactive configuration setup with wallet import | Initial setup, wallet import |
| `node wallet-info.js` | Display wallet information (public key, location) | Wallet verification |
| `node wallet-info.js --show-private` | Show private key with security warnings | Private key access (secure environment only) |
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

1. **Pool Selection** - Choose from popular pools or enter custom address (43-44 characters)
2. **Capital Amount** - Specify SOL amount with automatic balance checking
3. **Token Allocation** - Select ratio (100% SOL, 50/50, 100% Token, or custom)
4. **Position Range** - Configure bin span with price coverage visualization
5. **Liquidity Strategy** - Choose distribution pattern (Spot, Curve, BidAsk)
6. **Rebalancing Mode** - Enable swapless rebalancing with custom bin spans
7. **Initial Phase Gate** - Configure re-entry depth for controlled swapless activation
8. **Fee Management** - Choose between auto-compound or claim-and-convert-to-SOL
9. **Compounding Mode** - Select which fees to compound (both, SOL-only, token-only, none)
10. **Take Profit/Stop Loss** - Set automated exit conditions with trailing stops

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

#### **Initial Phase Gate System**
**Smart Rebalancing Activation for Stability**

The bot includes an intelligent "initial phase gate" that provides better control over when swapless rebalancing becomes active:

- **Purpose**: Prevents premature swapless switching during initial position establishment
- **How it works**: 
  - Blocks swapless rebalancing until price re-enters the position by a specified depth
  - Maintains the initial wide template during the gate-active phase
  - Enables swapless mode only after price demonstrates sufficient inside movement
- **Configuration**: Configurable re-entry depth (default: 2 bins from nearest edge)
- **Benefits**:
  - Reduces unnecessary early rebalancing noise
  - Ensures swapless strategy activates at optimal timing
  - Maintains position stability during initial volatile periods
  - Provides cleaner strategy transitions

**Example Flow:**
1. Position created with 20-bin span around current price
2. Price moves outside range → Normal rebalancing (maintains wide template)
3. Price re-enters by 2+ bins from edge → Gate deactivates
4. Future out-of-range moves → Swapless rebalancing activated

```
💡 Configuration prompt:
🔧 Initial re-entry threshold:
    Blocks the first swapless rebalancing until price re-enters by X bins from the nearest edge.

Enter inside re-entry depth in bins (default 2): 
```

### Advanced Fee Management

**Choose Your Fee Strategy**

The bot now offers two distinct fee handling modes:

#### **Auto-Compound Mode**
- **Purpose**: Reinvest fees to grow position size over time
- **How it works**: Earned fees are automatically added to new positions during rebalancing
- **Selective Compounding Options**:
  - `both` - Compound SOL and token fees (default)
  - `sol_only` - Compound only SOL-side fees, claim token fees
  - `token_only` - Compound only token-side fees, claim SOL fees  
  - `none` - No compounding (same as claim-and-convert mode)

#### **Claim-and-Convert Mode**
- **Purpose**: Convert all fees to SOL for steady SOL accumulation
- **How it works**: On each rebalance, non-SOL fees are swapped to SOL via Jupiter Ultra
- **Benefits**: Simplifies portfolio management, reduces token exposure
- **Use case**: When you prefer pure SOL accumulation over position growth

#### **Session Fee Optimization**
- **Smart Reuse**: During swapless UP cycles, token fees are accrued for reuse in DOWN cycles
- **Efficiency**: Reduces swap costs by reusing previously earned tokens
- **Tracking**: Real-time session fee accrual monitoring and consumption

### Dual P&L Tracking

**Real-Time Performance Monitoring with USD & SOL Metrics**

#### **USD-Denominated P&L**
- Tracks profit/loss from initial deposit in USD
- Monitors total fees earned across all rebalances  
- Displays current position value in USD
- Shows P&L percentage and absolute amounts

#### **SOL-Denominated P&L** 
- **Purpose**: Protection against USD price volatility of SOL
- **Baseline**: Locks in SOL price at monitoring start
- **Tracking**: Shows performance in SOL terms independent of USD fluctuations
- **Use case**: Better measure of DeFi performance during SOL price swings

#### **Session Reserve Tracking**
- Monitors SOL reserves from dynamic budget caps and haircuts
- Includes reserves in P&L calculations for accuracy
- Displays reserve amounts when significant (>$0.001)

```
📈 Enhanced P&L Tracking Display:
📊 Time      │ 💰 Value   │ 📈 P&L     │ 📊 P&L%   │ 💎 Fees   │ 🔄 Rebal │ 🎯 Exit
⏰ 7:05:47   │ $   21.77  │ ✅+$  2.15 │   +10.9%  │ $   0.48  │     3    │ 🔥+15% 🛡️-10%
🪙 P&L(SOL): +0.0134 SOL (+8.2%)
🔧 Reserve counted: +$0.12
```

---

## 🔐 Wallet Management Utilities

### Enhanced Wallet Configuration

The `configure.js` script provides an enhanced wallet setup experience:

```bash
node configure.js
```

**Features:**
- **🔑 Three wallet options:**
  1. **Create new wallet** - Generate fresh keypair
  2. **Import from Phantom/Solflare** - Paste base58 private key (auto-converts to JSON)
  3. **Use existing wallet file** - Point to existing JSON wallet
- **✅ Automatic conversion** from base58 to JSON array format
- **🛡️ Input validation** with clear error messages and retry prompts
- **📋 Complete configuration** - All environment variables in one flow

### Wallet Information Utility

The `wallet-info.js` script helps you view and manage wallet information:

#### **Basic Usage (Safe)**
```bash
# Show wallet location and public key only
node wallet-info.js
```

**Output:**
```
🔑 Wallet Information
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 Wallet Location: /path/to/your/wallet.json
🔓 Public Key:      6yP4...JWkq

💡 To display private key, run: node wallet-info.js --show-private
```

#### **Private Key Access (Secure Environment Only)**
```bash
# Show all wallet information including private key
node wallet-info.js --show-private
```

**⚠️ Security Features:**
- **Multiple security warnings** before displaying private key
- **Confirmation prompt** to ensure user consent
- **Strong disclaimers** about fund loss risks
- **Reminders to clear terminal** after use

**Private Key Formats Shown:**
- **Base58 format** (for importing to Phantom/Solflare)
- **JSON array format** (for bot configuration)

#### **Command Options**
```bash
node wallet-info.js --help          # Show help information
node wallet-info.js --show-private  # Show private key (with warnings)
node wallet-info.js -p              # Short form of --show-private
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
├── configure.js           # Enhanced setup with wallet import support
├── wallet-info.js         # Wallet information utility with security features
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

# View wallet information and public key
node wallet-info.js

# Check recent transactions on Solana explorer
# Use your wallet address: https://solscan.io/account/YOUR_WALLET_ADDRESS
```

#### **Reset Configuration**
```bash
# Backup current settings
cp .env .env.backup

# Reconfigure from scratch with enhanced wallet setup
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

### Latest Version (v3.1) - Current Features

#### 🔐 **Enhanced Wallet Management**
- Interactive wallet setup with 3 options (create new, import base58, use existing)
- **Phantom/Solflare Import**: Direct base58 private key import with automatic JSON conversion
- **Wallet Info Utility**: Safe wallet information display with optional private key access
- Enhanced security warnings and validation for all wallet operations
- Auto-detection of existing wallets with fallback handling

### Previous Version (v3.0) Features

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

#### 🔄 **Recent Reliability Fixes**
- **Progressive Slippage Retry**: Fixed "ExceededBinSlippageTolerance" errors during volatile rebalancing with 1%, 2%, 3% progressive slippage
- **Balance Caching Fix**: Retry attempts now respect original SOL limits instead of using unclamped wallet totals
- **Jupiter Ultra API Improvements**: Fresh order requests on each retry with dynamic slippage recalculation instead of reusing stale orders
- **Position-Only Operation**: Bot never exceeds initial deposit + earned gains/losses, wallet reserves remain untouched

---

*Built with ❤️ for the Solana DeFi ecosystem*

**Disclaimer**: This software is experimental. Always test with small amounts and understand the risks involved in liquidity provision and automated trading.