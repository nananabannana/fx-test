// 為替データの取得元（差し替え可能にする窓口。サーバー専用）
// 今は Twelve Data だけ。別の取得元にするときは FxProvider を実装して getProvider を変える。
import "server-only";

import type { Candle } from "../types";
import { PAIR } from "../config";
import { fetchCandles, LiveDataError } from "./twelveData";

export type FxProvider = {
  name: string;
  /** 遅延の説明（画面に表示） */
  delayNote: string;
  /** 直近 count 本の確定1分足（古い順） */
  recent(count: number): Promise<Candle[]>;
  /** [start, end) の1分足（古い順）。最大5,000本 */
  range(start: number, end: number): Promise<Candle[]>;
};

const MIN = 60_000;

/** 外部データをそのまま信用しない：形のおかしい足は捨てる */
export function sanitizeCandles(candles: Candle[]): Candle[] {
  const seen = new Set<number>();
  return candles
    .filter(
      (c) =>
        Number.isFinite(c.time) && c.time % MIN === 0 &&
        [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 50 && v < 400) &&
        c.high >= Math.max(c.open, c.close) - 1e-9 && c.low <= Math.min(c.open, c.close) + 1e-9 &&
        c.high - c.low < 3, // 1分で3円以上はデータ異常とみなす
    )
    .filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true)))
    .sort((a, b) => a.time - b.time);
}

export function getProvider(): FxProvider {
  const apiKey = process.env.FX_DATA_API_KEY;
  if (!apiKey) throw new LiveDataError("no_key", "為替データのAPIキー（FX_DATA_API_KEY）が設定されていません。");
  return {
    name: "Twelve Data",
    delayNote: "1分足の確定値（数十秒〜数分の遅れがありえます）。Bid/Ask・スプレッドは提供されていません",
    recent: async (count) => sanitizeCandles(await fetchCandles({ apiKey, symbol: PAIR, count })),
    range: async (start, end) =>
      sanitizeCandles(await fetchCandles({ apiKey, symbol: PAIR, count: 5000, range: { start, end } })).filter((c) => c.time >= start && c.time < end),
  };
}
