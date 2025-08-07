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
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} walletPubKey - User's wallet public key
 * @param {PublicKey} tokenXMint - EXACT Token X mint address from LP pair
 * @param {PublicKey} tokenYMint - EXACT Token Y mint address from LP pair
 * @returns {Object} Available wallet tokens ONLY for the specific LP pair mints
 */
async function getWalletTokensForRebalancing(connection, walletPubKey, tokenXMint, tokenYMint) {
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
    
    // Return ONLY tokens that match the LP pair mints
    return {
      walletTokenX,
      walletTokenY,
      decimalsX,
      decimalsY,
      tokenXAmount,
      tokenYAmount,
      // Include mint addresses for verification
      tokenXMint: tokenXMint.toBase58(),
      tokenYMint: tokenYMint.toBase58()
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