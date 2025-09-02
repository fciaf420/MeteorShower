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