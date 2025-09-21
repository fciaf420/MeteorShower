// ───────────────────────────────────────────────
// ~/lib/pnl-tracker.js - Comprehensive P&L Tracking
// ───────────────────────────────────────────────
import BN from 'bn.js';
import { SOL_MINT } from './constants.js';
import { getPrice } from './price.js';
import logger from './logger.js';

/**
 * P&L Tracker with baseline comparison and bin-level analysis  
 * Handles any initial allocation: SOL-only, Token-only, or Mixed
 */
export class PnLTracker {
  constructor() {
    this.baseline = null; // Initial allocation for comparison
    this.initialDeposit = null; // Initial USD value deposited
    // Lifetime claimed fees (accumulated across rebalances)
    this.claimedFees = { sol: new BN(0), token: new BN(0) };
    this.rebalanceCount = 0;
    // Optional accumulator for persistence (USD not stored; derive on demand)
    // this.totalFeesEarnedUsd is computed per-call from claimed + unclaimed
  }

  /**
   * Initialize baseline tracking with actual initial allocation
   * @param {BN} initialSolAmount - Initial SOL deposited (lamports)
   * @param {BN} initialTokenAmount - Initial token deposited (token units) 
   * @param {number} solPrice - SOL price at deposit
   * @param {number} tokenPrice - Token price at deposit (in USD)
   * @param {number} tokenDecimals - Token decimal places
   */
  async initializeBaseline(initialSolAmount, initialTokenAmount, solPrice = null, tokenPrice = null, tokenDecimals = 9) {
    // Get SOL price using correct mint address
    const currentSolPrice = solPrice || await getPrice(SOL_MINT.toString());
    
    // For token price, if not provided, assume it's priced relative to SOL
    let currentTokenPrice = tokenPrice;
    if (!currentTokenPrice && !initialTokenAmount.isZero()) {
      console.log('⚠️ [P&L] Token price not provided, using SOL price as fallback');
      currentTokenPrice = currentSolPrice; // Fallback
    }
    
    // Calculate initial USD values
    const solUsdValue = this.lamportsToUsd(initialSolAmount, currentSolPrice);
    const tokenUsdValue = initialTokenAmount.isZero() ? 0 : 
      this.tokenAmountToUsd(initialTokenAmount, currentTokenPrice, tokenDecimals);
    
    this.baseline = {
      solAmount: initialSolAmount,
      tokenAmount: initialTokenAmount,
      solPrice: currentSolPrice,
      tokenPrice: currentTokenPrice || 0,
      tokenDecimals: tokenDecimals,
      solUsdValue,
      tokenUsdValue,
      totalUsdValue: solUsdValue + tokenUsdValue
    };
    
    this.initialDeposit = this.baseline.totalUsdValue;
    
    console.log('📊 [P&L] Baseline initialized:');
    console.log(`   Initial SOL: ${this.lamportsToSol(initialSolAmount)} SOL ($${solUsdValue.toFixed(2)})`);
    console.log(`   Initial Token: ${this.tokenAmountToReadable(initialTokenAmount, tokenDecimals)} ($${tokenUsdValue.toFixed(2)})`);
    console.log(`   Total Initial: $${this.initialDeposit.toFixed(2)}`);
    console.log(`   SOL Price: $${currentSolPrice.toFixed(2)}, Token Price: $${(currentTokenPrice || 0).toFixed(6)}`);
  }

  /**
   * Calculate current position value from bin-level liquidity
   * @param {Object} position - DLMM position object
   * @param {Object} pool - DLMM pool object  
   * @param {number} currentSolPrice - Current SOL price
   * @param {PublicKey} userPublicKey - User's wallet public key for position lookup
   * @returns {Object} Detailed position breakdown
   */
  async calculatePositionValue(position, pool, currentSolPrice = null, userPublicKey = null) {
    const solPrice = currentSolPrice || await getPrice(SOL_MINT.toString());
    
    // Get bin-level breakdown
    const binBreakdown = await this.getBinLevelBreakdown(position, pool, userPublicKey);
    
    let totalSolValue = new BN(0);
    let totalTokenValue = new BN(0);
    let totalUsdValue = 0;
    
    for (const bin of binBreakdown.bins) {
      totalSolValue = totalSolValue.add(bin.solAmount);
      totalTokenValue = totalTokenValue.add(bin.tokenAmount);
      
      // Convert to USD using bin-specific pricing if available
      const binSolUsd = this.lamportsToUsd(bin.solAmount, solPrice);
      const tokenPrice = bin.binPrice ? bin.binPrice * solPrice : solPrice; // token price from bin price
      const binTokenUsd = this.tokenAmountToUsd(bin.tokenAmount, tokenPrice, this.baseline?.tokenDecimals || 9);
      
      totalUsdValue += binSolUsd + binTokenUsd;
    }
    
    return {
      bins: binBreakdown.bins,
      totalSolAmount: totalSolValue,
      totalTokenAmount: totalTokenValue,
      totalUsdValue,
      solPrice,
      binCount: binBreakdown.bins.length
    };
  }

  /**
   * Get detailed bin-level liquidity breakdown with precise calculations
   * @param {Object} position - DLMM position object
   * @param {Object} pool - DLMM pool object
   * @param {PublicKey} userPublicKey - User's wallet public key for position lookup
   * @returns {Object} Accurate bin breakdown with current SOL/token amounts
   */
  async getBinLevelBreakdown(position, pool, userPublicKey = null) {
    logger.debug('🔍 Starting bin-level breakdown analysis...');
    
    const bins = [];
    let totalClaimableFees = { sol: new BN(0), token: new BN(0) };
    
    try {
      // Use correct SDK method: getPositionsByUserAndLbPair
      logger.debug('📊 Fetching user positions from pool...');
      const ownerPubkey = userPublicKey || position.owner || position.publicKey || pool.wallet?.publicKey;
      
      if (!ownerPubkey) {
        throw new Error('Cannot find owner/user public key for position lookup');
      }
      
      const { userPositions } = await pool.getPositionsByUserAndLbPair(ownerPubkey);
      logger.debug(`📋 Found ${userPositions.length} user positions`);
      
      // Find our specific position
      let positionData = null;
      if (position.publicKey) {
        positionData = userPositions.find(p => 
          p.publicKey.toString() === position.publicKey.toString()
        );
      } else {
        // Use the first position if we don't have a specific publicKey
        positionData = userPositions[0];
      }
      
      if (!positionData) {
        throw new Error('Position not found in user positions list');
      }
      
      if (!positionData.positionData?.positionBinData) {
        throw new Error('Position bin data not found in SDK response');
      }
      
      const binData = positionData.positionData.positionBinData;
      logger.debug(`📊 Processing ${binData.length} bins from position data`);
      
      // Check if position is being closed (all amounts are undefined/zero)
      let hasAnyLiquidity = false;
      for (const bin of binData) {
        if (bin.positionXAmount || bin.positionYAmount || bin.binXAmount || bin.binYAmount) {
          hasAnyLiquidity = true;
          break;
        }
      }
      
      if (!hasAnyLiquidity) {
        logger.debug('⚠️ Position appears to be empty or being closed - skipping bin analysis');
        throw new Error('Position has no liquidity (likely being closed)');
      }

      // Figure out which side is SOL for this pool
      const xMint = pool.tokenX?.publicKey?.toString?.() || '';
      const yMint = pool.tokenY?.publicKey?.toString?.() || '';
      const X_IS_SOL = xMint === SOL_MINT.toString();
      const Y_IS_SOL = yMint === SOL_MINT.toString();

      const toBN = (v) => {
        if (BN.isBN(v)) return v;
        if (typeof v === 'bigint') return new BN(v.toString());
        if (typeof v === 'number') return new BN(v);
        if (typeof v === 'string') return new BN(v);
        if (v && v.toString) return new BN(v.toString());
        return new BN(0);
      };

      // Process each bin according to SDK structure - robustly coerce to BN and map SOL/token correctly
      for (const bin of binData) {
        const rawX = bin.positionXAmount ?? bin.binXAmount ?? 0;
        const rawY = bin.positionYAmount ?? bin.binYAmount ?? 0;

        const xAmount = toBN(rawX);
        const yAmount = toBN(rawY);

        // Map to SOL/token based on pool mints
        const solAmount = X_IS_SOL ? xAmount : yAmount;
        const tokenAmount = X_IS_SOL ? yAmount : xAmount;

        if (!solAmount.isZero() || !tokenAmount.isZero()) {
          const tokenDecimals = this.baseline?.tokenDecimals || 9;
          logger.debug(`  Bin ${bin.binId}: ${this.lamportsToSol(solAmount).toFixed(6)} SOL, ${this.tokenAmountToReadable(tokenAmount, tokenDecimals)} Token`);

          // Get bin price for calculations (best-effort)
          let binPrice = null;
          try {
            const activeBin = await pool.getActiveBin?.();
            binPrice = activeBin && typeof pool.getPriceOfBinByBinId === 'function'
              ? pool.getPriceOfBinByBinId(bin.binId)
              : (activeBin?.price ?? null);
          } catch {}

          const feeX = toBN(bin.positionFeeXAmount ?? bin.feeAmountX ?? 0);
          const feeY = toBN(bin.positionFeeYAmount ?? bin.feeAmountY ?? 0);
          const claimableSolFee = X_IS_SOL ? feeX : feeY;
          const claimableTokenFee = X_IS_SOL ? feeY : feeX;

          bins.push({
            binId: bin.binId,
            liquidityShare: toBN(bin.liquidityShare ?? 1),
            solAmount,
            tokenAmount,
            claimableSolFee,
            claimableTokenFee,
            binPrice,
            shareRatio: 1,
            isActive: false, // set below best-effort
            supply: toBN(bin.supply ?? 1),
            reserveX: xAmount,
            reserveY: yAmount
          });

          totalClaimableFees.sol = totalClaimableFees.sol.add(claimableSolFee);
          totalClaimableFees.token = totalClaimableFees.token.add(claimableTokenFee);
        }
      }

      // Set active flag best-effort
      try {
        const active = await pool.getActiveBin?.();
        if (active) {
          for (const b of bins) b.isActive = (b.binId === active.binId);
        }
      } catch {}
      
      if (bins.length === 0) {
        throw new Error('No bins with liquidity found in position data');
      }
      
    } catch (error) {
      logger.warn(`⚠️ SDK bin breakdown failed: ${error.message}`);
      logger.debug('⚠️ Available position properties: ' + JSON.stringify(Object.keys(position || {})));
      
      // Fallback: Use position totals if available
      logger.debug('⚠️ Using position totals as fallback');
      
      const totalSol = position.totalXAmount || position.xAmount || new BN(0);
      const totalToken = position.totalYAmount || position.yAmount || new BN(0);
      
      if (!totalSol.isZero() || !totalToken.isZero()) {
        bins.push({
          binId: 'fallback',
          liquidityShare: new BN(1),
          solAmount: totalSol,
          tokenAmount: totalToken,
          claimableSolFee: position.feeX || new BN(0),
          claimableTokenFee: position.feeY || new BN(0),
          binPrice: pool.getActiveBin()?.price || 1,
          shareRatio: 1,
          isActive: true,
          supply: new BN(1),
          reserveX: totalSol,
          reserveY: totalToken
        });
        
        totalClaimableFees.sol = position.feeX || new BN(0);
        totalClaimableFees.token = position.feeY || new BN(0);
      }
    }
    
    logger.debug(`✅ Bin breakdown complete: ${bins.length} bins processed`);
    
    return { 
      bins,
      totalClaimableFees,
      binCount: bins.length,
      totalLiquidity: bins.reduce((sum, bin) => sum.add(bin.solAmount).add(bin.tokenAmount), new BN(0))
    };
  }

  /**
   * Calculate comprehensive P&L with proper baseline comparison
   * @param {Object} position - DLMM position object
   * @param {Object} pool - DLMM pool object  
   * @param {number} currentSolPrice - Current SOL price
   * @param {number} currentTokenPrice - Current token price
   * @param {Object} newFees - New fees earned { sol: BN, token: BN }
   * @param {PublicKey} userPublicKey - User's wallet public key for position lookup
   * @returns {Object} Complete P&L analysis
   */
  async calculatePnL(position, pool, currentSolPrice = null, currentTokenPrice = null, newFees = null, userPublicKey = null) {
    if (!this.baseline) {
      throw new Error('P&L baseline not initialized. Call initializeBaseline() first.');
    }
    
    const solPrice = currentSolPrice || await getPrice(SOL_MINT.toString());
    
    // Get current token price (this is critical!)
    let tokenPrice = currentTokenPrice;
    if (!tokenPrice) {
      const activeBin = await (pool.getActiveBin ? pool.getActiveBin() : null);
      if (activeBin) {
        // Token price = bin price * SOL price (since bin price is token/SOL ratio)
        tokenPrice = activeBin.price * solPrice;
      } else {
        tokenPrice = this.baseline.tokenPrice; // fallback to initial
      }
    }
    
    // Update claimed fees if new fees provided (lamports / token units)
    if (newFees) {
      if (newFees.sol) this.claimedFees.sol = this.claimedFees.sol.add(newFees.sol);
      if (newFees.token) this.claimedFees.token = this.claimedFees.token.add(newFees.token);
    }
    
    // Get precise bin-level breakdown
    const binBreakdown = await this.getBinLevelBreakdown(position, pool, userPublicKey);
    
    // Calculate current position value
    let currentSolAmount = new BN(0);
    let currentTokenAmount = new BN(0);
    let unclaimedFeesUsd = 0;
    
    for (const bin of binBreakdown.bins) {
      currentSolAmount = currentSolAmount.add(bin.solAmount);
      currentTokenAmount = currentTokenAmount.add(bin.tokenAmount);
      
      // Add unclaimed fees
      unclaimedFeesUsd += this.lamportsToUsd(bin.claimableSolFee, solPrice);
      unclaimedFeesUsd += this.tokenAmountToUsd(bin.claimableTokenFee, tokenPrice, this.baseline.tokenDecimals);
    }
    
    // Current position value in USD
    const currentSolUsd = this.lamportsToUsd(currentSolAmount, solPrice);
    const currentTokenUsd = this.tokenAmountToUsd(currentTokenAmount, tokenPrice, this.baseline.tokenDecimals);
    const currentPositionUsd = currentSolUsd + currentTokenUsd;
    
    // Claimed fees in USD
    const claimedFeesUsd = this.lamportsToUsd(this.claimedFees.sol, solPrice) + 
                          this.tokenAmountToUsd(this.claimedFees.token, tokenPrice, this.baseline.tokenDecimals);
    
    // Total current value = position + unclaimed fees + claimed fees
    const totalCurrentValue = currentPositionUsd + unclaimedFeesUsd + claimedFeesUsd;
    
    // === BASELINE COMPARISONS ===
    
    // 1. Hold original allocation at current prices
    const baselineSolUsd = this.lamportsToUsd(this.baseline.solAmount, solPrice);
    const baselineTokenUsd = this.tokenAmountToUsd(this.baseline.tokenAmount, tokenPrice, this.baseline.tokenDecimals);
    const holdOriginalValue = baselineSolUsd + baselineTokenUsd;
    
    // 2. Convert everything to SOL and hold (if started with mixed/token)
    const equivalentSolAmount = this.baseline.totalUsdValue / this.baseline.solPrice; // SOL amount at start
    const holdSolValue = equivalentSolAmount * solPrice;
    
    // 3. Convert everything to token and hold (if started with mixed/SOL)
    const equivalentTokenAmount = this.baseline.totalUsdValue / (this.baseline.tokenPrice || 1);
    const holdTokenValue = equivalentTokenAmount * tokenPrice;
    
    // Calculate P&L vs different strategies
    const vsOriginalAllocation = totalCurrentValue - holdOriginalValue;
    const vsSolHold = totalCurrentValue - holdSolValue;  
    const vsTokenHold = totalCurrentValue - holdTokenValue;
    
    // Calculate percentages
    const absolutePnL = totalCurrentValue - this.initialDeposit;
    const absolutePnLPercent = (absolutePnL / this.initialDeposit) * 100;
    
    const vsOriginalPercent = (vsOriginalAllocation / this.initialDeposit) * 100;
    const vsSolHoldPercent = (vsSolHold / this.initialDeposit) * 100;
    const vsTokenHoldPercent = (vsTokenHold / this.initialDeposit) * 100;
    
    return {
      // Current state
      currentValue: totalCurrentValue,
      positionValue: currentPositionUsd,
      unclaimedFees: unclaimedFeesUsd,
      claimedFees: claimedFeesUsd,
      totalFees: unclaimedFeesUsd + claimedFeesUsd,
      
      // Current allocation
      currentSolAmount,
      currentTokenAmount,
      currentSolUsd,
      currentTokenUsd,
      
      // Baseline comparisons
      holdOriginalValue,
      holdSolValue,  
      holdTokenValue,
      
      // P&L analysis
      absolutePnL,
      absolutePnLPercent,
      vsOriginalAllocation,
      vsSolHold,
      vsTokenHold,
      vsOriginalPercent,
      vsSolHoldPercent,
      vsTokenHoldPercent,
      
      // Price changes
      solPriceChange: ((solPrice - this.baseline.solPrice) / this.baseline.solPrice) * 100,
      tokenPriceChange: this.baseline.tokenPrice ? ((tokenPrice - this.baseline.tokenPrice) / this.baseline.tokenPrice) * 100 : 0,
      
      // Metadata
      initialDeposit: this.initialDeposit,
      rebalanceCount: this.rebalanceCount,
      binCount: binBreakdown.binCount,
      
      // Detailed breakdown
      binBreakdown: binBreakdown.bins,
      
      // Current prices
      currentSolPrice: solPrice,
      currentTokenPrice: tokenPrice
    };
  }

  /**
   * Manually add claimed fees (lamports and token units)
   */
  addClaimedFees(solLamports = new BN(0), tokenAmount = new BN(0)) {
    if (solLamports) this.claimedFees.sol = this.claimedFees.sol.add(solLamports);
    if (tokenAmount) this.claimedFees.token = this.claimedFees.token.add(tokenAmount);
  }

  /**
   * Increment rebalance counter
   */
  incrementRebalance() {
    this.rebalanceCount++;
  }

  /**
   * Display comprehensive P&L report with multiple baseline comparisons
   * @param {Object} pnlData - P&L data from calculatePnL
   */
  displayPnL(pnlData) {
    console.log('\n💰 ═══════════════════════════════════════════════════════════════');
    console.log('📊 COMPREHENSIVE P&L ANALYSIS');
    console.log('💰 ═══════════════════════════════════════════════════════════════');
    
    // Current Position Breakdown
    console.log(`💵 Current Total Value: $${pnlData.currentValue.toFixed(2)}`);
    console.log(`   ├─ Position: $${pnlData.positionValue.toFixed(2)} (${this.lamportsToSol(pnlData.currentSolAmount).toFixed(4)} SOL + ${this.tokenAmountToReadable(pnlData.currentTokenAmount, this.baseline.tokenDecimals)} Token)`);
    console.log(`   ├─ Unclaimed Fees: $${pnlData.unclaimedFees.toFixed(2)}`);
    console.log(`   └─ Claimed Fees: $${pnlData.claimedFees.toFixed(2)}`);
    
    // Price Changes
    console.log(`\n📈 Price Changes Since Start:`);
    console.log(`   ├─ SOL: $${this.baseline.solPrice.toFixed(2)} → $${pnlData.currentSolPrice.toFixed(2)} (${pnlData.solPriceChange >= 0 ? '+' : ''}${pnlData.solPriceChange.toFixed(2)}%)`);
    console.log(`   └─ Token: $${this.baseline.tokenPrice?.toFixed(6) || '0.000000'} → $${pnlData.currentTokenPrice.toFixed(6)} (${pnlData.tokenPriceChange >= 0 ? '+' : ''}${pnlData.tokenPriceChange.toFixed(2)}%)`);
    
    // Baseline Comparisons
    console.log(`\n🏦 Strategy Performance vs Alternatives:`);
    
    // vs Original Allocation
    const origColor = pnlData.vsOriginalAllocation >= 0 ? '🟢' : '🔴';
    console.log(`   ${origColor} vs Hold Original Mix: $${pnlData.vsOriginalAllocation >= 0 ? '+' : ''}${pnlData.vsOriginalAllocation.toFixed(2)} (${pnlData.vsOriginalPercent >= 0 ? '+' : ''}${pnlData.vsOriginalPercent.toFixed(2)}%)`);
    console.log(`      Would have: $${pnlData.holdOriginalValue.toFixed(2)}`);
    
    // vs SOL Hold
    const solColor = pnlData.vsSolHold >= 0 ? '🟢' : '🔴';
    console.log(`   ${solColor} vs Hold All SOL: $${pnlData.vsSolHold >= 0 ? '+' : ''}${pnlData.vsSolHold.toFixed(2)} (${pnlData.vsSolHoldPercent >= 0 ? '+' : ''}${pnlData.vsSolHoldPercent.toFixed(2)}%)`);
    console.log(`      Would have: $${pnlData.holdSolValue.toFixed(2)}`);
    
    // vs Token Hold  
    const tokenColor = pnlData.vsTokenHold >= 0 ? '🟢' : '🔴';
    console.log(`   ${tokenColor} vs Hold All Token: $${pnlData.vsTokenHold >= 0 ? '+' : ''}${pnlData.vsTokenHold.toFixed(2)} (${pnlData.vsTokenHoldPercent >= 0 ? '+' : ''}${pnlData.vsTokenHoldPercent.toFixed(2)}%)`);
    console.log(`      Would have: $${pnlData.holdTokenValue.toFixed(2)}`);
    
    // Absolute P&L
    const pnlColor = pnlData.absolutePnL >= 0 ? '🟢' : '🔴';
    console.log(`\n${pnlColor} Total P&L: $${pnlData.absolutePnL >= 0 ? '+' : ''}${pnlData.absolutePnL.toFixed(2)} (${pnlData.absolutePnLPercent >= 0 ? '+' : ''}${pnlData.absolutePnLPercent.toFixed(2)}%)`);
    console.log(`   Initial Investment: $${pnlData.initialDeposit.toFixed(2)}`);
    
    // Fees Analysis
    console.log(`\n💰 Fee Performance:`);
    console.log(`   ├─ Total Fees Earned: $${pnlData.totalFees.toFixed(2)}`);
    console.log(`   ├─ Fee Yield: ${(pnlData.totalFees / pnlData.initialDeposit * 100).toFixed(3)}% of initial`);
    console.log(`   └─ Rebalances: ${pnlData.rebalanceCount}`);
    
    // Bin Analysis
    console.log(`\n📊 Position Distribution:`);
    console.log(`   ├─ Active Bins: ${pnlData.binCount}`);
    console.log(`   ├─ SOL Allocation: $${pnlData.currentSolUsd.toFixed(2)} (${(pnlData.currentSolUsd/pnlData.positionValue*100).toFixed(1)}%)`);
    console.log(`   └─ Token Allocation: $${pnlData.currentTokenUsd.toFixed(2)} (${(pnlData.currentTokenUsd/pnlData.positionValue*100).toFixed(1)}%)`);
    
    // Best Strategy Summary
    const bestStrategy = this.getBestStrategy(pnlData);
    console.log(`\n🎯 Best Strategy: ${bestStrategy.name} (${bestStrategy.performance >= 0 ? '+' : ''}${bestStrategy.performance.toFixed(2)}%)`);
    
    console.log('💰 ═══════════════════════════════════════════════════════════════\n');
    
    // Optional: Bin-level detail
    if (pnlData.binBreakdown && pnlData.binBreakdown.length <= 10) {
      console.log('📋 Bin-Level Breakdown:');
      for (const bin of pnlData.binBreakdown) {
        const binSolUsd = this.lamportsToUsd(bin.solAmount, pnlData.currentSolPrice);
        const binTokenUsd = this.tokenAmountToUsd(bin.tokenAmount, pnlData.currentTokenPrice, this.baseline.tokenDecimals);
        const binTotal = binSolUsd + binTokenUsd;
        console.log(`   Bin ${bin.binId}: $${binTotal.toFixed(2)} (${this.lamportsToSol(bin.solAmount).toFixed(4)} SOL + ${this.tokenAmountToReadable(bin.tokenAmount, this.baseline.tokenDecimals)} Token)${bin.isActive ? ' 🎯' : ''}`);
      }
      console.log('');
    }
  }

  /**
   * Determine which strategy performed best
   * @param {Object} pnlData - P&L data
   * @returns {Object} Best strategy info
   */
  getBestStrategy(pnlData) {
    const strategies = [
      { name: 'DLMM Strategy', performance: pnlData.absolutePnLPercent },
      { name: 'Hold Original Mix', performance: ((pnlData.holdOriginalValue - pnlData.initialDeposit) / pnlData.initialDeposit) * 100 },
      { name: 'Hold All SOL', performance: ((pnlData.holdSolValue - pnlData.initialDeposit) / pnlData.initialDeposit) * 100 },
      { name: 'Hold All Token', performance: ((pnlData.holdTokenValue - pnlData.initialDeposit) / pnlData.initialDeposit) * 100 }
    ];
    
    return strategies.reduce((best, current) => 
      current.performance > best.performance ? current : best
    );
  }

  /**
   * Helper: Convert lamports to SOL
   */
  lamportsToSol(lamports) {
    return lamports.toNumber() / 1e9;
  }

  /**
   * Helper: Convert lamports to USD
   */
  lamportsToUsd(lamports, solPrice) {
    return this.lamportsToSol(lamports) * solPrice;
  }

  /**
   * Helper: Convert token amount to readable format
   */
  tokenAmountToReadable(tokenAmount, decimals = 9) {
    if (tokenAmount.isZero()) return '0';
    const divisor = new BN(10).pow(new BN(decimals));
    const wholePart = tokenAmount.div(divisor);
    const fractionalPart = tokenAmount.mod(divisor);
    
    if (fractionalPart.isZero()) {
      return wholePart.toString();
    }
    
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
    const trimmedFractional = fractionalStr.replace(/0+$/, '');
    
    return trimmedFractional ? `${wholePart}.${trimmedFractional}` : wholePart.toString();
  }

  /**
   * Helper: Convert token amount to USD
   */
  tokenAmountToUsd(tokenAmount, tokenPrice, decimals = 9) {
    if (tokenAmount.isZero() || !tokenPrice) return 0;
    const divisor = new BN(10).pow(new BN(decimals));
    const tokenAmountFloat = tokenAmount.toNumber() / divisor.toNumber();
    return tokenAmountFloat * tokenPrice;
  }

  /**
   * Export state for persistence
   */
  exportState() {
    return {
      baseline: this.baseline,
      initialDeposit: this.initialDeposit,
      claimedFees: {
        sol: this.claimedFees.sol.toString(),
        token: this.claimedFees.token.toString(),
      },
      rebalanceCount: this.rebalanceCount
    };
  }

  /**
   * Import state from persistence
   */
  importState(state) {
    this.baseline = state.baseline;
    this.initialDeposit = state.initialDeposit;
    if (state.claimedFees) {
      this.claimedFees = {
        sol: new BN(state.claimedFees.sol || '0'),
        token: new BN(state.claimedFees.token || '0'),
      };
    } else {
      this.claimedFees = { sol: new BN(0), token: new BN(0) };
    }
    this.rebalanceCount = state.rebalanceCount || 0;
  }
}

export default PnLTracker;
