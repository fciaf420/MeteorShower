/**
 * Token assignment verification utilities for DLMM pools
 * Helps verify that tokenX/tokenY assignments match expected SDK behavior
 */

import { PublicKey } from '@solana/web3.js';
import { SOL_MINT } from '../../constants.js';

/**
 * Verify DLMM token assignments match SDK sorting rules
 * TokenX should be the lexicographically smaller public key
 * 
 * @param {Object} dlmmPool - DLMM pool instance
 * @returns {Object} Verification results
 */
export function verifyTokenAssignments(dlmmPool) {
  const tokenXKey = dlmmPool.tokenX.publicKey;
  const tokenYKey = dlmmPool.tokenY.publicKey;
  
  // SDK rule: compare buffers, X should be smaller
  const comparison = tokenXKey.toBuffer().compare(tokenYKey.toBuffer());
  const isCorrectOrder = comparison < 0; // X < Y lexicographically
  
  return {
    isCorrectOrder,
    tokenXKey: tokenXKey.toString(),
    tokenYKey: tokenYKey.toString(),
    comparison,
    explanation: isCorrectOrder 
      ? 'Token assignments follow SDK rules (X < Y lexicographically)'
      : '⚠️ Token assignments appear reversed (X > Y lexicographically)'
  };
}

/**
 * Determine which token is SOL automatically
 * 
 * @param {Object} dlmmPool - DLMM pool instance
 * @returns {Object} SOL detection results
 */
export function detectSolToken(dlmmPool) {
  const tokenXKey = dlmmPool.tokenX.publicKey.toString();
  const tokenYKey = dlmmPool.tokenY.publicKey.toString();
  const solMint = SOL_MINT.toString();
  
  const xIsSol = tokenXKey === solMint;
  const yIsSol = tokenYKey === solMint;
  
  return {
    xIsSol,
    yIsSol,
    solToken: xIsSol ? 'X' : (yIsSol ? 'Y' : 'NONE'),
    nonSolToken: xIsSol ? 'Y' : (yIsSol ? 'X' : 'BOTH'),
    tokenXSymbol: dlmmPool.tokenX.symbol || 'TOKEN_X',
    tokenYSymbol: dlmmPool.tokenY.symbol || 'TOKEN_Y'
  };
}

/**
 * Get comprehensive token analysis for debugging
 * 
 * @param {Object} dlmmPool - DLMM pool instance
 * @returns {Object} Complete token analysis
 */
export function analyzeTokenAssignments(dlmmPool) {
  const verification = verifyTokenAssignments(dlmmPool);
  const solDetection = detectSolToken(dlmmPool);
  
  return {
    ...verification,
    ...solDetection,
    poolInfo: {
      name: `${solDetection.tokenXSymbol}/${solDetection.tokenYSymbol}`,
      tokenXDecimals: typeof dlmmPool.tokenX.decimal === 'number' ? dlmmPool.tokenX.decimal : 'pending',
      tokenYDecimals: typeof dlmmPool.tokenY.decimal === 'number' ? dlmmPool.tokenY.decimal : 'pending'
    }
  };
}

/**
 * Log comprehensive token assignment analysis
 * 
 * @param {Object} dlmmPool - DLMM pool instance
 * @param {string} label - Optional label for logging
 */
export function logTokenAssignments(dlmmPool, label = 'Token Assignment Analysis') {
  const analysis = analyzeTokenAssignments(dlmmPool);
  
  console.log(`🔍 ${label}:`);
  console.log(`   Pool: ${analysis.poolInfo.name}`);
  console.log(`   Token X: ${analysis.tokenXKey.slice(0, 8)}... (${analysis.tokenXSymbol}) - ${analysis.xIsSol ? 'SOL' : 'Token'}`);
  console.log(`   Token Y: ${analysis.tokenYKey.slice(0, 8)}... (${analysis.tokenYSymbol}) - ${analysis.yIsSol ? 'SOL' : 'Token'}`);
  console.log(`   SOL Position: ${analysis.solToken}`);
  console.log(`   Assignment Order: ${analysis.explanation}`);
  console.log(`   Decimals: X=${analysis.poolInfo.tokenXDecimals}, Y=${analysis.poolInfo.tokenYDecimals}`);
  
  if (!analysis.isCorrectOrder) {
    console.log(`   ⚠️ WARNING: Token order doesn't match expected SDK rules!`);
  }
}
