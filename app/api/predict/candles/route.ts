// 短期予測画面のチャート用：直近420本の確定1分足（約50秒使い回す）
import { NextResponse } from "next/server";
import { getRecent, toPredictError } from "@/lib/server/predictService";
import type { CandlesResult } from "@/lib/predict/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const p = await getRecent();
    return json({ ok: true, ...p });
  } catch (e) {
    const err = toPredictError(e);
    return json({ ok: false, error: { code: err.code, message: err.message } }, err.code === "rate_limit" ? 429 : err.code === "no_key" ? 503 : 502);
  }
}

function json(body: CandlesResult, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
