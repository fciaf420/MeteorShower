// ───────────────────────────────────────────────
// ~/lib/jupiter.js
// ───────────────────────────────────────────────
import fetch from 'node-fetch';
import { URL } from 'url';
import { VersionedTransaction } from '@solana/web3.js';
import { lamportsToUi } from './math.js';
import { getPrice } from './price.js';
import { getMintDecimals } from './solana.js'; 
import { PublicKey } from '@solana/web3.js';

async function getSwapQuote(
  inputMint,
  outputMint,
  amountRaw,
  slippageBps = 10,
  maxAttempts = 20,
  price_impact = 0.5
) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const url = new URL("https://lite-api.jup.ag/swap/v1/quote");
      url.searchParams.set("inputMint", inputMint);
      url.searchParams.set("outputMint", outputMint);
      url.searchParams.set("amount", amountRaw.toString());
      url.searchParams.set("slippageBps", slippageBps.toString());

      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error(`Quote failed: ${res.status} ${res.statusText}`);
      }

      const quote = await res.json();
      console.log("Quote:", quote.inAmount, "→", quote.outAmount);

      const impact = Number(quote.priceImpactPct) * 100; // Convert fraction to %

      // Check if under our desired price impact
      if (impact < price_impact) {
        return quote;
      } else {
        console.log(
          `Price impact (${impact.toFixed(5)}%) above ${price_impact}% – retrying (attempt ${attempt}/${maxAttempts}).`
        );
      }
    } catch (err) {
      // Print the error, continue if attempts remain
      console.error(`Error in getSwapQuote (attempt ${attempt}):`, err.message);
      if (attempt >= maxAttempts) {
        console.log("Reached max attempts – returning null.");
        return null;
      }
    }

    // Small delay before the next attempt
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // If we exhausted attempts, return null
  console.log(`Max attempts reached. Price impact still above ${price_impact}%. Returning null.`);
  return null;
}

async function executeSwap(quoteResponse, userKeypair, connection, dlmmPool, maxAttempts = 20) {
  let attempt = 0;
  let currentQuote = quoteResponse;

  // Mints for readability
  const inMint = quoteResponse.inputMint;
  const outMint = quoteResponse.outputMint;
  // Keep the raw input amount so we can re‑quote if needed
  const inAmountRaw = quoteResponse.inAmount;

  // Main retry loop -------------------------------------------------------
  while (attempt < maxAttempts) {
    attempt += 1;
    console.log(`\n[executeSwap] attempt ${attempt}/${maxAttempts}`);

    //--------------------------------------------------------------------
    // (1) Build a fresh Jupiter swap transaction each attempt
    //--------------------------------------------------------------------
    let swapJson;
    try {
      const buildRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: currentQuote,
          userPublicKey: userKeypair.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          dynamicSlippage: { maxBps: 10 }, // ≤ 1 % slippage
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: 50000, // 50 000 µLamports
              priorityLevel: "veryHigh",
            },
          },
        }),
      });

      if (!buildRes.ok) {
        throw new Error(
          `Swap build failed: ${buildRes.status} ${buildRes.statusText}`
        );
      }

      swapJson = await buildRes.json();
      console.log("[swap-builder response]\n", JSON.stringify(swapJson, null, 2));
    } catch (e) {
      console.error("[executeSwap] error building swap transaction:", e.message);

      if (attempt >= maxAttempts) {
        console.error("Reached maxAttempts while building transaction — returning null.");
        return null;
      }

      console.log("[executeSwap] fetching a fresh quote before next attempt...");
      await new Promise((r) => setTimeout(r, 500));
      currentQuote = await getSwapQuote(inMint, outMint, inAmountRaw);
      if (!currentQuote) {
        console.error("Could not obtain a fresh quote — aborting.");
        return null;
      }
      continue;
    }

    //--------------------------------------------------------------------
    // (2) Send the transaction just built
    //--------------------------------------------------------------------
    try {
      const { swapTransaction } = swapJson;
      const swapTx = VersionedTransaction.deserialize(
        Buffer.from(swapTransaction, "base64")
      );

      // Use a fresh blockhash before sending
      const fresh = await connection.getLatestBlockhash("confirmed");
      swapTx.message.recentBlockhash = fresh.blockhash;
      swapTx.sign([userKeypair]);

      const sig = await connection.sendRawTransaction(swapTx.serialize(), {
        skipPreflight: false,
      });
      console.log(`Sent raw transaction. Signature: ${sig}`);

      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: fresh.blockhash,
          lastValidBlockHeight: fresh.lastValidBlockHeight,
        },
        "confirmed"
      );
      const txInfo = await connection.getParsedTransaction(
        sig,
        { maxSupportedTransactionVersion: 0 },
      );

      if (!txInfo) {
        throw new Error("could not fetch confirmed transaction");
      }
      if (txInfo.meta?.err) {
        console.error(
          `[executeSwap] on-chain swap **failed**: ${JSON.stringify(txInfo.meta.err)}`,
        );
        throw new Error("swap transaction reverted on-chain");
      }

      console.log(`Swap confirmed & succeeded: ${sig}`);
      //------------------------------------------------------------------
      // (3) Realised-slippage metric
      //------------------------------------------------------------------
      try {
        const txInfo = await connection.getTransaction(sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!txInfo || !txInfo.meta) throw new Error("missing meta");

        const ownerPk = userKeypair.publicKey.toString();
        const SOL_MINT = "So11111111111111111111111111111111111111112";
        const quotedLamports = BigInt(currentQuote.outAmount);

        let netGained, diff;

        if (outMint === SOL_MINT) {
          // ─────────────────────────── Native SOL ──────────────────────────
          const keys = txInfo.transaction.message.staticAccountKeys ??
                      txInfo.transaction.message.accountKeys ?? [];
          const idx  = keys.findIndex(k =>
                      (typeof k === "string" ? k : k.toString()) === ownerPk);
          if (idx < 0) throw new Error("owner key not found");

          const pre  = BigInt(txInfo.meta.preBalances[idx]  ?? 0);
          const post = BigInt(txInfo.meta.postBalances[idx] ?? 0);
          netGained  = post - pre;
        } else {
          // ─────────────────────────── Any SPL token ───────────────────────
          const sumBalances = (arr=[]) =>
            arr
              .filter(b => b.mint === outMint && b.owner === ownerPk)
              .reduce((tot, b) => tot + BigInt(b.uiTokenAmount.amount), 0n);

          const pre  = sumBalances(txInfo.meta.preTokenBalances);
          const post = sumBalances(txInfo.meta.postTokenBalances);
          netGained  = post - pre;
        }

        diff = quotedLamports - netGained;

        if (quotedLamports === 0n)
          throw new Error("quotedLamports is zero – cannot compute slippage");

        const slBps = Number(diff * 10000n) / Number(quotedLamports);
        const slPct = slBps / 100;

      } catch (e) {
        console.error("[metrics] realised-slippage calc failed:", e.message);
      }
      //------------------------------------------------------------------
      // (4) Swap spread cost (price impact) in USD
      //------------------------------------------------------------------
      try {
        // Fetch decimals straight from chain – no reliance on dlmmPool internals
        const inDecs  = (await getMintDecimals(connection, new PublicKey(inMint)))  ?? 0;
        const outDecs = (await getMintDecimals(connection, new PublicKey(outMint))) ?? 0;

        const inUi = lamportsToUi(currentQuote.inAmount, inDecs);
        const outUi = lamportsToUi(currentQuote.outAmount, outDecs);

        const inUsd = inUi * (await getPrice(inMint));
        const outUsd = outUi * (await getPrice(outMint));
        const diff = inUsd - outUsd
        const slipUsd = Number(diff) / 10**outDecs * await getPrice(outMint);

        const swapUsdValue = Number(currentQuote.swapUsdValue ?? 0);   // ← NEW
        const spreadUsd    = swapUsdValue * Number(currentQuote.priceImpactPct ?? 0);

        if (!Number.isFinite(spreadUsd)) {
          console.warn(
            "[metrics] swap-spread unavailable " +
            `(swapUsdValue=${currentQuote.swapUsdValue}, ` +
            `priceImpactPct=${currentQuote.priceImpactPct}) – sample skipped`
          );
        } else {
        // turn possibly-undefined fields into numbers (defaults to 0)
        const swapUsd   = Number(currentQuote.swapUsdValue)  || 0;
        const impactPct = Number(currentQuote.priceImpactPct) || 0;

        const spreadUsd = swapUsd * impactPct;

      }} catch (mErr) {
        console.error("[metrics] error computing swap spread:", mErr.message);
      }

      console.log(`Success: swap landed: ${sig}`);
      return sig;
    } catch (err) {

      console.error("[executeSwap] send/confirm error:", err.message);

      if (attempt < maxAttempts) {
        console.log(
          "[executeSwap] fetching a fresh quote before next retry..."
        );
        await new Promise((r) => setTimeout(r, 500));
        currentQuote = await getSwapQuote(inMint, outMint, inAmountRaw);
        if (!currentQuote) {
          console.error(
            "[executeSwap] could not obtain a fresh quote — aborting."
          );
          return null;
        }
        continue;
      }

      console.error("[executeSwap] all attempts exhausted. Returning null.");
      return null;
    }
  }

  // If the loop exits without a return, nothing landed
  return null;
}

export { getSwapQuote, executeSwap };