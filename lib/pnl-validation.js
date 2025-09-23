// ───────────────────────────────────────────────
// ~/lib/pnl-validation.js - P&L Validation and Safeguards
// ───────────────────────────────────────────────

import BN from 'bn.js';

/**
 * Validate P&L calculations and detect anomalies
 * Prevents false take profit triggers and baseline errors
 */

/**
 * Validate baseline update logic
 * @param {number} previousBaseline - Previous baseline value in USD
 * @param {number} newBaseline - Proposed new baseline value in USD
 * @param {Object} rebalanceData - Rebalance operation data
 * @returns {Object} Validation result
 */
export function validateBaselineUpdate(previousBaseline, newBaseline, rebalanceData) {
  const {
    claimedFeesUsd = 0,
    transactionCostsUsd = 0,
    isSwaplessRebalance = false,
    positionValueUsd = 0
  } = rebalanceData;

  // Calculate expected baseline change
  const expectedChange = claimedFeesUsd - transactionCostsUsd;
  const actualChange = newBaseline - previousBaseline;
  const changeDifference = Math.abs(actualChange - expectedChange);

  // Baseline should only change by fees earned minus costs
  // Large unexplained jumps indicate accounting errors
  const BASELINE_CHANGE_THRESHOLD = 50; // $50 USD threshold for investigation

  const validation = {
    isValid: true,
    warnings: [],
    errors: [],
    expectedBaseline: previousBaseline + expectedChange,
    actualBaseline: newBaseline,
    deviation: changeDifference
  };

  // Critical error: Large baseline jump without explanation
  if (changeDifference > BASELINE_CHANGE_THRESHOLD) {
    validation.isValid = false;
    validation.errors.push(
      `Baseline jumped $${changeDifference.toFixed(2)} without explanation. ` +
      `Expected: $${validation.expectedBaseline.toFixed(2)}, Got: $${newBaseline.toFixed(2)}`
    );
  }

  // Warning: Baseline decreasing significantly
  if (actualChange < -10 && Math.abs(actualChange) > Math.abs(expectedChange) * 2) {
    validation.warnings.push(
      `Baseline decreased more than expected. Expected: ${expectedChange.toFixed(2)}, ` +
      `Actual: ${actualChange.toFixed(2)}`
    );
  }

  // Swapless rebalance validation
  if (isSwaplessRebalance) {
    // In swapless rebalancing, baseline should barely change
    if (changeDifference > 5) { // $5 threshold for swapless
      validation.warnings.push(
        `Swapless rebalancing caused unexpected baseline change of $${changeDifference.toFixed(2)}`
      );
    }
  }

  return validation;
}

/**
 * Validate P&L percentage changes for take profit triggers
 * @param {number} currentPnlPercent - Current P&L percentage
 * @param {number} previousPnlPercent - Previous P&L percentage
 * @param {Object} rebalanceData - Recent rebalance data
 * @returns {Object} Validation result
 */
export function validatePnlChange(currentPnlPercent, previousPnlPercent, rebalanceData) {
  const pnlJump = currentPnlPercent - previousPnlPercent;
  const PNL_JUMP_THRESHOLD = 5; // 5% sudden jump threshold

  const validation = {
    isValid: true,
    isSuspicious: false,
    warnings: [],
    pnlJump: pnlJump,
    shouldBlockTakeProfit: false
  };

  // Detect suspicious P&L jumps that might be false
  if (pnlJump > PNL_JUMP_THRESHOLD) {
    validation.isSuspicious = true;
    validation.warnings.push(
      `P&L jumped ${pnlJump.toFixed(2)}% suddenly. This may be a false calculation.`
    );

    // Block take profit if jump coincides with rebalancing
    if (rebalanceData?.justRebalanced) {
      validation.shouldBlockTakeProfit = true;
      validation.warnings.push(
        `Blocking take profit trigger - P&L jump occurred during rebalancing, likely false.`
      );
    }
  }

  return validation;
}

/**
 * Validate fee accumulation across rebalances
 * @param {BN} totalFeesTracked - Total fees tracked across all systems
 * @param {Array} rebalanceHistory - History of rebalances
 * @returns {Object} Validation result
 */
export function validateFeeAccumulation(totalFeesTracked, rebalanceHistory) {
  const validation = {
    isValid: true,
    warnings: [],
    totalExpectedFees: new BN(0),
    actualFees: totalFeesTracked
  };

  // Calculate expected fees from rebalance history
  for (const rebalance of rebalanceHistory) {
    if (rebalance.feesEarned) {
      validation.totalExpectedFees = validation.totalExpectedFees.add(
        new BN(rebalance.feesEarned.toString())
      );
    }
  }

  // Check for significant discrepancies
  const difference = validation.actualFees.sub(validation.totalExpectedFees).abs();
  const threshold = validation.totalExpectedFees.div(new BN(10)); // 10% threshold

  if (difference.gt(threshold)) {
    validation.isValid = false;
    validation.warnings.push(
      `Fee accumulation mismatch: Expected ${validation.totalExpectedFees.toString()}, ` +
      `Got ${validation.actualFees.toString()}`
    );
  }

  return validation;
}

/**
 * Comprehensive P&L health check
 * @param {Object} pnlState - Current P&L state
 * @param {Object} rebalanceData - Recent rebalance data
 * @returns {Object} Overall health assessment
 */
export function performPnlHealthCheck(pnlState, rebalanceData) {
  const healthCheck = {
    isHealthy: true,
    issues: [],
    recommendations: [],
    shouldPauseTrading: false
  };

  // Validate baseline
  if (pnlState.previousBaseline && pnlState.currentBaseline) {
    const baselineValidation = validateBaselineUpdate(
      pnlState.previousBaseline,
      pnlState.currentBaseline,
      rebalanceData
    );

    if (!baselineValidation.isValid) {
      healthCheck.isHealthy = false;
      healthCheck.issues.push(...baselineValidation.errors);
      healthCheck.shouldPauseTrading = true;
    }

    healthCheck.issues.push(...baselineValidation.warnings);
  }

  // Validate P&L changes
  if (pnlState.currentPnlPercent !== undefined && pnlState.previousPnlPercent !== undefined) {
    const pnlValidation = validatePnlChange(
      pnlState.currentPnlPercent,
      pnlState.previousPnlPercent,
      rebalanceData
    );

    if (pnlValidation.shouldBlockTakeProfit) {
      healthCheck.recommendations.push('Block take profit triggers for next 2 cycles');
    }

    healthCheck.issues.push(...pnlValidation.warnings);
  }

  // Add recommendations based on issues
  if (healthCheck.issues.length > 0) {
    healthCheck.recommendations.push('Review P&L calculations for accuracy');
    healthCheck.recommendations.push('Check fee mapping consistency');
  }

  return healthCheck;
}