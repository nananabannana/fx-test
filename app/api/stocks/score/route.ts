// 開示1件を Claude で採点して保存する
// - 本文（text）なし：匿名化した数値だけで採点 → バックテストに使える
// - 本文あり：短信本文も読ませる → 匿名でなくなるので、バックテストには使わない（画面での参考用）
import { NextResponse } from "next/server";
import { getDisclosure, getDisclosures, getLatestScores, saveScore } from "@/lib/server/stockRepo";
import { PROMPT_VERSION, scoreDisclosure } from "@/lib/server/disclosureScorer";
import { DEFAULT_MODEL } from "@/lib/server/claudeAnalyzer";
import { badRequest, errorResponse } from "@/lib/server/apiError";
import { computeFeatures } from "@/lib/stocks/features";
import type { ScoreResponse } from "@/lib/stocks/api";
import type { DisclosureScore } from "@/lib/stocks/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const usage = { day: "", count: 0 };

export async function POST(req: Request) {
  let body: { disclosureId?: unknown; text?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("リクエストの形式が正しくありません。");
  }
  if (typeof body.disclosureId !== "string" || !body.disclosureId) return badRequest("disclosureId が必要です。");
  const text = typeof body.text === "string" ? body.text.slice(0, 20_000) : "";
  const usedText = text.trim().length > 0;

  try {
    const d = await getDisclosure(body.disclosureId);
    if (!d) return badRequest("開示が見つかりません。先に銘柄のデータを取得してください。");

    const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
    const id = `${d.id}:${model}:${PROMPT_VERSION}${usedText ? ":text" : ""}`;

    // 同じ条件で採点済みなら、それを返す（料金がかからない）
    if (!usedText && body.force !== true) {
      const existing = (await getLatestScores([d.id], true)).get(d.id);
      if (existing && existing.id === id) return NextResponse.json({ ok: true, score: existing, cached: true } satisfies ScoreResponse);
    }

    const today = new Date().toISOString().slice(0, 10);
    if (usage.day !== today) Object.assign(usage, { day: today, count: 0 });
    const limit = Number(process.env.CLAUDE_SCORE_DAILY_LIMIT) || 500;
    if (usage.count >= limit) {
      return NextResponse.json(
        { ok: false, error: { code: "daily_limit", message: `今日の開示スコアの上限（${limit}回）に達しました。CLAUDE_SCORE_DAILY_LIMIT で変えられます。` } },
        { status: 429 },
      );
    }
    usage.count++;

    const all = await getDisclosures(d.code);
    const out = await scoreDisclosure({ features: computeFeatures(d, all), text: usedText ? text : undefined });
    const score: DisclosureScore = {
      id,
      disclosureId: d.id,
      model: out.model,
      promptVersion: PROMPT_VERSION,
      score: out.score,
      subScores: out.subScores,
      summary: out.summary,
      reasons: out.reasons,
      usedText,
      createdAt: new Date().toISOString(),
    };
    await saveScore(score);
    return NextResponse.json({ ok: true, score, cached: false } satisfies ScoreResponse);
  } catch (e) {
    return errorResponse(e);
  }
}
