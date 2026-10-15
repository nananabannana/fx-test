import { test } from "node:test";
import assert from "node:assert/strict";
import { canOpen, DEMO_DEFAULTS, jstDay, openTrade, outcomeAt, settleTrade, sizePosition, todayPnl, type DemoTrade, type PredictionRecord } from "./demo";
import type { Candle } from "../types";

const MIN = 60_000;
const T = Date.UTC(2026, 9, 15, 3, 0); // 12:00 JST

test("数量：許容損失 ÷ 損切り幅 を1,000通貨単位で切り捨て。確率は関係しない", () => {
  const s = sizePosition({ balance: 10_000, riskYen: 100, stopPips: 5, minUnit: 1000, price: 150, marginRate: 0.04 });
  // 100円 ÷ 0.05円 = 2,000通貨。ただし証拠金 2,000×150×4% = 12,000円 > 10,000円 → 1,000通貨
  assert.ok(s.ok);
  assert.equal(s.ok && s.units, 1000);
  assert.equal(s.ok && s.riskAtStop, 50);
  assert.ok(s.ok && s.note?.includes("証拠金"));
  const s2 = sizePosition({ balance: 100_000, riskYen: 100, stopPips: 5, minUnit: 1000, price: 150, marginRate: 0.04 });
  assert.equal(s2.ok && s2.units, 2000);
});

test("数量：最小単位でも許容損失を超えるなら見送り（理由つき）", () => {
  const s = sizePosition({ balance: 10_000, riskYen: 50, stopPips: 8, minUnit: 1000, price: 150, marginRate: 0.04 });
  assert.equal(s.ok, false);
  assert.ok(!s.ok && s.reason.includes("80円"));
});

const closed = (pnl: number, at = T): DemoTrade => ({ ...openTrade({ id: String(Math.random()), predictionId: null, side: "buy", at, price: 150, units: 1000, stopPips: 5, holdMin: 5, riskAtStop: 50 }), status: "closed", exitTime: at + 5 * MIN, pnlYen: pnl });

test("1日の損失上限・同時保有1つ", () => {
  const s = DEMO_DEFAULTS;
  assert.deepEqual(canOpen({ trades: [], now: T, riskAtStop: 50, settings: s }), { ok: true });
  const open = openTrade({ id: "o", predictionId: null, side: "buy", at: T, price: 150, units: 1000, stopPips: 5, holdMin: 5, riskAtStop: 50 });
  assert.equal(canOpen({ trades: [open], now: T, riskAtStop: 50, settings: s }).ok, false);
  // 今日 −160円：残り40円 < 想定損失50円
  const r = canOpen({ trades: [closed(-100), closed(-60)], now: T + 20 * MIN, riskAtStop: 50, settings: s });
  assert.ok(!r.ok && r.reason.includes("残り 40円"));
  // 上限に達した
  assert.equal(canOpen({ trades: [closed(-200)], now: T + 20 * MIN, riskAtStop: 50, settings: s }).ok, false);
  // 前日の損失は数えない
  assert.equal(todayPnl([closed(-200, T - 86_400_000)], T), 0);
  assert.equal(jstDay(Date.UTC(2026, 9, 15, 15, 0)), "2026-10-16"); // JST 0時を跨ぐ
});

const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({ time: T + i * MIN, open: o, high: h, low: l, close: c });

test("手仕舞い：損切り優先・時間で決済・終わりの足待ち", () => {
  const t = openTrade({ id: "a", predictionId: null, side: "buy", at: T, price: 150, units: 1000, stopPips: 5, holdMin: 5, riskAtStop: 50 });
  assert.equal(t.stopPrice, 149.95);
  // 3分後の足で安値が損切りに触れる
  const hit = settleTrade(t, [bar(1, 150, 150.02, 149.99, 150.01), bar(2, 150, 150.01, 149.97, 149.98), bar(3, 149.98, 149.99, 149.94, 149.96)]);
  assert.equal(hit?.exitReason, "stop");
  assert.equal(hit?.pnlYen, -50);
  // 触れずに5分後の終値
  const ok = [1, 2, 3, 4, 5].map((i) => bar(i, 150, 150.04, 149.98, 150.03));
  const done = settleTrade(t, ok);
  assert.equal(done?.exitReason, "time");
  assert.equal(done?.pnlYen, 30);
  // まだ終わりの足がない
  assert.equal(settleTrade(t, ok.slice(0, 3)), null);
  // 売り
  const s = openTrade({ id: "b", predictionId: null, side: "sell", at: T, price: 150, units: 1000, stopPips: 5, holdMin: 5, riskAtStop: 50 });
  assert.equal(settleTrade(s, ok)?.pnlYen, -30);
});

test("予測の結果：横ばいの幅で判定・確定前は pending", () => {
  const r: PredictionRecord = {
    id: "p", at: T, price: 150, modelVersion: "lr1-x", regime: "range", session: "tokyo", atrPips: 3, spreadPips: null,
    horizons: {
      5: { percents: { up: 50, flat: 30, down: 20 }, probs: { up: 0.5, flat: 0.3, down: 0.2 }, direction: "up", bandPips: 2, movePips: 3, provisional: false },
      10: { percents: { up: 20, flat: 60, down: 20 }, probs: { up: 0.2, flat: 0.6, down: 0.2 }, direction: "flat", bandPips: 3, movePips: 4, provisional: false },
    },
    actual: { 5: 150.025 },
  };
  const o5 = outcomeAt(r, 5);
  assert.ok(o5.status === "settled" && o5.hit && o5.deltaPips === 2.5);
  assert.equal(outcomeAt(r, 10).status, "pending");
  const o10 = outcomeAt({ ...r, actual: { 10: 150.02 } }, 10);
  assert.ok(o10.status === "settled" && o10.actual === "flat" && o10.hit);
});

test("検証の集計：的中率・基準・予測に従った損益", async () => {
  const { horizonStats } = await import("./stats");
  const mk = (i: number, dir: "up" | "down" | "flat", actual: number): PredictionRecord => ({
    id: `r${i}`, at: T + i * 10 * MIN, price: 150, modelVersion: "v", regime: "range", session: "tokyo", atrPips: 3, spreadPips: null,
    horizons: {
      5: { percents: { up: 40, flat: 30, down: 30 }, probs: { up: dir === "up" ? 0.5 : 0.25, flat: dir === "flat" ? 0.5 : 0.25, down: dir === "down" ? 0.5 : 0.25 }, direction: dir, bandPips: 2, movePips: 3, provisional: false, base: [0.3, 0.4, 0.3] },
      10: { percents: { up: 40, flat: 30, down: 30 }, probs: { up: 0.4, flat: 0.3, down: 0.3 }, direction: "up", bandPips: 3, movePips: 4, provisional: false },
    },
    actual: { 5: actual },
  });
  const s = horizonStats([mk(0, "up", 150.05), mk(1, "down", 150.05), mk(2, "flat", 150.01), mk(3, "up", 150.02)], 5);
  assert.equal(s.settled, 4);
  assert.equal(s.metrics.accuracy, 3 / 4); // up○ down× flat○ up○
  assert.equal(s.base.n, 4);
  assert.equal(s.base.accuracy, 1 / 4); // 基準は常に「横ばい」
  assert.equal(s.follow.n, 3); // 横ばい予測は取引しない
  assert.equal(s.follow.totalYen, 50 - 50 + 20); // 1,000通貨 × pips × 0.01円
  assert.equal(s.follow.maxDD, 50);
  assert.equal(s.pending, 0);
  assert.equal(horizonStats([mk(0, "up", 150.05)], 10).pending, 1);
});
