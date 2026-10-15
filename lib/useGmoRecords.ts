"use client";

// 外為オプションの記録（TradeRecord）の保存と、満期後の自動照合
// 記録はこのブラウザの localStorage に保存（CSVで書き出し可能）

import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle } from "./types";
import { expiryRate, outcomeOf, pnlOf, PAYOUT, type TradeRecord } from "./gmoOption";

const KEY = "fx-signal-lab:gmo:v1";
const MIN = 60_000;

function load(): TradeRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** ブラウザでだけ描く画面（useIsClient で守った画面）から使うこと */
export function useGmoRecords(liveCandles: Candle[] = []) {
  const [records, setRecords] = useState<TradeRecord[]>(load);
  const loaded = true;
  const busy = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(records));
    } catch {
      /* 保存できなくても動作は続ける */
    }
  }, [records]);

  const add = useCallback((r: TradeRecord) => setRecords((l) => [r, ...l]), []);
  const update = useCallback((id: string, patch: Partial<TradeRecord>) => setRecords((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r))), []);
  const remove = useCallback((id: string) => setRecords((l) => l.filter((r) => r.id !== id)), []);

  // 満期を過ぎた記録に、Twelve Data の満期直前1分足の終値を入れる
  const settleDue = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const due = records
        .filter((r) => r.expiryRateAuto === undefined && !r.autoUnavailable && r.expiry <= Date.now() - 45_000)
        .slice(0, 5);
      for (const r of due) {
        const bar = liveCandles.find((c) => c.time === r.expiry - MIN);
        if (bar) {
          update(r.id, { expiryRateAuto: bar.close });
          continue;
        }
        try {
          const res = await fetch(`/api/rate-at?t=${r.expiry}`, { cache: "no-store" });
          const body = await res.json();
          if (body.ok) update(r.id, { expiryRateAuto: body.rate });
          else if (body.error?.code === "no_data") update(r.id, { autoUnavailable: true });
        } catch {
          /* 次の機会にやり直す */
        }
      }
    } finally {
      busy.current = false;
    }
  }, [records, liveCandles, update]);

  useEffect(() => {
    if (!loaded) return;
    settleDue();
    const id = window.setInterval(settleDue, 30_000);
    return () => window.clearInterval(id);
  }, [loaded, settleDue]);

  return { records, loaded, add, update, remove };
}

/** CSV（別のチャットや表計算で分析する用） */
export function recordsToCsv(records: TradeRecord[]): string {
  const t = (ms: number) => new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const p = (v: number | undefined) => (v === undefined ? "" : (v * 100).toFixed(1));
  const head = [
    "記録日時", "回号", "満期", "方向", "目標レート", "記録時の現在値", "満期まで(分)", "購入価格", "枚数", "損益分岐(%)",
    "判断エンジン", "基準モデル(%)", "指標(%)", "Claude(%)", "安全幅(%)", "実購入", "判定レート(自動)", "判定レート(手入力)", "結果", "損益(円)", "メモ",
  ];
  const outcome = { win: "勝ち", lose: "負け", draw: "引き分け", pending: "判定待ち" } as const;
  const rows = records.map((r) =>
    [
      t(r.createdAt), r.roundId, t(r.expiry), r.direction === "high" ? "High" : "Low", r.strike.toFixed(3), r.spot.toFixed(3),
      Math.round(r.minutesLeft), r.price, r.units, ((r.price / PAYOUT) * 100).toFixed(1), r.engine,
      p(r.probs.baseline), p(r.probs.indicator), p(r.probs.claude), (r.margin * 100).toFixed(1), r.executed ? "はい" : "いいえ",
      r.expiryRateAuto?.toFixed(3) ?? "", r.expiryRateManual?.toFixed(3) ?? "", outcome[outcomeOf(r)], pnlOf(r) ?? "",
      r.note.replace(/[\r\n,]/g, " "),
    ].join(","),
  );
  return "﻿" + [head.join(","), ...rows].join("\n");
}

export { expiryRate };
