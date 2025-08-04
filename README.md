### Introduction

This document provides instructions for the DLMM Liquidity Bot known as Meteor Shower, an open-source tool designed to automate the process of providing liquidity on the Meteora platform. Specifically, this bot helps users automatically re-center their positions in Meteora's Dynamic Liquidity Market Maker (DLMM) pools. By monitoring the active price bin, the bot can close and reopen a liquidity position to keep it centered, aiming to optimize fee capture and manage position effectiveness.

This tool is intended for users who have a solid understanding of decentralized finance (DeFi), liquidity pools, and the inherent risks involved. Please read the following disclaimers carefully before proceeding.

### **Disclaimers**

**No Financial Advice**
The information and tools provided in this guide are for informational purposes only and do not constitute financial, investment, or trading advice. You should not construe any such information or other material as legal, tax, investment, financial, or other advice. The use of this bot is at your sole discretion and risk.

**Risk of Financial Loss**
Providing liquidity in a DLMM, like any other automated market maker, carries significant financial risks. These risks include, but are not limited to, impermanent loss, price volatility, and potential loss of your entire deposited capital. The automated nature of this bot does not eliminate these risks and may, in some market conditions, amplify them.

**Open-Source Software**
This is an open-source software provided on an "as is" basis, without warranties or representations of any kind, express or implied. The developers and contributors of this software are not liable for any bugs, errors, or vulnerabilities in the code. You are responsible for reviewing and understanding the code before you use it.

**Smart Contract Risk**
The bot interacts with the smart contracts of the Meteora platform and may use other third-party protocols like Jupiter for token swaps. Smart contracts can have vulnerabilities or behave in unexpected ways, which could lead to a partial or total loss of your funds.

**No Guarantee of Performance**
There is no guarantee that this bot will perform as expected or that it will be profitable. Market conditions can change rapidly, and the bot's re-centering strategy may not be effective in all scenarios. Past performance is not indicative of future results.

By choosing to use the DLMM Liquidity Bot, you acknowledge that you have read, understood, and accepted these risks. You agree that the developers and contributors of this software will not be held liable for any losses or damages that may arise from its use.

# DLMM Liquidity Bot Setup Guide

This guide explains how to set up and run the DLMM liquidity bot for Meteora on Solana.

---

## Beginner's Guide to Downloading and Accessing GitHub Code

Follow these simple steps to download code from GitHub and access it via the Command Line Interface (CLI).

### 1. Downloading the Code from GitHub

*   Visit the GitHub repository at this link: [https://github.com/TheMattness/MeteorShower/tree/main](https://github.com/TheMattness/MeteorShower/tree/main)
*   Click on the green `<> Code` button on the right side of the page.
*   Select `Download ZIP`. Your download will start automatically.

### 2. Extracting the ZIP File

*   Navigate to your computer's `Downloads` folder (or wherever the file was downloaded).
*   Locate the file named `MeteorShower-main.zip`.
*   Right-click the ZIP file and select `Extract All`.
*   Choose a location to extract the files (the default is typically fine).
*   Click `Extract`.

### 3. Navigating to the Directory Using CLI

*   **Open your Command Line Interface (CLI):**
    *   **Windows:** Search for `Command Prompt` in your Start Menu.
    *   **MacOS:** Search for and open `Terminal` using Spotlight Search (`Cmd + Space`).
    *   **Linux:** Open the `Terminal` application from your applications menu.
*   **Navigate to the directory:**
    *   Replace `<your-username>` with your actual username.
    *   **On Windows:**
        ```bash
        cd C:\Users\<your-username>\Downloads\MeteorShower-main
        ```
    *   **On MacOS or Linux:**
        ```bash
        cd ~/Downloads/MeteorShower-main
        ```
*   **Check if you're in the right place:**
    ```bash
    ls
    ```
    This command should list files like `README.md` and other files from the repository.

You're now ready to use or explore the code!

---

## Beginner's Guide to Running MeteorShower From Scratch

### 1. Install Node.js

Ensure Node.js is installed on your system. If you are unfamiliar, Node is how you will run the javascript code.
*   **Download:** [Node.js Official Website](https://nodejs.org/)

*   **Check Installation:** Run the following commands in your terminal:
    ```bash
    node -v
    npm -v
    ```
    If both commands return version numbers, Node.js is installed successfully.

### 2. Install Dependencies

We have the required libraries defined in our `packages.json`. Run the following command in your terminal to install these required packages:
```bash
npm install
```

### 3. Create Configuration File

Create a file named `.env` in your project directory. We will create this file by running the following script in our command line:
```bash
node configure.js run
```
Below we go through each item during setup. Input your known values or use the defaults. You can also edit the `.env` file directly after we create it during configuration.

---

## Detailed `.env` Variable Reference

This reference explains every value in `.env.example`, what it controls, and how to pick a setting. Comments that start with `#` are ignored by the bot—they are just notes for you.

### 1. Network / RPC

*   `RPC_URL`
    *   Full HTTPS endpoint for a Solana RPC node. Use the URL (including any API key query-string) given by Helius, Triton, QuickNode, or your own validator. Without a reliable RPC, the bot cannot send transactions.
    *   If you do not have an RPC provider then we recommend Helius - [https://www.helius.dev/](https://www.helius.dev/) which has a free tier which is more than capable of supporting this bot.

### 2. Wallet / Keys

*   `WALLET_PATH`
    *   Absolute path (or `~/…`) to the JSON key-pair created by `solana-keygen new`. If you did not have a wallet created before using `configure.js` then leave this blank. If you leave this blank, `configure.js` will generate a new wallet and fill the path for you. Back up this file—whoever has it controls your funds.
*   `# WALLET_ADDRESS=…`
    *   This comment is added automatically by `configure.js` after it knows your public key. It is informational only. This is the wallet address which you will need to transfer your funds before you run the bot.

### 3. Pool Configuration

*   `POOL_ADDRESS`
    *   Address of the Meteora DLMM liquidity-bin pair you intend to provide liquidity to—not the LP token mint. Copy it from the Meteora UI or a block explorer. You must use a SOL pool pair. Underlined is the pool address from a Meteora URL:
    *   `https://app.meteora.ag/dlmm/<u>6wJ7W3oHj7ex6MVFp2o26NSof3aey7U8Brs8E371WCXA</u>?referrer=portfolio`
*   `TOTAL_BINS_SPAN`
    *   Total number of bins that your position will cover, counting both sides of the active price. A wider span reduces recenter frequency but spreads your capital thin; a narrow span concentrates fees but requires more rebalancing. Meteora uses 69 as a default.
*   `LOWER_COEF`
    *   Fraction of those bins allocated below the active price. For symmetrical exposure use `0.5`. A lower number biases more bins above price; a higher number places more below.
*   `LIQUIDITY_STRATEGY_TYPE`
    *   Preset that shapes how liquidity is distributed inside your span. `Spot`, `Curve`, or `BidAsk` distribute liquidity differently. Choose one recognised by the version of Meteora you are running.
    *   Here is a quick overview: [https://docs.meteora.ag/overview/products/dlmm/1-what-is-dlmm#liquidity-shapes](https://docs.meteora.ag/overview/products/dlmm/1-what-is-dlmm#liquidity-shapes)

### 4. Fee & Priority Tuning

*   `PRIORITY_FEE_MICRO_LAMPORTS`
    *   Extra compute-unit fee expressed in micro-lamports. Higher numbers buy faster confirmations. Around `50000` corresponds to the "very high" preset on main-net.
*   `SOL_FEE_BUFFER_LAMPORTS`
    *   Amount of SOL (in lamports) the bot will reserve for future rent and fees. Default is `70000000` (0.07 SOL). The bot refuses to drop below this balance. This is to cover the refundable pool rent and to cover transaction costs after capital is allocated.
*   `PRICE_IMPACT`
    *   Maximum allowed price impact when Jupiter performs swaps to balance your tokens. `0.1` means 0.10 %.
*   `SLIPPAGE`
    *   Slippage tolerance, expressed in basis points. `10` equals 0.1 %.

### 5. Monitoring & Rebalancing

*   `MONITOR_INTERVAL_SECONDS`
    *   How often, in seconds, the bot checks price drift and position health.
*   `CENTER_DISTANCE_THRESHOLD`
    *   When price moves this far from the centre of your span, the bot closes and reopens the position. The value is expressed as a fraction of half-span. `0.45` means 45 % of half-width. In a 20 bin pool, the bot will recenter when the pool is on the final bin before ‘out of range’.

### 6. Manual vs Automatic Span Optimisation

*   `MANUAL`
    *   `true` instructs the bot to use your fixed `TOTAL_BINS_SPAN`. `false` makes it query an external API for an adaptive span.
*   `DITHER_ALPHA_API`
    *   URL of the service that returns historical volatility metrics. Used only when `MANUAL=false`.
*   `LOOKBACK`
    *   Number of days of historical data the bot requests when calculating an adaptive span.

### 7. Logging & Debugging

*   `LOG_LEVEL`
    *   Controls how much information the bot prints. Accepted values: `fatal`, `error`, `warn`, `info`, `debug`, `trace`. Use `debug` if you are troubleshooting.

---

## Quick-Start `.env` Template

Copy this block into a new file named `.env`, then replace the highlighted bits:

```env
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE
WALLET_PATH=~/id.json
POOL_ADDRESS=PASTE_YOUR_POOL_ADDRESS
TOTAL_BINS_SPAN=40
LOWER_COEF=0.5
LIQUIDITY_STRATEGY_TYPE=Spot
PRIORITY_FEE_MICRO_LAMPORTS=50000
SOL_FEE_BUFFER_LAMPORTS=70000000
PRICE_IMPACT=0.1
SLIPPAGE=10
MONITOR_INTERVAL_SECONDS=30
CENTER_DISTANCE_THRESHOLD=0.45
MANUAL=true
DITHER_ALPHA_API=http://0.0.0.0:8000/metrics
LOOKBACK=30
LOG_LEVEL=info
```

Once the file is saved, you can start the bot with `node cli.js run`. Good luck!

---

## 4. Running the Bot

*   **Run the bot with default settings:**
    ```bash
    node cli.js run
    ```

*   **Run the bot with a custom monitoring interval (e.g., every 30 seconds):**
    ```bash
    node cli.js run --interval 30
    ```

## 5. Understanding What the Bot Does

*   **Opens Liquidity Positions:** Creates a DLMM liquidity position centered around the current active bin.
*   **Balances Tokens:** Automatically uses Jupiter to balance your token holdings to optimal ratios.
*   **Continuous Monitoring:** Tracks your position value and performance in real-time.
*   **Automatic Rebalancing:** Closes and reopens positions when the active price moves too far from your liquidity center.

## 7. Prerequisites

*   A Solana wallet containing the tokens for your target pool.
*   Some SOL for transaction fees (the bot reserves 0.07 SOL as a fee buffer).
*   Your wallet file must be a JSON array containing private key bytes.

## 8. Safety and Reliability Features

*   Maintains a buffer of SOL to ensure transactions complete.
*   Implements retry logic for failed transactions.
*   Validates token balances before performing actions.
*   Uses slippage protection when swapping tokens.
*   Press `Ctrl+C` at any time to stop the bot.

## 9. Manual Mode Configuration

To enable manual control, update your `.env` file:
```env
MANUAL=true
TOTAL_BINS_SPAN=15         # Sets a fixed bin span width
LOWER_COEF=0.5             # 50% bins below, 50% above the active price
CENTER_DISTANCE_THRESHOLD=0.45  # Rebalances at 45% drift
```

### When to use Manual Mode:
*   Manage your position size and span directly.
*   API optimization isn't available to you.
*   Implementing your own liquidity management strategies.

### When to use Automatic Mode:
*   Optimal range based on dynamic volatility.
*   Adaptive positioning based on current market conditions.
