"use client";

// OP検証：記録した外為オプションの成績（期待値ベース）と、確率の較正

import { useMemo, useState } from "react";
import { useIsClient } from "@/lib/useIsClient";
import Link from "next/link";
import {
  CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { useGmoRecords } from "@/lib/useGmoRecords";
import { brier, calibration, EXPIRY_HOURS_JST, outcomeOf, summarize, type Engine, type Outcome, type TradeRecord } from "@/lib/gmoOption";
import { jstHour, type Result } from "@/lib/conditions";
import { useFxEvents } from "@/lib/useFxEvents";
import { ConditionAnalysis, type CondItem } from "@/components/ConditionAnalysis";
import { Card, Kpi, Notice } from "@/components/stocks/ui";

const ENGINE_LABEL: Record<Engine, string> = { baseline: "基準モデル", indicator: "指標", claude: "Claude" };
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
const yen = (v: number | null) =>
  v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v)).toLocaleString("ja-JP")}円`;

type EngineFilter = Engine | "all";
type ExecFilter = "all" | "executed" | "paper";
type ExpiryFilter = "all" | `${number}`;

const RESULT: Record<Outcome, Result> = { win: "win", lose: "lose", draw: "excluded", pending: "pending" };
const expiryHourOf = (r: TradeRecord) => Math.round(jstHour(r.expiry)) % 24;

export default function GmoVerifyPage() {
  const isClient = useIsClient();
  if (!isClient) return <p className="py-10 text-center text-sm text-muted">読み込み中…</p>;
  return <VerifyView />;
}

function VerifyView() {
  const { records: allRecords, update } = useGmoRecords();
  const events = useFxEvents();
  const [engine, setEngine] = useState<EngineFilter>("all");
  const [exec, setExec] = useState<ExecFilter>("all");
  const [expiry, setExpiry] = useState<ExpiryFilter>("all");
  const usedHours = EXPIRY_HOURS_JST.filter((h) => allRecords.some((r) => expiryHourOf(r) === h));
  // 判定時刻（回号の満期の時）で絞り込む。ページ全体に効かせる
  const records = useMemo(
    () => (expiry === "all" ? allRecords : allRecords.filter((r) => String(expiryHourOf(r)) === expiry)),
    [allRecords, expiry],
  );
  const [calEngine, setCalEngine] = useState<Engine>("baseline");

  const filtered = useMemo(
    () =>
      records.filter(
        (r) => (engine === "all" || r.engine === engine) && (exec === "all" || (exec === "executed" ? r.executed : !r.executed)),
      ),
    [records, engine, exec],
  );
  const s = summarize(filtered);
  const byEngine = (["baseline", "indicator", "claude"] as Engine[]).map((e) => ({
    engine: e,
    s: summarize(records.filter((r) => r.engine === e && (exec === "all" || (exec === "executed" ? r.executed : !r.executed)))),
  }));

  // 較正は「判断に使ったエンジン」に関係なく、そのエンジンの確率が記録されている全件で見る
  const calBase = records.filter((r) => exec === "all" || (exec === "executed" ? r.executed : !r.executed));
  const bins = calibration(calBase, calEngine);
  const scores = (["baseline", "indicator", "claude"] as Engine[]).map((e) => ({ engine: e, b: brier(calBase, e) }));
  const condItems: CondItem[] = filtered.map((r) => ({ id: r.id, time: r.createdAt, session: r.session, atrPips: r.atrPips, result: RESULT[outcomeOf(r)] }));
  const atrPopulation = allRecords.flatMap((r) => (r.atrPips === undefined ? [] : [r.atrPips]));
  const backfill = allRecords.filter((r) => r.atrPips === undefined && !r.atrUnavailable).map((r) => ({ id: r.id, asOf: r.createdAt }));
  const points = bins.filter((b) => b.n > 0).map((b) => ({ x: b.avgPred!, y: b.hitRate!, n: b.n, label: b.label }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">OP検証</h1>
        <p className="text-xs text-muted">一致率ではなく、購入価格を含めた損益と、確率の正確さ（較正）で評価します</p>
      </div>

      <Card>
        <div className="flex flex-wrap gap-4">
          <Filter
            label="判断に使ったエンジン"
            value={engine}
            onChange={setEngine}
            options={[["all", "すべて"], ["baseline", "基準モデル"], ["indicator", "指標"], ["claude", "Claude"]]}
          />
          <Filter label="購入" value={exec} onChange={setExec} options={[["all", "すべて"], ["executed", "実購入"], ["paper", "記録のみ"]]} />
          <Filter
            label="判定時刻"
            value={expiry}
            onChange={setExpiry}
            options={[["all", "すべて"], ...usedHours.map((h) => [`${h}`, `${h}時`] as [ExpiryFilter, string])]}
          />
        </div>
      </Card>

      <Card title="成績">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Kpi label="判定済み" value={`${s.settled}件`} hint={`引き分け ${s.draws}・判定待ち ${s.pending}`} />
          <Kpi label="勝率" value={s.winRate === null ? "—" : `${pct(s.winRate)} ±${pct(s.winRateMargin, 1)}`} hint="±は95%の誤差幅" />
          <Kpi label="平均の損益分岐" value={pct(s.avgBreakeven)} />
          <Kpi label="合計損益" value={yen(s.totalPnl)} tone={s.totalPnl > 0 ? "up" : s.totalPnl < 0 ? "down" : undefined} />
          <Kpi label="1枚あたり平均損益" value={yen(s.pnlPerUnit)} tone={(s.pnlPerUnit ?? 0) > 0 ? "up" : (s.pnlPerUnit ?? 0) < 0 ? "down" : undefined} />
        </dl>
        <div className="mt-3">
          {s.settled === 0 ? (
            <Notice>まだ判定済みの記録がありません。<Link href="/gmo" className="text-accent underline">外為OP</Link> で記録すると、満期後に自動で判定されます。</Notice>
          ) : !s.enoughData ? (
            <Notice tone="warn">
              判定済みが {s.settled} 件で、勝率の誤差が ±{pct(s.winRateMargin, 0)} と大きいため、まだ「勝てる／負ける」は判断できません（目安は100件以上、できれば数百件）。
            </Notice>
          ) : s.ci && s.avgBreakeven !== null ? (
            s.ci.low > s.avgBreakeven ? (
              <Notice>勝率の誤差幅の下限（{pct(s.ci.low)}）が平均の損益分岐（{pct(s.avgBreakeven)}）を上回っています。条件を変えずに件数を増やして、続くか確かめてください。</Notice>
            ) : s.ci.high < s.avgBreakeven ? (
              <Notice tone="warn">勝率の誤差幅の上限（{pct(s.ci.high)}）が平均の損益分岐（{pct(s.avgBreakeven)}）を下回っています。この条件では続けるほど負ける可能性が高いです。</Notice>
            ) : (
              <Notice tone="warn">勝率の誤差幅（{pct(s.ci.low)}〜{pct(s.ci.high)}）が損益分岐（{pct(s.avgBreakeven)}）をまたいでいます。まだ差があるとは言えません。</Notice>
            )
          ) : null}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="mb-1 text-left text-xs text-muted">判断に使ったエンジン別</caption>
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 text-left font-normal">エンジン</th>
                <th className="py-1.5 text-right font-normal">判定済み</th>
                <th className="py-1.5 text-right font-normal">勝率</th>
                <th className="py-1.5 text-right font-normal">損益分岐</th>
                <th className="py-1.5 text-right font-normal">合計損益</th>
                <th className="py-1.5 text-right font-normal">1枚あたり</th>
              </tr>
            </thead>
            <tbody className="num">
              {byEngine.map(({ engine: e, s: x }) => (
                <tr key={e} className="border-b border-line/50">
                  <td className="py-1.5 font-sans">{ENGINE_LABEL[e]}</td>
                  <td className="py-1.5 text-right">{x.settled}</td>
                  <td className="py-1.5 text-right">{x.winRate === null ? "—" : `${pct(x.winRate)} ±${pct(x.winRateMargin, 0)}`}</td>
                  <td className="py-1.5 text-right">{pct(x.avgBreakeven)}</td>
                  <td className={`py-1.5 text-right ${x.totalPnl > 0 ? "text-up" : x.totalPnl < 0 ? "text-down" : ""}`}>{yen(x.totalPnl)}</td>
                  <td className="py-1.5 text-right">{yen(x.pnlPerUnit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ConditionAnalysis
        items={condItems}
        atrPopulation={atrPopulation}
        events={events}
        backfill={backfill}
        onPatch={update}
        note={
          <>
            上の「判断に使ったエンジン」「購入」「判定時刻」の絞り込みに連動します。引き分けは対象外です。
            外為オプションの払戻倍率は 1,000円 ÷ 購入価格{s.avgBreakeven ? `（いまの記録の平均損益分岐 ${pct(s.avgBreakeven)} ＝ 約${(1 / s.avgBreakeven).toFixed(2)}倍）` : ""}です。
          </>
        }
      />

      <Card
        title="確率の較正（予測した確率 vs 実際に上だった割合）"
        right={
          <Filter
            label="エンジン"
            value={calEngine}
            onChange={setCalEngine}
            options={[["baseline", "基準モデル"], ["indicator", "指標"], ["claude", "Claude"]]}
          />
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-muted">
          点が対角線に近いほど、確率が正確です。例えば「60%」と見積もった記録のうち、実際に60%前後が目標レートより上で終わっていれば合格。
          High/Low どちらを選んだかに関係なく、そのエンジンの確率が記録されている全件で見ます。
        </p>
        {points.length === 0 ? (
          <Notice>{ENGINE_LABEL[calEngine]}の確率が入った判定済みの記録がまだありません。</Notice>
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart margin={{ top: 8, right: 12, bottom: 16, left: 0 }}>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" />
                <XAxis type="number" dataKey="x" domain={[0, 1]} ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]} tickFormatter={(v: number) => `${v * 100}%`}
                  tick={{ fill: "var(--color-muted)", fontSize: 11 }} label={{ value: "予測した確率", position: "insideBottom", offset: -8, fill: "var(--color-muted)", fontSize: 11 }} />
                <YAxis type="number" dataKey="y" domain={[0, 1]} ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]} tickFormatter={(v: number) => `${v * 100}%`}
                  tick={{ fill: "var(--color-muted)", fontSize: 11 }} width={44} />
                <ZAxis type="number" dataKey="n" range={[40, 400]} />
                <Tooltip
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload as { x: number; y: number; n: number; label: string } | undefined;
                    if (!active || !p || p.label === undefined) return null;
                    return (
                      <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs shadow-xl">
                        <div className="text-muted">確率帯 {p.label}</div>
                        <div className="num">予測の平均 {pct(p.x)}</div>
                        <div className="num">実際 {pct(p.y)}（{p.n}件）</div>
                      </div>
                    );
                  }}
                />
                <Line data={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} dataKey="y" stroke="var(--color-muted)" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                <Scatter data={points} fill="var(--color-accent)" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 text-left font-normal">確率帯</th>
                <th className="py-1.5 text-right font-normal">件数</th>
                <th className="py-1.5 text-right font-normal">予測の平均</th>
                <th className="py-1.5 text-right font-normal">実際に上だった割合</th>
                <th className="py-1.5 text-right font-normal">差</th>
              </tr>
            </thead>
            <tbody className="num">
              {bins.map((b) => (
                <tr key={b.label} className={`border-b border-line/50 ${b.n === 0 ? "text-muted" : ""}`}>
                  <td className="py-1.5">{b.label}</td>
                  <td className="py-1.5 text-right">{b.n}</td>
                  <td className="py-1.5 text-right">{pct(b.avgPred)}</td>
                  <td className="py-1.5 text-right">{pct(b.hitRate)}</td>
                  <td className="py-1.5 text-right">
                    {b.n ? `${(((b.hitRate ?? 0) - (b.avgPred ?? 0)) * 100).toFixed(1)}pt` : "—"}
                    {b.n > 0 && b.n < 20 && <span className="ml-1 text-[10px] text-muted">少</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[360px] text-sm">
            <caption className="mb-1 text-left text-xs text-muted">ブライアスコア（小さいほど正確。いつも50%と答えると0.250）</caption>
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 text-left font-normal">エンジン</th>
                <th className="py-1.5 text-right font-normal">件数</th>
                <th className="py-1.5 text-right font-normal">スコア</th>
              </tr>
            </thead>
            <tbody className="num">
              {scores.map(({ engine: e, b }) => (
                <tr key={e} className="border-b border-line/50">
                  <td className="py-1.5 font-sans">{ENGINE_LABEL[e]}</td>
                  <td className="py-1.5 text-right">{b?.n ?? 0}</td>
                  <td className="py-1.5 text-right">{b ? b.score.toFixed(3) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">同じ記録で比べています。Claude が基準モデルより小さいスコアを安定して出せるかが、Claude を使う意味があるかの目安です。</p>
        </div>
      </Card>

      <p className="text-xs text-muted">
        記録の追加・判定レートの手入力は <Link href="/gmo" className="text-accent underline">外為OP</Link> の画面で行います。旧仕様（◯分後予測）の成績は <Link href="/legacy/verify" className="text-accent underline">旧モード</Link> に残っています。
      </p>
    </div>
  );
}

function Filter<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-line bg-panel-2 p-0.5 text-sm">
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={`rounded-md px-3 py-1 ${value === v ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
