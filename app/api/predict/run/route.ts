// 「AI分析を実行」：サーバーで最新の確定足を取り、学習済みモデルで5分後・10分後の確率を出す。
// 古いデータ・データ不足・モデルなしのときは、予測を出さずに理由を返す。
import { NextResponse } from "next/server";
import { runPrediction, toPredictError } from "@/lib/server/predictService";
import type { RunResult } from "@/lib/predict/types";

export const dynamic = "force-dynamic";

const COOLDOWN_MS = 3_000;
let lastAt = 0;

export async function POST() {
  if (Date.now() - lastAt < COOLDOWN_MS) {
    return json({ ok: false, error: { code: "cooldown", message: "連続実行は数秒あけてください。" } }, 429);
  }
  lastAt = Date.now();
  try {
    return json({ ok: true, run: await runPrediction() });
  } catch (e) {
    const err = toPredictError(e);
    if (!["no_model", "stale", "insufficient"].includes(err.code)) console.error("[predict/run]", err.code, err.message);
    return json({ ok: false, error: { code: err.code, message: err.message } }, err.code === "rate_limit" ? 429 : 400);
  }
}

function json(body: RunResult, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
