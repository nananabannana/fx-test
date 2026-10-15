"use client";

// 勝率の条件別分析（旧モードの検証・OP検証で共通の表示）
// セッション／ボラティリティ／指標イベントの区分ごとに、件数・一致・不一致・勝率（95%区間）を並べ、
// 払戻倍率から出した損益分岐の勝率と比べる。

import { useMemo, useState, type ReactNode } from "react";
import { Bar, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  breakevenFromMultiplier, conditionTable, describeSessions, EVENT_WINDOW_MIN, IMPORTANCE_LABEL, MIN_SAMPLES, nearEvent,
  SESSION_LABEL, SESSIONS, sessionOf, VOL_LABEL, volBandOf, volTerciles,
  type CondRow, type Importance, type Result, type Session,
} from "@/lib/conditions";
import type { EventsState } from "@/lib/useFxEvents";
import { BACKFILL_BATCH, useAtrBackfill, type BackfillTarget } from "@/lib/useAtrBackfill";
import type { ConditionFields } from "@/lib/conditions";
import { nowMs } from "@/lib/useIsClient";

export type CondItem = {
  id: string;
  /** 予測時刻（セッション・イベントの判定に使う） */
  time: number;
  session?: Session;
  atrPips?: number;
  result: Result;
};

type Dim = "session" | "vol" | "event";
const DIM_LABEL: Record<Dim, string> = { session: "セッション", vol: "ボラティリティ", event: "指標イベント" };

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);

export function ConditionAnalysis({
  items,
  atrPopulation,
  events,
  backfill,
  onPatch,
  note,
}: {
  /** フィルター後の記録 */
  items: CondItem[];
  /** 3分位の境界を決める、全期間の ATR（フィルター前・このデータの全記録） */
  atrPopulation: number[];
  events: EventsState;
  /** ATR が欠けていて、価格履歴（Twelve Data）から補完を試せる記録。null なら補完ボタンを出さない */
  backfill: BackfillTarget[] | null;
  onPatch: (id: string, patch: ConditionFields) => void;
  note?: ReactNode;
}) {
  const [dim, setDim] = useState<Dim>("session");
  const [multText, setMultText] = useState("1.9");
  const [minImp, setMinImp] = useState<Importance>("medium");
  const filler = useAtrBackfill(onPatch);

  const mult = Number(multText);
  const breakeven = breakevenFromMultiplier(mult);
  const terciles = useMemo(() => volTerciles(atrPopulation), [atrPopulation]);
  const evList = events.status === "ok" ? events.events : null;

  const rows = useMemo<CondRow[]>(() => {
    if (dim === "session") {
      return conditionTable(items, (i) => i.session ?? sessionOf(i.time), (i) => i.result, SESSIONS.map((k) => ({ key: k, label: SESSION_LABEL[k] })));
    }
    if (dim === "vol") {
      return conditionTable(
        items,
        (i) => volBandOf(i.atrPips, terciles),
        (i) => i.result,
        (["low", "mid", "high"] as const).map((k) => ({ key: k, label: `${VOL_LABEL[k]}` })),
      );
    }
    return conditionTable(
      items,
      (i) => (evList ? (nearEvent(i.time, evList, minImp) ? "near" : "none") : null),
      (i) => i.result,
      [
        { key: "near", label: `前後${EVENT_WINDOW_MIN}分以内` },
        { key: "none", label: "なし" },
      ],
    );
  }, [dim, items, terciles, evList, minImp]);

  const unknownAtr = items.filter((i) => i.atrPips === undefined).length;
  const evRange = evList && evList.length ? { from: evList[0].time, to: evList[evList.length - 1].time } : null;
  const fmtDate = (t: number) => new Date(t).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });

  return (
    <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">勝率の条件別分析</h2>
        <label className="flex items-center gap-2 text-xs text-muted">
          払戻倍率
          <input
            type="number"
            inputMode="decimal"
            min={1.01}
            max={10}
            step={0.01}
            value={multText}
            onChange={(e) => setMultText(e.target.value)}
            className="num w-20 rounded-lg border border-line bg-panel-2 px-2 py-1 text-right text-sm text-ink outline-none focus:border-accent"
          />
          倍 → 損益分岐 <span className="num font-semibold text-hold">{pct(breakeven)}</span>
        </label>
      </div>

      <div role="tablist" aria-label="条件の種類" className="mb-3 flex w-full rounded-lg border border-line bg-panel-2 p-0.5 text-xs sm:inline-flex sm:w-auto sm:text-sm">
        {(Object.keys(DIM_LABEL) as Dim[]).map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={dim === d}
            onClick={() => setDim(d)}
            className={`flex-1 whitespace-nowrap rounded-md px-2 py-1 sm:flex-none sm:px-3 ${dim === d ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {DIM_LABEL[d]}
          </button>
        ))}
      </div>

      <DimNote dim={dim} terciles={terciles} unknownAtr={unknownAtr} events={events} evRange={evRange} fmtDate={fmtDate} minImp={minImp} setMinImp={setMinImp} />

      {dim === "vol" && backfill && backfill.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => (filler.running ? filler.cancel() : filler.run(backfill))}
            className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 font-semibold text-ink hover:border-accent"
          >
            {filler.running ? `補完中 ${filler.done}/${filler.total}（止める）` : `価格履歴から補完（${Math.min(backfill.length, BACKFILL_BATCH)}件・API ${Math.min(backfill.length, BACKFILL_BATCH)}回）`}
          </button>
          <span className="text-muted">
            ATR が欠けた記録 {backfill.length}件。Twelve Data の過去の1分足から計算します（無料枠に合わせて8秒間隔）。
          </span>
          {filler.message && !filler.running && <span className="text-ink/85">{filler.message}</span>}
        </div>
      )}

      <WinRateChart rows={rows} breakeven={breakeven} />

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-1.5 text-left font-normal">区分</th>
              <th className="py-1.5 text-right font-normal">件数</th>
              <th className="py-1.5 text-right font-normal">一致</th>
              <th className="py-1.5 text-right font-normal">不一致</th>
              <th className="py-1.5 text-right font-normal">勝率</th>
              <th className="py-1.5 text-right font-normal">95%区間</th>
              <th className="py-1.5 text-right font-normal">損益分岐との差</th>
            </tr>
          </thead>
          <tbody className="num">
            {rows.map((r) => {
              const gap = r.winRate !== null && breakeven !== null ? r.winRate - breakeven : null;
              const verdict =
                !r.enough || !r.ci || breakeven === null ? null : r.ci.low > breakeven ? "上回る" : r.ci.high < breakeven ? "下回る" : null;
              return (
                <tr key={r.key} className={`border-b border-line/50 ${r.enough ? "" : "text-muted"}`}>
                  <td className="py-1.5 font-sans">
                    {r.label}
                    {!r.enough && (
                      <span className="ml-1.5 rounded border border-line px-1 py-px text-[10px] text-muted">判断不可</span>
                    )}
                    {verdict && (
                      <span className={`ml-1.5 rounded border px-1 py-px text-[10px] ${verdict === "上回る" ? "border-up/40 text-up" : "border-down/40 text-down"}`}>
                        区間ごと{verdict}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    {r.n}
                    {r.excluded + r.pending > 0 && <span className="ml-1 text-[10px] text-muted">(+{r.excluded + r.pending})</span>}
                  </td>
                  <td className="py-1.5 text-right">{r.wins}</td>
                  <td className="py-1.5 text-right">{r.losses}</td>
                  <td className={`py-1.5 text-right ${r.enough && gap !== null ? (gap > 0 ? "text-up" : "text-down") : ""}`}>{pct(r.winRate)}</td>
                  <td className="py-1.5 text-right">{r.ci ? `${pct(r.ci.low, 0)}〜${pct(r.ci.high, 0)}` : "—"}</td>
                  <td className="py-1.5 text-right">{gap === null ? "—" : `${gap > 0 ? "+" : ""}${(gap * 100).toFixed(1)}pt`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-muted">
        <li>件数は照合できた数（一致＋不一致）。（+n）は対象外・確認待ちで、勝率には入れていません。</li>
        <li>
          {MIN_SAMPLES}件未満の区分はグレーで「判断不可」。95%区間（ウィルソン法）の全体が損益分岐より上なら「区間ごと上回る」、下なら「区間ごと下回る」と表示します。
        </li>
        <li>区分をたくさん見比べると、偶然どれかが良く見えます。良さそうな条件は、そこから先の新しい記録で同じ結果が続くか確かめてください。</li>
        {note && <li>{note}</li>}
      </ul>
    </section>
  );
}

function DimNote({
  dim, terciles, unknownAtr, events, evRange, fmtDate, minImp, setMinImp,
}: {
  dim: Dim;
  terciles: { t1: number; t2: number } | null;
  unknownAtr: number;
  events: EventsState;
  evRange: { from: number; to: number } | null;
  fmtDate: (t: number) => string;
  minImp: Importance;
  setMinImp: (v: Importance) => void;
}) {
  const cls = "mb-3 text-xs leading-relaxed text-muted";
  if (dim === "session") {
    return (
      <p className={cls}>
        予測時刻（JST）で分けます。欧米の夏時間に合わせて境界が動きます。いま：{describeSessions(nowMs())}
      </p>
    );
  }
  if (dim === "vol") {
    return (
      <p className={cls}>
        予測時点の5分足 ATR(14)。このデータの全記録の分布で3等分しています
        {terciles ? `（低 ≦${terciles.t1.toFixed(1)} pips ＜ 中 ≦${terciles.t2.toFixed(1)} pips ＜ 高）` : "（記録が3件未満のため、まだ分けられません）"}。
        {unknownAtr > 0 && ` 価格履歴が足りず計算できない ${unknownAtr}件は「不明」です。`}
      </p>
    );
  }
  return (
    <div className={`${cls} flex flex-wrap items-center gap-x-3 gap-y-1`}>
      <span>
        予測時刻の前後{EVENT_WINDOW_MIN}分以内に、data/events.json に登録した指標があるか。
        {events.status === "loading" && " 読み込み中…"}
        {events.status === "error" && <span className="text-down"> {events.message}（全件「不明」）</span>}
        {events.status === "ok" && events.events.length === 0 && <span className="text-hold"> まだ1件も登録されていません（全件「なし」になります）。</span>}
        {events.status === "ok" && evRange && ` 登録 ${events.events.length}件（${fmtDate(evRange.from)}〜${fmtDate(evRange.to)}）。この期間の外の記録は、指標があっても「なし」になります。`}
        {events.status === "ok" && events.errors.length > 0 && <span className="text-hold"> 読めなかった行：{events.errors.join("、")}</span>}
      </span>
      <label className="flex items-center gap-1.5">
        対象の重要度
        <select
          value={minImp}
          onChange={(e) => setMinImp(e.target.value as Importance)}
          className="rounded-md border border-line bg-panel-2 px-1.5 py-0.5 text-xs text-ink"
        >
          <option value="high">{IMPORTANCE_LABEL.high}のみ</option>
          <option value="medium">{IMPORTANCE_LABEL.medium}以上</option>
          <option value="low">すべて</option>
        </select>
      </label>
    </div>
  );
}

type ChartRow = CondRow & { range: [number, number] | null };

/** 勝率の点と95%区間の線（区分ごと）。縦の破線が損益分岐 */
function WinRateChart({ rows, breakeven }: { rows: CondRow[]; breakeven: number | null }) {
  const data: ChartRow[] = rows.map((r) => ({ ...r, range: r.ci ? [r.ci.low, r.ci.high] : null }));
  if (!data.some((r) => r.n > 0)) {
    return <p className="rounded-xl border border-line bg-panel-2 p-3 text-xs text-muted">照合できた記録がまだありません。</p>;
  }
  return (
    <div className="w-full" style={{ height: 44 + data.length * 40 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} layout="vertical" margin={{ top: 18, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={92}
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          {breakeven !== null && (
            <ReferenceLine
              x={breakeven}
              stroke="var(--color-hold)"
              strokeDasharray="4 4"
              label={{ value: `損益分岐 ${pct(breakeven)}`, position: "top", fill: "var(--color-hold)", fontSize: 11 }}
            />
          )}
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as ChartRow | undefined;
              if (!active || !r) return null;
              return (
                <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs shadow-xl">
                  <div className="font-semibold">{r.label}{!r.enough && <span className="ml-1 font-normal text-muted">判断不可</span>}</div>
                  <div className="num">勝率 {pct(r.winRate)}（{r.wins}/{r.n}件）</div>
                  {r.ci && <div className="num text-muted">95%区間 {pct(r.ci.low)}〜{pct(r.ci.high)}</div>}
                </div>
              );
            }}
          />
          <Bar dataKey="range" isAnimationActive={false} shape={<Whisker />} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 区間の線＋端の短い縦線＋勝率の点 */
function Whisker(props: { x?: number; y?: number; width?: number; height?: number; payload?: ChartRow }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload?.ci || payload.winRate === null) return null;
  const color = payload.enough ? "var(--color-accent)" : "var(--color-muted)";
  const cy = y + height / 2;
  const span = payload.ci.high - payload.ci.low;
  const px = span > 0 ? x + ((payload.winRate - payload.ci.low) / span) * width : x;
  return (
    <g opacity={payload.enough ? 1 : 0.7}>
      <line x1={x} x2={x + width} y1={cy} y2={cy} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <line x1={x} x2={x} y1={cy - 5} y2={cy + 5} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <line x1={x + width} x2={x + width} y1={cy - 5} y2={cy + 5} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <circle cx={px} cy={cy} r={5} fill={color} stroke="var(--color-panel)" strokeWidth={2} />
    </g>
  );
}
