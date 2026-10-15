// いま使っている予測モデルと、学習用データの状況
import { NextResponse } from "next/server";
import { loadHistory, loadModel } from "@/lib/server/predictStore";
import { isTraining } from "@/lib/server/predictService";
import type { ModelResult } from "@/lib/predict/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const [model, history] = await Promise.all([loadModel(), loadHistory()]);
  const body: ModelResult = {
    ok: true,
    model,
    training: isTraining(),
    history: { candles: history.length, from: history[0]?.time ?? null, to: history.at(-1)?.time ?? null },
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
