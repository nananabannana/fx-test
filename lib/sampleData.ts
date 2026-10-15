// 架空のUSD/JPY 1分足データを作ります（実在の相場ではありません）。
// STEP 2 では、この関数の代わりに為替データAPIから取得したローソク足を使います。

import type { Candle } from "./types";
import { gaussian, mulberry32 } from "./random";

export const SAMPLE_SEED = 20261010;
export const SAMPLE_LENGTH = 240;
/** サンプル開始時刻: 2026-10-09 09:00 (日本時間) */
export const SAMPLE_START = Date.UTC(2026, 9, 9, 0, 0, 0);

const MINUTE = 60_000;

export function generateSampleCandles(
  length = SAMPLE_LENGTH,
  seed = SAMPLE_SEED,
): Candle[] {
  const rand = mulberry32(seed);
  const candles: Candle[] = [];
  let price = 149.5;
  // ゆっくり向きが変わるトレンド成分＋ランダムな揺れ
  let drift = 0;

  for (let i = 0; i < length; i++) {
    drift = drift * 0.92 + gaussian(rand) * 0.0025;
    const open = price;
    let p = open;
    let high = open;
    let low = open;
    // 1分の中を4ステップに分けて高値・安値を作る
    for (let s = 0; s < 4; s++) {
      p += drift / 4 + gaussian(rand) * 0.006;
      high = Math.max(high, p);
      low = Math.min(low, p);
    }
    const close = p;
    high += rand() * 0.004;
    low -= rand() * 0.004;
    candles.push({
      time: SAMPLE_START + i * MINUTE,
      open: round3(open),
      high: round3(high),
      low: round3(low),
      close: round3(close),
    });
    price = close;
  }
  return candles;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
