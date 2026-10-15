// 予測モデルに渡す特徴量と、相場状態の分類（短期予測用）
//
// 時点 t（t に始まった1分足が確定した直後）の特徴量は、t までの足だけから作る。
// 5分足・15分足は1分足から作り、確定している足だけを使う（未来の情報が混ざらない）。

import type { Candle } from "../types";
import { PIP } from "../config";
import { aggregate, atrLast, emaLast, macdLast, rsiLast, smaLast } from "./ta";

const MIN = 60_000;
const JST = 9 * 60 * MIN;

/** 1回の計算で使う1分足の本数（15分足 SMA20・ATR14 に足りる量） */
export const WINDOW = 420;

export const FEATURE_NAMES = [
  "ret1", "ret5", "ret15", "ema20dist", "rsi14", "macdHist5", "ema9_21_5", "sma20dist15",
  "rangePos60", "structure5", "volRatio", "breakout30", "efficiency60", "hourSin", "hourCos",
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

/** 画面に出す、人が読める値（pips・% など） */
export type Raw = {
  price: number;
  atr1Pips: number;
  atr5Pips: number;
  atr15Pips: number;
  change1Pips: number;
  change5Pips: number;
  change15Pips: number;
  ema20DistPips: number;
  rsi14: number;
  macdHist5Pips: number;
  ema9_21_5Pips: number;
  sma20Dist15Pips: number;
  high60: number;
  low60: number;
  rangePos60: number;
  higherHighs: number;
  lowerLows: number;
  breakout30: -1 | 0 | 1;
  efficiency60: number;
};

export type FeatureResult = { t: number; x: number[]; raw: Raw };

export type FeatureFailure = { t: number; reason: string };

/**
 * candles の最後の足の時刻 t における特徴量。
 * candles は時刻順で、t より後の足を含まないこと。
 */
export function computeFeatures(candles: Candle[]): FeatureResult | FeatureFailure {
  const last = candles[candles.length - 1];
  if (!last) return { t: 0, reason: "足がありません" };
  const t = last.time;
  const asOf = t + MIN;
  const win = candles.length > WINDOW ? candles.slice(-WINDOW) : candles;
  if (win.length < 130) return { t, reason: "1分足が足りません（130本以上必要）" };

  // 直近60分の間に10分以上の欠けがあれば（休場明けなど）計算しない
  const recent = win.slice(-61);
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].time - recent[i - 1].time > 10 * MIN) return { t, reason: "直近の足に欠けがあります（休場明けなど）" };
  }
  if (t - recent[0].time > 90 * MIN) return { t, reason: "直近の足が不足しています" };

  const b5 = aggregate(win, 5, asOf);
  const b15 = aggregate(win, 15, asOf);
  if (b5.length < 36) return { t, reason: "5分足が足りません" };
  if (b15.length < 21) return { t, reason: "15分足が足りません" };

  const c1 = win.map((c) => c.close);
  const c5 = b5.map((c) => c.close);
  const c15 = b15.map((c) => c.close);
  const price = last.close;

  const a1 = atrLast(win, 14);
  const a1Long = atrLast(win, 120);
  const a5 = atrLast(b5, 14);
  const a15 = atrLast(b15, 14);
  const ema20 = emaLast(c1, 20);
  const rsi = rsiLast(c1, 14);
  const macd = macdLast(c5);
  const ema9 = emaLast(c5, 9);
  const ema21 = emaLast(c5, 21);
  const sma15 = smaLast(c15, 20);
  if ([a1, a1Long, a5, a15, ema20, rsi, ema9, ema21, sma15].some((v) => v === null) || !macd) {
    return { t, reason: "指標を計算できません" };
  }
  // 値動きがまったくない（データ異常）
  if (!a1 || !a5 || !a15 || !a1Long) return { t, reason: "値幅が0です（データ異常の可能性）" };

  const ago = (n: number) => c1[c1.length - 1 - n];
  const d1 = price - ago(1);
  const d5 = price - ago(5);
  const d15 = price - ago(15);
  const last60 = win.slice(-60);
  const hi60 = Math.max(...last60.map((c) => c.high));
  const lo60 = Math.min(...last60.map((c) => c.low));
  const rangePos = hi60 > lo60 ? (price - lo60) / (hi60 - lo60) : 0.5;

  // 5分足6本の高値の切り上げ・安値の切り下げ
  const s6 = b5.slice(-7);
  let hh = 0;
  let ll = 0;
  for (let i = 1; i < s6.length; i++) {
    if (s6[i].high > s6[i - 1].high) hh++;
    if (s6[i].low < s6[i - 1].low) ll++;
  }

  // 直近30分の高値・安値を（今の足を除いて）抜けたか
  const prev30 = win.slice(-31, -1);
  const brk: -1 | 0 | 1 = price > Math.max(...prev30.map((c) => c.high)) ? 1 : price < Math.min(...prev30.map((c) => c.low)) ? -1 : 0;

  // 効率比：60分の正味の動き ÷ 動いた距離の合計（1に近いほど一方向）
  let path = 0;
  const base = c1.length - 61;
  for (let i = base + 1; i < c1.length; i++) path += Math.abs(c1[i] - c1[i - 1]);
  const eff = path > 0 ? (price - c1[base]) / path : 0;

  const hour = (((t + JST) % (24 * 60 * MIN)) / (60 * MIN)) * ((2 * Math.PI) / 24);

  const x = [
    d1 / a1,
    d5 / (a1 * Math.sqrt(5)),
    d15 / (a1 * Math.sqrt(15)),
    (price - ema20!) / a1,
    (rsi! - 50) / 50,
    macd.hist / a5,
    (ema9! - ema21!) / a5,
    (price - sma15!) / a15,
    rangePos - 0.5,
    (hh - ll) / 6,
    Math.log(a1 / a1Long),
    brk,
    eff,
    Math.sin(hour),
    Math.cos(hour),
  ].map((v) => (Number.isFinite(v) ? Math.max(-10, Math.min(10, v)) : 0));

  const p = (v: number) => Math.round((v / PIP) * 10) / 10;
  return {
    t,
    x,
    raw: {
      price,
      atr1Pips: p(a1),
      atr5Pips: p(a5),
      atr15Pips: p(a15),
      change1Pips: p(d1),
      change5Pips: p(d5),
      change15Pips: p(d15),
      ema20DistPips: p(price - ema20!),
      rsi14: Math.round(rsi! * 10) / 10,
      macdHist5Pips: Math.round((macd.hist / PIP) * 100) / 100,
      ema9_21_5Pips: p(ema9! - ema21!),
      sma20Dist15Pips: p(price - sma15!),
      high60: hi60,
      low60: lo60,
      rangePos60: Math.round(rangePos * 100) / 100,
      higherHighs: hh,
      lowerLows: ll,
      breakout30: brk,
      efficiency60: Math.round(eff * 100) / 100,
    },
  };
}

export function isFailure(r: FeatureResult | FeatureFailure): r is FeatureFailure {
  return "reason" in r;
}

// ---------------- 相場状態 ----------------

export type Regime = "trend" | "range" | "highvol";
export const REGIME_LABEL: Record<Regime, string> = { trend: "トレンド相場", range: "レンジ相場", highvol: "高ボラティリティ" };

export type RegimeThresholds = {
  /** 5分足 ATR がこれ以上なら高ボラティリティ（学習期間の80パーセンタイル） */
  atr5Pips: number;
  /** 効率比の絶対値がこれ以上ならトレンド */
  efficiency: number;
};

export const DEFAULT_EFFICIENCY = 0.3;

export function classifyRegime(raw: Raw, th: RegimeThresholds): Regime {
  if (raw.atr5Pips >= th.atr5Pips) return "highvol";
  if (Math.abs(raw.efficiency60) >= th.efficiency) return "trend";
  return "range";
}

export const REGIME_NOTE: Record<Regime, string> = {
  trend:
    "一方向に動いています。勢いの指標が効きやすい反面、急な反転で損切りにかかりやすい局面です。予測が流れと逆向きのときは特に慎重に。",
  range:
    "上下に行き来しています。数分先の方向はほぼ五分五分になりやすく、横ばいの確率が高めに出ます。レンジの端では反転に注意。",
  highvol:
    "値動きがふだんより大きい局面です。同じ確率でも損益の振れ幅が大きく、損切り幅が広く必要になります。指標発表の前後なら見送りを検討。",
};

// ---------------- 説明用の名前 ----------------

export const FEATURE_LABEL: Record<FeatureName, string> = {
  ret1: "直近1分の変化",
  ret5: "直近5分の変化",
  ret15: "直近15分の変化",
  ema20dist: "1分足EMA20からの乖離",
  rsi14: "RSI(14)",
  macdHist5: "5分足MACDヒストグラム",
  ema9_21_5: "5分足EMA9とEMA21の差",
  sma20dist15: "15分足SMA20からの乖離",
  rangePos60: "直近60分のレンジ内の位置",
  structure5: "5分足の高値・安値の切り上げ/切り下げ",
  volRatio: "最近の値幅（ふだんとの比）",
  breakout30: "直近30分の高値・安値ブレイク",
  efficiency60: "60分の一方向性（効率比）",
  hourSin: "時間帯",
  hourCos: "時間帯",
};

/** 特徴量の今の値を読める形に */
export function describeFeature(name: FeatureName, raw: Raw): string {
  const s = (v: number) => `${v > 0 ? "+" : ""}${v}`;
  switch (name) {
    case "ret1": return `${s(raw.change1Pips)} pips`;
    case "ret5": return `${s(raw.change5Pips)} pips`;
    case "ret15": return `${s(raw.change15Pips)} pips`;
    case "ema20dist": return `${s(raw.ema20DistPips)} pips`;
    case "rsi14": return `${raw.rsi14}`;
    case "macdHist5": return `${s(raw.macdHist5Pips)} pips`;
    case "ema9_21_5": return `${s(raw.ema9_21_5Pips)} pips`;
    case "sma20dist15": return `${s(raw.sma20Dist15Pips)} pips`;
    case "rangePos60": return `下端から ${Math.round(raw.rangePos60 * 100)}%`;
    case "structure5": return `切り上げ ${raw.higherHighs}本・切り下げ ${raw.lowerLows}本（直近6本）`;
    case "volRatio": return `1分足ATR ${raw.atr1Pips} pips`;
    case "breakout30": return raw.breakout30 === 1 ? "高値を上抜け" : raw.breakout30 === -1 ? "安値を下抜け" : "レンジ内";
    case "efficiency60": return `${raw.efficiency60}`;
    default: return "";
  }
}
