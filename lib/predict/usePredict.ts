"use client";

// 短期予測画面の状態：直近の足（1分ごと）、予測の記録、仮想取引。
// 記録はこのブラウザの localStorage に保存。h 分後の足が届いたら自動で照合する。
// ブラウザでだけ描く画面（useIsClient で守った画面）から使うこと。

import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle } from "../types";
import type { CandlesPayload, CandlesResult, ApiError } from "./types";
import { DEMO_DEFAULTS, settleTrade, type DemoSettings, type DemoTrade, type PredictionRecord } from "./demo";
import { HORIZONS } from "./model";
import type { CandlesAtResponse } from "@/app/api/candles-at/route";

const MIN = 60_000;
const POLL_MS = 60_000;
export const STALE_MS = 10 * MIN;

const KEYS = {
  records: "fx-signal-lab:predict:v1",
  trades: "fx-signal-lab:predict-trades:v1",
  settings: "fx-signal-lab:predict-settings:v1",
};

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

export function useRecentCandles(enabled = true) {
  const [data, setData] = useState<CandlesPayload | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/predict/candles", { cache: "no-store" });
      const body = (await res.json()) as CandlesResult;
      if (body.ok) {
        setData({ candles: body.candles, fetchedAt: body.fetchedAt, provider: body.provider, delayNote: body.delayNote });
        setError(null);
      } else setError(body.error); // 前回のデータは残す（古いことは画面で示す）
    } catch {
      setError({ code: "network", message: "アプリのサーバーに接続できませんでした。" });
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部API の購読（取得開始）
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  return { data, error, loading, refresh };
}

async function candlesAt(asOf: number): Promise<{ ok: true; candles: Candle[] } | { ok: false; code: string }> {
  try {
    const res = await fetch(`/api/candles-at?asOf=${asOf}`, { cache: "no-store" });
    const body = (await res.json()) as CandlesAtResponse;
    return body.ok ? { ok: true, candles: body.candles } : { ok: false, code: body.error.code };
  } catch {
    return { ok: false, code: "network" };
  }
}

export function usePredictStore(candles: Candle[]) {
  const [records, setRecords] = useState<PredictionRecord[]>(() => read(KEYS.records, []));
  const [trades, setTrades] = useState<DemoTrade[]>(() => read(KEYS.trades, []));
  const [settings, setSettings] = useState<DemoSettings>(() => ({ ...DEMO_DEFAULTS, ...read<Partial<DemoSettings>>(KEYS.settings, {}) }));
  const busy = useRef(false);

  useEffect(() => write(KEYS.records, records), [records]);
  useEffect(() => write(KEYS.trades, trades), [trades]);
  useEffect(() => write(KEYS.settings, settings), [settings]);

  const addRecord = useCallback((r: PredictionRecord) => setRecords((l) => [r, ...l.filter((x) => x.id !== r.id)].slice(0, 5000)), []);
  const removeRecord = useCallback((id: string) => setRecords((l) => l.filter((x) => x.id !== id)), []);
  const addTrade = useCallback((t: DemoTrade) => setTrades((l) => [t, ...l]), []);
  const resetTrades = useCallback(() => setTrades([]), []);

  // 照合：h 分後の足の終値を入れる／仮想ポジションを手仕舞う
  const settle = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const now = Date.now();
      const byTime = new Map(candles.map((c) => [c.time, c.close]));
      const first = candles[0]?.time ?? Infinity;
      const rPatch = new Map<string, Partial<PredictionRecord>>();
      let fetches = 0;
      for (const r of records) {
        for (const h of HORIZONS) {
          if (r.actual[h] !== undefined || r.unavailable?.[h]) continue;
          const target = r.at + h * MIN;
          if (target + MIN > now - 20_000) continue; // まだ確定していない
          const local = byTime.get(target);
          const prev = rPatch.get(r.id) ?? {};
          if (local !== undefined) {
            rPatch.set(r.id, { ...prev, actual: { ...r.actual, ...prev.actual, [h]: local } });
            continue;
          }
          if (target >= first) continue; // 手元の範囲内なのに無い → 次の取得を待つ
          if (fetches >= 4) continue;
          fetches++;
          const got = await candlesAt(target + MIN);
          if (got.ok) {
            const c = got.candles.find((x) => x.time === target);
            rPatch.set(r.id, c
              ? { ...prev, actual: { ...r.actual, ...prev.actual, [h]: c.close } }
              : { ...prev, unavailable: { ...r.unavailable, ...prev.unavailable, [h]: true } });
          } else if (got.code === "no_data") {
            rPatch.set(r.id, { ...prev, unavailable: { ...r.unavailable, ...prev.unavailable, [h]: true } });
          }
        }
      }
      if (rPatch.size) setRecords((l) => l.map((r) => (rPatch.has(r.id) ? { ...r, ...rPatch.get(r.id) } : r)));

      const tPatch = new Map<string, DemoTrade>();
      for (const t of trades) {
        if (t.status !== "open") continue;
        let done = settleTrade(t, candles);
        if (!done && t.exitAt + MIN < now - 20_000 && t.exitAt < first + 5 * MIN && fetches < 6) {
          fetches++;
          const got = await candlesAt(t.exitAt + 2 * MIN);
          if (got.ok) done = settleTrade(t, got.candles);
        }
        if (done) tPatch.set(t.id, done);
      }
      if (tPatch.size) setTrades((l) => l.map((t) => tPatch.get(t.id) ?? t));
    } finally {
      busy.current = false;
    }
  }, [candles, records, trades]);

  useEffect(() => {
    settle();
    const id = window.setInterval(settle, 30_000);
    return () => window.clearInterval(id);
  }, [settle]);

  return { records, trades, settings, setSettings, addRecord, removeRecord, addTrade, resetTrades };
}
