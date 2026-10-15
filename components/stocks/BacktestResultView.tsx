"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BacktestResult, BucketStat } from "@/lib/stocks/types";
import { breakevenWinRate } from "@/lib/stocks/backtest";
import { EXIT_LABEL, pct, plainPct, price, rMul, shortDate, signedYen, yen } from "@/lib/stocks/format";
import { TREND_LABEL } from "@/lib/stocks/trend";
import { toCode4 } from "@/lib/stocks/types";
import { Card, Kpi, Notice, ScoreBadge } from "./ui";

export function BacktestResultView({ result }: { result: BacktestResult }) {
  const m = result.metrics;
  const be = breakevenWinRate(m.avgWinPct, m.avgLossPct);
  const skippedTotal = m.skipped.unit_too_large + m.skipped.no_cash + m.skipped.overlap;

  return (
    <div className="space-y-4">
      <Card title={`結果（${shortDate(result.period.from)}〜${shortDate(result.period.to)}・${result.codes.length}銘柄）`}>
        {m.trades < 30 && (
          <div className="mb-3">
            <Notice tone="warn">
              取引が {m.trades} 回しかありません。30回未満では偶然の影響が大きく、勝率や期待値はほとんど当てになりません。銘柄を増やすか、条件をゆるめてください。
            </Notice>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="取引回数" value={`${m.trades}回`} hint={`条件に合った開示 ${m.signals}件`} />
          <Kpi label="勝率" value={plainPct(m.winRate)} hint={be !== null ? `損益が0になる勝率 ${plainPct(be)}` : undefined} />
          <Kpi label="期待値（1回あたり）" value={rMul(m.expectancyR)} tone={m.expectancyR === null ? "muted" : m.expectancyR > 0 ? "up" : "down"} hint={`平均 ${pct(m.expectancyPct, 2)}`} />
          <Kpi label="プロフィットファクター" value={m.profitFactor === null ? "—" : m.profitFactor.toFixed(2)} hint="総利益 ÷ 総損失（1超えでプラス）" />
          <Kpi label="平均利益／平均損失" value={`${pct(m.avgWinPct)} / ${pct(m.avgLossPct)}`} />
          <Kpi label="合計損益" value={signedYen(m.totalPnlYen)} tone={m.totalPnlYen > 0 ? "up" : m.totalPnlYen < 0 ? "down" : undefined} hint={`最終資金 ${yen(m.endCapital)}`} />
          <Kpi label="最大ドローダウン" value={`−${(m.maxDrawdownPct * 100).toFixed(1)}%`} tone={m.maxDrawdownPct > 0.15 ? "down" : undefined} />
          <Kpi label="平均保有" value={m.avgHoldDays === null ? "—" : `${m.avgHoldDays.toFixed(1)}日`} />
        </dl>
        {skippedTotal > 0 && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            見送り {skippedTotal}件：
            {m.skipped.unit_too_large > 0 && `100株だと許容損失を超える ${m.skipped.unit_too_large}件 `}
            {m.skipped.no_cash > 0 && `資金不足（同時保有） ${m.skipped.no_cash}件 `}
            {m.skipped.overlap > 0 && `同じ銘柄を保有中 ${m.skipped.overlap}件`}
            {m.skipped.unit_too_large > 0 && result.params.lotMode === "unit" && "。「単元未満株も可」にすると影響を比べられます。"}
          </p>
        )}
      </Card>

      {result.equity.length > 1 && (
        <Card title="資金の推移（手仕舞い日ごと）">
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[{ date: result.period.from ?? "", equity: result.params.capital }, ...result.equity]} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickFormatter={(d: string) => d.slice(2, 7).replace("-", "/")} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} minTickGap={36} />
                <YAxis orientation="right" tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
                <ReferenceLine y={result.params.capital} stroke="var(--color-muted)" strokeDasharray="3 3" />
                <Tooltip
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    const r = payload?.[0]?.payload as { date: string; equity: number } | undefined;
                    if (!active || !r) return null;
                    return (
                      <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs shadow-xl">
                        <div className="text-muted">{r.date}</div>
                        <div className="num">{yen(r.equity)}</div>
                      </div>
                    );
                  }}
                />
                <Line type="stepAfter" dataKey="equity" stroke="var(--color-accent)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="スコア帯ごとの成績">
          <BucketTable rows={result.byScore} />
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            条件で絞る前の全開示で計算（トレンド不問・資金の制約なし）。スコアが高い帯ほど期待値が高ければ、スコアに意味がある可能性があります。
          </p>
        </Card>
        <Card title="トレンドごとの成績">
          <BucketTable rows={result.byTrend} />
          <p className="mt-2 text-[11px] leading-relaxed text-muted">同じく全開示で計算（スコア不問）。</p>
        </Card>
      </div>

      <Card title={`取引一覧（${result.trades.length}件）`}>
        {result.trades.length === 0 ? (
          <p className="text-sm text-muted">条件に合う取引がありませんでした。</p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line text-left">
                  <th className="px-1 py-2 font-normal">銘柄</th>
                  <th className="px-1 py-2 font-normal">開示</th>
                  <th className="px-1 py-2 font-normal">スコア</th>
                  <th className="px-1 py-2 font-normal">トレンド</th>
                  <th className="px-1 py-2 text-right font-normal">買い</th>
                  <th className="px-1 py-2 text-right font-normal">売り</th>
                  <th className="px-1 py-2 font-normal">理由</th>
                  <th className="px-1 py-2 text-right font-normal">株数</th>
                  <th className="px-1 py-2 text-right font-normal">損益</th>
                </tr>
              </thead>
              <tbody>
                {result.trades
                  .slice()
                  .reverse()
                  .map((t) => (
                    <tr key={t.disclosureId + t.entryDate} className="border-b border-line/50">
                      <td className="px-1 py-2">
                        <span className="num">{toCode4(t.code)}</span> <span className="text-xs text-muted">{t.name}</span>
                      </td>
                      <td className="num px-1 py-2 text-xs">{shortDate(t.discDate)}</td>
                      <td className="px-1 py-2"><ScoreBadge score={t.score} /></td>
                      <td className="px-1 py-2 text-xs">{TREND_LABEL[t.trend]}</td>
                      <td className="num px-1 py-2 text-right text-xs">{shortDate(t.entryDate)}<br />{price(t.entryPrice)}</td>
                      <td className="num px-1 py-2 text-right text-xs">{shortDate(t.exitDate)}<br />{price(t.exitPrice)}</td>
                      <td className="px-1 py-2 text-xs">{EXIT_LABEL[t.exitReason]}（{t.holdDays}日）</td>
                      <td className="num px-1 py-2 text-right text-xs">{t.shares.toLocaleString()}</td>
                      <td className={`num px-1 py-2 text-right ${t.pnlYen > 0 ? "text-up" : t.pnlYen < 0 ? "text-down" : ""}`}>
                        {signedYen(t.pnlYen)}
                        <br />
                        <span className="text-xs">{pct(t.returnPct)}</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function BucketTable({ rows }: { rows: BucketStat[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line">
            <th className="py-1.5 text-left font-normal">区分</th>
            <th className="py-1.5 text-right font-normal">件数</th>
            <th className="py-1.5 text-right font-normal">勝率</th>
            <th className="py-1.5 text-right font-normal">平均</th>
            <th className="py-1.5 text-right font-normal">期待値</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line/50">
              <td className="py-1.5 font-sans">{r.label}</td>
              <td className="py-1.5 text-right">{r.n}</td>
              <td className="py-1.5 text-right">{plainPct(r.winRate)}</td>
              <td className="py-1.5 text-right">{pct(r.avgReturnPct)}</td>
              <td className={`py-1.5 text-right ${r.expectancyR === null ? "" : r.expectancyR > 0 ? "text-up" : "text-down"}`}>
                {rMul(r.expectancyR)}
                {r.n > 0 && r.n < 20 && <span className="ml-1 text-[10px] text-muted">少</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
