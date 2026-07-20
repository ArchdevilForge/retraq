/**
 * Pure JS self-check for training sim USDT sizing (no test framework).
 * Run: node frontend/src/utils/training/sim.selfcheck.mjs
 */
import assert from 'node:assert/strict';

const MAX_LEVERAGE = 20;

function feeOf(price, qty, feeRate) {
  return Math.abs(price * qty * feeRate);
}
function requiredMargin(price, qty, leverage) {
  const lev = Math.min(MAX_LEVERAGE, Math.max(1, leverage));
  return Math.abs(price * qty) / lev;
}
function usdtToBase(usdt, price) {
  if (!(price > 0) || !(usdt > 0)) return 0;
  return usdt / price;
}
function emptyLedger(startEquity, feeRate) {
  return {
    account: { startEquity, feeRate, equity: startEquity },
    position: null,
    stats: { trades: 0, wins: 0, realizedPnl: 0, fees: 0 },
    markers: [],
  };
}
function marketOpen(ledger, bar, direction, usdtNotional, leverage) {
  if (ledger.position) return { ok: false, message: '已有仓位' };
  if (!(usdtNotional > 0)) return { ok: false, message: '金额须大于 0' };
  const lev = Math.min(MAX_LEVERAGE, Math.max(1, leverage));
  const price = bar.close;
  const qty = usdtToBase(usdtNotional, price);
  if (!(qty > 0)) return { ok: false, message: '金额无效' };
  const margin = requiredMargin(price, qty, lev);
  const fee = feeOf(price, qty, ledger.account.feeRate);
  if (margin + fee > ledger.account.equity + 1e-9) return { ok: false, message: '保证金不足' };
  return {
    ok: true,
    value: {
      ...ledger,
      account: { ...ledger.account, equity: ledger.account.equity - fee },
      position: { direction, qty, entryPrice: price, leverage: lev },
    },
  };
}
function marketClose(ledger, bar, usdtNotional) {
  const pos = ledger.position;
  if (!pos) return { ok: false, message: '当前无仓位' };
  const price = bar.close;
  let qty = usdtNotional == null ? pos.qty : usdtToBase(usdtNotional, price);
  if (usdtNotional != null && qty >= pos.qty - 1e-12) qty = pos.qty;
  const pnl = (pos.direction === 'long' ? price - pos.entryPrice : pos.entryPrice - price) * qty;
  const fee = feeOf(price, qty, ledger.account.feeRate);
  const remaining = pos.qty - qty;
  return {
    ok: true,
    value: {
      account: { ...ledger.account, equity: ledger.account.equity + pnl - fee },
      position: remaining <= 1e-12 ? null : { ...pos, qty: remaining },
    },
  };
}

// --- cases ---
assert.equal(usdtToBase(20, 100), 0.2);
assert.equal(usdtToBase(0, 100), 0);

const bar = { close: 100 };
let ledger = emptyLedger(100, 0.0005);
const opened = marketOpen(ledger, bar, 'long', 20, 5);
assert.equal(opened.ok, true);
assert.ok(Math.abs(opened.value.position.qty - 0.2) < 1e-12);
// margin = 20/5 = 4, fee = 100*0.2*0.0005 = 0.01
assert.ok(opened.value.account.equity < 100);

const underfunded = marketOpen(emptyLedger(1, 0.0005), bar, 'long', 50, 1);
assert.equal(underfunded.ok, false);

const closed = marketClose(opened.value, { close: 110 }, undefined);
assert.equal(closed.ok, true);
assert.equal(closed.value.position, null);
// pnl = 10 * 0.2 = 2
assert.ok(closed.value.account.equity > opened.value.account.equity);

const partial = marketClose(opened.value, { close: 100 }, 10);
assert.equal(partial.ok, true);
assert.ok(partial.value.position);
assert.ok(Math.abs(partial.value.position.qty - 0.1) < 1e-12);

console.log('sim.selfcheck: ok');
