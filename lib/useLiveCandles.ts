"use client";

// 実データ（/api/candles）を取得し、1分ごとに自動更新するフック。
// 画面が裏に回っている間は取得しないので、無料枠を無駄に使いません。

import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle } from "./types";
import type { CandlesResponse, LiveError } from "./liveTypes";

const POLL_MS = 60_000;
/** 最新の足がこれより古ければ「市場が閉まっている」とみなす */
const STALE_MS = 10 * 60_000;

export type LiveStatus = {
  loading: boolean;
  error: LiveError | null;
  fetchedAt: number | null;
  provider: string | null;
};

export function useLiveCandles(enabled: boolean) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [status, setStatus] = useState<LiveStatus>({
    loading: false,
    error: null,
    fetchedAt: null,
    provider: null,
  });
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/candles", { cache: "no-store" });
      const body = (await res.json()) as CandlesResponse;
      if (body.ok) {
        setCandles(body.candles);
        setStatus({ loading: false, error: null, fetchedAt: body.fetchedAt, provider: body.provider });
      } else {
        // 失敗しても、前回取れたデータはそのまま残す（サンプルには切り替えない）
        setStatus((s) => ({ ...s, loading: false, error: body.error }));
      }
    } catch {
      setStatus((s) => ({
        ...s,
        loading: false,
        error: { code: "network", message: "アプリのサーバーに接続できませんでした。" },
      }));
    } finally {
      busy.current = false;
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部API の購読（取得開始）
    refresh();
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refresh]);

  const last = candles[candles.length - 1];
  const stale = !!last && now - last.time > STALE_MS;

  return { candles, status, refresh, stale };
}
