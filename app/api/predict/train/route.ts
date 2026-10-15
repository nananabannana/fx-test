// 予測モデルの学習：Twelve Data から直近約1か月の1分足を取り（足りない分だけ）、学習してテストする。
// 初回は API を約9回・1〜2分かかる。5分に1回まで。
import { NextResponse } from "next/server";
import { runTraining, toPredictError } from "@/lib/server/predictService";
import type { TrainSettings } from "@/lib/predict/model";
import type { TrainResult } from "@/lib/predict/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let settings: Partial<TrainSettings> | undefined;
  try {
    const b = (await req.json()) as { settings?: Partial<TrainSettings> };
    settings = b?.settings && typeof b.settings === "object" ? b.settings : undefined;
  } catch {
    settings = undefined;
  }
  try {
    const { model, calls } = await runTraining(settings);
    return json({ ok: true, model, calls });
  } catch (e) {
    const err = toPredictError(e);
    console.error("[predict/train]", err.code, err.message);
    const status = err.code === "busy" || err.code === "cooldown" || err.code === "rate_limit" ? 429 : err.code === "no_key" ? 503 : 500;
    return json({ ok: false, error: { code: err.code, message: err.message } }, status);
  }
}

function json(body: TrainResult, status = 200) {
  return NextResponse.json(body, { status });
}
