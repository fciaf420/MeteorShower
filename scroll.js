// ───────────────────────────────────────────────
// ~/cli.js
// ───────────────────────────────────────────────
import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { main } from './main.js';

function loadEnv() {
  const cfg = {
    RPC_URL      : process.env.RPC_URL,
    WALLET_PATH  : process.env.WALLET_PATH,
    LOG_LEVEL    : process.env.LOG_LEVEL ?? 'info'
  };

  if (!cfg.RPC_URL)    throw new Error('RPC_URL is not set');
  if (!cfg.WALLET_PATH) throw new Error('WALLET_PATH is not set');

  return cfg;
}

function parseArgs() {
  return yargs(hideBin(process.argv))
    .command('run', 'start the liquidity bot', y =>
      y.option('interval', {
        alias      : 'i',
        type       : 'number',
        default    : 5,
        describe   : 'Monitor tick interval in seconds'
      })
    )
    .demandCommand(1)
    .strict()
    .help()
    .parse();
}

async function runCli() {
  try {
    const env   = loadEnv();
    const argv  = parseArgs();
    const { interval } = argv;

    await main({
      ...env,
      MONITOR_INTERVAL_SECONDS : interval
    });
  } catch (err) {
    // Always exit with non-zero so systemd / Kubernetes knows it failed
    console.error('❌', err.message);
    process.exit(1);
  }
}

// Only run automatically if this file is invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}

export { loadEnv, parseArgs, runCli };

// ───────────────────────────────────────────────
// ~/main.js
// ───────────────────────────────────────────────
import BN from 'bn.js';
import { loadWalletKeypair } from './lib/solana.js';
import { openDlmmPosition, recenterPosition } from './lib/dlmm.js';
import 'dotenv/config';
import { getMintDecimals } from './lib/solana.js';
import { getPrice } from './lib/price.js';
import { SOL_MINT } from './lib/constants.js';
import {
  Connection,
} from '@solana/web3.js';
// pull vars from the environment
const {
  RPC_URL,
  WALLET_PATH,
  MONITOR_INTERVAL_SECONDS = 5,
} = process.env;

async function monitorPositionLoop(
  connection,
  dlmmPool,
  userKeypair,
  initialCapitalUsd,
  positionPubKey,
  intervalSeconds,
) {
  console.log(`Starting monitoring - Interval ${intervalSeconds}s`);
  console.log(`Tracking Position: ${positionPubKey.toBase58()}`);

  /* ─── 1. token-decimals  ─────────────────────────────── */
  if (typeof dlmmPool.tokenX.decimal !== 'number')
    dlmmPool.tokenX.decimal = await getMintDecimals(connection, dlmmPool.tokenX.publicKey);
  if (typeof dlmmPool.tokenY.decimal !== 'number')
    dlmmPool.tokenY.decimal = await getMintDecimals(connection, dlmmPool.tokenY.publicKey);
  const dx = dlmmPool.tokenX.decimal;
  const dy = dlmmPool.tokenY.decimal;
  console.log(`Token decimals: X=${dx}, Y=${dy}`);

  /* ─── 3. heading ────────────────────────────────────────────────── */
  console.log(
    "Time         | Total($)  "
  );

  /* ─── 4. loop ───────────────────────────────────────────────────── */
  while (true) {
    try {
      /* 4-A refresh on-chain state --------------------------------- */
      await dlmmPool.refetchStates();
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
      const activeBin   = await dlmmPool.getActiveBin();
      const pos         = userPositions.find(p => p.publicKey.equals(positionPubKey));
      if (!pos || !activeBin) break;

      /* 4-B amounts ------------------------------------------------- */
      let lamX = new BN(0), lamY = new BN(0);
      pos.positionData.positionBinData.forEach(b => {
        lamX = lamX.add(new BN(b.positionXAmount));
        lamY = lamY.add(new BN(b.positionYAmount));
      });
      const feeX = new BN(pos.positionData.feeX);
      const feeY = new BN(pos.positionData.feeY);

      const amtX     = lamX.toNumber() / 10 ** dx;
      const amtY     = lamY.toNumber() / 10 ** dy;
      const feeAmtX  = feeX.toNumber() / 10 ** dx;
      const feeAmtY  = feeY.toNumber() / 10 ** dy;

      const pxX      = await getPrice(dlmmPool.tokenX.publicKey.toString());
      const pxY      = await getPrice(dlmmPool.tokenY.publicKey.toString());

      const liqUsd   = amtX * pxX + amtY * pxY;
      const feesUsd  = feeAmtX * pxX + feeAmtY * pxY;
      const totalUsd = liqUsd + feesUsd;

      /* 4-C re-centre if out of range ------------------------------- */
      const width  = pos.positionData.upperBinId - pos.positionData.lowerBinId + 1;
      const centre = pos.positionData.lowerBinId + (width - 1) / 2;
      const dist   = Math.abs(activeBin.binId - centre);

      if (dist > width * Number(process.env.CENTER_DISTANCE_THRESHOLD || 0.45)) {
        console.log(`🔄 Rebalancing: active=${activeBin.binId}, center=${centre}`);

        const res = await recenterPosition(connection, dlmmPool, userKeypair, positionPubKey);
        if (!res) break;

        dlmmPool        = res.dlmmPool;
        positionPubKey  = res.positionPubKey;
      }

      console.log(
        `${new Date().toLocaleTimeString()} | ` +
        `${totalUsd.toFixed(2).padStart(8)} ` 
      );

    } catch (err) {
      console.error('Error during monitor tick:', err?.message ?? err);
    }

    await new Promise(r => setTimeout(r, intervalSeconds * 1_000));
  }

  console.log('Monitoring ended.');
}

async function main() {
    const userKeypair = loadWalletKeypair(WALLET_PATH);
    const connection  = new Connection(RPC_URL, 'confirmed');
  
    // 1️⃣ Open initial position
    const {
      dlmmPool,
      initialCapitalUsd,
      positionPubKey,
      openFeeLamports
    } = await openDlmmPosition(connection, userKeypair);
  
    if (!dlmmPool || !positionPubKey) {
      console.error("Failed to open position – aborting.");
      process.exit(1);
    }
  
    // 2️⃣ Start monitoring & rebalancing (pass initialTxnLamports)
    await monitorPositionLoop(
      connection,
      dlmmPool,
      userKeypair,
      initialCapitalUsd,
      positionPubKey,
      MONITOR_INTERVAL_SECONDS,
      openFeeLamports
    );
  
    console.log("🏁 Script finished.");
  }
  
  main().catch(err => {
    console.error("💥 Unhandled error in main:", err);
    process.exit(1);
  });
export { main, monitorPositionLoop };

// configure.js – interactive .env generator with Solana wallet support
// -------------------------------------------------------------------
// • Reads example.env (template) line‑by‑line
// • Prompts the user for every KEY, offering the template value as default
// • Ensures a Solana key‑pair exists; if not, writes ./id.json in CWD
// • After creating a wallet, prints the public address
// • Adds the public address as a comment in the .env, e.g.
//     # WALLET_ADDRESS=6yP4…JWkq
//   just above the WALLET_PATH line.
// -------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Keypair } from '@solana/web3.js';

const kvRegex = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/;

/* ---------- helpers -------------------------------------------------- */

/** Parse KEY=value pairs (ignore comments/blank lines). */
function parseTemplate(templatePath) {
  const lines = fs.readFileSync(templatePath, 'utf8').split(/\r?\n/);
  const pairs = [];

  lines.forEach((line, idx) => {
    const match = line.match(kvRegex);
    if (match) {
      pairs.push({ key: match[1], def: match[2] });
    } else if (line.trim() && !line.trim().startsWith('#')) {
      console.warn(`[warn] line ${idx + 1} ignored (not KEY=VALUE): ${line}`);
    }
  });

  return pairs;
}

/** Ensure wallet exists, return { path, pubkey }. */
function ensureWallet(walletPath) {
  let absPath = path.resolve(walletPath);
  let kp;

  try {
    if (fs.existsSync(absPath)) {
      // Read existing wallet to get the public key
      const secret = JSON.parse(fs.readFileSync(absPath, 'utf8'));
      kp = Keypair.fromSecretKey(Uint8Array.from(secret));
      console.log(`[info] using existing wallet at ${absPath}`);
      return { path: absPath, pubkey: kp.publicKey.toBase58() };
    }

    console.log('[info] wallet file not found — generating a new key‑pair …');
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    kp = Keypair.generate();
    fs.writeFileSync(absPath, JSON.stringify(Array.from(kp.secretKey)));
    console.log(`[success] new key‑pair saved to ${absPath}`);
    return { path: absPath, pubkey: kp.publicKey.toBase58() };
  } catch (err) {
    console.error(`[warn] cannot write wallet at ${absPath}: ${err.message}`);

    // Fallback to ./id.json in CWD
    const fallback = path.join(process.cwd(), 'id.json');
    try {
      kp = Keypair.generate();
      fs.writeFileSync(fallback, JSON.stringify(Array.from(kp.secretKey)), {
        flag: 'wx',
      });
      console.log(`[success] new key‑pair saved to ${fallback}`);
      return { path: fallback, pubkey: kp.publicKey.toBase58() };
    } catch (e) {
      console.error(`[error] fallback wallet creation failed: ${e.message}`);
      // Return whatever info we have; pubkey may be undefined
      return { path: fallback, pubkey: kp?.publicKey?.toBase58() ?? '' };
    }
  }
}

/* ---------- main ----------------------------------------------------- */

async function main(templateFile = '.env.example', outputFile = 'test.env') {
  if (!fs.existsSync(templateFile)) {
    console.error(`[fatal] template not found: ${templateFile}`);
    return;
  }

  const templatePairs = parseTemplate(templateFile);
  const rl = readline.createInterface({ input, output });
  const answers = {};

  // Interactive prompt
  for (const { key, def } of templatePairs) {
    try {
      const reply = await rl.question(`${key} [${def}]: `);
      answers[key] = reply.trim() ? reply.trim() : def;
    } catch (err) {
      console.error(`[error] reading ${key}: ${err.message}`);
      answers[key] = def;
    }
  }
  rl.close();

  // Wallet handling ----------------------------------------------------
  const WALLET_VAR = 'WALLET_PATH';
  let walletPath =
    answers[WALLET_VAR] || path.join(process.cwd(), 'id.json');

  // Make relative paths explicit
  if (!path.isAbsolute(walletPath)) {
    walletPath = path.join(process.cwd(), walletPath);
  }

  const { path: finalWalletPath, pubkey } = ensureWallet(walletPath);
  answers[WALLET_VAR] = finalWalletPath;

  if (pubkey) {
    console.log(`[info] wallet public address: ${pubkey}`);
  }

  // Write .env ---------------------------------------------------------
  try {
    const lines = [];
    for (const [key, val] of Object.entries(answers)) {
      if (key === WALLET_VAR && pubkey) {
        lines.push(`# WALLET_ADDRESS=${pubkey}`); // comment with address
      }
      lines.push(`${key}=${val}`);
    }

    fs.writeFileSync(outputFile, lines.join('\n') + '\n');
    console.log(`[success] wrote ${outputFile}`);
  } catch (err) {
    console.error(`[error] writing ${outputFile}: ${err.message}`);
  }
}

main().catch((err) => console.error(`[fatal] unhandled: ${err.message}`));

// ───────────────────────────────────────────────
// ~/lib/dlmm.js
// ───────────────────────────────────────────────
import BN from 'bn.js';
import dlmmPackage from '@meteora-ag/dlmm';
const { StrategyType } = dlmmPackage;
import {
  PublicKey,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction
} from '@solana/web3.js';

import { withRetry } from './retry.js';
import { getPrice } from './price.js';
import { swapTokensUltra } from './jupiter.js';
import {
  getMintDecimals,
  safeGetBalance,
  unwrapWSOL,
} from './solana.js';
import { getFallbackPriorityFee, PRIORITY_LEVELS } from './lib/priority-fee.js';
import { sendTransactionWithSenderIfEnabled } from './lib/sender.js';

import 'dotenv/config';
// pull config from env once
 const {
   POOL_ADDRESS,
   TOTAL_BINS_SPAN: ENV_TOTAL_BINS_SPAN,
   LOWER_COEF               = 0.5,
   MANUAL = 'true',
   DITHER_ALPHA_API = 'http://0.0.0.0:8000/metrics',   // sensible defaults
   LOOKBACK = '30',
   PRICE_IMPACT,
   SLIPPAGE
 } = process.env;

const MANUAL_MODE             = String(MANUAL).toLowerCase() === 'true';
console.log(MANUAL_MODE)
const DEFAULT_TOTAL_BINS_SPAN = Number(ENV_TOTAL_BINS_SPAN ?? 20);
const SLIPPAGE_BPS = Number(SLIPPAGE ?? 10);       // e.g. “25” → 25
const PRICE_IMPACT_PCT = Number(PRICE_IMPACT ?? 0.5);

const DLMM = dlmmPackage.default ?? dlmmPackage;

const STRATEGY_STRING = (process.env.LIQUIDITY_STRATEGY_TYPE || "Spot").trim();

// Validate & translate
if (!(STRATEGY_STRING in StrategyType)) {
  throw new Error(
    `Invalid LIQUIDITY_STRATEGY_TYPE="${STRATEGY_STRING}". ` +
    `Valid options: ${Object.keys(StrategyType).join(", ")}`
  );
}

export const LIQUIDITY_STRATEGY_TYPE = StrategyType[STRATEGY_STRING];

async function resolveTotalBinsSpan(dlmmPool) {
  if (MANUAL_MODE) {
    console.log(`[config] MANUAL=true – using TOTAL_BINS_SPAN=${DEFAULT_TOTAL_BINS_SPAN}`);
    return DEFAULT_TOTAL_BINS_SPAN;
  }
  if (!DITHER_ALPHA_API || !LOOKBACK) {
    console.warn('[config] DITHER_ALPHA_API or LOOKBACK unset – using default span');
    return DEFAULT_TOTAL_BINS_SPAN;
  }
  // Attempt to read the pool's step size in basis‑points.
  // Try the SDK property first; fall back if missing
  const stepBp = dlmmPool?.lbPair?.binStep ?? dlmmPool?.binStep ?? dlmmPool?.stepBp ?? dlmmPool?.stepBP ?? null;
  if (stepBp == null) {
    console.warn('[config] Could not determine pool step_bp – using default span');
    return DEFAULT_TOTAL_BINS_SPAN;
  }

  // Compose API URL
  const mintA = dlmmPool.tokenX.publicKey.toString();
  const mintB = dlmmPool.tokenY.publicKey.toString();
  const url   = `${DITHER_ALPHA_API}?mintA=${mintA}&mintB=${mintB}&lookback=${LOOKBACK}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[config] API fetch failed (${res.status} ${res.statusText}) – using default span`);
      return DEFAULT_TOTAL_BINS_SPAN;
    }
    const data = await res.json();
    const gridSweep = data?.grid_sweep ?? data?.pnl_drivers?.grid_sweep;
    if (!Array.isArray(gridSweep)) {
      console.warn('[config] grid_sweep missing – using default span');
      return DEFAULT_TOTAL_BINS_SPAN;
    }

    const match = gridSweep.find(g => Number(g.step_bp) === Number(stepBp));
    if (!match) {
      console.warn(`[config] No grid_sweep entry for step_bp=${stepBp} – default span`);
      return DEFAULT_TOTAL_BINS_SPAN;
    }
    const binsPerSide = Number(match.bins);
    if (!Number.isFinite(binsPerSide) || binsPerSide <= 0) {
      console.warn('[config] Invalid bins value – default span');
      return DEFAULT_TOTAL_BINS_SPAN;
    }
    const span = binsPerSide * 2;                 // convert per‑side → total
    console.log(`[config] Resolved TOTAL_BINS_SPAN=${span} via API (step_bp=${stepBp})`);
    return span;
  } catch (err) {
    console.warn('[config] Error fetching grid_sweep –', err?.message ?? err);
    return DEFAULT_TOTAL_BINS_SPAN;
  }
}

async function fetchBalances(connection, dlmmPool, ownerPk) {
  return {
    lamX: await safeGetBalance(
      connection,
      dlmmPool.tokenX.publicKey,
      ownerPk
    ),
    lamY: await safeGetBalance(
      connection,
      dlmmPool.tokenY.publicKey,
      ownerPk
    ),
  };
}

async function openDlmmPosition(connection, userKeypair) {
  return await withRetry(async () => {
    //------------------------------------------------------------------
    // 0) Pool metadata
    //------------------------------------------------------------------
    const poolPK   = new PublicKey(POOL_ADDRESS);
    const dlmmPool = await DLMM.create(connection, poolPK);
    // 🔍 0‑a) Abort if a position already exists
    try {
      const { userPositions } =
        await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);

      if (userPositions.length) {
        // ── grab the first position (or pick by some other rule) ─────────
        const existingPos = userPositions[0];

        // (i) make sure decimals are cached
        for (const t of [dlmmPool.tokenX, dlmmPool.tokenY]) {
          if (typeof t.decimal !== 'number')
            t.decimal = await getMintDecimals(connection, t.publicKey);
        }
        const dx = dlmmPool.tokenX.decimal;
        const dy = dlmmPool.tokenY.decimal;

        // (ii) pull the balances locked in that position
        let lamX = new BN(0), lamY = new BN(0);
        existingPos.positionData.positionBinData.forEach(b => {
          lamX = lamX.add(new BN(b.positionXAmount));
          lamY = lamY.add(new BN(b.positionYAmount));
        });

        // (iii) USD valuation
        const priceX = await getPrice(dlmmPool.tokenX.publicKey.toString());
        const priceY = await getPrice(dlmmPool.tokenY.publicKey.toString());
        const uiX    = lamX.toNumber() / 10 ** dx;
        const uiY    = lamY.toNumber() / 10 ** dy;
        const depositUsd = uiX * priceX + uiY * priceY;

        console.log('[open] Existing position detected – skipping open.');

        return {
          dlmmPool,
          initialCapitalUsd: depositUsd,
          positionPubKey:    existingPos.publicKey,
          openFeeLamports:   0                 
        };
      }
    } catch (err) {
      console.error('[open] Could not check for existing positions:', err);
    }
    // Decide span (may hit API)
    const TOTAL_BINS_SPAN = await resolveTotalBinsSpan(dlmmPool);

    // Cache decimals
    for (const t of [dlmmPool.tokenX, dlmmPool.tokenY]) {
      if (typeof t.decimal !== 'number')
        t.decimal = await getMintDecimals(connection, t.publicKey);
    }
    const dx = dlmmPool.tokenX.decimal;
    const dy = dlmmPool.tokenY.decimal;

    const X_MINT  = dlmmPool.tokenX.publicKey.toString();
    const Y_MINT  = dlmmPool.tokenY.publicKey.toString();
    const X_IS_SOL = X_MINT === SOL_MINT.toString();
    const Y_IS_SOL = Y_MINT === SOL_MINT.toString();

    //------------------------------------------------------------------
    // 1) Reserve SOL buffer
    //------------------------------------------------------------------
    const SOL_BUFFER = new BN(70_000_000);         // 0.07 SOL hard‑coded

    const balances   = await fetchBalances(connection, dlmmPool, userKeypair.publicKey);

    let lamX = balances.lamX;      // BN
    let lamY = balances.lamY;      // BN

    //------------------------------------------------------------------
    // 2) Optional Jupiter swap to balance USD value
    //------------------------------------------------------------------
    const priceX = await getPrice(X_MINT);
    const priceY = await getPrice(Y_MINT);
    if (priceX == null || priceY == null)
      throw new Error('Price feed unavailable for one of the pool tokens');

    const usdX = lamX.toNumber() / 10 ** dx * priceX;
    const usdY = lamY.toNumber() / 10 ** dy * priceY;
    const diffUsd = usdY - usdX;                     // +ve → Y richer

    if (Math.abs(diffUsd) > 0.01) {
      const inputMint  = diffUsd > 0 ? Y_MINT : X_MINT;
      const outputMint = diffUsd > 0 ? X_MINT : Y_MINT;
      const inputDecs  = diffUsd > 0 ? dy      : dx;
      const pxInputUsd = diffUsd > 0 ? priceY  : priceX;
      // move half the USD gap from richer → poorer
      const usdToSwap   = Math.abs(diffUsd) / 2;
      const rawInputAmt = BigInt(
        Math.floor((usdToSwap / pxInputUsd) * 10 ** inputDecs)
      );
      console.log(`Swapping ${diffUsd > 0 ? 'Y→X' : 'X→Y'} worth $${usdToSwap.toFixed(2)} …`);

      const sig = await swapTokensUltra(
        inputMint,
        outputMint,
        rawInputAmt,        // amountRaw
        userKeypair,
        connection,
        dlmmPool,
        SLIPPAGE_BPS,       // slippageBps
        20,                 // maxAttempts
        PRICE_IMPACT_PCT    // price_impact threshold (%)
      );
      if (!sig)  throw new Error('Ultra API swap failed');
    }
    // ───────────────────────── 3) Refresh balances ─────────────────────────
    ({ lamX, lamY } = await fetchBalances(connection, dlmmPool, userKeypair.publicKey));

    if (X_IS_SOL) {
      if (lamX.lt(SOL_BUFFER)) throw new Error('Not enough SOL (tokenX) to keep fee‑buffer');
      lamX = lamX.sub(SOL_BUFFER);
    } else if (Y_IS_SOL) {
      if (lamY.lt(SOL_BUFFER)) throw new Error('Not enough SOL (tokenY) to keep fee‑buffer');
      lamY = lamY.sub(SOL_BUFFER);
    } else {
      const native = new BN(await connection.getBalance(userKeypair.publicKey, 'confirmed'));
      if (native.lt(SOL_BUFFER)) throw new Error('Not enough native SOL for rent + fees');
    }
    // Sanity‑check: wallet still owns the buffer
    const walletSol = await connection.getBalance(userKeypair.publicKey, 'confirmed');
    if (walletSol < SOL_BUFFER.toNumber())
      throw new Error('SOL buffer was consumed during swap — aborting');

    //------------------------------------------------------------------
    // 4) Final deposit figures & USD value
    //------------------------------------------------------------------
    const uiX = lamX.toNumber() / 10 ** dx;
    const uiY = lamY.toNumber() / 10 ** dy;
    const depositUsd = uiX * priceX + uiY * priceY;
    console.log(`Final deposit: ${uiX.toFixed(4)} X  +  ${uiY.toFixed(4)} Y  =  $${depositUsd.toFixed(2)}`);

    //------------------------------------------------------------------
    // 5) Bin‑range centred on the active bin
    //------------------------------------------------------------------
    const activeBin = await dlmmPool.getActiveBin();
    const minBin    = activeBin.binId - Math.floor(TOTAL_BINS_SPAN * LOWER_COEF);
    const maxBin    = activeBin.binId + Math.floor(TOTAL_BINS_SPAN * (1 - LOWER_COEF));

    //------------------------------------------------------------------
    // 6) Build & send InitializePositionAndAddLiquidity transaction
    //------------------------------------------------------------------
    const posKP = Keypair.generate();
    const ixs = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: posKP.publicKey,
      user:           userKeypair.publicKey,
      totalXAmount:   lamX,
      totalYAmount:   lamY,
      strategy:       {
        minBinId: minBin,
        maxBinId: maxBin,
        strategyType: LIQUIDITY_STRATEGY_TYPE,
      },
    });

    const tx = new Transaction().add(...ixs.instructions);
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: getFallbackPriorityFee(PRIORITY_LEVELS.MEDIUM) })
    );
    tx.feePayer = userKeypair.publicKey;

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash      = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;

    const sig = await sendTransactionWithSenderIfEnabled(connection, tx, [userKeypair, posKP], PRIORITY_LEVELS.MEDIUM);
    console.log(`Position opened: ${sig}`);

    return {
      dlmmPool,
      initialCapitalUsd: depositUsd,
      positionPubKey:    posKP.publicKey,
      openFeeLamports:   (await connection.getParsedTransaction(
                           sig, { maxSupportedTransactionVersion: 0 }
                         ))?.meta?.fee ?? 0,
    };
  }, 'openDlmmPosition');
}
// -----------------------------------------------------------------------------
// closeDlmmPosition: remove 100% & claim fees
// -----------------------------------------------------------------------------
async function closeDlmmPosition(connection, dlmmPool, userKeypair, positionPubKey) {
    return await withRetry(async () => {
      await dlmmPool.refetchStates();
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
      const pos = userPositions.find(p => p.publicKey.equals(positionPubKey));
      if (!pos) {
        console.log("Position already closed.");
        return true;
      }
  
      const closeIx = await dlmmPool.removeLiquidity({
        position:            positionPubKey,
        user:                userKeypair.publicKey,
        fromBinId:           pos.positionData.lowerBinId,
        toBinId:             pos.positionData.upperBinId,
        bps:                 new BN(10_000),
        shouldClaimAndClose: true,
      });
  
      const tx = new Transaction().add(...closeIx.instructions);
      tx.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: getFallbackPriorityFee(PRIORITY_LEVELS.MEDIUM) })
      );
      tx.feePayer = userKeypair.publicKey;
      // refresh blockhash
      const recent = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash      = recent.blockhash;
      tx.lastValidBlockHeight = recent.lastValidBlockHeight;
  
      const sig = await sendTransactionWithSenderIfEnabled(connection, tx, [userKeypair], PRIORITY_LEVELS.MEDIUM);
      console.log(`✅ [close] Position closed: ${sig}`);
      return true;
    }, 'closeDlmmPosition');
  }

async function recenterPosition(connection, dlmmPool, userKeypair, oldPositionPubKey) {
  console.log('Starting recenterPosition');

  // 0) ensure decimals are cached ────────────────────────────────────────────
  if (typeof dlmmPool.tokenX.decimal !== 'number')
    dlmmPool.tokenX.decimal = await getMintDecimals(connection, dlmmPool.tokenX.publicKey);
  if (typeof dlmmPool.tokenY.decimal !== 'number')
    dlmmPool.tokenY.decimal = await getMintDecimals(connection, dlmmPool.tokenY.publicKey);

  const dx = dlmmPool.tokenX.decimal;
  const dy = dlmmPool.tokenY.decimal;

  // 1) locate the old position ───────────────────────────────────────────────
  await dlmmPool.refetchStates();
  const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(userKeypair.publicKey);
  const oldPos = userPositions.find(p => p.publicKey.equals(oldPositionPubKey));
  if (!oldPos) {
    console.log('Old position not found – skip recenter.');
    return null;
  }

  // 2) value the position and realise IL (for metrics only) ──────────────────
  let lamX = new BN(0), lamY = new BN(0);
  oldPos.positionData.positionBinData.forEach(b => {
    lamX = lamX.add(new BN(b.positionXAmount));
    lamY = lamY.add(new BN(b.positionYAmount));
  });
  lamX = lamX.add(new BN(oldPos.positionData.feeX));
  lamY = lamY.add(new BN(oldPos.positionData.feeY));

  // 3) close the position ────────────────────────────────────────────────────
  await withRetry(async () => {
    const closeIx = await dlmmPool.removeLiquidity({
      position:            oldPositionPubKey,
      user:                userKeypair.publicKey,
      fromBinId:           oldPos.positionData.lowerBinId,
      toBinId:             oldPos.positionData.upperBinId,
      bps:                 new BN(10_000),
      shouldClaimAndClose: true,
    });
    const tx = new Transaction().add(...closeIx.instructions);
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: getFallbackPriorityFee(PRIORITY_LEVELS.MEDIUM) })
    );
    tx.feePayer = userKeypair.publicKey;

    const recent = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash      = recent.blockhash;
    tx.lastValidBlockHeight = recent.lastValidBlockHeight;

    const sig = await sendTransactionWithSenderIfEnabled(connection, tx, [userKeypair], PRIORITY_LEVELS.MEDIUM);
    await unwrapWSOL(connection, userKeypair);       // keep SOL as native
    console.log(`Closed old position, sig: ${sig}`);
  }, 'closePosition');

  // 4) reopen via the canonical helper (handles swap + SOL buffer) ───────────
  let openRes;
  try {
    openRes = await openDlmmPosition(connection, userKeypair, dlmmPool);
  } catch (err) {
    console.error('[recenter] reopen failed:', err?.message ?? err);
    throw err;   // bubble up so a supervisor can decide what to do
  }

  // 5) pass through the interesting fields ───────────────────────────────────
  return {
    dlmmPool,
    openValueUsd:   openRes.initialCapitalUsd,
    positionPubKey: openRes.positionPubKey,
    rebalanceSignature: openRes.openFeeLamports,
  };
}

export {
  fetchBalances,
  openDlmmPosition,
  closeDlmmPosition,
  recenterPosition
};


// ───────────────────────────────────────────────
// ~/lib/math.js
// ───────────────────────────────────────────────
function lamportsToUi(amountStr, decimals) {
  const len = amountStr.length;
  if (decimals === 0) return parseFloat(amountStr);
  if (len <= decimals) {
    return parseFloat('0.' + '0'.repeat(decimals - len) + amountStr);
  }
  return parseFloat(amountStr.slice(0, len - decimals) + '.' + amountStr.slice(len - decimals));
}
export { lamportsToUi };

