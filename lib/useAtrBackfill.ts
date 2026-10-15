"use client";

// 予測時点の ATR が欠けている記録を、Twelve Data の過去の1分足から補完する（ボタンで実行）。
// 外部APIを1件につき1回使うので、無料枠（1分8回）を超えないよう間隔をあけて少しずつ進める。

import { useCallback, useRef, useState } from "react";
import { atr5m, type ConditionFields } from "./conditions";
import type { CandlesAtResponse } from "@/app/api/candles-at/route";

export type BackfillTarget = { id: string; asOf: number };

const GAP_MS = 8_000;
export const BACKFILL_BATCH = 20;

export function useAtrBackfill(onPatch: (id: string, patch: ConditionFields) => void) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const stop = useRef(false);

  const run = useCallback(
    async (targets: BackfillTarget[]) => {
      if (running) return;
      const list = targets.slice(0, BACKFILL_BATCH);
      stop.current = false;
      setRunning(true);
      setDone(0);
      setTotal(list.length);
      setMessage(null);
      let filled = 0;
      let unavailable = 0;
      try {
        for (let i = 0; i < list.length; i++) {
          if (stop.current) break;
          const t = list[i];
          let body: CandlesAtResponse;
          try {
            const res = await fetch(`/api/candles-at?asOf=${t.asOf}`, { cache: "no-store" });
            body = (await res.json()) as CandlesAtResponse;
          } catch {
            setMessage("アプリのサーバーに接続できませんでした。");
            break;
          }
          if (body.ok) {
            const atr = atr5m(body.candles, t.asOf);
            if (atr !== null) {
              onPatch(t.id, { atrPips: atr });
              filled++;
            } else {
              onPatch(t.id, { atrUnavailable: true });
              unavailable++;
            }
          } else if (body.error.code === "no_data") {
            onPatch(t.id, { atrUnavailable: true });
            unavailable++;
          } else {
            // キーなし・上限・接続失敗は、記録には何も書かずに止める（後でやり直せる）
            setMessage(body.error.message);
            break;
          }
          setDone(i + 1);
          if (i < list.length - 1) await new Promise((r) => setTimeout(r, GAP_MS));
        }
      } finally {
        setRunning(false);
        setMessage((m) => m ?? `補完 ${filled}件${unavailable ? `・価格履歴なし ${unavailable}件（「不明」のまま）` : ""}`);
      }
    },
    [running, onPatch],
  );

  const cancel = useCallback(() => {
    stop.current = true;
  }, []);

  return { run, cancel, running, done, total, message };
}
