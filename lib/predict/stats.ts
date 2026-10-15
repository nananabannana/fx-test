// 検証画面の集計（予測の記録から）
import { PIP } from "../config";
import { wilson } from "../gmoOption";
import { CLASSES, evaluateProbs, maxDrawdown, type ProbMetrics } from "./evaluate";
import { outcomeAt, probsArray, type PredictionRecord } from "./demo";
import type { Horizon } from "./model";

const JST = 9 * 3600_000;

/** 予測に従って 1,000通貨で入り、h 分後の終値で出たときの損益（コストなし） */
export const FOLLOW_UNITS = 1_000;

export type HorizonStats = {
  total: number;
  settled: number;
  pending: number;
  unavailable: number;
  metrics: ProbMetrics;
  ci: { low: number; high: number } | null;
  /** 基準（学習期間の比率で答える）の成績。記録に比率があるものだけ */
  base: { n: number; accuracy: number | null; brier: number | null };
  hourly: { hour: number; n: number; hits: number }[];
  follow: { n: number; wins: number; totalYen: number; avgYen: number | null; maxDD: number; curve: { t: number; value: number }[] };
};

export function horizonStats(records: PredictionRecord[], h: Horizon): HorizonStats {
  const sorted = [...records].sort((a, b) => a.at - b.at);
  let pending = 0;
  let unavailable = 0;
  const scored: { p: number[]; y: number; r: PredictionRecord; delta: number; hit: boolean }[] = [];
  for (const r of sorted) {
    const o = outcomeAt(r, h);
    if (o.status === "pending") pending++;
    else if (o.status === "unavailable") unavailable++;
    else scored.push({ p: probsArray(r.horizons[h]), y: CLASSES.indexOf(o.actual), r, delta: o.deltaPips, hit: o.hit });
  }
  const metrics = evaluateProbs(scored);
  const hits = scored.filter((s) => s.hit).length;

  const withBase = scored.filter((s) => s.r.horizons[h].base?.length === 3);
  const baseM = evaluateProbs(withBase.map((s) => ({ p: s.r.horizons[h].base!, y: s.y })));

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, n: 0, hits: 0 }));
  for (const s of scored) {
    const hr = new Date(s.r.at + JST).getUTCHours();
    hourly[hr].n++;
    if (s.hit) hourly[hr].hits++;
  }

  let cum = 0;
  let wins = 0;
  const curve: { t: number; value: number }[] = [];
  const trades = scored.filter((s) => s.r.horizons[h].direction !== "flat");
  for (const s of trades) {
    const sign = s.r.horizons[h].direction === "up" ? 1 : -1;
    const yen = Math.round(sign * s.delta * PIP * FOLLOW_UNITS);
    if (yen > 0) wins++;
    cum += yen;
    curve.push({ t: s.r.at, value: cum });
  }
  return {
    total: records.length,
    settled: scored.length,
    pending,
    unavailable,
    metrics,
    ci: wilson(hits, scored.length),
    base: { n: withBase.length, accuracy: baseM.accuracy, brier: baseM.brier },
    hourly,
    follow: { n: trades.length, wins, totalYen: cum, avgYen: trades.length ? cum / trades.length : null, maxDD: maxDrawdown([0, ...curve.map((c) => c.value)]), curve },
  };
}

/** 記録の CSV（表計算や別のチャットで分析する用） */
export function recordsCsv(records: PredictionRecord[]): string {
  const t = (ms: number) => new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const head = ["分析日時", "分析時点の価格", "モデル", "相場状態", "時間帯", "5分足ATR(pips)", "スプレッド"];
  for (const h of [5, 10]) head.push(`${h}分後_予測`, `${h}分後_上昇%`, `${h}分後_横ばい%`, `${h}分後_下降%`, `${h}分後_横ばい幅`, `${h}分後_実際の価格`, `${h}分後_結果`);
  const rows = records.map((r) => {
    const cols: (string | number)[] = [t(r.at), r.price.toFixed(3), r.modelVersion, r.regime, r.session, r.atrPips, "未使用"];
    for (const h of [5, 10] as Horizon[]) {
      const x = r.horizons[h];
      const o = outcomeAt(r, h);
      cols.push(x.direction, x.percents.up, x.percents.flat, x.percents.down, x.bandPips, r.actual[h]?.toFixed(3) ?? "",
        o.status === "settled" ? `${o.actual}${o.hit ? "(的中)" : "(外れ)"}` : o.status === "pending" ? "判定待ち" : "取得できず");
    }
    return cols.join(",");
  });
  return "﻿" + [head.join(","), ...rows].join("\n");
}
