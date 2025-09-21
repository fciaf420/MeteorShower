// ~/lib/sender.js
// Helius Sender integration: dual routing with required tip + priority fee
// Opt-in via USE_SENDER=true. Falls back to sendAndConfirmTransaction otherwise.

import fetch from 'node-fetch';
import {
  SystemProgram,
  ComputeBudgetProgram,
  PublicKey,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getDynamicPriorityFee, getFallbackPriorityFee, PRIORITY_LEVELS } from './priority-fee.js';
import 'dotenv/config';

const DEFAULT_SENDER_ENDPOINT = 'https://sender.helius-rpc.com/fast';

// Designated Jito tip accounts (mainnet)
const TIP_ACCOUNTS = [
  '4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE',
  'D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ',
  '9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta',
  '5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn',
  '2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD',
  '2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ',
  'wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF',
  '3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT',
  '4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey',
  '4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or',
];

const SKIP_SENDER_CONFIRMATION = String(process.env.SENDER_SKIP_CONFIRMATION || 'false').toLowerCase() === 'true';
const DEFAULT_CONFIRM_TIMEOUT_MS = Number(process.env.SENDER_CONFIRM_TIMEOUT_MS ?? 45000);
const DEFAULT_CONFIRM_POLL_MS = Number(process.env.SENDER_CONFIRM_POLL_MS ?? 500);
const DEFAULT_CONFIRM_COMMITMENT = (process.env.SENDER_CONFIRM_COMMITMENT || 'confirmed').toLowerCase();
const DEFAULT_SEARCH_HISTORY_MS = Number(process.env.SENDER_CONFIRM_SEARCH_HISTORY_MS ?? 15000);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForSenderConfirmation(connection, signature, options = {}) {
  const {
    timeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_CONFIRM_POLL_MS,
    commitment = DEFAULT_CONFIRM_COMMITMENT,
    searchHistoryAfterMs = DEFAULT_SEARCH_HISTORY_MS,
  } = options;

  if (!connection || typeof connection.getSignatureStatuses !== 'function') {
    throw new Error('Connection instance required to confirm Sender transactions');
  }

  const normalizedCommitment = typeof commitment === 'string' ? commitment.toLowerCase() : 'confirmed';
  const start = Date.now();
  let searchTransactionHistory = false;
  let lastRpcError = null;

  while (Date.now() - start <= timeoutMs) {
    let response;
    try {
      response = await connection.getSignatureStatuses([signature], { searchTransactionHistory });
    } catch (err) {
      lastRpcError = err;
      await sleep(pollIntervalMs);
      continue;
    }

    const status = response?.value?.[0];
    if (!status) {
      if (!searchTransactionHistory && Date.now() - start >= searchHistoryAfterMs) {
        searchTransactionHistory = true;
      }
      await sleep(pollIntervalMs);
      continue;
    }

    if (status.err) {
      throw new Error('Sender transaction ' + signature + ' failed: ' + JSON.stringify(status.err));
    }

    const confirmationStatus = typeof status.confirmationStatus === 'string'
      ? status.confirmationStatus.toLowerCase()
      : null;

    const satisfied =
      confirmationStatus === 'finalized' ||
      (normalizedCommitment === 'processed' && (confirmationStatus === 'processed' || confirmationStatus === 'confirmed' || confirmationStatus === 'finalized')) ||
      (normalizedCommitment === 'confirmed' && (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized')) ||
      (normalizedCommitment === 'finalized' && confirmationStatus === 'finalized') ||
      (confirmationStatus == null && typeof status.confirmations === 'number' && status.confirmations > 0 && normalizedCommitment !== 'finalized');

    if (satisfied) {
      return status;
    }

    await sleep(pollIntervalMs);
  }

  const errorDetail = lastRpcError ? ' RPC error: ' + (lastRpcError.message || lastRpcError) : '';
  throw new Error('Sender transaction ' + signature + ' not confirmed within ' + timeoutMs + 'ms.' + errorDetail);
}

function pickTipAccount() {
  const idx = Math.floor(Math.random() * TIP_ACCOUNTS.length);
  return TIP_ACCOUNTS[idx];
}

function getSenderConfig() {
  const useSender = String(process.env.USE_SENDER || 'false').toLowerCase() === 'true';
  let endpoint = process.env.SENDER_ENDPOINT || DEFAULT_SENDER_ENDPOINT;
  const swqosOnly = String(process.env.SENDER_SWQOS_ONLY || 'false').toLowerCase() === 'true';
  if (swqosOnly) {
    endpoint += (endpoint.includes('?') ? '&' : '?') + 'swqos_only=true';
  }
  const tipSolMin = Number(process.env.SENDER_TIP_SOL_MIN || 0.001);
  const computeUnitLimit = Number(process.env.SENDER_COMPUTE_UNIT_LIMIT || 300_000);
  return { useSender, endpoint, tipSolMin, computeUnitLimit };
}

function hasAnyComputeBudgetInstruction(tx) {
  return tx.instructions?.some(ix => ix.programId?.equals?.(ComputeBudgetProgram.programId));
}

export async function sendTransactionWithSenderIfEnabled(connection, transaction, signers, priorityLevel = PRIORITY_LEVELS.MEDIUM) {
  const { useSender, endpoint, tipSolMin, computeUnitLimit } = getSenderConfig();
  if (!useSender) {
    return await sendAndConfirmTransaction(connection, transaction, signers);
  }

  // Ensure blockhash + fee payer
  if (!transaction.recentBlockhash) {
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
  }
  if (!transaction.feePayer && signers?.[0]?.publicKey) {
    transaction.feePayer = signers[0].publicKey;
  }

  // Add compute budget instructions at the beginning (limit + price)
  // Always add limit to ensure presence; add price to override with our dynamic/fallback
  transaction.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({ units: Math.max(1_000, Math.floor(computeUnitLimit)) })
  );

  try {
    const dynamicMicros = await getDynamicPriorityFee(connection, transaction, priorityLevel);
    transaction.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: dynamicMicros })
    );
  } catch {
    const fallbackMicros = getFallbackPriorityFee(priorityLevel);
    transaction.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fallbackMicros })
    );
  }

  // Add required Jito tip transfer (minimum tip)
  const tipLamports = Math.max(0, Math.floor(tipSolMin * 1_000_000_000));
  if (tipLamports > 0) {
    const toPubkey = new PublicKey(pickTipAccount());
    transaction.add(
      SystemProgram.transfer({ fromPubkey: transaction.feePayer, toPubkey, lamports: tipLamports })
    );
  }

  // Sign and serialize
  transaction.sign(...(signers || []));
  const payload = Buffer.from(transaction.serialize()).toString('base64');

  // Send via Sender with skipPreflight true
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now().toString(),
      method: 'sendTransaction',
      params: [payload, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }]
    })
  });

  const json = await res.json();
  if (json?.error) {
    throw new Error(json.error?.message || 'Sender error');
  }
  const signature = json.result;
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new Error('Sender returned invalid signature');
  }
  if (!SKIP_SENDER_CONFIRMATION) {
    await waitForSenderConfirmation(connection, signature);
  }
  return signature; // signature
}
