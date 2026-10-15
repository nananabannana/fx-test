// テクニカル指標と足のまとめ（短期予測用）
// どれも「渡された配列の最後の時点」までの情報だけを使う。未来の足は渡さないこと。

import type { Candle } from "../types";

const MIN = 60_000;

/**
 * 1分足を N 分足にまとめる（時計の区切り。JST は UTC+9時間なので区切りは同じ）。
 * asOf 時点で確定している足だけを返す（asOf より後に終わる足は入れない）。
 */
export function aggregate(candles: Candle[], minutes: number, asOf: number): Candle[] {
  const span = minutes * MIN;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of candles) {
    if (c.time + MIN > asOf) break;
    const k = Math.floor(c.time / span) * span;
    if (k + span > asOf) break;
    if (!cur || cur.time !== k) {
      if (cur) out.push(cur);
      cur = { time: k, open: c.open, high: c.high, low: c.low, close: c.close };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function smaLast(values: number[], n: number): number | null {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

/** EMA の系列（最初の n 本の単純平均から始める）。足りなければ空配列 */
export function emaSeries(values: number[], n: number): number[] {
  if (values.length < n) return [];
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += values[i];
  e /= n;
  const out = [e];
  for (let i = n; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

export function emaLast(values: number[], n: number): number | null {
  const s = emaSeries(values, n);
  return s.length ? s[s.length - 1] : null;
}

/** RSI（ワイルダーの平滑化） */
export function rsiLast(values: number[], n = 14): number | null {
  if (values.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (gain + loss === 0) return 50;
  return (100 * gain) / (gain + loss);
}

/** MACD(12,26,9) の最後の値 */
export function macdLast(values: number[], fast = 12, slow = 26, signal = 9): { macd: number; signal: number; hist: number } | null {
  if (values.length < slow + signal) return null;
  const ef = emaSeries(values, fast);
  const es = emaSeries(values, slow);
  // 両方そろっている部分だけで MACD 線を作る
  const line: number[] = [];
  const offset = slow - fast;
  for (let i = 0; i < es.length; i++) line.push(ef[i + offset] - es[i]);
  const sig = emaSeries(line, signal);
  if (!sig.length) return null;
  const m = line[line.length - 1];
  const s = sig[sig.length - 1];
  return { macd: m, signal: s, hist: m - s };
}

/** ATR（直近 n 本の真の値幅の単純平均）。前の足の終値が要るので n+1 本必要 */
export function atrLast(bars: Candle[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  let s = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    s += Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  }
  return s / n;
}
