// Claude によるモデル結果の説明。サーバーが保存した予測結果（id）だけを説明させる（ブラウザから数値は受け取らない）。
import { NextResponse } from "next/server";
import { getRun } from "@/lib/server/predictService";
import { explainRun } from "@/lib/server/predictExplain";
import { AnalyzeError, DEFAULT_MODEL } from "@/lib/server/claudeAnalyzer";
import type { ExplainResult } from "@/lib/predict/types";

export const dynamic = "force-dynamic";

const usage = { day: "", count: 0, lastAt: 0 };
const cache = new Map<string, Extract<ExplainResult, { ok: true }>>();

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail("no_key", "Anthropic のAPIキーが設定されていません（説明なしでも予測は使えます）。", 503);
  let id: unknown;
  try {
    id = ((await req.json()) as { id?: unknown })?.id;
  } catch {
    id = null;
  }
  if (typeof id !== "string" || id.length > 100) return fail("bad_request", "リクエストの形式が正しくありません。", 400);
  const run = getRun(id);
  if (!run) return fail("not_found", "その予測結果が見つかりません。もう一度「AI分析を実行」してください。", 404);
  const hit = cache.get(id);
  if (hit) return NextResponse.json({ ...hit, cached: true } satisfies ExplainResult);

  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const limit = Number(process.env.CLAUDE_DAILY_LIMIT) || 200;
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (usage.day !== today) Object.assign(usage, { day: today, count: 0 });
  if (now - usage.lastAt < 5_000) return fail("cooldown", "連続実行は5秒あけてください。", 429);
  if (usage.count >= limit) return fail("daily_limit", `Claude の1日の上限（${limit}回）に達しました。`, 429);
  usage.lastAt = now;
  usage.count++;
  try {
    const explanation = await explainRun({ apiKey, model, run });
    const body = { ok: true as const, explanation, model, cached: false };
    cache.set(id, body);
    return NextResponse.json(body satisfies ExplainResult);
  } catch (e) {
    const err = e instanceof AnalyzeError ? e : new AnalyzeError("network", "Claude API に接続できませんでした。");
    console.error("[predict/explain]", err.code);
    return fail(err.code, err.message, err.code === "rate_limit" ? 429 : 502);
  }
}

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } } satisfies ExplainResult, { status });
}
