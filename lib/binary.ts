// ハイロー（バイナリー）検証の計算
//
// 価格の決まり方は2種類
// - 購入価格方式（国内のラダー型など）：1枚を P 円で買い、当たれば 1,000 円、外れれば 0 円
//     → 損益分岐の勝率 = P ÷ 1,000
// - 倍率方式（海外のハイローなど）：投資額 S 円、当たれば S × 倍率、外れれば 0 円
//     → 損益分岐の勝率 = 1 ÷ 倍率
// 判定：判定時刻のレートが目標レートより上なら HIGH の勝ち、下なら LOW の勝ち。同値は負けとして扱う（保守的）

export type BinaryDirection = "high" | "low";
export type BinaryKind = "ladder" | "highlow";
export type BinaryStatus = "pending" | "won" | "lost" | "unavailable";

export type Pricing =
  | { mode: "price"; price: number } // 1枚の購入価格（円）。満額 1,000 円
  | { mode: "multiplier"; multiplier: number; stake: number }; // 倍率と1回の投資額（円）

export const PAYOUT = 1000;

export type BinaryRecord = {
  id: string;
  createdAt: number;
  kind: BinaryKind;
  direction: BinaryDirection;
  /** 目標レート（ハイロー型は記録時の現在値） */
  strike: number;
  /** 記録した時点のレート */
  entryRate: number;
  /** 判定時刻（ミリ秒、分単位ちょうど） */
  judgeAt: number;
  pricing: Pricing;
  units: number;
  ai?: { up: number; down: number; hold: number; direction: "up" | "down" | "hold"; reasons: string[]; model: string };
  status: BinaryStatus;
  settleRate?: number;
  pnlYen?: number;
  note: string;
};

/** 損益分岐の勝率（0〜1） */
export function breakeven(p: Pricing): number | null {
  if (p.mode === "price") return p.price > 0 && p.price < PAYOUT ? p.price / PAYOUT : null;
  return p.multiplier > 1 ? 1 / p.multiplier : null;
}

/** 1回あたり（枚数込み）の勝ち・負けの損益 */
export function payoff(p: Pricing, units: number): { win: number; lose: number } {
  if (p.mode === "price") return { win: (PAYOUT - p.price) * units, lose: -p.price * units };
  return { win: p.stake * (p.multiplier - 1), lose: -p.stake };
}

/** 勝率 w のときの1回あたりの期待値（円） */
export function expectedValue(p: Pricing, units: number, w: number): number {
  const { win, lose } = payoff(p, units);
  return w * win + (1 - w) * lose;
}

/** 判定レートで勝ち負けを決める */
export function settle(r: BinaryRecord, rate: number): BinaryRecord {
  const won = r.direction === "high" ? rate > r.strike : rate < r.strike;
  const { win, lose } = payoff(r.pricing, r.units);
  return { ...r, status: won ? "won" : "lost", settleRate: rate, pnlYen: won ? win : lose };
}

/** 勝率の95%信頼区間（ウィルソン法）。件数が少ないときも極端になりにくい */
export function wilson(wins: number, n: number): { low: number; high: number } | null {
  if (n === 0) return null;
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export type BinaryStats = {
  settled: number;
  wins: number;
  winRate: number | null;
  ci: { low: number; high: number } | null;
  avgBreakeven: number | null;
  totalPnl: number;
  evPerTrade: number | null;
  verdict: "above" | "below" | "unclear" | "none";
  /** 今の勝率が続くとして、損益分岐との差を見分けるのに必要なおおよその件数 */
  neededN: number | null;
};

export function stats(records: BinaryRecord[]): BinaryStats {
  const done = records.filter((r) => r.status === "won" || r.status === "lost");
  const wins = done.filter((r) => r.status === "won").length;
  const n = done.length;
  const bes = done.map((r) => breakeven(r.pricing)).filter((v): v is number => v !== null);
  const avgBreakeven = bes.length ? bes.reduce((a, b) => a + b, 0) / bes.length : null;
  const totalPnl = done.reduce((s, r) => s + (r.pnlYen ?? 0), 0);
  const winRate = n ? wins / n : null;
  const ci = wilson(wins, n);

  let verdict: BinaryStats["verdict"] = "none";
  let neededN: number | null = null;
  if (ci && avgBreakeven !== null && winRate !== null) {
    verdict = ci.low > avgBreakeven ? "above" : ci.high < avgBreakeven ? "below" : "unclear";
    const diff = Math.abs(winRate - avgBreakeven);
    if (verdict === "unclear" && diff > 0.005) {
      neededN = Math.ceil((1.96 * 1.96 * winRate * (1 - winRate)) / (diff * diff));
    }
  }
  return { settled: n, wins, winRate, ci, avgBreakeven, totalPnl, evPerTrade: n ? totalPnl / n : null, verdict, neededN };
}

/** 記録を CSV にする（別のチャットや表計算で分析する用） */
export function toCsv(records: BinaryRecord[]): string {
  const head = [
    "記録日時", "種類", "方向", "目標レート", "記録時レート", "判定時刻", "価格方式", "購入価格/倍率", "投資額", "枚数",
    "損益分岐勝率", "AI上", "AI下", "AI保留", "結果", "判定レート", "損益(円)", "メモ",
  ];
  const t = (ms: number) => new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const rows = records.map((r) => {
    const be = breakeven(r.pricing);
    return [
      t(r.createdAt), r.kind === "ladder" ? "ラダー" : "ハイロー", r.direction === "high" ? "HIGH" : "LOW",
      r.strike.toFixed(3), r.entryRate.toFixed(3), t(r.judgeAt),
      r.pricing.mode === "price" ? "購入価格" : "倍率",
      r.pricing.mode === "price" ? r.pricing.price : r.pricing.multiplier,
      r.pricing.mode === "price" ? r.pricing.price * r.units : r.pricing.stake,
      r.units, be === null ? "" : (be * 100).toFixed(1) + "%",
      r.ai?.up ?? "", r.ai?.down ?? "", r.ai?.hold ?? "",
      { pending: "判定待ち", won: "勝ち", lost: "負け", unavailable: "判定不可" }[r.status],
      r.settleRate?.toFixed(3) ?? "", r.pnlYen ?? "", r.note.replace(/[\r\n,]/g, " "),
    ].join(",");
  });
  return "﻿" + [head.join(","), ...rows].join("\n");
}

/** 次の「2時間ごと」の判定時刻（偶数時ちょうど、日本時間）。最低 margin 分は先にする */
export function nextEvenHour(now: number, marginMin = 5): number {
  const jst = 9 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  let t = Math.ceil((now + jst + marginMin * 60_000) / hour) * hour;
  if (((t / hour) % 2) !== 0) t += hour;
  return t - jst;
}
