import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atr5m, breakevenFromMultiplier, conditionTable, describeSessions, isEuDst, isUsDst, nearEvent, parseEvents,
  sessionOf, volBandOf, volTerciles, type Result,
} from "./conditions";
import type { Candle } from "./types";

const MIN = 60_000;
/** JST の日時 → UTC ミリ秒 */
const jst = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);

test("夏時間の切り替え（2026年：欧州 3/29〜10/25、米国 3/8〜11/1）", () => {
  assert.equal(isEuDst(jst(2026, 10, 15, 12)), true);
  assert.equal(isEuDst(jst(2026, 10, 25, 9, 59)), true); // 01:00 UTC = JST 10:00 に終了
  assert.equal(isEuDst(jst(2026, 10, 25, 10, 0)), false);
  assert.equal(isEuDst(jst(2026, 3, 29, 9, 59)), false);
  assert.equal(isEuDst(jst(2026, 3, 29, 10, 0)), true);
  assert.equal(isUsDst(jst(2026, 11, 1, 14, 59)), true); // 06:00 UTC = JST 15:00 に終了
  assert.equal(isUsDst(jst(2026, 11, 1, 15, 0)), false);
  assert.equal(isUsDst(jst(2026, 3, 8, 15, 59)), false); // 07:00 UTC = JST 16:00 に開始
  assert.equal(isUsDst(jst(2026, 3, 8, 16, 0)), true);
  assert.equal(isUsDst(jst(2027, 1, 10, 12)), false);
});

test("セッション区分：夏時間（9-15 / 15-21 / 21-翌2 / 2-9）", () => {
  const d = (h: number, mi = 0) => sessionOf(jst(2026, 10, 15, h, mi));
  assert.equal(d(9), "tokyo");
  assert.equal(d(14, 59), "tokyo");
  assert.equal(d(15), "europe");
  assert.equal(d(20, 59), "europe");
  assert.equal(d(21), "ny");
  assert.equal(d(23, 30), "ny");
  assert.equal(sessionOf(jst(2026, 10, 16, 1, 59)), "ny");
  assert.equal(sessionOf(jst(2026, 10, 16, 2)), "late");
  assert.equal(d(8, 59), "late");
  assert.equal(describeSessions(jst(2026, 10, 15, 12)), "東京 9–15時・欧州前場 15–21時・NY 21–翌2時・深夜閑散 2–9時");
});

test("セッション区分：欧州だけ冬時間の週（10/26〜10/31）と、両方冬時間", () => {
  const mixed = (h: number) => sessionOf(jst(2026, 10, 28, h));
  assert.equal(mixed(15), "tokyo"); // 欧州の開始が16時に
  assert.equal(mixed(16), "europe");
  assert.equal(mixed(21), "ny"); // 米国はまだ夏時間
  const winter = (h: number, d = 10) => sessionOf(jst(2026, 11, d, h));
  assert.equal(winter(15), "tokyo");
  assert.equal(winter(21), "europe");
  assert.equal(winter(22), "ny");
  assert.equal(winter(2, 11), "ny");
  assert.equal(winter(3, 11), "late");
  assert.equal(describeSessions(jst(2026, 11, 10, 12)), "東京 9–16時・欧州前場 16–22時・NY 22–翌3時・深夜閑散 3–9時");
});

/** 1分足を作る：5分足ごとに値幅 range（円）になるようにする */
function bars(start: number, n5: number, range: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n5 * 5; i++) {
    const p = 150;
    out.push({ time: start + i * MIN, open: p, close: p, high: p + range / 2, low: p - range / 2 });
  }
  return out;
}

test("ATR(14)：5分足15本で計算、足りなければ null、未確定の足は使わない", () => {
  const start = jst(2026, 10, 15, 10, 0);
  const c = bars(start, 16, 0.1); // 5分足16本・値幅 0.1円 = 10 pips
  const asOf = start + 15 * 5 * MIN; // 15本確定
  assert.equal(atr5m(c, asOf), 10);
  assert.equal(atr5m(c, asOf - 5 * MIN), null); // 14本しか確定していない
  // 確定していない16本目の値幅が大きくても影響しない
  const spike = c.map((x) => (x.time >= asOf ? { ...x, high: 151, low: 149 } : x));
  assert.equal(atr5m(spike, asOf + 2 * MIN), 10);
  // 直前の足が長く欠けている（休場明けなど）なら null
  assert.equal(atr5m(c, asOf + 60 * MIN), null);
});

test("ATR の3分位", () => {
  const t = volTerciles([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(t);
  assert.equal(volBandOf(1, t), "low");
  assert.equal(volBandOf(5, t), "mid");
  assert.equal(volBandOf(9, t), "high");
  assert.equal(volBandOf(undefined, t), null);
  assert.equal(volTerciles([1, 2]), null);
});

test("イベント：読み込み・JST補完・前後30分・重要度", () => {
  const { events, errors } = parseEvents([
    { time: "2026-11-06 22:30", name: "米雇用統計", importance: "high" },
    { time: "2026-11-05T09:30:00+09:00", name: "豪貿易収支", importance: "low" },
    { time: "bad", name: "x", importance: "high" },
    { time: "2026-11-01T00:00:00Z", name: "", importance: "high" },
  ]);
  assert.equal(events.length, 2);
  assert.equal(errors.length, 2);
  assert.equal(events[1].time, jst(2026, 11, 6, 22, 30));
  assert.equal(nearEvent(jst(2026, 11, 6, 22, 0), events)?.name, "米雇用統計");
  assert.equal(nearEvent(jst(2026, 11, 6, 23, 0), events)?.name, "米雇用統計");
  assert.equal(nearEvent(jst(2026, 11, 6, 23, 1), events), null);
  assert.equal(nearEvent(jst(2026, 11, 5, 9, 30), events), null); // 重要度「低」は既定では数えない
  assert.equal(nearEvent(jst(2026, 11, 5, 9, 30), events, "low")?.name, "豪貿易収支");
  assert.deepEqual(parseEvents({ events: [] }).errors, []);
  assert.equal(parseEvents("x").errors.length, 1);
});

test("条件別の集計：Wilson区間・30件未満は判断不可・不明区分", () => {
  type Item = { k: string | null; r: Result };
  const items: Item[] = [
    ...Array.from({ length: 20 }, () => ({ k: "a", r: "win" as const })),
    ...Array.from({ length: 12 }, () => ({ k: "a", r: "lose" as const })),
    { k: "a", r: "excluded" },
    { k: "a", r: "pending" },
    { k: "b", r: "win" },
    { k: null, r: "lose" },
  ];
  const rows = conditionTable(items, (i) => i.k, (i) => i.r, [
    { key: "a", label: "A" },
    { key: "b", label: "B" },
    { key: "c", label: "C" },
  ]);
  assert.deepEqual(rows.map((r) => r.key), ["a", "b", "c", "unknown"]);
  const a = rows[0];
  assert.equal(a.n, 32);
  assert.equal(a.excluded, 1);
  assert.equal(a.pending, 1);
  assert.equal(a.winRate, 20 / 32);
  assert.equal(a.enough, true);
  assert.ok(a.ci && a.ci.low < 0.625 && a.ci.high > 0.625);
  assert.equal(rows[1].enough, false);
  assert.equal(rows[2].n, 0);
  assert.equal(rows[2].winRate, null);
  // 不明がなければ行を出さない
  assert.equal(conditionTable<Item>([], (i) => i.k, (i) => i.r, [{ key: "a", label: "A" }]).length, 1);
});

test("払戻倍率から損益分岐", () => {
  assert.equal(breakevenFromMultiplier(1.9)?.toFixed(4), "0.5263");
  assert.equal(breakevenFromMultiplier(1), null);
});
