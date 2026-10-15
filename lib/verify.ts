// 予測と「予測期間後の実績」を照合します。
// 予測時刻＋予測期間（分）の足を「時刻」で探すので、サンプルでも実データでも同じ処理で動きます。

import type { Candle, Direction, Prediction, VerifiedPrediction } from "./types";
import { FLAT_THRESHOLD_PIPS, PIP } from "./config";

const MINUTE = 60_000;

/** 予測期間後にあたる足の時刻 */
export function targetTime(p: Prediction): number {
  return p.at + p.horizonMinutes * MINUTE;
}

/** 手元の足から、予測の実績価格を探す（見つからなければ null） */
export function findActualPrice(p: Prediction, candles: Candle[]): number | null {
  if (p.resolvedPrice != null) return p.resolvedPrice;
  const t = targetTime(p);
  return candles.find((c) => c.time === t)?.close ?? null;
}

export function verifyPrediction(p: Prediction, candles: Candle[]): VerifiedPrediction {
  const actualPrice = findActualPrice(p, candles);
  if (actualPrice === null) {
    // 取得できた最も古い足より前の実績は、もう確認できない
    const first = candles[0]?.time;
    const lost = first !== undefined && targetTime(p) < first;
    return {
      ...p,
      actualPrice: null,
      changePips: null,
      actualDirection: null,
      outcome: lost ? "unavailable" : "pending",
    };
  }

  const changePips = Math.round(((actualPrice - p.basePrice) / PIP) * 10) / 10;
  const actualDirection: Direction =
    Math.abs(changePips) < FLAT_THRESHOLD_PIPS ? "hold" : changePips > 0 ? "up" : "down";

  const outcome =
    p.direction === "hold" ? "excluded" : p.direction === actualDirection ? "match" : "miss";

  return { ...p, actualPrice, changePips, actualDirection, outcome };
}

export type VerifySummary = {
  total: number;
  evaluated: number;
  match: number;
  miss: number;
  excluded: number;
  pending: number;
};

export function summarize(items: VerifiedPrediction[]): VerifySummary {
  const count = (o: VerifiedPrediction["outcome"]) => items.filter((i) => i.outcome === o).length;
  const match = count("match");
  const miss = count("miss");
  return {
    total: items.length,
    evaluated: match + miss,
    match,
    miss,
    excluded: count("excluded"),
    pending: count("pending") + count("unavailable"),
  };
}
