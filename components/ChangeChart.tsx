"use client";

import {
  Bar,
  BarChart,
  Cell,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Outcome, VerifiedPrediction } from "@/lib/types";
import { FLAT_THRESHOLD_PIPS } from "@/lib/config";
import { DIRECTION_LABEL, formatPips, formatTime, OUTCOME_LABEL } from "@/lib/format";

const FILL: Record<Outcome, string> = {
  match: "var(--color-up)",
  miss: "var(--color-down)",
  excluded: "var(--color-muted)",
  pending: "var(--color-line)",
  unavailable: "var(--color-line)",
};

/** 各予測の「予測期間後の値動き（pips）」を、照合結果の色で並べるグラフ */
export function ChangeChart({ items }: { items: VerifiedPrediction[] }) {
  const rows = items
    .filter((i) => i.changePips !== null)
    .slice()
    .reverse()
    .map((i) => ({
      label: formatTime(i.at),
      change: i.changePips as number,
      outcome: i.outcome,
      direction: i.direction,
      horizon: i.horizonMinutes,
    }));

  if (rows.length === 0) return null;

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <ReferenceArea
            y1={-FLAT_THRESHOLD_PIPS}
            y2={FLAT_THRESHOLD_PIPS}
            fill="var(--color-hold)"
            fillOpacity={0.08}
            ifOverflow="extendDomain"
          />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            minTickGap={16}
          />
          <YAxis
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              if (!active || !r) return null;
              return (
                <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs shadow-xl">
                  <div className="text-muted">{r.label}</div>
                  <div>予測：{DIRECTION_LABEL[r.direction]}</div>
                  <div className="num">{r.horizon}分後：{formatPips(r.change)} pips</div>
                  <div>照合：{OUTCOME_LABEL[r.outcome]}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="change" radius={[2, 2, 2, 2]} maxBarSize={36} isAnimationActive={false}>
            {rows.map((r, i) => (
              <Cell key={i} fill={FILL[r.outcome]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
