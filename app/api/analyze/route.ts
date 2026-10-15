// ブラウザからの「この足で分析して」に答える窓口。Claude API はここからだけ呼びます。
// 使いすぎを防ぐため、連打の制限・1日の上限・同じ足の結果の使い回しをしています。

import { NextResponse } from "next/server";
import { HORIZON_MINUTES, PAIR, isHorizon } from "@/lib/config";
import type { Candle } from "@/lib/types";
import type { AnalyzeRequest, AnalyzeResponse } from "@/lib/analysisTypes";
import { AnalyzeError, analyzeWithClaude, DEFAULT_MODEL } from "@/lib/server/claudeAnalyzer";

export const dynamic = "force-dynamic";

/** 前回の呼び出しからこの時間は次を受け付けない */
const COOLDOWN_MS = 5_000;
/** 受け取る足の上限（それ以上は古い方を捨てる） */
const MAX_CANDLES = 200;

const usage = { day: "", count: 0, lastAt: 0 };
const cache = new Map<string, Extract<AnalyzeResponse, { ok: true }>>();

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fail(
      "no_key",
      "Anthropic のAPIキーが設定されていません。.env.local に ANTHROPIC_API_KEY=（キー）を書き、サーバーを再起動してください。",
      503,
    );
  }
  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const dailyLimit = Number(process.env.CLAUDE_DAILY_LIMIT) || 200;

  let body: AnalyzeRequest;
  try {
    body = (await req.json()) as AnalyzeRequest;
  } catch {
    return fail("bad_request", "リクエストの形式が正しくありません。", 400);
  }
  const candles = sanitize(body?.candles);
  if (candles.length < 20) {
    return fail("bad_request", "分析には20本以上のローソク足が必要です。", 400);
  }
  const dataKind = body.dataKind === "live" ? "live" : "demo";
  // FX分析画面は 5/10/15/30分、ハイロー検証画面は判定時刻までの分数（1〜360分）
  const h = body.horizonMinutes;
  const horizonMinutes =
    isHorizon(h) ? h : typeof h === "number" && Number.isInteger(h) && h >= 1 && h <= 360 ? h : HORIZON_MINUTES;
  const strike =
    typeof body.strike === "number" && Number.isFinite(body.strike) && body.strike > 0 ? Math.round(body.strike * 1000) / 1000 : undefined;
  const last = candles[candles.length - 1];

  // 同じ足・同じモデルの分析は使い回す（費用を抑える）
  const key = `${dataKind}:${model}:${horizonMinutes}:${strike ?? "-"}:${last.time}:${last.close}`;
  const hit = cache.get(key);
  if (hit) return NextResponse.json({ ...hit, cached: true } satisfies AnalyzeResponse);

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (usage.day !== today) {
    usage.day = today;
    usage.count = 0;
  }
  if (usage.count >= dailyLimit) {
    return fail(
      "daily_limit",
      `今日の Claude 分析の上限（${dailyLimit}回）に達しました。上限は .env.local の CLAUDE_DAILY_LIMIT で変えられます。`,
      429,
    );
  }
  if (now - usage.lastAt < COOLDOWN_MS) {
    return fail("too_soon", "続けて分析するときは、数秒あけてください。", 429);
  }
  usage.lastAt = now;
  usage.count += 1;

  try {
    const result = await analyzeWithClaude({
      apiKey,
      model,
      pair: PAIR,
      horizonMinutes,
      candles,
      dataKind,
      strike,
    });
    const res: Extract<AnalyzeResponse, { ok: true }> = { ok: true, result, model, cached: false };
    cache.set(key, res);
    if (cache.size > 100) cache.delete(cache.keys().next().value as string);
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof AnalyzeError) {
      const status = e.code === "rate_limit" ? 429 : e.code === "overloaded" ? 503 : 502;
      return fail(e.code, e.message, status);
    }
    return fail("network", "分析中に予期しないエラーが起きました。", 500);
  }
}

/** 受け取った足を検証して、時刻順にそろえる */
function sanitize(input: unknown): Candle[] {
  if (!Array.isArray(input)) return [];
  const out: Candle[] = [];
  for (const c of input.slice(-MAX_CANDLES)) {
    if (!c || typeof c !== "object") continue;
    const { time, open, high, low, close } = c as Record<string, unknown>;
    const v = [time, open, high, low, close];
    if (!v.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    out.push({ time: time as number, open: open as number, high: high as number, low: low as number, close: close as number });
  }
  return out.sort((a, b) => a.time - b.time);
}

function fail(code: Extract<AnalyzeResponse, { ok: false }>["error"]["code"], message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } } satisfies AnalyzeResponse, { status });
}
