import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "../types";
import { aggregate, atrLast, emaLast, macdLast, rsiLast, smaLast } from "./ta";
import { classifyRegime, computeFeatures, isFailure, type FeatureResult } from "./features";
import { toPercents, trainSoftmax, predictProba } from "./logistic";
import { evaluateProbs, maxDrawdown } from "./evaluate";
import { flatBandPips, labelOf, predictHorizon, trainModel, DEFAULT_SETTINGS, type FxModel } from "./model";
import { mulberry32, gaussian } from "../random";

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 7, 0, 0); // 2026-09-07（月）09:00 JST

/** 乱数の1分足。drift は「直近の動きが続く度合い」（0 なら純粋なランダムウォーク） */
function series(n: number, seed: number, momentum = 0, start = T0): Candle[] {
  const r = mulberry32(seed);
  const out: Candle[] = [];
  let p = 150;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const step = momentum * prev + gaussian(r) * 0.01;
    const o = p;
    p += step;
    prev = step;
    out.push({ time: start + i * MIN, open: o, close: p, high: Math.max(o, p) + Math.abs(gaussian(r)) * 0.003, low: Math.min(o, p) - Math.abs(gaussian(r)) * 0.003 });
  }
  return out;
}

test("指標：SMA・EMA・RSI・MACD・ATR", () => {
  assert.equal(smaLast([1, 2, 3, 4], 2), 3.5);
  assert.equal(smaLast([1], 2), null);
  assert.equal(emaLast([1, 1, 1, 1], 3), 1);
  assert.equal(rsiLast([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14), 100);
  assert.equal(rsiLast(new Array(20).fill(5), 14), 50);
  const up = Array.from({ length: 60 }, (_, i) => 100 + i * 0.1);
  assert.ok(macdLast(up)!.macd > 0);
  assert.equal(macdLast(up.slice(0, 30)), null);
  const bars = Array.from({ length: 16 }, (_, i) => ({ time: i, open: 1, close: 1, high: 1.1, low: 0.9 }));
  assert.ok(Math.abs(atrLast(bars, 14)! - 0.2) < 1e-12);
});

test("足のまとめ：確定した5分足だけ・時計の区切り", () => {
  const c = series(17, 1); // 09:00〜09:16
  const b5 = aggregate(c, 5, c[16].time + MIN); // 09:16 の足が確定した時点
  assert.equal(b5.length, 3); // 09:00, 09:05, 09:10（09:15 はまだ途中）
  assert.equal(b5[1].open, c[5].open);
  assert.equal(b5[1].close, c[9].close);
  assert.equal(b5[1].high, Math.max(...c.slice(5, 10).map((x) => x.high)));
});

test("特徴量は未来の足に影響されない（データリーク防止）", () => {
  const c = series(600, 2);
  const a = computeFeatures(c.slice(0, 450)) as FeatureResult;
  assert.ok(!isFailure(a));
  // 450本目以降を大きく書き換えても、450本目までで計算した値は同じ
  const changed = c.map((x, i) => (i >= 450 ? { ...x, close: x.close + 5, high: x.high + 5, low: x.low + 5 } : x));
  const b = computeFeatures(changed.slice(0, 450)) as FeatureResult;
  assert.deepEqual(a.x, b.x);
  assert.equal(a.x.length, 15);
});

test("特徴量：足りない・欠けているときは計算しない", () => {
  const c = series(500, 3);
  assert.ok(isFailure(computeFeatures(c.slice(0, 100))));
  const gap = c.map((x, i) => (i >= 480 ? { ...x, time: x.time + 30 * MIN } : x));
  const r = computeFeatures(gap);
  assert.ok(isFailure(r) && r.reason.includes("欠け"));
});

test("相場状態の分類", () => {
  const base = { atr5Pips: 3, efficiency60: 0.1 } as Parameters<typeof classifyRegime>[0];
  const th = { atr5Pips: 5, efficiency: 0.3 };
  assert.equal(classifyRegime(base, th), "range");
  assert.equal(classifyRegime({ ...base, efficiency60: -0.4 }, th), "trend");
  assert.equal(classifyRegime({ ...base, atr5Pips: 6, efficiency60: 0.5 }, th), "highvol");
});

test("横ばいの幅とラベル", () => {
  assert.equal(flatBandPips(2, 4, DEFAULT_SETTINGS), 2); // 0.5×2×√4 = 2
  assert.equal(flatBandPips(0.5, 5, DEFAULT_SETTINGS), 1); // 最小幅 1
  assert.equal(labelOf(1.9, 2), "flat");
  assert.equal(labelOf(2, 2), "up");
  assert.equal(labelOf(-3, 2), "down");
});

test("確率の％は合計100", () => {
  assert.deepEqual(toPercents([1 / 3, 1 / 3, 1 / 3]).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(toPercents([0.333, 0.333, 0.334]), [33, 33, 34]);
  assert.equal(toPercents([0.125, 0.4375, 0.4375]).reduce((a, b) => a + b, 0), 100);
});

test("ソフトマックス回帰：分けられるデータを学習できる", () => {
  const Z = Array.from({ length: 300 }, (_, i) => [i % 3 === 0 ? 2 : i % 3 === 1 ? 0 : -2]);
  const y = Z.map((z) => (z[0] > 1 ? 0 : z[0] < -1 ? 2 : 1));
  const W = trainSoftmax(Z, y, 3, { epochs: 300 });
  assert.ok(predictProba(W, [2])[0] > 0.8);
  assert.ok(predictProba(W, [-2])[2] > 0.8);
});

test("評価：混同行列・ブライアスコア・ドローダウン", () => {
  const m = evaluateProbs([
    { p: [0.7, 0.2, 0.1], y: 0 },
    { p: [0.7, 0.2, 0.1], y: 2 },
    { p: [0.1, 0.2, 0.7], y: 2 },
  ]);
  assert.equal(m.n, 3);
  assert.equal(m.accuracy, 2 / 3);
  assert.equal(m.confusion[2][0], 1);
  assert.equal(m.perClass[0].precision, 0.5);
  assert.ok(m.brier! > 0 && m.brier! < 2);
  assert.equal(maxDrawdown([100, 120, 90, 110, 80, 130]), 40);
});

let trained: FxModel | null = null;

test("学習：時間順に分け、学習期間とテスト期間が重ならない", () => {
  const c = series(9000, 4, 0.35); // 勢いが続く性質のある系列
  const m = trainModel(c, { now: T0 + 9000 * MIN, source: "test" });
  assert.ok(!("error" in m), "error" in m ? m.error : "");
  const model = m as FxModel;
  trained = model;
  assert.ok(model.split.trainTo + 10 * MIN < model.split.testFrom);
  for (const h of [5, 10] as const) {
    const hm = model.horizons[h];
    assert.ok(hm.test.n >= 100);
    assert.equal(hm.weights.length, 3);
    // 勢いのある系列では、基準（過去の比率）より良くなるはず
    assert.ok(hm.test.brier! < hm.test.baseline.brier!, `h=${h} brier ${hm.test.brier} vs ${hm.test.baseline.brier}`);
  }
  assert.match(model.version, /^lr1-\d{8}-\d{4}$/);
});

test("学習：純粋なランダムウォークでは「暫定」になりやすい（予測力を主張しない）", () => {
  const c = series(9000, 5, 0);
  const m = trainModel(c, { now: T0, source: "test" }) as FxModel;
  assert.ok(!("error" in m));
  const hm = m.horizons[5];
  // 予測力がないので、的中率は基準からほとんど離れない
  assert.ok(Math.abs(hm.test.accuracy! - hm.test.baseline.accuracy!) < 0.06);
  // 学習期間が短い（約6日）ので必ず暫定
  assert.equal(hm.provisional, true);
});

test("予測：確率の合計100%・方向・根拠", () => {
  assert.ok(trained);
  const c = series(9000, 4, 0.35);
  const f = computeFeatures(c.slice(-420)) as FeatureResult;
  const p = predictHorizon(trained!, 5, f, "range");
  assert.equal(p.percents.up + p.percents.flat + p.percents.down, 100);
  assert.ok(Math.abs(p.probs.up + p.probs.flat + p.probs.down - 1) < 1e-9);
  assert.ok(p.contributions.length > 3);
  assert.ok(p.movePips > 0);
});
