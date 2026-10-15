// 過去の予測時点の1分足（ATR の補完用）。asOf の直前90分ぶんを返す。
// 外部APIを1回使うので、画面のボタンから少しずつ呼ぶ。結果はサーバーで使い回す。

import { NextResponse } from "next/server";
import { PAIR } from "@/lib/config";
import { fetchCandles, LiveDataError } from "@/lib/server/twelveData";
import type { Candle } from "@/lib/types";

export const dynamic = "force-dynamic";

const MIN = 60_000;
const SPAN_MIN = 90;
const cache = new Map<number, Candle[]>();

export type CandlesAtResponse =
  | { ok: true; asOf: number; candles: Candle[] }
  | { ok: false; error: { code: string; message: string } };

export async function GET(req: Request) {
  const asOf = Number(new URL(req.url).searchParams.get("asOf"));
  if (!Number.isFinite(asOf) || asOf <= 0) return json({ ok: false, error: { code: "bad_request", message: "時刻の指定が正しくありません。" } }, 400);
  const end = Math.floor(asOf / MIN) * MIN; // この時刻より前に始まった1分足まで
  if (end > Date.now() - MIN) return json({ ok: false, error: { code: "not_yet", message: "まだ確定していない時刻です。" } }, 400);

  const hit = cache.get(end);
  if (hit) return json({ ok: true, asOf, candles: hit });

  const apiKey = process.env.FX_DATA_API_KEY;
  if (!apiKey) return json({ ok: false, error: { code: "no_key", message: "為替データのAPIキーが設定されていません。" } }, 503);
  try {
    const candles = (await fetchCandles({ apiKey, symbol: PAIR, count: SPAN_MIN + 5, range: { start: end - SPAN_MIN * MIN, end } })).filter(
      (c) => c.time < end,
    );
    if (candles.length === 0) return json({ ok: false, error: { code: "no_data", message: "その時刻の価格履歴が見つかりませんでした（休場の可能性）。" } }, 404);
    cache.set(end, candles);
    return json({ ok: true, asOf, candles });
  } catch (e) {
    const err = e instanceof LiveDataError ? e : null;
    return json(
      { ok: false, error: { code: err?.code ?? "upstream", message: err?.message ?? "価格履歴を取得できませんでした。" } },
      err?.code === "rate_limit" ? 429 : 502,
    );
  }
}

function json(body: CandlesAtResponse, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
