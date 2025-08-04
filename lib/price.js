// ───────────────────────────────────────────────
// ~/lib/price.js
// ───────────────────────────────────────────────
import fetch from 'node-fetch';
import { URL } from 'url';

async function getPrice(mint) {
  try {
    const url = new URL("https://lite-api.jup.ag/price/v2");
    url.searchParams.set("ids", mint);

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error(`[getPrice] HTTP ${res.status} for mint ${mint}`);
      return null;
    }

    const json = await res.json();          

    const entry  = json?.data?.[mint];
    if (!entry || entry.price == null) {
      console.error(`[getPrice] no price field for mint ${mint}`);
      return null;
    }

    const px = typeof entry.price === "number"
      ? entry.price
      : parseFloat(entry.price);

    return Number.isFinite(px) ? px : null;
  } catch (err) {
    console.error(`[getPrice] exception for mint ${mint}: ${err.message}`);
    return null;
  }
}
export { getPrice };