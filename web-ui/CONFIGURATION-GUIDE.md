# MeteorShower Web UI Configuration Guide

## 🎯 **Interactive Configuration Setup**

Your MeteorShower bot now has a **visual configuration wizard** that replaces the CLI setup experience!

### 🚀 **How to Configure Your Bot**

#### **Option 1: Settings Button in Control Panel**
1. Visit **http://localhost:3000**
2. Look for the **"Configure Settings"** button in the Control Panel (bottom-right card)
3. Click to open the 5-step configuration wizard

#### **Option 2: Settings Navigation**
1. Click **"Settings"** in the top navigation bar
2. Opens the same configuration wizard

### 📝 **5-Step Configuration Wizard**

#### **Step 1: Network Configuration**
- **RPC URL**: Your Solana RPC endpoint (Helius, Triton, QuickNode)
- **Example**: `https://mainnet.helius-rpc.com/?api-key=YOUR-API-KEY`
- **Required**: ✅ Must be HTTPS endpoint

#### **Step 2: Wallet Setup** 
- **Wallet Path**: Absolute path to your Solana keypair JSON file
- **Example**: `/path/to/your/wallet.json` or `C:\Users\YourName\wallet.json`
- **Required**: ✅ Must point to valid keypair file

#### **Step 3: Pool Configuration**
- **Pool Address**: Choose from dropdown or enter manually
  - 🔍 **Search pools** by name or address
  - 📊 **View APY and TVL** for each pool
  - ✏️ **Manual entry** option for custom pools
- **Bin Span**: Number of bins (1-100, default: 40)
- **Lower Coefficient**: Portion below active price (0-1, default: 0.5)
- **Strategy**: Spot, Curve, or BidAsk

#### **Step 4: Trading Parameters**
- **Priority Fee**: Micro-lamports per CU (default: 50,000)
- **SOL Buffer**: Reserved for fees (default: 70,000,000 lamports = 0.07 SOL)
- **Price Impact**: Max acceptable impact (default: 0.1%)
- **Slippage**: Slippage tolerance (default: 10 = 0.1%)

#### **Step 5: System Settings**
- **Monitor Interval**: Check frequency in seconds (default: 30)
- **Manual Mode**: Enable manual bin span parameters
- **Log Level**: fatal, error, warn, info, debug, trace

### 🎛️ **Configuration Features**

#### **🔍 Pool Selection Dropdown**
- **Live Pool Data**: APY, TVL, fee information
- **Smart Search**: Find pools by name, token, or address
- **Popular Pools**: SOL/USDC, SOL/USDT, SOL/BONK pre-loaded
- **Manual Entry**: Enter any pool address directly

#### **✅ Real-Time Validation**
- **URL Validation**: Ensures RPC endpoints are HTTPS
- **Path Validation**: Checks wallet path format
- **Range Validation**: Bin span (1-100), coefficients (0-1)
- **Address Validation**: Basic Solana address format checking

#### **💾 Auto-Save to .env**
- Saves directly to your `.env` file
- Compatible with existing CLI bot
- No need to run `configure.js` again
- Instant application to running bot

### 🔄 **How It Replaces CLI Setup**

#### **Before (CLI)**:
```bash
node configure.js
# Interactive prompts in terminal
# Type each value manually
# No visual feedback
# Easy to make typos
```

#### **Now (Web UI)**:
```bash
# 1. Start web UI
npm run dev

# 2. Visit http://localhost:3000
# 3. Click "Configure Settings" or "Settings"
# 4. Visual wizard with validation
# 5. Pool selection dropdown
# 6. Save directly to .env
```

### 📱 **Mobile-Friendly**
- **Responsive Design**: Works on phones and tablets
- **Touch Controls**: Optimized for mobile trading
- **Full Functionality**: Complete setup on any device

### 🎨 **Visual Improvements**
- **Progress Indicator**: Shows step completion
- **Field Validation**: Real-time error checking
- **Help Text**: Explains each setting
- **Pool Information**: APY and TVL display
- **Dark DeFi Theme**: Professional trading interface

### 🔧 **Advanced Features**

#### **Configuration Persistence**
- Reads existing `.env` values as defaults
- Updates only changed values
- Preserves comments and formatting
- Backward compatible with CLI

#### **Error Handling**
- **Validation Messages**: Clear error descriptions
- **Step Validation**: Can't proceed with invalid data
- **Network Errors**: Graceful handling of API issues
- **Rollback**: Can cancel without saving changes

#### **Pool Management**
- **Live Data**: Fetches current APY and TVL
- **Favorites**: Remember frequently used pools
- **Search History**: Recent pool searches
- **Validation**: Checks pool exists and is active

## 🎉 **Result**

After configuration, your bot will:
1. ✅ Use the new settings automatically
2. ✅ Start trading with your preferred pools
3. ✅ Apply risk management parameters
4. ✅ Monitor at your chosen intervals
5. ✅ Log at your preferred level

**No more command-line configuration needed!** 🚀

The web UI provides the same powerful setup as the CLI but with:
- 🎯 Visual guidance and validation
- 🔍 Pool discovery and search
- 📊 Real-time data and feedback
- 📱 Mobile-friendly interface
- 💾 Automatic .env management

**Ready to configure your bot visually!** Click "Settings" to get started! 🌠