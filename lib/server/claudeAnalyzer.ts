// Claude API でローソク足を分析する処理（サーバー専用）
// APIキーはここでだけ使い、ブラウザには送りません。
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { Candle, Direction, DirectionScores } from "../types";
import type { AnalysisResult } from "../analyzer";
import type { AnalyzeErrorCode } from "../analysisTypes";
import { PIP } from "../config";
import { rsi, sma } from "../indicators";

/** 既定のモデル。.env.local の CLAUDE_MODEL で変更できる */
export const DEFAULT_MODEL = "claude-haiku-5-5";

/** Claude に渡す足の本数 */
const INPUT_CANDLES = 60;

export class AnalyzeError extends Error {
  constructor(
    public code: AnalyzeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// Claude に返してもらう JSON の形
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    direction: {
      type: "string",
      enum: ["up", "down", "hold"],
      description: "指定された時間後の終値の方向。根拠が弱いときは hold。",
    },
    up: { type: "integer", description: "上昇の見込み（0〜100）。up+down+hold=100" },
    down: { type: "integer", description: "下落の見込み（0〜100）" },
    hold: { type: "integer", description: "判断保留・横ばいの見込み（0〜100）" },
    reasons: {
      type: "array",
      items: { type: "string" },
      description: "判断の理由。日本語で2〜4項目。各1文、データの数値に触れる。",
    },
  },
  required: ["direction", "up", "down", "hold", "reasons"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `あなたは為替の短期値動きを分析するアシスタントです。個人の学習・検証用アプリの中で使われます。
与えられた USD/JPY の1分足データだけをもとに、指定された時間後の終値が、最後の足の終値と比べて上がるか下がるかを判断します。

守ること:
- 判断材料は与えられたデータと指標だけです。ニュース・経済指標・要人発言など、データにない情報を推測で持ち込まないでください。
- 数分先の為替はほぼランダムに近く、どんな分析でも外れることが多いと理解したうえで、正直に判断してください。
- 方向を示す根拠が弱い、相反する、値動きが小さすぎるときは "hold"（判断保留）を選んでください。無理に方向を決める必要はありません。
- up/down/hold の数値は合計100にし、あなたの主観的な見込みとして控えめにつけてください。どれかを80以上にするのは、非常に明確な根拠がある場合だけです。
- direction は up/down/hold のうち最も数値が大きいものと一致させてください。
- reasons は日本語で2〜4項目。各項目は1文で、データ中の具体的な数値（pips、RSI など）に触れてください。
- 売買の推奨、エントリーや損切りの指示は書かないでください。`;

export async function analyzeWithClaude(opts: {
  apiKey: string;
  model: string;
  pair: string;
  horizonMinutes: number;
  candles: Candle[];
  dataKind: "demo" | "live";
  strike?: number;
}): Promise<AnalysisResult> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    // テスト用に接続先を差し替えられる（通常は設定不要）
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    timeout: 30_000,
    maxRetries: 1,
  });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: opts.model,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(opts) }],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    });
  } catch (e) {
    throw toAnalyzeError(e);
  }

  if (response.stop_reason === "refusal") {
    throw new AnalyzeError("bad_output", "Claude がこの分析への回答を控えました。");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AnalyzeError("bad_output", "Claude の回答が途中で切れました。もう一度お試しください。");
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new AnalyzeError("bad_output", "Claude の回答に分析結果が含まれていませんでした。");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.text);
  } catch {
    throw new AnalyzeError("bad_output", "Claude の回答を読み取れませんでした。");
  }
  return normalize(raw);
}

/** Claude に渡す本文。直近の足と、計算済みの指標をまとめる */
function buildUserPrompt(opts: {
  pair: string;
  horizonMinutes: number;
  candles: Candle[];
  dataKind: "demo" | "live";
  strike?: number;
}): string {
  const candles = opts.candles.slice(-INPUT_CANDLES);
  const closes = opts.candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const pips = (n: number) => (n / PIP).toFixed(1);

  const sma5 = sma(closes, 5);
  const sma20 = sma(closes, 20);
  const rsi14 = rsi(closes, 14);
  const ago = (n: number) => (closes.length > n ? closes[closes.length - 1 - n] : null);
  const m5 = ago(5);
  const m15 = ago(15);
  const recent = candles.slice(-15);
  const avgRange = recent.reduce((s, c) => s + (c.high - c.low), 0) / Math.max(recent.length, 1);
  const hi = Math.max(...candles.map((c) => c.high));
  const lo = Math.min(...candles.map((c) => c.low));

  const fmtTime = (t: number) => new Date(t).toISOString().slice(11, 16);
  const rows = candles
    .map((c) => `${fmtTime(c.time)},${c.open.toFixed(3)},${c.high.toFixed(3)},${c.low.toFixed(3)},${c.close.toFixed(3)}`)
    .join("\n");

  const lines: (string | null)[] = [
    `通貨ペア: ${opts.pair}`,
    opts.strike !== undefined
      ? `予測したいこと: ${opts.horizonMinutes} 分後（判定時刻）のレートが、目標レート ${opts.strike.toFixed(3)} より上（up）か下（down）か。最後の終値 ${last.close.toFixed(3)} は目標レートから ${pips(last.close - opts.strike)} pips の位置`
      : `予測したいこと: 最後の足の終値 ${last.close.toFixed(3)} から ${opts.horizonMinutes} 分後の終値の方向`,
    `データの種類: ${opts.dataKind === "live" ? "実際の相場データ（1分足）" : "練習用の架空データ（1分足）"}`,
    opts.strike !== undefined
      ? "1 pip = 0.01 円。up/down の数値は「判定時刻に目標レートより上／下にある」見込み、hold は判断がつかない度合い。"
      : "1 pip = 0.01 円。±2 pips 未満の変化は「横ばい」として扱われます。",
    "",
    "## 計算済みの指標",
    sma5 !== null && sma20 !== null
      ? `- 移動平均 5本: ${sma5.toFixed(3)} / 20本: ${sma20.toFixed(3)}（差 ${pips(sma5 - sma20)} pips）`
      : null,
    rsi14 !== null ? `- RSI(14): ${rsi14.toFixed(1)}` : null,
    m5 !== null ? `- 直近5分の変化: ${pips(last.close - m5)} pips` : null,
    m15 !== null ? `- 直近15分の変化: ${pips(last.close - m15)} pips` : null,
    `- 直近15本の平均値幅（高値-安値）: ${pips(avgRange)} pips`,
    `- 表示期間の高値 ${hi.toFixed(3)} / 安値 ${lo.toFixed(3)}（最後の終値は高値から ${pips(hi - last.close)} pips、安値から ${pips(last.close - lo)} pips）`,
    "",
    `## 直近${candles.length}本の1分足（時刻はUTC、古い順）`,
    "time,open,high,low,close",
    rows,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/** Claude の回答を検証し、画面で使える形にそろえる */
function normalize(raw: unknown): AnalysisResult {
  if (!raw || typeof raw !== "object") {
    throw new AnalyzeError("bad_output", "Claude の回答が想定した形ではありませんでした。");
  }
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);
  let up = num(o.up);
  let down = num(o.down);
  let hold = num(o.hold);
  const total = up + down + hold;
  if (total <= 0) {
    throw new AnalyzeError("bad_output", "Claude の回答に見込みの数値がありませんでした。");
  }
  // 合計がちょうど100になるように調整
  up = Math.round((up / total) * 100);
  down = Math.round((down / total) * 100);
  hold = 100 - up - down;
  const scores: DirectionScores = { up, down, hold };

  const dirRaw = typeof o.direction === "string" ? o.direction.toLowerCase() : "";
  let direction: Direction = dirRaw === "up" || dirRaw === "down" || dirRaw === "hold" ? dirRaw : "hold";
  // 方向と数値が食い違うときは、数値の最大を優先する
  const top = (["up", "down", "hold"] as Direction[]).reduce((a, b) => (scores[a] >= scores[b] ? a : b));
  if (scores[direction] < scores[top]) direction = top;

  const reasons = Array.isArray(o.reasons)
    ? o.reasons
        .filter((r): r is string => typeof r === "string")
        .map((r) => r.trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  if (reasons.length === 0) reasons.push("Claude から理由の説明がありませんでした。");

  return { direction, scores, reasons };
}

function toAnalyzeError(e: unknown): AnalyzeError {
  if (e instanceof Anthropic.APIError) {
    const msg = String(e.message ?? "");
    if (e.status === 401 || e.status === 403) {
      return new AnalyzeError("invalid_key", "Anthropic のAPIキーが正しくないか、権限がありません。");
    }
    if (e.status === 429) {
      return new AnalyzeError("rate_limit", "Claude API の利用回数の上限に達しました。少し待ってからお試しください。");
    }
    if (e.status === 529 || e.status === 503) {
      return new AnalyzeError("overloaded", "Claude API が混み合っています。少し待ってからお試しください。");
    }
    if (e.status === 400 && /credit|balance|billing/i.test(msg)) {
      return new AnalyzeError("no_credit", "Anthropic のクレジット残高が足りません。Claude Console で残高を確認してください。");
    }
    if (e.status === 400 || e.status === 404) {
      return new AnalyzeError("bad_request", "Claude API がリクエストを受け付けませんでした。モデル名（CLAUDE_MODEL）などの設定を確認してください。");
    }
  }
  return new AnalyzeError("network", "Claude API に接続できませんでした。通信状況を確認してください。");
}
