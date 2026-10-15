// 予測モデルの結果を Claude に「説明だけ」してもらう（サーバー専用）
// Claude には方向・確率を決めさせない。モデルの数値を渡し、それを言葉で説明させる。
// 回答に、渡していない％の数値が出てきたら、その文は捨てる（根拠のない確率を足させないため）。
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { AnalyzeError } from "./claudeAnalyzer";
import type { Explanation, PredictRun } from "../predict/types";
import { REGIME_LABEL, describeFeature, FEATURE_LABEL } from "../predict/features";
import { CLASS_LABEL } from "../predict/evaluate";
import { SESSION_LABEL } from "../conditions";

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "相場状態と予測モデルの結果の要約（日本語2〜3文）" },
    points: { type: "array", items: { type: "string" }, description: "根拠になった指標の解説（日本語、2〜4項目、各1文）" },
    cautions: { type: "array", items: { type: "string" }, description: "注意事項（日本語、1〜3項目、各1文）" },
  },
  required: ["summary", "points", "cautions"],
  additionalProperties: false,
} as const;

const SYSTEM = `あなたは為替の分析アプリで、数値モデルの結果を日本語で説明する係です。

役割はこれだけです：
- テクニカル指標の意味を解説する
- 相場状態を要約する
- 予測モデルが出した結果を、わかりやすい言葉で説明する
- 注意事項を伝える

必ず守ること：
- 方向や確率を自分で決めない。モデルの確率・数値を変えない、言い換えない、新しい確率や％を作らない。
- 確率に触れるときは、渡された数値をそのまま使う。
- 渡されたデータにない情報（ニュース・要人発言など）を持ち込まない。
- 売買の推奨・「買い時」などの表現は書かない。利益を約束する表現も書かない。
- 確率が「暫定」と渡された場合は、そのことを必ず注意事項に入れる。`;

export function buildExplainPrompt(r: PredictRun): string {
  const lines: string[] = [
    `通貨ペア: USD/JPY`,
    `分析時点の価格: ${r.price.toFixed(3)}`,
    `相場状態（モデルの分類）: ${REGIME_LABEL[r.regime]}`,
    `時間帯: ${SESSION_LABEL[r.session]}`,
    `モデル: ${r.modelVersion}（ロジスティック回帰。過去の実データで学習し、学習に使っていない期間でテスト済み）`,
    "",
  ];
  for (const h of [5, 10] as const) {
    const p = r.horizons[h];
    lines.push(
      `## ${h}分後の予測（モデルの出力）`,
      `- 上昇 ${p.percents.up}% / 横ばい ${p.percents.flat}% / 下降 ${p.percents.down}%（一番高いもの：${CLASS_LABEL[p.direction]}）`,
      `- 横ばいの幅: ±${p.bandPips} pips 未満の変化は横ばい`,
      `- 変動幅の目安: ±${p.movePips} pips`,
      `- テスト期間の的中率: ${p.testAccuracy === null ? "不明" : Math.round(p.testAccuracy * 100) + "%"}（比較用の基準 ${p.baselineAccuracy === null ? "不明" : Math.round(p.baselineAccuracy * 100) + "%"}）`,
      `- 確率は暫定か: ${p.provisional ? "はい（" + p.provisionalReasons.join("／") + "）" : "いいえ"}`,
      `- 上昇寄り(+)・下降寄り(−)に効いた要素: ${p.contributions
        .slice(0, 4)
        .map((c) => `${c.label}（${c.effect > 0 ? "上昇寄り" : "下降寄り"}）`)
        .join("、")}`,
      "",
    );
  }
  lines.push("## 指標の値");
  for (const name of ["ret5", "ret15", "ema20dist", "rsi14", "macdHist5", "ema9_21_5", "sma20dist15", "rangePos60", "structure5", "breakout30", "efficiency60"] as const) {
    lines.push(`- ${FEATURE_LABEL[name]}: ${describeFeature(name, r.raw)}`);
  }
  lines.push(`- 1分足ATR(14): ${r.raw.atr1Pips} pips / 5分足ATR(14): ${r.raw.atr5Pips} pips / 15分足ATR(14): ${r.raw.atr15Pips} pips`);
  if (r.events.length) lines.push("", "## 近くの指標発表", ...r.events.map((e) => `- ${e.name}`));
  lines.push("", "## アプリが出している注意事項", ...r.cautions.map((c) => `- ${c}`));
  return lines.join("\n");
}

/** 渡した数値にない「◯%」を含む文を捨てる */
export function guardPercents(text: string, allowed: Set<number>): boolean {
  const re = /(\d+(?:\.\d+)?)\s*[%％]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!allowed.has(Math.round(Number(m[1])))) return false;
  }
  return true;
}

export function allowedPercents(r: PredictRun): Set<number> {
  const s = new Set<number>();
  for (const h of [5, 10] as const) {
    const p = r.horizons[h];
    Object.values(p.percents).forEach((v) => s.add(v));
    if (p.testAccuracy !== null) s.add(Math.round(p.testAccuracy * 100));
    if (p.baselineAccuracy !== null) s.add(Math.round(p.baselineAccuracy * 100));
  }
  s.add(Math.round(r.raw.rangePos60 * 100));
  return s;
}

export async function explainRun(opts: { apiKey: string; model: string; run: PredictRun }): Promise<Explanation> {
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: process.env.ANTHROPIC_BASE_URL || undefined, timeout: 30_000, maxRetries: 1 });
  let res: Anthropic.Message;
  try {
    res = await client.messages.create({
      model: opts.model,
      max_tokens: 900,
      system: SYSTEM,
      messages: [{ role: "user", content: buildExplainPrompt(opts.run) }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      const msg = String(e.message ?? "");
      if (e.status === 401 || e.status === 403) throw new AnalyzeError("invalid_key", "Anthropic のAPIキーが正しくないか、権限がありません。");
      if (e.status === 429) throw new AnalyzeError("rate_limit", "Claude API の回数制限にかかりました。少し待ってからお試しください。");
      if (e.status === 529 || e.status === 503) throw new AnalyzeError("overloaded", "Claude API が混み合っています。少し待ってからお試しください。");
      if (e.status === 400 && /credit|balance|billing/i.test(msg)) throw new AnalyzeError("no_credit", "Anthropic のクレジット残高が足りません。");
    }
    throw new AnalyzeError("network", "Claude API に接続できませんでした。");
  }
  const text = res.content.find((b) => b.type === "text");
  if (res.stop_reason !== "end_turn" || !text || text.type !== "text") throw new AnalyzeError("bad_output", "Claude の説明を最後まで受け取れませんでした。");
  let o: { summary?: unknown; points?: unknown; cautions?: unknown };
  try {
    o = JSON.parse(text.text);
  } catch {
    throw new AnalyzeError("bad_output", "Claude の説明を読み取れませんでした。");
  }
  const allowed = allowedPercents(opts.run);
  let removed = 0;
  const keep = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : [])
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.slice(0, 240))
      .filter((s) => (guardPercents(s, allowed) ? true : (removed++, false)))
      .slice(0, max);
  const summaryRaw = typeof o.summary === "string" ? o.summary.slice(0, 400) : "";
  const summary = guardPercents(summaryRaw, allowed) ? summaryRaw : (removed++, "");
  return { summary, points: keep(o.points, 4), cautions: keep(o.cautions, 3), removed };
}
