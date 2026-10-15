// npm test で実行（Node 標準のテスト機能 + tsx）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brier, calibration, evaluate, getNextRound, getOpenRounds, makeRound, outcomeOf, pnlOf, probAbove,
  probAboveIndicator, roundFromId, summarize, type TradeRecord,
} from "./gmoOption";

/** JST の日時 → UTC ミリ秒 */
const jst = (s: string) => Date.parse(`${s}+09:00`);
const ids = (rs: { id: string }[]) => rs.map((r) => r.id);

test("回号：平日16:30は17時と19時の2回号が買える", () => {
  const open = getOpenRounds(jst("2026-10-15T16:30:00")); // 木曜
  assert.deepEqual(ids(open), ["2026-10-15T17:00", "2026-10-15T19:00"]);
  assert.equal(open[0].minutesToExpiry, 30);
  assert.equal(open[0].minutesToCutoff, 28);
  assert.equal(open[0].label, "10/15 17:00回");
});

test("回号：満期2分前を過ぎると買えない", () => {
  const open = getOpenRounds(jst("2026-10-15T16:58:30"));
  assert.deepEqual(ids(open), ["2026-10-15T19:00"]);
  assert.deepEqual(ids(getOpenRounds(jst("2026-10-15T16:57:59"))), ["2026-10-15T17:00", "2026-10-15T19:00"]);
});

test("回号：深夜の翌1・3・5時、朝8時前は買えない", () => {
  assert.deepEqual(ids(getOpenRounds(jst("2026-10-16T00:30:00"))), ["2026-10-16T01:00", "2026-10-16T03:00"]);
  assert.deepEqual(ids(getOpenRounds(jst("2026-10-16T04:30:00"))), ["2026-10-16T05:00"]);
  assert.deepEqual(getOpenRounds(jst("2026-10-16T06:00:00")), []);
  assert.equal(getNextRound(jst("2026-10-16T06:00:00"))?.id, "2026-10-16T11:00");
  assert.equal(getNextRound(jst("2026-10-16T06:00:00"))?.start, jst("2026-10-16T08:00:00"));
});

test("回号：土曜5時（金曜の取引日）までで、次は月曜11時", () => {
  assert.deepEqual(ids(getOpenRounds(jst("2026-10-17T04:00:00"))), ["2026-10-17T05:00"]); // 土曜4時
  assert.deepEqual(getOpenRounds(jst("2026-10-17T12:00:00")), []); // 土曜昼
  assert.deepEqual(getOpenRounds(jst("2026-10-18T12:00:00")), []); // 日曜
  assert.equal(getNextRound(jst("2026-10-17T12:00:00"))?.id, "2026-10-19T11:00"); // 月曜11時
  assert.deepEqual(getOpenRounds(jst("2026-10-19T07:59:00")), []); // 月曜8時前
  assert.deepEqual(ids(getOpenRounds(jst("2026-10-19T08:00:00"))), ["2026-10-19T11:00"]);
});

test("回号：id から復元できる（JST 固定）", () => {
  const r = roundFromId("2026-10-15T23:00")!;
  assert.equal(r.expiry, jst("2026-10-15T23:00:00"));
  assert.equal(r.start, jst("2026-10-15T20:00:00"));
  assert.equal(r.cutoff, jst("2026-10-15T22:58:00"));
  assert.deepEqual(makeRound(r.expiry), r);
});

// 1分ごとに ±0.01 ずつ交互に動く系列（ボラティリティが一定）
const closes = Array.from({ length: 121 }, (_, i) => 150 + (i % 2 ? 0.01 : -0.01));

test("基準モデル：同値なら50%、上なら50%超、残り時間が長いほど50%に近づく", () => {
  assert.ok(Math.abs(probAbove(closes, 150, 150, 60)! - 0.5) < 1e-9);
  const near = probAbove(closes, 150.1, 150, 10)!;
  const far = probAbove(closes, 150.1, 150, 120)!;
  assert.ok(near > far && far > 0.5, `${near} > ${far} > 0.5`);
  assert.ok(probAbove(closes, 149.9, 150, 30)! < 0.5);
  assert.equal(probAbove(closes.slice(0, 10), 150, 150, 30), null); // データ不足
  assert.equal(probAbove(closes, 150, 150, 0), null); // 満期後
});

test("指標エンジン：上昇の勢いがあると上寄りになるが、極端にはならない", () => {
  const rising = Array.from({ length: 121 }, (_, i) => 150 + i * 0.002 + (i % 2 ? 0.01 : -0.01));
  const spot = rising[rising.length - 1];
  const ind = probAboveIndicator(rising, spot, spot, 60)!;
  assert.ok(ind > probAbove(rising, spot, spot, 60)!);
  // 強い勢いでも、勢いによる移動は満期までの変動の目安の半分まで → 同値なら Φ(0.5) ≈ 69% が上限
  const steep = Array.from({ length: 121 }, (_, i) => 150 + i * 0.05 + (i % 2 ? 0.01 : -0.01));
  const s2 = steep[steep.length - 1];
  for (const t of [5, 60, 180]) {
    const v = probAboveIndicator(steep, s2, s2, t)!;
    assert.ok(v <= 0.6916 && v >= 0.5, `${t}分: ${v}`);
  }
});

test("期待値：購入価格520円・確率60%（High）は候補、Lowは候補外", () => {
  const hi = evaluate({ probAbove: 0.6, direction: "high", price: 520 });
  assert.equal(hi.breakeven, 0.52);
  assert.ok(Math.abs(hi.edge - 0.08) < 1e-9);
  assert.ok(Math.abs(hi.evPerUnit - 80) < 1e-9);
  assert.equal(hi.candidate, true);
  const lo = evaluate({ probAbove: 0.6, direction: "low", price: 520 });
  assert.ok(Math.abs(lo.pWin - 0.4) < 1e-9);
  assert.equal(lo.candidate, false);
  assert.equal(evaluate({ probAbove: 0.535, direction: "high", price: 520 }).candidate, false); // 安全幅2%に届かない
  assert.equal(evaluate({ probAbove: 0.535, direction: "high", price: 520, margin: 0 }).candidate, true);
});

const rec = (over: Partial<TradeRecord>): TradeRecord => ({
  id: Math.random().toString(36),
  createdAt: 0,
  roundId: "2026-10-15T17:00",
  expiry: jst("2026-10-15T17:00:00"),
  strike: 150,
  direction: "high",
  price: 500,
  units: 1,
  spot: 150,
  minutesLeft: 60,
  engine: "baseline",
  probs: { baseline: 0.5 },
  margin: 0.02,
  executed: false,
  note: "",
  ...over,
});

test("照合：手入力の判定レートを優先、同値は引き分けで損益0", () => {
  assert.equal(outcomeOf(rec({})), "pending");
  assert.equal(outcomeOf(rec({ expiryRateAuto: 150.01 })), "win");
  assert.equal(outcomeOf(rec({ expiryRateAuto: 150.01, expiryRateManual: 149.99 })), "lose");
  assert.equal(outcomeOf(rec({ expiryRateAuto: 150 })), "draw");
  assert.equal(pnlOf(rec({ expiryRateAuto: 150.01, price: 520, units: 2 })), 960);
  assert.equal(pnlOf(rec({ direction: "low", expiryRateAuto: 150.01, price: 520, units: 2 })), -1040);
});

test("集計：引き分けと未判定を除き、勝率・誤差幅・損益を出す", () => {
  const list = [
    ...Array.from({ length: 6 }, () => rec({ expiryRateAuto: 151 })), // 勝ち6
    ...Array.from({ length: 4 }, () => rec({ expiryRateAuto: 149 })), // 負け4
    rec({ expiryRateAuto: 150 }), // 引き分け
    rec({}), // 未判定
  ];
  const s = summarize(list);
  assert.equal(s.settled, 10);
  assert.equal(s.draws, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.winRate, 0.6);
  assert.equal(s.avgBreakeven, 0.5);
  assert.equal(s.totalPnl, 6 * 500 - 4 * 500);
  assert.equal(s.pnlPerUnit, 100);
  assert.ok(s.winRateMargin! > 0.2); // 10件では誤差が大きい
  assert.equal(s.enoughData, false);
});

test("較正：確率帯ごとの予測平均と実際の割合、ブライアスコア", () => {
  const list = [
    rec({ probs: { baseline: 0.72 }, expiryRateAuto: 151 }),
    rec({ probs: { baseline: 0.78 }, expiryRateAuto: 149 }),
    rec({ probs: { baseline: 0.15 }, expiryRateAuto: 149 }),
    rec({ probs: { claude: 0.9 }, expiryRateAuto: 151 }), // baseline なし → 除外
  ];
  const bins = calibration(list, "baseline");
  assert.equal(bins[7].n, 2);
  assert.ok(Math.abs(bins[7].avgPred! - 0.75) < 1e-9);
  assert.equal(bins[7].hitRate, 0.5);
  assert.equal(bins[1].n, 1);
  assert.equal(bins[1].hitRate, 0);
  const b = brier(list, "baseline")!;
  assert.equal(b.n, 3);
  assert.ok(Math.abs(b.score - ((0.72 - 1) ** 2 + 0.78 ** 2 + 0.15 ** 2) / 3) < 1e-9);
});
