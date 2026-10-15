// 指定した時刻（判定時刻）のレートを返す。ハイロー検証の自動判定に使う。
// 「17:00 のレート」= 16:59〜17:00 の1分足の終値。確定していない時刻には答えない。

import { NextResponse } from "next/server";
import { PAIR } from "@/lib/config";
import { fetchCandles, LiveDataError } from "@/lib/server/twelveData";

export const dynamic = "force-dynamic";

const MINUTE = 60_000;
const cache = new Map<number, number>();

export async function GET(req: Request) {
  const t = Number(new URL(req.url).searchParams.get("t"));
  if (!Number.isFinite(t) || t % MINUTE !== 0) {
    return NextResponse.json({ ok: false, error: { code: "bad_request", message: "時刻の指定が正しくありません。" } }, { status: 400 });
  }
  if (t > Date.now() - 30_000) {
    return NextResponse.json({ ok: false, error: { code: "not_yet", message: "まだ判定時刻になっていません。" } }, { status: 400 });
  }
  const hit = cache.get(t);
  if (hit !== undefined) return NextResponse.json({ ok: true, time: t, rate: hit });

  const apiKey = process.env.FX_DATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: { code: "no_key", message: "為替データのAPIキーが設定されていません。" } }, { status: 503 });
  }
  try {
    const candles = await fetchCandles({ apiKey, symbol: PAIR, count: 10, range: { start: t - 5 * MINUTE, end: t + MINUTE } });
    // 判定時刻の直前に始まった足（t-1分）の終値。なければ、それより前で一番近い足
    const exact = candles.find((c) => c.time === t - MINUTE);
    const before = candles.filter((c) => c.time < t).at(-1);
    const bar = exact ?? before;
    if (!bar) {
      return NextResponse.json({ ok: false, error: { code: "no_data", message: "その時刻のレートが見つかりませんでした（市場休場の可能性）。" } }, { status: 404 });
    }
    cache.set(t, bar.close);
    return NextResponse.json({ ok: true, time: t, rate: bar.close, approx: !exact });
  } catch (e) {
    const err = e instanceof LiveDataError ? e : null;
    return NextResponse.json(
      { ok: false, error: { code: err?.code ?? "upstream", message: err?.message ?? "レートを取得できませんでした。" } },
      { status: err?.code === "rate_limit" ? 429 : 502 },
    );
  }
}
