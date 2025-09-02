// MeteorShower Shared Constants
// Consolidates constants used across multiple modules to prevent conflicts and inconsistencies

import { PublicKey } from '@solana/web3.js';

// Solana native SOL mint address - used consistently across all modules
export const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Token account size in bytes for rent exemption calculations
export const TOKEN_ACCOUNT_SIZE = 165;

// Base fee amounts for transaction cost estimation
export const BASE_FEE_LAMPORTS = 10_000n; // BigInt for main.js compatibility (aligned with BN value)
export const BASE_FEE_BN = 10_000; // Number for BN constructor in lib/dlmm.js

// SOL buffer amounts for various operations
export const SOL_BUFFER_LAMPORTS = 70_000_000n; // 0.07 SOL in lamports (BigInt)
export const PREFLIGHT_SOL_BUFFER = 50_000_000n; // 0.05 SOL preflight buffer

// Default priority fee fallback (micro-lamports per compute unit)
export const DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS = 50_000;

// Slippage and price impact defaults
export const DEFAULT_SLIPPAGE_BPS = 10; // 0.1% in basis points
export const DEFAULT_MAX_PRICE_IMPACT = 0.5; // 0.5%