// ───────────────────────────────────────────────
// ~/lib/fee-mapping.js - Standardized Fee Mapping
// ───────────────────────────────────────────────
import BN from 'bn.js';

/**
 * Standardized fee mapping utility to ensure consistent SOL/Token fee allocation
 * across all systems (main.js, pnl-tracker.js, etc.)
 *
 * This solves the critical inconsistency where different parts of the system
 * mapped fees differently, causing incorrect P&L calculations.
 */

/**
 * Map DLMM fees to SOL and Token amounts consistently
 * @param {BN} feeX - Fee amount for token X (in token units)
 * @param {BN} feeY - Fee amount for token Y (in token units)
 * @param {boolean} isSolX - True if SOL is token X, false if SOL is token Y
 * @returns {Object} Standardized fee mapping
 */
export function mapDlmmFees(feeX, feeY, isSolX) {
  return {
    solFee: isSolX ? feeX : feeY,
    tokenFee: isSolX ? feeY : feeX,
    // Metadata for debugging
    originalFeeX: feeX,
    originalFeeY: feeY,
    isSolX: isSolX
  };
}

/**
 * Map fees with validation and type conversion
 * @param {BN|number|string} feeX - Fee amount for token X
 * @param {BN|number|string} feeY - Fee amount for token Y
 * @param {boolean} isSolX - True if SOL is token X
 * @returns {Object} Validated fee mapping with BN values
 */
export function mapDlmmFeesWithValidation(feeX, feeY, isSolX) {
  // Ensure BN types
  const feeXBN = feeX instanceof BN ? feeX : new BN(feeX.toString());
  const feeYBN = feeY instanceof BN ? feeY : new BN(feeY.toString());

  // Validate inputs
  if (feeXBN.isNeg() || feeYBN.isNeg()) {
    throw new Error('Fee amounts cannot be negative');
  }

  if (typeof isSolX !== 'boolean') {
    throw new Error('isSolX must be a boolean');
  }

  return mapDlmmFees(feeXBN, feeYBN, isSolX);
}

/**
 * Convert raw DLMM pool fees to readable format
 * @param {Object} fees - Raw fees from DLMM position
 * @param {boolean} isSolX - True if SOL is token X
 * @param {number} solDecimals - SOL decimals (default 9)
 * @param {number} tokenDecimals - Token decimals
 * @returns {Object} Human-readable fee amounts
 */
export function formatDlmmFees(fees, isSolX, solDecimals = 9, tokenDecimals = 9) {
  const mapped = mapDlmmFeesWithValidation(fees.feeX, fees.feeY, isSolX);

  return {
    solFeeReadable: mapped.solFee.toNumber() / Math.pow(10, solDecimals),
    tokenFeeReadable: mapped.tokenFee.toNumber() / Math.pow(10, tokenDecimals),
    solFeeLamports: mapped.solFee,
    tokenFeeUnits: mapped.tokenFee,
    debug: {
      originalFeeX: mapped.originalFeeX.toString(),
      originalFeeY: mapped.originalFeeY.toString(),
      isSolX: mapped.isSolX
    }
  };
}

/**
 * Validate fee mapping consistency across systems
 * @param {Object} mapping1 - First fee mapping result
 * @param {Object} mapping2 - Second fee mapping result
 * @returns {boolean} True if mappings are consistent
 */
export function validateFeeMappingConsistency(mapping1, mapping2) {
  return (
    mapping1.solFee.eq(mapping2.solFee) &&
    mapping1.tokenFee.eq(mapping2.tokenFee) &&
    mapping1.isSolX === mapping2.isSolX
  );
}

/**
 * Create zero fees object for initialization
 * @returns {Object} Zero fees mapping
 */
export function createZeroFees() {
  return {
    solFee: new BN(0),
    tokenFee: new BN(0),
    originalFeeX: new BN(0),
    originalFeeY: new BN(0),
    isSolX: false // Will be set properly when first fees are received
  };
}