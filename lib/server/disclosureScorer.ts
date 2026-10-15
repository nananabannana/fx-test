// Claude による開示スコア（サーバー専用）
// 渡すのは比率・変化率だけで、会社名・コード・日付・金額は渡さない（匿名化）。
// 理由：過去の開示を採点するとき、Claude がその後の株価の動きを学習データで知っていると、
//       バックテストが実力以上に良く見えてしまうため。
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { DisclosureFeatures, SubScores } from "../stocks/types";
import { KIND_LABEL, pct } from "../stocks/features";
import { DEFAULT_MODEL } from "./claudeAnalyzer";

/** プロンプトを変えたら上げる（古いスコアと区別して比べられるように） */
export const PROMPT_VERSION = "v1";

export class ScoreError extends Error {
  constructor(
    public code: "no_key" | "invalid_key" | "no_credit" | "rate_limit" | "overloaded" | "bad_output" | "network",
    message: string,
  ) {
    super(message);
  }
}

const SCHEMA = {
  type: "object",
  properties: {
    revision: { type: "integer", description: "業績予想の修正・着地（-2〜+2）" },
    guidance: { type: "integer", description: "来期予想・ガイダンスの強弱（-2〜+2）。該当なしは0" },
    dividend: { type: "integer", description: "増配・減配（-2〜+2）" },
    growth: { type: "integer", description: "前年同期比の成長（-2〜+2）" },
    progress: { type: "integer", description: "通期予想に対する進捗（-2〜+2）。該当なしは0" },
    overall: { type: "integer", description: "総合スコア（-10〜+10）。0が中立" },
    summary: { type: "string", description: "日本語で1〜2文の要約" },
    reasons: { type: "array", items: { type: "string" }, description: "判断の根拠（日本語、2〜4項目、数値に触れる）" },
  },
  required: ["revision", "guidance", "dividend", "growth", "progress", "overall", "summary", "reasons"],
  additionalProperties: false,
} as const;

const SYSTEM = `あなたは日本株の決算・開示を読み、内容の良し悪しを点数にするアナリストです。
個人の検証用アプリで、スイングトレード（数日〜数週間）のルール検証に使われます。

採点のしかた:
- 各項目は -2（とても悪い）〜 +2（とても良い）の整数。情報がない項目は 0。
  - revision: 業績予想の上方修正・会社予想を上回る着地は＋、下方修正・未達は−
  - guidance: 来期予想が今期実績より強い（増収増益）なら＋、弱いなら−
  - dividend: 増配・配当予想の引き上げは＋、減配・引き下げは−
  - growth: 前年同期比の増収増益は＋、減収減益は−
  - progress: 通期予想に対する進捗が標準より速ければ＋、遅ければ−
- overall は -10〜+10 の整数。項目の合計をそのまま使わず、重要度（一般に 予想修正・ガイダンス ＞ 成長 ＞ 配当・進捗）を考えて決める。
- 数値が小さい変化（数%以内）は ±1 以内にとどめる。材料が少なければ 0 付近にする。

守ること:
- 与えられた数値と本文だけを根拠にする。会社名や業種を推測したり、知識から株価の反応を予想したりしない。
- 株価がどう動くかではなく、開示内容そのものの良し悪しを評価する。
- reasons は日本語で、具体的な数値（%）に触れる。売買の推奨は書かない。`;

export type ScoreOutput = {
  score: number;
  subScores: SubScores;
  summary: string;
  reasons: string[];
  model: string;
};

export async function scoreDisclosure(opts: { features: DisclosureFeatures; text?: string }): Promise<ScoreOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ScoreError("no_key", "Anthropic のAPIキーが設定されていません。.env.local に ANTHROPIC_API_KEY=（キー）を書いて再起動してください。");
  }
  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({
    apiKey,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    timeout: 60_000,
    maxRetries: 1,
  });

  let res: Anthropic.Message;
  try {
    res = await client.messages.create({
      model,
      max_tokens: 1000,
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(opts.features, opts.text) }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
  } catch (e) {
    throw toError(e);
  }
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
    throw new ScoreError("bad_output", "Claude の回答を最後まで受け取れませんでした。もう一度お試しください。");
  }
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new ScoreError("bad_output", "Claude の回答に採点結果がありませんでした。");

  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text.text);
  } catch {
    throw new ScoreError("bad_output", "Claude の回答を読み取れませんでした。");
  }
  const clampInt = (v: unknown, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.round(typeof v === "number" && Number.isFinite(v) ? v : 0)));

  return {
    model,
    score: clampInt(o.overall, -10, 10),
    subScores: {
      revision: clampInt(o.revision, -2, 2),
      guidance: clampInt(o.guidance, -2, 2),
      dividend: clampInt(o.dividend, -2, 2),
      growth: clampInt(o.growth, -2, 2),
      progress: clampInt(o.progress, -2, 2),
    },
    summary: typeof o.summary === "string" ? o.summary.slice(0, 300) : "",
    reasons: Array.isArray(o.reasons)
      ? o.reasons.filter((r): r is string => typeof r === "string").map((r) => r.slice(0, 200)).slice(0, 4)
      : [],
  };
}

function buildPrompt(f: DisclosureFeatures, text?: string): string {
  const lines: string[] = [
    `開示の種類: ${KIND_LABEL[f.kind]}${f.periodType ? `（${f.periodType}）` : ""}`,
    "",
    "## 前年同期比（実績）",
    `- 売上高: ${pct(f.yoy.sales)} / 営業利益: ${pct(f.yoy.op)} / 純利益: ${pct(f.yoy.np)}`,
    "",
    "## 今期予想の修正（直前の予想との比較。通期決算では予想に対する着地）",
    `- 売上高: ${pct(f.revision.sales)} / 営業利益: ${pct(f.revision.op)} / 純利益: ${pct(f.revision.np)} / 年間配当: ${pct(f.revision.div)}`,
  ];
  if (f.kind === "earnings" && f.periodType === "FY") {
    lines.push(
      "",
      "## 来期の会社予想（今期実績比）",
      `- 売上高: ${pct(f.guidance.sales)} / 営業利益: ${pct(f.guidance.op)} / 純利益: ${pct(f.guidance.np)} / 年間配当: ${pct(f.guidance.div)}`,
    );
  }
  if (f.progress.standard !== null) {
    lines.push(
      "",
      "## 進捗",
      `- 営業利益の通期予想に対する進捗: ${f.progress.op === null ? "—" : `${(f.progress.op * 100).toFixed(1)}%`}（標準 ${(f.progress.standard * 100).toFixed(0)}%）`,
    );
  }
  if (f.opMargin !== null) lines.push("", `営業利益率: ${(f.opMargin * 100).toFixed(1)}%`);
  lines.push("", "「—」はデータなし。");
  if (text && text.trim()) {
    lines.push("", "## 決算短信などの本文（抜粋）", text.trim().slice(0, 12_000));
  }
  return lines.join("\n");
}

function toError(e: unknown): ScoreError {
  if (e instanceof Anthropic.APIError) {
    const msg = String(e.message ?? "");
    if (e.status === 401 || e.status === 403) return new ScoreError("invalid_key", "Anthropic のAPIキーが正しくないか、権限がありません。");
    if (e.status === 429) return new ScoreError("rate_limit", "Claude API の回数制限にかかりました。少し待ってからお試しください。");
    if (e.status === 529 || e.status === 503) return new ScoreError("overloaded", "Claude API が混み合っています。少し待ってからお試しください。");
    if (e.status === 400 && /credit|balance|billing/i.test(msg)) return new ScoreError("no_credit", "Anthropic のクレジット残高が足りません。");
  }
  return new ScoreError("network", "Claude API に接続できませんでした。");
}
