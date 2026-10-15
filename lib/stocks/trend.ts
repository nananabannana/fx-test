// 移動平均によるトレンド判定
// 上昇 = 終値 > 25日線 かつ 25日線 > 75日線
// 下降 = 終値 < 25日線 かつ 25日線 < 75日線
// それ以外は中立

import type { Bar, Trend, TrendInfo } from "./types";

function smaAt(bars: Bar[], idx: number, period: number): number | null {
  if (idx + 1 < period) return null;
  let s = 0;
  for (let i = idx - period + 1; i <= idx; i++) s += bars[i].c;
  return s / period;
}

export function trendAt(bars: Bar[], idx: number): TrendInfo | null {
  if (idx < 0 || idx >= bars.length) return null;
  const close = bars[idx].c;
  const sma25 = smaAt(bars, idx, 25);
  const sma75 = smaAt(bars, idx, 75);
  let trend: Trend = "neutral";
  if (sma25 !== null && sma75 !== null) {
    if (close > sma25 && sma25 > sma75) trend = "up";
    else if (close < sma25 && sma25 < sma75) trend = "down";
  }
  const window = bars.slice(Math.max(0, idx - 19), idx + 1).filter((b) => b.va !== null);
  const avgTurnover20 = window.length >= 10 ? window.reduce((s, b) => s + (b.va ?? 0), 0) / window.length : null;
  return { trend, close, sma25, sma75, avgTurnover20 };
}

/** 指定日（その日を含む）以前で最後の足の位置。なければ -1 */
export function indexOnOrBefore(bars: Bar[], date: string): number {
  let lo = 0;
  let hi = bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** チャート用に、各日の 25日線・75日線を付ける */
export function withSma(bars: Bar[]) {
  return bars.map((b, i) => ({ ...b, sma25: smaAt(bars, i, 25), sma75: smaAt(bars, i, 75) }));
}

export const TREND_LABEL: Record<Trend, string> = { up: "上昇", neutral: "中立", down: "下降" };
