// 予測の記録と、仮想取引（デモ）のルール。実際の注文は一切送らない。
//
// 仮想取引の初期設定（検証用。利益や安全性を保証するものではない）
// - 仮想資金 10,000円・USD/JPY・同時に1ポジションまで・保有 5〜10分
// - 1回の許容損失 50〜100円、1日の仮想損失の上限 200円
// - 数量 = 許容損失 ÷ 損切り幅 を最小単位（1,000通貨）で切り捨て。確率が高くても増やさない
// - スプレッド・取引コストは使わない設定（0円として計算し、画面に明記）

import type { Candle } from "../types";
import { PIP } from "../config";
import type { Session } from "../conditions";
import type { Regime } from "./features";
import { CLASSES, type Cls } from "./evaluate";
import { labelOf, type Horizon } from "./model";

const MIN = 60_000;
const JST = 9 * 3600_000;

// ---------------- 予測の記録 ----------------

export type HorizonRecord = {
  percents: Record<Cls, number>;
  probs: Record<Cls, number>;
  direction: Cls;
  bandPips: number;
  movePips: number;
  provisional: boolean;
  /** モデルの学習期間の比率（ブライアスコアの比較用） */
  base?: number[];
};

export type PredictionRecord = {
  id: string;
  /** 分析に使った最後の確定1分足の時刻 */
  at: number;
  price: number;
  modelVersion: string;
  regime: Regime;
  session: Session;
  /** 5分足 ATR(14)（pips） */
  atrPips: number;
  /** 予測時点のスプレッド（使わない設定なので null） */
  spreadPips: null;
  horizons: Record<Horizon, HorizonRecord>;
  /** h 分後の足の終値（確定したら入る） */
  actual: Partial<Record<Horizon, number>>;
  /** 価格履歴がなく確定できなかった */
  unavailable?: Partial<Record<Horizon, boolean>>;
};

export type HorizonOutcome = { status: "pending" } | { status: "unavailable" } | { status: "settled"; actual: Cls; deltaPips: number; hit: boolean };

export function outcomeAt(r: PredictionRecord, h: Horizon): HorizonOutcome {
  const a = r.actual[h];
  if (a === undefined) return r.unavailable?.[h] ? { status: "unavailable" } : { status: "pending" };
  const deltaPips = Math.round(((a - r.price) / PIP) * 10) / 10;
  const actual = labelOf(deltaPips, r.horizons[h].bandPips);
  return { status: "settled", actual, deltaPips, hit: actual === r.horizons[h].direction };
}

export const probsArray = (h: HorizonRecord) => CLASSES.map((c) => h.probs[c]);

// ---------------- 仮想取引 ----------------

export type DemoSettings = {
  startBalance: number;
  /** 1回の許容損失（円）50〜100 */
  riskYen: number;
  dailyLossLimit: number;
  minUnit: number;
  /** 必要証拠金の率（個人の FX は 4% ＝ 25倍） */
  marginRate: number;
  stopPips: number;
  holdMin: 5 | 10;
};

export const DEMO_DEFAULTS: DemoSettings = {
  startBalance: 10_000,
  riskYen: 100,
  dailyLossLimit: 200,
  minUnit: 1_000,
  marginRate: 0.04,
  stopPips: 5,
  holdMin: 5,
};

export type Side = "buy" | "sell";

export type DemoTrade = {
  id: string;
  predictionId: string | null;
  side: Side;
  /** エントリーした足（この足の終値で入る） */
  entryAt: number;
  entry: number;
  units: number;
  stopPips: number;
  stopPrice: number;
  /** この足の終値で手仕舞う（保有時間の終わり） */
  exitAt: number;
  /** 損切りにかかったときの想定損失（円） */
  riskYen: number;
  status: "open" | "closed";
  exitPrice?: number;
  exitTime?: number;
  exitReason?: "stop" | "time";
  pnlYen?: number;
  /** スプレッド等のコスト（使わない設定なので 0） */
  costYen: 0;
};

export type Sizing =
  | { ok: true; units: number; riskAtStop: number; margin: number; note?: string }
  | { ok: false; reason: string };

export function sizePosition(o: { balance: number; riskYen: number; stopPips: number; minUnit: number; price: number; marginRate: number }): Sizing {
  if (!(o.stopPips > 0)) return { ok: false, reason: "損切り幅を0より大きくしてください。" };
  if (!(o.riskYen > 0)) return { ok: false, reason: "許容損失を0より大きくしてください。" };
  const perUnitLoss = o.stopPips * PIP; // 1通貨あたりの損失（円）
  let units = Math.floor(o.riskYen / perUnitLoss / o.minUnit) * o.minUnit;
  if (units < o.minUnit) {
    const minLoss = Math.round(o.minUnit * perUnitLoss);
    return {
      ok: false,
      reason: `最小単位（${o.minUnit.toLocaleString()}通貨）でも、損切り${o.stopPips} pipsで ${minLoss.toLocaleString()}円の損失になり、許容損失 ${o.riskYen}円を超えます。損切り幅を狭めるか見送ってください。`,
    };
  }
  let note: string | undefined;
  const maxByMargin = Math.floor(o.balance / (o.price * o.marginRate) / o.minUnit) * o.minUnit;
  if (units > maxByMargin) {
    if (maxByMargin < o.minUnit) return { ok: false, reason: "仮想資金が必要証拠金に足りません。" };
    units = maxByMargin;
    note = `必要証拠金の上限で ${units.toLocaleString()}通貨に減らしました。`;
  }
  return { ok: true, units, riskAtStop: Math.round(units * perUnitLoss), margin: Math.round(units * o.price * o.marginRate), note };
}

/** JST の日付（YYYY-MM-DD） */
export const jstDay = (t: number) => new Date(t + JST).toISOString().slice(0, 10);

export function todayPnl(trades: DemoTrade[], now: number): number {
  const d = jstDay(now);
  return trades.filter((t) => t.status === "closed" && t.exitTime !== undefined && jstDay(t.exitTime) === d).reduce((s, t) => s + (t.pnlYen ?? 0), 0);
}

export function balanceOf(trades: DemoTrade[], start: number): number {
  return start + trades.filter((t) => t.status === "closed").reduce((s, t) => s + (t.pnlYen ?? 0), 0);
}

export function canOpen(o: { trades: DemoTrade[]; now: number; riskAtStop: number; settings: DemoSettings }): { ok: true } | { ok: false; reason: string } {
  if (o.trades.some((t) => t.status === "open")) return { ok: false, reason: "保有中の仮想ポジションがあります（同時保有は1つまで）。" };
  const pnl = todayPnl(o.trades, o.now);
  const remaining = o.settings.dailyLossLimit + Math.min(0, pnl);
  if (remaining <= 0) return { ok: false, reason: `今日の仮想損失が上限（${o.settings.dailyLossLimit}円）に達しました。今日はここまでです。` };
  if (o.riskAtStop > remaining) {
    return { ok: false, reason: `損切りになると今日の損失上限を超えます（残り ${remaining}円・この取引の想定損失 ${o.riskAtStop}円）。` };
  }
  return { ok: true };
}

export function openTrade(o: { id: string; predictionId: string | null; side: Side; at: number; price: number; units: number; stopPips: number; holdMin: number; riskAtStop: number }): DemoTrade {
  const dir = o.side === "buy" ? 1 : -1;
  return {
    id: o.id,
    predictionId: o.predictionId,
    side: o.side,
    entryAt: o.at,
    entry: o.price,
    units: o.units,
    stopPips: o.stopPips,
    stopPrice: Math.round((o.price - dir * o.stopPips * PIP) * 1000) / 1000,
    exitAt: o.at + o.holdMin * MIN,
    riskYen: o.riskAtStop,
    status: "open",
    costYen: 0,
  };
}

/**
 * 1分足で手仕舞いを判定する。損切り価格に触れたらその価格で、触れなければ保有時間の終わりの足の終値で。
 * 同じ足で判定できないこと（足の中の順番）は、損切りを優先する（不利な側で見る）。
 * 終わりの足がまだなければ null。
 */
export function settleTrade(t: DemoTrade, candles: Candle[]): DemoTrade | null {
  if (t.status === "closed") return t;
  const dir = t.side === "buy" ? 1 : -1;
  const close = (price: number, time: number, reason: "stop" | "time"): DemoTrade => ({
    ...t,
    status: "closed",
    exitPrice: price,
    exitTime: time + MIN,
    exitReason: reason,
    pnlYen: Math.round((price - t.entry) * dir * t.units),
  });
  const span = candles.filter((c) => c.time > t.entryAt && c.time <= t.exitAt).sort((a, b) => a.time - b.time);
  for (const c of span) {
    if (t.side === "buy" ? c.low <= t.stopPrice : c.high >= t.stopPrice) return close(t.stopPrice, c.time, "stop");
    if (c.time === t.exitAt) return close(c.close, c.time, "time");
  }
  // 終わりの足が欠けている（休場など）けれど、それより後の足が届いている：最後に確認できた足の終値で
  if (candles.some((c) => c.time > t.exitAt)) {
    const lastSeen = span.at(-1);
    if (lastSeen) return close(lastSeen.close, lastSeen.time, "time");
    return close(t.entry, t.entryAt, "time");
  }
  return null;
}
