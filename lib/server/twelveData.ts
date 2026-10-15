// Twelve Data からローソク足を取得する処理（サーバー専用）
// このファイルはブラウザには送られません。APIキーはここでだけ使います。
import "server-only";

import type { Candle } from "../types";
import type { LiveErrorCode } from "../liveTypes";

const DEFAULT_BASE = "https://api.twelvedata.com";
const MINUTE = 60_000;

export class LiveDataError extends Error {
  constructor(
    public code: LiveErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type TwelveValue = { datetime: string; open: string; high: string; low: string; close: string };
type TwelveResponse =
  | { status: "ok"; values: TwelveValue[] }
  | { status: "error"; code: number; message: string };

export async function fetchCandles(opts: {
  apiKey: string;
  symbol: string;
  count: number;
  /** 指定すると、その期間（UTC、ミリ秒）の足を取得する */
  range?: { start: number; end: number };
}): Promise<Candle[]> {
  // テスト用に接続先を差し替えられる（通常は設定不要）
  const base = process.env.FX_DATA_API_BASE || DEFAULT_BASE;
  const url = new URL("/time_series", base);
  url.searchParams.set("symbol", opts.symbol);
  url.searchParams.set("interval", "1min");
  url.searchParams.set("outputsize", String(opts.count));
  if (opts.range) {
    const fmt = (t: number) => new Date(t).toISOString().slice(0, 19).replace("T", " ");
    url.searchParams.set("start_date", fmt(opts.range.start));
    url.searchParams.set("end_date", fmt(opts.range.end));
  }
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("order", "asc");

  let res: Response;
  try {
    res = await fetch(url, {
      // キーはURLではなくヘッダーで送る（ログに残りにくい）
      headers: { Authorization: `apikey ${opts.apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LiveDataError("network", "為替データAPIに接続できませんでした。");
  }

  let body: TwelveResponse;
  try {
    body = (await res.json()) as TwelveResponse;
  } catch {
    throw new LiveDataError("upstream", "為替データAPIの応答を読み取れませんでした。");
  }

  if (body.status !== "ok") {
    const code = "code" in body ? body.code : res.status;
    if (code === 401 || code === 403) {
      throw new LiveDataError("invalid_key", "APIキーが正しくないか、このデータを使う権限がありません。");
    }
    if (code === 429) {
      throw new LiveDataError("rate_limit", "無料枠の利用上限に達しました。しばらく待ってから再取得してください。");
    }
    throw new LiveDataError("upstream", "為替データAPIがエラーを返しました。");
  }

  const now = Date.now();
  const candles: Candle[] = [];
  for (const v of body.values ?? []) {
    const time = Date.parse(v.datetime.replace(" ", "T") + "Z");
    const c = {
      time,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
    };
    if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) continue;
    // まだ確定していない（形成中の）足は使わない
    if (time + MINUTE > now) continue;
    candles.push(c);
  }
  candles.sort((a, b) => a.time - b.time);
  return candles;
}
