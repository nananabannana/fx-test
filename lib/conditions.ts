// 勝率の条件別分析（旧モード・OP検証で共通）
// - セッション区分（JST。欧米の夏時間に合わせて境界を自動で動かす）
// - 予測時点のボラティリティ（5分足 ATR(14)、pips）と、その3分位
// - 主要指標の前後30分以内か（data/events.json に手動登録）
// 時刻はすべて UTC ミリ秒から固定のずれで計算し、実行環境のタイムゾーンに依存しない。

import type { Candle } from "./types";
import { PIP } from "./config";
import { wilson } from "./gmoOption";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const JST_OFFSET = 9 * HOUR;

// ---------------- 夏時間 ----------------

/** その年・月（0始まり）の n 番目の日曜日（UTC 0時のミリ秒）。n=-1 で最終日曜 */
function nthSundayUtc(year: number, month: number, n: number): number {
  if (n > 0) {
    const first = Date.UTC(year, month, 1);
    const dow = new Date(first).getUTCDay();
    return first + (((7 - dow) % 7) + (n - 1) * 7) * DAY;
  }
  const last = Date.UTC(year, month + 1, 0);
  const dow = new Date(last).getUTCDay();
  return last - dow * DAY;
}

/** 欧州の夏時間か（3月最終日曜 01:00 UTC 〜 10月最終日曜 01:00 UTC） */
export function isEuDst(t: number): boolean {
  const y = new Date(t).getUTCFullYear();
  return t >= nthSundayUtc(y, 2, -1) + HOUR && t < nthSundayUtc(y, 9, -1) + HOUR;
}

/** 米国の夏時間か（3月第2日曜 2:00 EST=07:00 UTC 〜 11月第1日曜 2:00 EDT=06:00 UTC） */
export function isUsDst(t: number): boolean {
  const y = new Date(t).getUTCFullYear();
  return t >= nthSundayUtc(y, 2, 2) + 7 * HOUR && t < nthSundayUtc(y, 10, 1) + 6 * HOUR;
}

// ---------------- セッション ----------------

export type Session = "tokyo" | "europe" | "ny" | "late";
export const SESSIONS: Session[] = ["tokyo", "europe", "ny", "late"];
export const SESSION_LABEL: Record<Session, string> = {
  tokyo: "東京",
  europe: "欧州前場",
  ny: "NY",
  late: "深夜閑散",
};

/**
 * その時刻に使うセッションの境界（JSTの時。late は翌日側の時）。
 * 夏時間の基準：東京 9時 / 欧州 フランクフルト8時 = JST15時 / NY ニューヨーク8時 = JST21時 / 深夜 ニューヨーク13時 = JST翌2時。
 * 冬時間では欧州・NY・深夜の開始がそれぞれ1時間遅くなる（東京の終わりも欧州の開始に合わせて延びる）。
 */
export function sessionBounds(t: number): { tokyo: number; europe: number; ny: number; late: number } {
  const eu = isEuDst(t);
  const us = isUsDst(t);
  return { tokyo: 9, europe: eu ? 15 : 16, ny: us ? 21 : 22, late: us ? 2 : 3 };
}

/** JST の「時」（小数。例 15.5 = 15:30） */
export function jstHour(t: number): number {
  const ms = (((t + JST_OFFSET) % DAY) + DAY) % DAY;
  return ms / HOUR;
}

export function sessionOf(t: number): Session {
  const b = sessionBounds(t);
  const h = jstHour(t);
  if (h >= b.tokyo && h < b.europe) return "tokyo";
  if (h >= b.europe && h < b.ny) return "europe";
  if (h >= b.ny || h < b.late) return "ny";
  return "late";
}

/** 画面表示用「東京 9–15時・欧州前場 15–21時・NY 21–翌2時・深夜閑散 2–9時」 */
export function describeSessions(t: number): string {
  const b = sessionBounds(t);
  return `東京 ${b.tokyo}–${b.europe}時・欧州前場 ${b.europe}–${b.ny}時・NY ${b.ny}–翌${b.late}時・深夜閑散 ${b.late}–${b.tokyo}時`;
}

// ---------------- ボラティリティ（5分足 ATR） ----------------

export const ATR_PERIOD = 14;
const BAR = 5 * MIN;

/**
 * asOf（この時刻までに確定した情報だけを使う）時点の、5分足 ATR(14)（pips）。
 * 1分足を時計の5分区切りでまとめ、確定した5分足だけを使う。
 * 前の終値が要るので5分足が15本（75分ぶん）必要。足りなければ null。
 */
export function atr5m(candles: Candle[], asOf: number, period = ATR_PERIOD): number | null {
  const bars = new Map<number, { high: number; low: number; close: number; last: number }>();
  for (const c of candles) {
    if (c.time + MIN > asOf) continue; // まだ確定していない1分足
    const k = Math.floor(c.time / BAR) * BAR;
    if (k + BAR > asOf) continue; // まだ確定していない5分足
    const b = bars.get(k);
    if (!b) bars.set(k, { high: c.high, low: c.low, close: c.close, last: c.time });
    else {
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      if (c.time > b.last) {
        b.close = c.close;
        b.last = c.time;
      }
    }
  }
  const keys = [...bars.keys()].sort((a, b) => a - b);
  if (keys.length < period + 1) return null;
  const lastKey = keys[keys.length - 1];
  // 予測時点の直前の足が欠けている（休場明け・取得範囲外）なら、その時点の値とはいえない
  if (asOf - (lastKey + BAR) > 3 * BAR) return null;
  const use = keys.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < use.length; i++) {
    const b = bars.get(use[i])!;
    const prevClose = bars.get(use[i - 1])!.close;
    sum += Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
  }
  return Math.round((sum / period / PIP) * 100) / 100;
}

export type VolBand = "low" | "mid" | "high";
export const VOL_LABEL: Record<VolBand, string> = { low: "低", mid: "中", high: "高" };

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 全期間の ATR の分布から3分位の境界を出す（3件未満なら null） */
export function volTerciles(values: number[]): { t1: number; t2: number } | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 3) return null;
  return { t1: quantile(v, 1 / 3), t2: quantile(v, 2 / 3) };
}

export function volBandOf(atr: number | null | undefined, t: { t1: number; t2: number } | null): VolBand | null {
  if (atr === null || atr === undefined || !t) return null;
  if (atr <= t.t1) return "low";
  if (atr <= t.t2) return "mid";
  return "high";
}

// ---------------- 指標イベント ----------------

export type Importance = "high" | "medium" | "low";
export const IMPORTANCE_LABEL: Record<Importance, string> = { high: "高", medium: "中", low: "低" };
const IMPORTANCE_RANK: Record<Importance, number> = { low: 1, medium: 2, high: 3 };

export type FxEvent = { time: number; name: string; importance: Importance };

/** events.json の中身を検証して読み込む。おかしな行は errors に理由を入れて飛ばす */
export function parseEvents(raw: unknown): { events: FxEvent[]; errors: string[] } {
  const errors: string[] = [];
  const events: FxEvent[] = [];
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events) ? (raw as { events: unknown[] }).events : null;
  if (!list) return { events, errors: ["配列（[ ... ]）か { \"events\": [ ... ] } の形で書いてください。"] };
  list.forEach((e, i) => {
    const row = e as { time?: unknown; datetime?: unknown; name?: unknown; importance?: unknown };
    const ts = typeof row.time === "string" ? row.time : typeof row.datetime === "string" ? row.datetime : null;
    // タイムゾーンの書かれていない日時は JST とみなす（例 "2026-11-06 22:30"）
    const iso = ts && !/(Z|[+-]\d{2}:?\d{2})$/.test(ts.trim()) ? `${ts.trim().replace(" ", "T")}+09:00` : ts;
    const time = iso ? Date.parse(iso) : NaN;
    const imp = row.importance;
    if (!Number.isFinite(time)) return void errors.push(`${i + 1}件目：日時が読めません`);
    if (typeof row.name !== "string" || !row.name.trim()) return void errors.push(`${i + 1}件目：名称がありません`);
    if (imp !== "high" && imp !== "medium" && imp !== "low") return void errors.push(`${i + 1}件目：重要度は high / medium / low のどれかにしてください`);
    events.push({ time, name: row.name.trim(), importance: imp });
  });
  events.sort((a, b) => a.time - b.time);
  return { events, errors };
}

export const EVENT_WINDOW_MIN = 30;

/** 予測時刻の前後 windowMin 分以内にある、重要度 minImportance 以上のイベント（なければ null） */
export function nearEvent(t: number, events: FxEvent[], minImportance: Importance = "medium", windowMin = EVENT_WINDOW_MIN): FxEvent | null {
  const w = windowMin * MIN;
  const min = IMPORTANCE_RANK[minImportance];
  return events.find((e) => IMPORTANCE_RANK[e.importance] >= min && Math.abs(e.time - t) <= w) ?? null;
}

// ---------------- 条件別の集計 ----------------

/** 一致=win / 不一致=lose / 対象外（判断保留・引き分け）=excluded / 確認待ち・取得できず=pending */
export type Result = "win" | "lose" | "excluded" | "pending";

/** これ未満の件数の区分は「判断不可」 */
export const MIN_SAMPLES = 30;

export type CondRow = {
  key: string;
  label: string;
  /** 照合できた件数（一致＋不一致） */
  n: number;
  wins: number;
  losses: number;
  excluded: number;
  pending: number;
  winRate: number | null;
  ci: { low: number; high: number } | null;
  enough: boolean;
};

export const UNKNOWN = "unknown";

export function conditionTable<T>(
  items: T[],
  keyOf: (item: T) => string | null,
  resultOf: (item: T) => Result,
  order: { key: string; label: string }[],
): CondRow[] {
  const rows = new Map<string, CondRow>();
  const all = [...order, { key: UNKNOWN, label: "不明" }];
  for (const o of all) {
    rows.set(o.key, { key: o.key, label: o.label, n: 0, wins: 0, losses: 0, excluded: 0, pending: 0, winRate: null, ci: null, enough: false });
  }
  for (const it of items) {
    const row = rows.get(keyOf(it) ?? UNKNOWN) ?? rows.get(UNKNOWN)!;
    const r = resultOf(it);
    if (r === "win") row.wins++;
    else if (r === "lose") row.losses++;
    else if (r === "excluded") row.excluded++;
    else row.pending++;
  }
  return all
    .map((o) => rows.get(o.key)!)
    .filter((r) => r.key !== UNKNOWN || r.wins + r.losses + r.excluded + r.pending > 0)
    .map((r) => {
      const n = r.wins + r.losses;
      return { ...r, n, winRate: n ? r.wins / n : null, ci: wilson(r.wins, n), enough: n >= MIN_SAMPLES };
    });
}

/** 払戻倍率（例 1.9倍）から損益分岐の勝率（1/1.9 ≈ 52.6%） */
export function breakevenFromMultiplier(m: number): number | null {
  return Number.isFinite(m) && m > 1 ? 1 / m : null;
}

/** 記録に保存する条件（予測作成時） */
export type ConditionFields = {
  session?: Session;
  /** 5分足 ATR(14)（pips） */
  atrPips?: number;
  /** 価格履歴から ATR を計算できないと確定した（休場・データなし） */
  atrUnavailable?: boolean;
};

export function conditionsAt(candles: Candle[], asOf: number, sessionTime: number = asOf): ConditionFields {
  const atr = atr5m(candles, asOf);
  return { session: sessionOf(sessionTime), ...(atr !== null ? { atrPips: atr } : {}) };
}
