"use client";

// 日足の終値と 25日線・75日線。開示日は縦線で、スコアに応じて色を変える。

import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Bar } from "@/lib/stocks/types";
import { withSma } from "@/lib/stocks/trend";
import { price } from "@/lib/stocks/format";

export type ChartMarker = { date: string; score: number | null; label: string };

export function PriceChart({ bars, markers = [], days = 250 }: { bars: Bar[]; markers?: ChartMarker[]; days?: number }) {
  const rows = withSma(bars).slice(-days);
  if (rows.length < 2) return <p className="py-16 text-center text-sm text-muted">表示できる日足がありません。</p>;
  const first = rows[0].date;
  const visible = markers.filter((m) => m.date >= first);
  const lows = rows.map((r) => Math.min(r.l, r.sma75 ?? r.l));
  const highs = rows.map((r) => Math.max(r.h, r.sma75 ?? r.h));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const pad = (max - min) * 0.06;

  return (
    <div className="h-[260px] w-full sm:h-[340px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickFormatter={(d: string) => d.slice(2, 7).replace("-", "/")}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            minTickGap={36}
          />
          <YAxis
            orientation="right"
            domain={[Math.floor(min - pad), Math.ceil(max + pad)]}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickFormatter={(v: number) => v.toLocaleString("ja-JP")}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              if (!active || !r) return null;
              return (
                <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs shadow-xl">
                  <div className="mb-1 text-muted">{r.date}</div>
                  <div className="num">終値 {price(r.c)}</div>
                  <div className="num text-accent">25日線 {price(r.sma25)}</div>
                  <div className="num text-hold">75日線 {price(r.sma75)}</div>
                </div>
              );
            }}
          />
          {visible.map((m) => (
            <ReferenceLine
              key={m.date + m.label}
              x={rows.find((r) => r.date >= m.date)?.date}
              stroke={m.score === null ? "var(--color-muted)" : m.score >= 3 ? "var(--color-up)" : m.score <= -3 ? "var(--color-down)" : "var(--color-muted)"}
              strokeDasharray="3 3"
              strokeOpacity={0.7}
            />
          ))}
          <Line type="monotone" dataKey="c" stroke="var(--color-ink)" strokeWidth={1.5} dot={false} isAnimationActive={false} name="終値" />
          <Line type="monotone" dataKey="sma25" stroke="var(--color-accent)" strokeWidth={1.2} dot={false} isAnimationActive={false} connectNulls name="25日線" />
          <Line type="monotone" dataKey="sma75" stroke="var(--color-hold)" strokeWidth={1.2} dot={false} isAnimationActive={false} connectNulls name="75日線" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PriceChartLegend() {
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      <span><span className="text-ink">━</span> 終値</span>
      <span><span className="text-accent">━</span> 25日線</span>
      <span><span className="text-hold">━</span> 75日線</span>
      <span>┆ 開示日（<span className="text-up">緑</span>=スコア+3以上／<span className="text-down">赤</span>=−3以下／灰=その他）</span>
    </p>
  );
}
