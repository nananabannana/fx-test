"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Candle, Direction, Prediction } from "@/lib/types";
import { formatPrice, formatTime } from "@/lib/format";

type Row = Candle & { label: string; range: [number, number] };

const DIR_COLOR: Record<Direction, string> = {
  up: "var(--color-up)",
  down: "var(--color-down)",
  hold: "var(--color-hold)",
};

/**
 * ローソク足チャート。
 * Recharts にはローソク足専用の部品がないため、
 * 「安値〜高値」の範囲バーを描き、その形を自作のローソク足に置き換えています。
 */
export function CandleChart({
  candles,
  markers = [],
}: {
  candles: Candle[];
  markers?: Prediction[];
}) {
  const rows: Row[] = candles.map((c) => ({
    ...c,
    label: formatTime(c.time),
    range: [c.low, c.high],
  }));

  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const pad = Math.max((max - min) * 0.08, 0.01);
  const domain: [number, number] = [
    Math.floor((min - pad) * 100) / 100,
    Math.ceil((max + pad) * 100) / 100,
  ];

  const first = candles[0]?.time ?? 0;
  const last = candles[candles.length - 1]?.time ?? 0;
  const visibleMarkers = markers.filter((m) => m.at >= first && m.at <= last);

  return (
    <div className="h-[280px] w-full sm:h-[360px] lg:h-auto lg:min-h-[360px] lg:flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            orientation="right"
            domain={domain}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickFormatter={(v: number) => v.toFixed(2)}
            tickLine={false}
            axisLine={false}
            width={52}
            allowDataOverflow
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={<CandleTooltip />}
            isAnimationActive={false}
          />
          <Bar dataKey="range" shape={CandleShape} isAnimationActive={false} />
          {visibleMarkers.map((m) => (
            <ReferenceDot
              key={m.id}
              x={formatTime(m.at)}
              y={m.basePrice}
              r={4.5}
              fill={DIR_COLOR[m.direction]}
              stroke="var(--color-bg)"
              strokeWidth={2}
              ifOverflow="extendDomain"
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type ShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: Row;
};

function CandleShape(props: unknown) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props as ShapeProps;
  if (!payload) return <g />;
  const { open, close, high, low } = payload;
  const top = Math.min(y, y + height);
  const span = Math.abs(height);
  const ratio = high === low ? 0 : span / (high - low);
  const toY = (v: number) => top + (high - v) * ratio;

  const rising = close >= open;
  const color = rising ? "var(--color-up)" : "var(--color-down)";
  const bodyTop = toY(Math.max(open, close));
  const bodyH = Math.max(Math.abs(toY(open) - toY(close)), 1);
  const cx = x + width / 2;
  const bodyW = Math.max(width, 2);

  return (
    <g>
      <line x1={cx} x2={cx} y1={toY(high)} y2={toY(low)} stroke={color} strokeWidth={1} />
      <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} rx={0.5} />
    </g>
  );
}

type TooltipProps = {
  active?: boolean;
  payload?: { payload: Row }[];
};

function CandleTooltip({ active, payload }: TooltipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const items: [string, number][] = [
    ["始値", row.open],
    ["高値", row.high],
    ["安値", row.low],
    ["終値", row.close],
  ];
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 text-muted">{row.label}</div>
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="num text-right">{formatPrice(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
