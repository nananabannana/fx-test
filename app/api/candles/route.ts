// ブラウザからの「最新のローソク足をください」に答える窓口。
// APIキーは .env.local から読み、ブラウザには一切返しません。

import { NextResponse } from "next/server";
import { PAIR } from "@/lib/config";
import { fetchCandles, LiveDataError } from "@/lib/server/twelveData";
import type { CandlesResponse } from "@/lib/liveTypes";

export const dynamic = "force-dynamic";

/** 取得する本数。約2.5時間分あれば、その間の予測をすべて照合できる */
const COUNT = 150;
/** 同じデータを何度も取りに行かないよう、この時間は前回の結果を使い回す */
const CACHE_MS = 50_000;

let cache: { at: number; body: CandlesResponse } | null = null;
let inflight: Promise<CandlesResponse> | null = null;

export async function GET() {
  const apiKey = process.env.FX_DATA_API_KEY;
  if (!apiKey) {
    return json(
      {
        ok: false,
        error: {
          code: "no_key",
          message: "APIキーが設定されていません。.env.local を確認して、サーバーを再起動してください。",
        },
      },
      503,
    );
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return json(cache.body, 200);
  }

  // 同時に複数のリクエストが来ても、外部APIへの問い合わせは1回にまとめる
  inflight ??= load(apiKey).finally(() => {
    inflight = null;
  });
  const body = await inflight;
  return json(body, body.ok ? 200 : statusFor(body.error.code));
}

async function load(apiKey: string): Promise<CandlesResponse> {
  try {
    const candles = await fetchCandles({ apiKey, symbol: PAIR, count: COUNT });
    const body: CandlesResponse = { ok: true, candles, fetchedAt: Date.now(), provider: "Twelve Data" };
    cache = { at: Date.now(), body };
    return body;
  } catch (e) {
    if (e instanceof LiveDataError) {
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    return { ok: false, error: { code: "upstream", message: "データの取得中に予期しないエラーが起きました。" } };
  }
}

function statusFor(code: string): number {
  if (code === "rate_limit") return 429;
  if (code === "invalid_key") return 502;
  return 502;
}

function json(body: CandlesResponse, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
