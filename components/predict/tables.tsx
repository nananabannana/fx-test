"use client";

// 検証・モデル画面で使う表とグラフ
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CLASS_LABEL, CLASSES, type CalibrationBin } from "@/lib/predict/evaluate";
import { pct, yen } from "./parts";

/** 混同行列（行＝実際、列＝予測） */
export function ConfusionTable({ confusion }: { confusion: number[][] }) {
  const total = confusion.flat().reduce((a, b) => a + b, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line">
            <th className="py-1.5 text-left font-normal">実際 ＼ 予測</th>
            {CLASSES.map((c) => <th key={c} className="py-1.5 text-right font-normal">{CLASS_LABEL[c]}</th>)}
            <th className="py-1.5 text-right font-normal">計</th>
          </tr>
        </thead>
        <tbody className="num">
          {CLASSES.map((a, i) => (
            <tr key={a} className="border-b border-line/50">
              <td className="py-1.5 font-sans">{CLASS_LABEL[a]}</td>
              {CLASSES.map((p, j) => (
                <td key={p} className={`py-1.5 text-right ${i === j ? "font-bold text-ink" : "text-ink/80"}`}>
                  {confusion[i][j]}
                  {i === j && <span className="ml-0.5 text-[10px] font-normal text-up">○</span>}
                </td>
              ))}
              <td className="py-1.5 text-right text-muted">{confusion[i].reduce((x, y) => x + y, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted">○の付いた対角線が的中（計 {total}件）。</p>
    </div>
  );
}

export function CalibrationTable({ bins }: { bins: CalibrationBin[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line">
            <th className="py-1.5 text-left font-normal">予測した方向の確率</th>
            <th className="py-1.5 text-right font-normal">件数</th>
            <th className="py-1.5 text-right font-normal">確率の平均</th>
            <th className="py-1.5 text-right font-normal">実際の的中率</th>
            <th className="py-1.5 text-right font-normal">差</th>
          </tr>
        </thead>
        <tbody className="num">
          {bins.map((b) => (
            <tr key={b.lo} className={`border-b border-line/50 ${b.n === 0 ? "text-muted" : ""}`}>
              <td className="py-1.5">{Math.round(b.lo * 100)}〜{Math.round(b.hi * 100)}%</td>
              <td className="py-1.5 text-right">{b.n}</td>
              <td className="py-1.5 text-right">{pct(b.avgProb)}</td>
              <td className="py-1.5 text-right">{pct(b.accuracy)}</td>
              <td className="py-1.5 text-right">
                {b.n ? `${(((b.accuracy ?? 0) - (b.avgProb ?? 0)) * 100).toFixed(1)}pt` : "—"}
                {b.n > 0 && b.n < 30 && <span className="ml-1 text-[10px] text-muted">少</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted">「確率の平均」と「実際の的中率」が近いほど、確率が正確です。</p>
    </div>
  );
}

/** 資金（または累積損益）の推移。base に横線 */
export function EquityChart({ points, base, unit = "円" }: { points: { label: string; value: number }[]; base?: number; unit?: string }) {
  if (points.length < 2) return <p className="rounded-xl border border-line bg-panel-2 p-3 text-xs text-muted">グラフにするには2件以上の結果が必要です。</p>;
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} minTickGap={40} />
          <YAxis orientation="right" tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={56} domain={["auto", "auto"]}
            tickFormatter={(v: number) => v.toLocaleString("ja-JP")} />
          {base !== undefined && <ReferenceLine y={base} stroke="var(--color-muted)" strokeDasharray="3 3" />}
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as { label: string; value: number } | undefined;
              if (!active || !r) return null;
              return (
                <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs shadow-xl">
                  <div className="text-muted">{r.label}</div>
                  <div className="num">{unit === "円" && base === undefined ? yen(r.value) : `${r.value.toLocaleString("ja-JP")}${unit}`}</div>
                </div>
              );
            }}
          />
          <Line type="stepAfter" dataKey="value" stroke="var(--color-accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
