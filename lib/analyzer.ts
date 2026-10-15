// 分析ロジック
//
// 「デモ指標」エンジン：移動平均・勢い・RSI から機械的にスコアと理由を作ります（AIは使いません）。
// Claude による分析は lib/server/claudeAnalyzer.ts と app/api/analyze/route.ts にあります。

import type { Candle, Direction, DirectionScores } from "./types";
import { PIP } from "./config";
import { rsi, sma } from "./indicators";

export type AnalysisInput = {
  pair: string;
  horizonMinutes: number;
  /** 予測時点までのローソク足（未来の足は含めない） */
  candles: Candle[];
};

export type AnalysisResult = {
  direction: Direction;
  scores: DirectionScores;
  reasons: string[];
};

export type Analyzer = (input: AnalysisInput) => Promise<AnalysisResult>;

/** スコアの最大値がこれ未満なら「判断保留」にする */
const HOLD_BELOW = 45;

export const demoAnalyzer: Analyzer = async (input) => {
  // 実際の通信の雰囲気を出すため少し待つ（デモ演出）
  await new Promise((r) => setTimeout(r, 700));
  return analyzeDemo(input);
};

/** デモ分析の本体（同期版。初期の履歴データ作成にも使う） */
export function analyzeDemo({ candles }: AnalysisInput): AnalysisResult {
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];
  const sma5 = sma(closes, 5) ?? last;
  const sma20 = sma(closes, 20) ?? last;
  const momentum = closes.length > 5 ? last - closes[closes.length - 6] : 0;
  const rsi14 = rsi(closes, 14) ?? 50;

  const maGapPips = (sma5 - sma20) / PIP;
  const momentumPips = momentum / PIP;

  // 各指標を -1〜+1 程度にそろえて合計（重みはデモ用の仮の値）
  const raw =
    clamp(maGapPips / 4, -1, 1) * 0.45 +
    clamp(momentumPips / 6, -1, 1) * 0.4 +
    clamp((50 - rsi14) / 30, -1, 1) * 0.15; // 買われすぎは下落寄り

  const scores = toScores(raw);
  const top = (Object.keys(scores) as Direction[]).reduce((a, b) =>
    scores[a] >= scores[b] ? a : b,
  );
  const direction: Direction =
    top === "hold" || scores[top] < HOLD_BELOW ? "hold" : top;

  const reasons = [
    describeMa(maGapPips),
    describeMomentum(momentumPips),
    describeRsi(rsi14),
  ];
  if (direction === "hold") {
    reasons.push(
      "シグナルの強さが基準に届かないため、方向を決めずに「判断保留」としました。",
    );
  }

  return { direction, scores, reasons };
}

/** -1〜+1 の値を、合計100の整数スコアに変換する */
function toScores(raw: number): DirectionScores {
  const strength = Math.min(Math.abs(raw), 1);
  const hold = Math.round(55 - strength * 40); // 15〜55
  const rest = 100 - hold;
  const lean = 0.5 + Math.sign(raw) * strength * 0.4; // 0.1〜0.9
  const up = Math.round(rest * lean);
  const down = rest - up;
  return { up, down, hold };
}

function describeMa(gap: number): string {
  const g = gap.toFixed(1);
  if (gap > 0.5) return `短期移動平均（5本）が中期（20本）を ${g} pips 上回っており、短期的には上向きです。`;
  if (gap < -0.5) return `短期移動平均（5本）が中期（20本）を ${Math.abs(gap).toFixed(1)} pips 下回っており、短期的には下向きです。`;
  return `短期と中期の移動平均がほぼ重なっていて（差 ${g} pips）、方向感は弱めです。`;
}

function describeMomentum(pips: number): string {
  const p = Math.abs(pips).toFixed(1);
  if (pips > 1) return `直近5分で ${p} pips 上昇しています。`;
  if (pips < -1) return `直近5分で ${p} pips 下落しています。`;
  return `直近5分の値動きは ${p} pips と小さく、勢いは目立ちません。`;
}

function describeRsi(v: number): string {
  const r = v.toFixed(0);
  if (v >= 70) return `RSI(14) が ${r} と高く、買われすぎによる反落の可能性も考慮しました。`;
  if (v <= 30) return `RSI(14) が ${r} と低く、売られすぎによる反発の可能性も考慮しました。`;
  return `RSI(14) は ${r} で、過熱感はありません。`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
