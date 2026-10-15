// Claude に「満期に目標レートより上になる確率」を聞く（サーバー専用）
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { Candle } from "../types";
import { PIP } from "../config";
import { rsi, sma } from "../indicators";
import { volatilityPerMinute } from "../gmoOption";
import { AnalyzeError } from "./claudeAnalyzer";

const SCHEMA = {
  type: "object",
  properties: {
    prob_above: { type: "integer", description: "満期の判定レートが目標レートより上になる確率（0〜100の整数、%）" },
    reasons: { type: "array", items: { type: "string" }, description: "判断の根拠。日本語で2〜4項目、各1文、数値に触れる" },
  },
  required: ["prob_above", "reasons"],
  additionalProperties: false,
} as const;

const SYSTEM = `あなたは為替の短期の値動きを確率で見積もるアシスタントです。個人の検証用アプリで使われ、あなたの見積もりは後で実際の結果と照合され、確率としての正確さ（較正）を評価されます。

やること：
- USD/JPY の満期（判定時刻）に、レートが目標レートより上にある確率を 0〜100 の整数で答える。

守ること：
- 判断材料は与えられたデータだけ。ニュースや経済指標など、データにない情報を推測で持ち込まない。
- 数時間以内の為替はランダムに近い。現在値と目標レートの距離、満期までの時間、これまでの値動きの大きさ（ボラティリティ）が最も重要な要素であることを踏まえる。
- 勢いなどの方向感は、明確なときだけ小さく反映する。根拠のない自信は較正を悪くする。
- 現在値が目標レートちょうどで方向感がなければ 50 付近になる。
- reasons は日本語で2〜4項目。具体的な数値（pips、分、RSI など）に触れる。売買の推奨は書かない。`;

export type ProbResult = { probAbove: number; reasons: string[] };

export async function claudeProbAbove(opts: {
  apiKey: string;
  model: string;
  candles: Candle[];
  strike: number;
  minutesLeft: number;
}): Promise<ProbResult> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    timeout: 30_000,
    maxRetries: 1,
  });

  let res: Anthropic.Message;
  try {
    res = await client.messages.create({
      model: opts.model,
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(opts) }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
  } catch (e) {
    throw toError(e);
  }
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
    throw new AnalyzeError("bad_output", "Claude の回答を最後まで受け取れませんでした。もう一度お試しください。");
  }
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new AnalyzeError("bad_output", "Claude の回答に確率がありませんでした。");
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text.text);
  } catch {
    throw new AnalyzeError("bad_output", "Claude の回答を読み取れませんでした。");
  }
  const raw = typeof o.prob_above === "number" && Number.isFinite(o.prob_above) ? o.prob_above : null;
  if (raw === null) throw new AnalyzeError("bad_output", "Claude の回答に確率の数値がありませんでした。");
  // 0%・100% は照合で極端な誤差になるので 1〜99% に収める
  const probAbove = Math.min(99, Math.max(1, Math.round(raw))) / 100;
  const reasons = Array.isArray(o.reasons)
    ? o.reasons.filter((r): r is string => typeof r === "string").map((r) => r.slice(0, 200)).slice(0, 4)
    : [];
  return { probAbove, reasons };
}

function buildPrompt(opts: { candles: Candle[]; strike: number; minutesLeft: number }): string {
  const candles = opts.candles.slice(-60);
  const closes = opts.candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const pips = (n: number) => (n / PIP).toFixed(1);
  const sigma = volatilityPerMinute(closes);
  const sigmaPips = sigma !== null ? (sigma * last.close) / PIP : null;
  const sma20 = sma(closes, 20);
  const rsi14 = rsi(closes, 14);
  const ago = (n: number) => (closes.length > n ? closes[closes.length - 1 - n] : null);
  const m15 = ago(15);
  const m60 = ago(60);
  const hi = Math.max(...candles.map((c) => c.high));
  const lo = Math.min(...candles.map((c) => c.low));
  const fmt = (t: number) => new Date(t).toISOString().slice(11, 16);

  const lines: (string | null)[] = [
    "通貨ペア: USD/JPY",
    `現在値（直近の確定1分足の終値）: ${last.close.toFixed(3)}`,
    `目標レート: ${opts.strike.toFixed(3)}（現在値は目標レートより ${pips(last.close - opts.strike)} pips ${last.close >= opts.strike ? "上" : "下"}）`,
    `満期まで: ${Math.round(opts.minutesLeft)} 分`,
    "1 pip = 0.01 円。",
    "",
    "## 直近の値動き",
    sigmaPips !== null ? `- 1分あたりの変動の大きさ（標準偏差）: ${sigmaPips.toFixed(2)} pips` : null,
    sigmaPips !== null ? `- そのまま満期まで続いた場合の変動の目安（1標準偏差）: ±${(sigmaPips * Math.sqrt(opts.minutesLeft)).toFixed(1)} pips` : null,
    m15 !== null ? `- 直近15分の変化: ${pips(last.close - m15)} pips` : null,
    m60 !== null ? `- 直近60分の変化: ${pips(last.close - m60)} pips` : null,
    sma20 !== null ? `- 20分移動平均: ${sma20.toFixed(3)}（現在値との差 ${pips(last.close - sma20)} pips）` : null,
    rsi14 !== null ? `- RSI(14): ${rsi14.toFixed(1)}` : null,
    `- 直近${candles.length}分の高値 ${hi.toFixed(3)} / 安値 ${lo.toFixed(3)}`,
    "",
    `## 直近${candles.length}本の1分足（時刻はUTC、古い順）`,
    "time,open,high,low,close",
    candles.map((c) => `${fmt(c.time)},${c.open.toFixed(3)},${c.high.toFixed(3)},${c.low.toFixed(3)},${c.close.toFixed(3)}`).join("\n"),
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

function toError(e: unknown): AnalyzeError {
  if (e instanceof Anthropic.APIError) {
    const msg = String(e.message ?? "");
    if (e.status === 401 || e.status === 403) return new AnalyzeError("invalid_key", "Anthropic のAPIキーが正しくないか、権限がありません。");
    if (e.status === 429) return new AnalyzeError("rate_limit", "Claude API の回数制限にかかりました。少し待ってからお試しください。");
    if (e.status === 529 || e.status === 503) return new AnalyzeError("overloaded", "Claude API が混み合っています。少し待ってからお試しください。");
    if (e.status === 400 && /credit|balance|billing/i.test(msg)) return new AnalyzeError("no_credit", "Anthropic のクレジット残高が足りません。");
    if (e.status === 400 || e.status === 404) return new AnalyzeError("bad_request", "Claude API がリクエストを受け付けませんでした。");
  }
  return new AnalyzeError("network", "Claude API に接続できませんでした。");
}
