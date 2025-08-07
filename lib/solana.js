// ───────────────────────────────────────────────
// ~/lib/solana.js
// ───────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import os from 'os';
import BN from 'bn.js';
import {
  Connection,
  PublicKey,
  Keypair,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createCloseAccountInstruction
} from '@solana/spl-token';


function loadWalletKeypair(walletPath) {
  const resolved = walletPath.startsWith('~')
    ? path.join(os.homedir(), walletPath.slice(1))
    : path.resolve(walletPath);
  if (!fs.existsSync(resolved)) {
    console.error('Error: wallet file not found at', resolved);
    process.exit(1);
  }
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(resolved, 'utf8')));
  return Keypair.fromSecretKey(secret);
}
async function getMintDecimals(connection, mintPubkey) {
  const info = await connection.getParsedAccountInfo(mintPubkey);
  return info.value.data.parsed.info.decimals;
}

async function safeGetBalance(connection, mint, owner) {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  if (mint.toString() === SOL_MINT) {
    // 1️⃣ native lamports
    const nativeLamports = new BN(await connection.getBalance(owner, "confirmed"));

    // 2️⃣ wrapped SOL in the ATA (if any)
    const ata = await getAssociatedTokenAddress(mint, owner, true);
    let wrappedLamports = new BN(0);
    try {
      const bal = await connection.getTokenAccountBalance(ata, "confirmed");
      wrappedLamports = new BN(bal.value.amount);        
    } catch (e) {
      if (!/could not find account/i.test(e.message)) throw e;
    }

    return nativeLamports.add(wrappedLamports);
  }

  // ── SPL tokens ──
  const ata = await getAssociatedTokenAddress(mint, owner, true);
  try {
    const bal = await connection.getTokenAccountBalance(ata, "confirmed");
    return new BN(bal.value.amount);
  } catch (e) {
    if (/could not find account/i.test(e.message)) return new BN(0);
    throw e;
  }
}

async function unwrapWSOL(connection, ownerKeypair) {
  const wsolAta = await getAssociatedTokenAddress(
    new PublicKey("So11111111111111111111111111111111111111112"),
    ownerKeypair.publicKey,
    true
  );

  try {
    const bal = await connection.getTokenAccountBalance(wsolAta, 'confirmed');
    if (bal?.value?.uiAmount && bal.value.uiAmount > 0) {
      const ix = createCloseAccountInstruction(
        wsolAta,                       // source (WSOL ATA)
        ownerKeypair.publicKey,        // destination (native SOL)
        ownerKeypair.publicKey         // authority
      );
      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [ownerKeypair]);
      console.log('✔ WSOL unwrapped:', bal.value.amount, 'lamports');
    }
  } catch (e) {
    if (!/could not find account/i.test(e.message)) throw e;
  }
}

function createConnection(rpcUrl, commitment = 'confirmed') {
  return new Connection(rpcUrl, { commitment });
}

/**
 * Scans wallet for accumulated tokens that match the specific LP pair mints
 * SAFETY: Only returns tokens that exactly match the LP pair - no random tokens!
 * LIMIT: Only uses small amounts to prevent consuming entire wallet balance
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} walletPubKey - User's wallet public key
 * @param {PublicKey} tokenXMint - EXACT Token X mint address from LP pair
 * @param {PublicKey} tokenYMint - EXACT Token Y mint address from LP pair
 * @param {number} initialDepositUsd - Original deposit amount to limit usage
 * @returns {Object} Available wallet tokens ONLY for the specific LP pair mints
 */
async function getWalletTokensForRebalancing(connection, walletPubKey, tokenXMint, tokenYMint, initialDepositUsd = 0) {
  try {
    console.log('🔍 Scanning wallet for accumulated LP pair tokens...');
    console.log(`   🔒 SAFETY: Only using tokens matching LP pair mints:`);
    console.log(`      Token X Mint: ${tokenXMint.toBase58()}`);
    console.log(`      Token Y Mint: ${tokenYMint.toBase58()}`);
    
    // Get wallet balances ONLY for the exact LP pair mints
    const walletTokenX = await safeGetBalance(connection, tokenXMint, walletPubKey);
    const walletTokenY = await safeGetBalance(connection, tokenYMint, walletPubKey);
    
    // Get decimals for proper display
    const decimalsX = await getMintDecimals(connection, tokenXMint);
    const decimalsY = await getMintDecimals(connection, tokenYMint);
    
    const tokenXAmount = walletTokenX.toNumber() / 10 ** decimalsX;
    const tokenYAmount = walletTokenY.toNumber() / 10 ** decimalsY;
    
    console.log(`   ✅ LP Pair Token X: ${tokenXAmount.toFixed(6)} (${tokenXMint.toBase58().slice(0,8)}...)`);
    console.log(`   ✅ LP Pair Token Y: ${tokenYAmount.toFixed(6)} (${tokenYMint.toBase58().slice(0,8)}...)`);
    
    // 🚨 CRITICAL SAFETY: Limit wallet token usage to prevent consuming entire balance
    // Only use small amounts that could realistically be from LP fees/rebalancing
    const MAX_WALLET_USAGE_MULTIPLIER = 2.0; // Max 2x the original deposit
    const maxUsageUsd = Math.max(initialDepositUsd * MAX_WALLET_USAGE_MULTIPLIER, 50); // Minimum $50 limit
    
    // Estimate token values (rough calculation for safety)
    const SOL_PRICE_ESTIMATE = 170; // Conservative SOL price estimate
    const maxSOLUsage = maxUsageUsd / SOL_PRICE_ESTIMATE;
    
    console.log(`   🔒 SAFETY LIMIT: Max wallet usage ~$${maxUsageUsd.toFixed(0)} (~${maxSOLUsage.toFixed(3)} SOL equivalent)`);
    
    // Apply safety limits to prevent wallet drainage
    let limitedTokenX = walletTokenX;
    let limitedTokenY = walletTokenY;
    let limitedTokenXAmount = tokenXAmount;
    let limitedTokenYAmount = tokenYAmount;
    
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    
    // Limit SOL usage specifically
    if (tokenXMint.toBase58() === SOL_MINT && tokenXAmount > maxSOLUsage) {
      limitedTokenX = new BN(Math.floor(maxSOLUsage * 10 ** decimalsX));
      limitedTokenXAmount = maxSOLUsage;
      console.log(`   ⚠️  LIMITED Token X (SOL): Using ${limitedTokenXAmount.toFixed(6)} instead of ${tokenXAmount.toFixed(6)}`);
    }
    
    if (tokenYMint.toBase58() === SOL_MINT && tokenYAmount > maxSOLUsage) {
      limitedTokenY = new BN(Math.floor(maxSOLUsage * 10 ** decimalsY));
      limitedTokenYAmount = maxSOLUsage;
      console.log(`   ⚠️  LIMITED Token Y (SOL): Using ${limitedTokenYAmount.toFixed(6)} instead of ${tokenYAmount.toFixed(6)}`);
    }
    
    // Return ONLY tokens that match the LP pair mints with safety limits applied
    return {
      walletTokenX: limitedTokenX,
      walletTokenY: limitedTokenY,
      decimalsX,
      decimalsY,
      tokenXAmount: limitedTokenXAmount,
      tokenYAmount: limitedTokenYAmount,
      // Include mint addresses for verification
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58(),
      // Safety information
      originalTokenXAmount: tokenXAmount,
      originalTokenYAmount: tokenYAmount,
      limitApplied: (tokenXAmount > limitedTokenXAmount) || (tokenYAmount > limitedTokenYAmount)
    };
    
  } catch (error) {
    console.error('⚠️  Error scanning LP pair tokens:', error.message);
    return {
      walletTokenX: new BN(0),
      walletTokenY: new BN(0),
      decimalsX: 9,
      decimalsY: 9,
      tokenXAmount: 0,
      tokenYAmount: 0,
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58()
    };
  }
}

export {
  loadWalletKeypair,
  getMintDecimals,
  safeGetBalance,
  unwrapWSOL,
  createConnection,
  getWalletTokensForRebalancing
};