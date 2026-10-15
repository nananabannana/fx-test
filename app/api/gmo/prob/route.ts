// 外為オプション用：Claude に「満期に目標レートより上になる確率」を聞く
// 使いすぎ防止：連続実行は5秒あける・1日の上限（CLAUDE_DAILY_LIMIT）・同じ条件は結果を使い回す

import { NextResponse } from "next/server";
import type { Candle } from "@/lib/types";
import { AnalyzeError, DEFAULT_MODEL } from "@/lib/server/claudeAnalyzer";
import { claudeProbAbove, type ProbResult } from "@/lib/server/claudeProb";

export const dynamic = "force-dynamic";

const COOLDOWN_MS = 5_000;
const usage = { day: "", count: 0, lastAt: 0 };
const cache = new Map<string, ProbResult & { model: string }>();

export type GmoProbResponse =
  | { ok: true; probAbove: number; reasons: string[]; model: string; cached: boolean }
  | { ok: false; error: { code: string; message: string } };

const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ ok: false, error: { code, message } } satisfies GmoProbResponse, { status });

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail("no_key", "Anthropic のAPIキーが設定されていません。.env.local に ANTHROPIC_API_KEY を書いて再起動してください。", 503);
  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const dailyLimit = Number(process.env.CLAUDE_DAILY_LIMIT) || 200;

  let body: { candles?: unknown; strike?: unknown; minutesLeft?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", "リクエストの形式が正しくありません。", 400);
  }
  const candles = sanitize(body.candles);
  const strike = typeof body.strike === "number" && Number.isFinite(body.strike) && body.strike > 0 ? body.strike : null;
  const minutesLeft = typeof body.minutesLeft === "number" && body.minutesLeft > 0 && body.minutesLeft <= 240 ? body.minutesLeft : null;
  if (candles.length < 30) return fail("bad_request", "確率の見積もりには30本以上の1分足が必要です。", 400);
  if (strike === null || minutesLeft === null) return fail("bad_request", "目標レートと満期までの時間を確認してください。", 400);

  const last = candles[candles.length - 1];
  const key = `${model}:${last.time}:${strike.toFixed(3)}:${Math.round(minutesLeft)}`;
  const hit = cache.get(key);
  if (hit) return NextResponse.json({ ok: true, ...hit, cached: true } satisfies GmoProbResponse);

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (usage.day !== today) Object.assign(usage, { day: today, count: 0 });
  if (usage.count >= dailyLimit) return fail("daily_limit", `今日の Claude の上限（${dailyLimit}回）に達しました。`, 429);
  if (now - usage.lastAt < COOLDOWN_MS) return fail("too_soon", "続けて聞くときは、数秒あけてください。", 429);
  usage.lastAt = now;
  usage.count++;

  try {
    const r = await claudeProbAbove({ apiKey, model, candles, strike, minutesLeft });
    cache.set(key, { ...r, model });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return NextResponse.json({ ok: true, ...r, model, cached: false } satisfies GmoProbResponse);
  } catch (e) {
    if (e instanceof AnalyzeError) return fail(e.code, e.message, e.code === "rate_limit" ? 429 : 502);
    return fail("network", "予期しないエラーが起きました。", 500);
  }
}

function sanitize(input: unknown): Candle[] {
  if (!Array.isArray(input)) return [];
  const out: Candle[] = [];
  for (const c of input.slice(-200)) {
    if (!c || typeof c !== "object") continue;
    const { time, open, high, low, close } = c as Record<string, unknown>;
    if (![time, open, high, low, close].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    out.push({ time: time as number, open: open as number, high: high as number, low: low as number, close: close as number });
  }
  return out.sort((a, b) => a.time - b.time);
}
