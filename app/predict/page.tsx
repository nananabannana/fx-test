"use client";

// 短期予測：USD/JPY の5分後・10分後を、学習済みの数値モデル（ロジスティック回帰）で予測する。
// Claude は結果の説明だけを担当する。仮想取引は記録だけで、注文は送らない。

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useIsClient, nowMs } from "@/lib/useIsClient";
import { STALE_MS, usePredictStore, useRecentCandles } from "@/lib/predict/usePredict";
import { aggregate } from "@/lib/predict/ta";
import { describeFeature, REGIME_LABEL, REGIME_NOTE } from "@/lib/predict/features";
import { CLASS_LABEL } from "@/lib/predict/evaluate";
import { HORIZONS, type Horizon, type HorizonPrediction } from "@/lib/predict/model";
import type { Explanation, ExplainResult, ModelResult, PredictRun, RunResult } from "@/lib/predict/types";
import {
  balanceOf, canOpen, openTrade, outcomeAt, sizePosition, todayPnl,
  type DemoSettings, type PredictionRecord,
} from "@/lib/predict/demo";
import { SESSION_LABEL } from "@/lib/conditions";
import { PIP } from "@/lib/config";
import type { Candle } from "@/lib/types";
import { CandleChart } from "@/components/CandleChart";
import { Button, Card, ErrorBox, Kpi, Notice, Spinner } from "@/components/stocks/ui";
import { ClsTag, fmtDateTime, fmtTime, fmtTimeSec, pct, ProbBars, yen } from "@/components/predict/parts";

const MIN = 60_000;

export default function PredictPage() {
  const isClient = useIsClient();
  if (!isClient) return <p className="py-10 text-center text-sm text-muted">読み込み中…</p>;
  return <PredictView />;
}

function useNow(ms = 15_000) {
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowMs()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

function toRecord(run: PredictRun): PredictionRecord {
  const h = (p: HorizonPrediction) => ({
    percents: p.percents, probs: p.probs, direction: p.direction, bandPips: p.bandPips, movePips: p.movePips, provisional: p.provisional, base: p.baseProbs,
  });
  return {
    id: run.id, at: run.at, price: run.price, modelVersion: run.modelVersion, regime: run.regime, session: run.session,
    atrPips: run.raw.atr5Pips, spreadPips: null, horizons: { 5: h(run.horizons[5]), 10: h(run.horizons[10]) }, actual: {},
  };
}

function PredictView() {
  const live = useRecentCandles();
  const candles = useMemo(() => live.data?.candles ?? [], [live.data]);
  const store = usePredictStore(candles);
  const now = useNow();
  const [model, setModel] = useState<ModelResult | null>(null);
  const [run, setRun] = useState<PredictRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch("/api/predict/model", { cache: "no-store" })
      .then((r) => r.json() as Promise<ModelResult>)
      .then(setModel)
      .catch(() => setModel({ ok: false, error: { code: "network", message: "モデルの状態を読み込めませんでした。" } }));
  }, []);

  const last = candles.at(-1) ?? null;
  const stale = !!last && now - (last.time + MIN) > STALE_MS;
  const hasModel = model?.ok && model.model !== null;
  const blocked = !last
    ? live.loading ? "価格データを取得しています…" : "価格データがまだありません。"
    : stale ? "最新の足が10分以上前で止まっています。市場が閉まっている間（週末など）は分析できません。"
    : model && model.ok && !model.model ? "予測モデルがまだありません。「モデル」タブで学習してください。"
    : null;

  const analyze = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch("/api/predict/run", { method: "POST" });
      const body = (await res.json()) as RunResult;
      if (body.ok) {
        setRun(body.run);
        store.addRecord(toRecord(body.run));
      } else {
        setRun(null); // 失敗したときに前の結果を新しいものとして見せない
        setRunError(body.error.message);
      }
    } catch {
      setRun(null);
      setRunError("アプリのサーバーに接続できませんでした。");
    } finally {
      setRunning(false);
    }
  };

  const runFresh = run && last ? last.time - run.at <= 2 * MIN && !stale : false;

  return (
    <div className="space-y-4">
      <PriceHeader live={live} now={now} stale={stale} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <ChartCard candles={candles} />
        <Card title="AI分析">
          <p className="mb-3 text-xs leading-relaxed text-muted">
            学習済みの数値モデルが、1分足・5分足・15分足の指標から5分後・10分後の「上昇・横ばい・下降」の確率を出します（合計100%）。
            Claude は結果の説明だけを担当し、確率は作りません。
          </p>
          <Button variant="primary" onClick={analyze} disabled={running || !!blocked}>
            {running && <Spinner />} AI分析を実行
          </Button>
          {blocked && <p className="mt-2 text-xs text-hold">{blocked}{model?.ok && !model.model && <> → <Link href="/predict/model" className="text-accent underline">モデル</Link></>}</p>}
          {runError && <div className="mt-3"><ErrorBox message={runError} /></div>}
          {hasModel && model.ok && model.model && (
            <p className="mt-3 text-[11px] text-muted">
              使用モデル：<span className="num">{model.model.version}</span>（学習 {fmtDateTime(model.model.createdAt)}・データ {fmtDateTime(model.model.data.from)}〜{fmtDateTime(model.model.data.to)}）
            </p>
          )}
          {run && (
            <p className={`mt-2 text-[11px] ${runFresh ? "text-muted" : "text-hold"}`}>
              分析時点：{fmtTime(run.at)} の足（終値 <span className="num">{run.price.toFixed(3)}</span>）{!runFresh && "。新しい足が出ています。結果は古くなっています"}
            </p>
          )}
        </Card>
      </div>

      {run && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {HORIZONS.map((h) => <HorizonCard key={h} h={h} p={run.horizons[h]} run={run} />)}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RegimeCard run={run} />
            <CautionCard run={run} />
          </div>
          <ExplainCard run={run} />
        </>
      )}

      <DemoTradePanel run={runFresh ? run : null} candles={candles} store={store} now={now} />

      <RecentRecords records={store.records} />
    </div>
  );
}

function PriceHeader({ live, now, stale }: { live: ReturnType<typeof useRecentCandles>; now: number; stale: boolean }) {
  const last = live.data?.candles.at(-1);
  const delayMin = last ? Math.max(0, Math.floor((now - (last.time + MIN)) / MIN)) : null;
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted">USD/JPY（直近の確定1分足の終値）</p>
          <p className={`num text-3xl font-bold tracking-tight ${stale ? "text-muted" : ""}`}>{last ? last.close.toFixed(3) : "—"}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
          <dt className="text-muted">取得元</dt><dd>{live.data?.provider ?? "—"}</dd>
          <dt className="text-muted">足の時刻</dt><dd className="num">{last ? `${fmtTime(last.time)}〜${fmtTime(last.time + MIN)}` : "—"}</dd>
          <dt className="text-muted">取得時刻</dt><dd className="num">{live.data ? fmtTimeSec(live.data.fetchedAt) : "—"}</dd>
          <dt className="text-muted">遅れ</dt><dd className={`num ${delayMin !== null && delayMin >= 3 ? "text-hold" : ""}`}>{delayMin === null ? "—" : `${delayMin}分`}</dd>
        </dl>
        <Button onClick={live.refresh} disabled={live.loading}>{live.loading && <Spinner />}再取得</Button>
      </div>
      {live.data && <p className="mt-2 text-[11px] text-muted">{live.data.delayNote}。1分ごとに自動更新（画面を開いている間だけ）。</p>}
      {stale && <div className="mt-2"><Notice tone="warn">最新の足が10分以上前のものです。この価格を現在値として扱わないでください（市場が閉まっている可能性）。</Notice></div>}
      {live.error && <div className="mt-2"><ErrorBox message={`${live.error.message}${live.data ? "（表示は前回取得したデータです）" : ""}`} onRetry={live.refresh} /></div>}
    </Card>
  );
}

function ChartCard({ candles }: { candles: Candle[] }) {
  const [tf, setTf] = useState<1 | 5 | 15>(1);
  const shown = useMemo(() => {
    const last = candles.at(-1);
    if (!last) return [];
    if (tf === 1) return candles.slice(-90);
    return aggregate(candles, tf, last.time + MIN).slice(-60);
  }, [candles, tf]);
  return (
    <Card
      title="チャート"
      right={
        <div role="tablist" aria-label="時間軸" className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5 text-xs">
          {([1, 5, 15] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={tf === v} onClick={() => setTf(v)}
              className={`rounded-md px-2.5 py-1 ${tf === v ? "bg-panel font-semibold text-ink" : "text-muted hover:text-ink"}`}>
              {v}分足
            </button>
          ))}
        </div>
      }
    >
      {shown.length ? (
        <div className="flex h-[280px] flex-col sm:h-[340px]">
          <CandleChart candles={shown} />
        </div>
      ) : <p className="py-16 text-center text-sm text-muted">データがありません。</p>}
      {tf !== 1 && <p className="mt-1 text-[11px] text-muted">{tf}分足は1分足から作成（確定した足のみ）。</p>}
    </Card>
  );
}

function HorizonCard({ h, p, run }: { h: Horizon; p: HorizonPrediction; run: PredictRun }) {
  const lo = run.price - p.movePips * PIP;
  const hi = run.price + p.movePips * PIP;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {h}分後の予測
          {p.provisional && <span className="rounded border border-hold/50 px-1.5 py-px text-[10px] font-normal text-hold">暫定の推定値</span>}
        </span>
      }
      right={<span className="text-[11px] text-muted">判定 {fmtTime(run.at + h * MIN)} の足の終値</span>}
    >
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted">一番高い確率：</span>
        <ClsTag cls={p.direction} size="lg" />
        <span className="num text-lg font-bold">{p.percents[p.direction]}%</span>
      </div>
      <ProbBars percents={p.percents} highlight={p.direction} />
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <Kpi label="変動幅の目安" value={`±${p.movePips} pips`} hint={`${lo.toFixed(3)}〜${hi.toFixed(3)}（過去の中央値から）`} />
        <Kpi label="横ばいの幅" value={`±${p.bandPips} pips未満`} hint="この幅より小さい変化は「横ばい」" />
        <Kpi label="テスト期間の的中率" value={pct(p.testAccuracy, 0)} hint={`比較用の基準 ${pct(p.baselineAccuracy, 0)}（学習に使っていない期間）`} />
        <Kpi
          label={`${REGIME_LABEL[run.regime]}での的中率`}
          value={pct(p.regimeAccuracy.accuracy, 0)}
          hint={`テスト期間 ${p.regimeAccuracy.n}件${p.regimeAccuracy.n < 100 ? "（件数が少なく参考程度）" : ""}`}
        />
      </dl>
      <h3 className="mb-1 mt-3 text-xs font-semibold text-muted">予測の根拠（効いた要素の大きい順）</h3>
      <ul className="space-y-1 text-sm">
        {p.contributions.slice(0, 4).map((c) => (
          <li key={c.name} className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span>
              {c.label}
              {c.name !== "hourSin" && c.name !== "hourCos" && <span className="num ml-1.5 text-xs text-muted">{describeFeature(c.name, run.raw)}</span>}
            </span>
            <span className={`text-xs ${c.effect > 0 ? "text-up" : "text-down"}`}>{c.effect > 0 ? "▲ 上昇寄り" : "▼ 下降寄り"}</span>
          </li>
        ))}
      </ul>
      {p.provisional && <p className="mt-2 text-[11px] leading-relaxed text-hold">暫定の理由：{p.provisionalReasons.join("／")}</p>}
    </Card>
  );
}

function RegimeCard({ run }: { run: PredictRun }) {
  const r = run.raw;
  return (
    <Card title={<>相場状態：{REGIME_LABEL[run.regime]}</>}>
      <p className="mb-3 text-sm leading-relaxed text-ink/85">{REGIME_NOTE[run.regime]}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {[
          ["ATR 1分/5分/15分", `${r.atr1Pips} / ${r.atr5Pips} / ${r.atr15Pips} pips`],
          ["RSI(14)・1分足", `${r.rsi14}`],
          ["60分の一方向性", `${r.efficiency60}`],
          ["直近60分の高値/安値", `${r.high60.toFixed(3)} / ${r.low60.toFixed(3)}`],
          ["15分前比", `${r.change15Pips > 0 ? "+" : ""}${r.change15Pips} pips`],
          ["時間帯", SESSION_LABEL[run.session]],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="num">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function CautionCard({ run }: { run: PredictRun }) {
  return (
    <Card title="注意事項・コスト">
      <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink/85">
        {run.cautions.map((c) => <li key={c}>{c}</li>)}
        <li>予測は「その時点のデータから見た確率」で、結果を保証しません。判定時刻が来るまでは結果は確定していません。</li>
      </ul>
      <p className="mt-2 text-[11px] text-muted">データ：{run.provider}（{run.delayNote}）・取得 {fmtTimeSec(run.fetchedAt)}</p>
    </Card>
  );
}

function ExplainCard({ run }: { run: PredictRun }) {
  const [state, setState] = useState<{ id: string; ex?: Explanation; err?: string; busy?: boolean } | null>(null);
  const cur = state?.id === run.id ? state : null;
  const ask = async () => {
    setState({ id: run.id, busy: true });
    try {
      const res = await fetch("/api/predict/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: run.id }) });
      const body = (await res.json()) as ExplainResult;
      setState(body.ok ? { id: run.id, ex: body.explanation } : { id: run.id, err: body.error.message });
    } catch {
      setState({ id: run.id, err: "アプリのサーバーに接続できませんでした。" });
    }
  };
  return (
    <Card title="Claude による説明" right={<Button onClick={ask} disabled={cur?.busy}>{cur?.busy && <Spinner />}説明を聞く</Button>}>
      <p className="text-xs text-muted">モデルの数値をそのまま渡して、言葉で説明してもらいます（1回ごとに API 料金）。確率や方向は Claude には決めさせません。</p>
      {cur?.err && <div className="mt-3"><ErrorBox message={cur.err} /></div>}
      {cur?.ex && (
        <div className="mt-3 space-y-2 text-sm leading-relaxed">
          {cur.ex.summary && <p>{cur.ex.summary}</p>}
          {cur.ex.points.length > 0 && <ul className="list-disc space-y-1 pl-5">{cur.ex.points.map((s) => <li key={s}>{s}</li>)}</ul>}
          {cur.ex.cautions.length > 0 && <ul className="list-disc space-y-1 pl-5 text-hold">{cur.ex.cautions.map((s) => <li key={s}>{s}</li>)}</ul>}
          {cur.ex.removed > 0 && <p className="text-[11px] text-muted">モデルが出していない数値（％）を含む文 {cur.ex.removed}件は表示していません。</p>}
        </div>
      )}
    </Card>
  );
}

// ---------------- 仮想取引 ----------------

function DemoTradePanel({ run, candles, store, now }: {
  run: PredictRun | null;
  candles: Candle[];
  store: ReturnType<typeof usePredictStore>;
  now: number;
}) {
  const { trades, settings: s, setSettings, addTrade, resetTrades } = store;
  const [confirmReset, setConfirmReset] = useState(false);
  const balance = balanceOf(trades, s.startBalance);
  const today = todayPnl(trades, now);
  const remaining = Math.max(0, s.dailyLossLimit + Math.min(0, today));
  const open = trades.find((t) => t.status === "open") ?? null;
  const last = candles.at(-1);
  const set = (patch: Partial<DemoSettings>) => setSettings({ ...s, ...patch });

  const pred = run?.horizons[s.holdMin];
  const side = pred?.direction === "up" ? "buy" : pred?.direction === "down" ? "sell" : null;
  const sizing = run ? sizePosition({ balance, riskYen: s.riskYen, stopPips: s.stopPips, minUnit: s.minUnit, price: run.price, marginRate: s.marginRate }) : null;
  const gate = sizing?.ok ? canOpen({ trades, now, riskAtStop: sizing.riskAtStop, settings: s }) : null;
  const reason = !run
    ? "最新の予測がありません。先に「AI分析を実行」してください（予測から2分以内の足でエントリーします）。"
    : !side ? `${s.holdMin}分後の予測が「横ばい」のため見送りです。`
    : sizing && !sizing.ok ? sizing.reason
    : gate && !gate.ok ? gate.reason
    : null;

  const enter = () => {
    if (!run || !side || !sizing?.ok || reason) return;
    addTrade(openTrade({ id: `t-${nowMs().toString(36)}`, predictionId: run.id, side, at: run.at, price: run.price, units: sizing.units, stopPips: s.stopPips, holdMin: s.holdMin, riskAtStop: sizing.riskAtStop }));
  };

  const unreal = open && last ? Math.round((last.close - open.entry) * (open.side === "buy" ? 1 : -1) * open.units) : null;

  return (
    <Card title="仮想取引（デモ）" right={<span className="text-[11px] text-muted">注文は送りません・スプレッド等のコストは反映していません</span>}>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="仮想資金" value={`${balance.toLocaleString("ja-JP")}円`} hint={`開始 ${s.startBalance.toLocaleString("ja-JP")}円`} />
        <Kpi label="今日の損益" value={yen(today)} tone={today > 0 ? "up" : today < 0 ? "down" : undefined} />
        <Kpi label="今日の損失の残り枠" value={`${remaining}円`} hint={`1日の上限 ${s.dailyLossLimit}円`} tone={remaining < 50 ? "down" : undefined} />
        <Kpi label="保有" value={open ? `${open.side === "buy" ? "買い" : "売り"} ${open.units.toLocaleString()}通貨` : "なし"} hint="同時保有は1つまで" />
      </dl>

      {open && (
        <div className="mt-3 rounded-xl border border-line bg-panel-2 p-3 text-sm">
          <p>
            {open.side === "buy" ? "▲ 買い" : "▼ 売り"} <span className="num">{open.entry.toFixed(3)}</span>・損切り <span className="num">{open.stopPrice.toFixed(3)}</span>（{open.stopPips} pips・最大 −{open.riskYen}円）・
            手仕舞い {fmtTime(open.exitAt + MIN)}
          </p>
          {unreal !== null && <p className="num mt-1 text-xs text-muted">いまの評価損益 {yen(unreal)}（最新の足の終値で計算）</p>}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted">損切り幅（pips）
          <input type="number" min={1} max={30} step={0.5} value={s.stopPips}
            onChange={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 30) set({ stopPips: v }); }}
            className="num mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
        </label>
        <label className="text-xs text-muted">1回の許容損失（円）
          <select value={s.riskYen} onChange={(e) => set({ riskYen: Number(e.target.value) })}
            className="mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink">
            {[50, 60, 70, 80, 90, 100].map((v) => <option key={v} value={v}>{v}円</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">保有時間（使う予測）
          <select value={s.holdMin} onChange={(e) => set({ holdMin: Number(e.target.value) === 10 ? 10 : 5 })}
            className="mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink">
            <option value={5}>5分（5分後の予測）</option>
            <option value={10}>10分（10分後の予測）</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={enter} disabled={!!reason}>
          {side === "sell" ? "▼ 仮想で売る" : side === "buy" ? "▲ 仮想で買う" : "仮想エントリー"}
        </Button>
        {sizing?.ok && side && (
          <span className="text-xs text-muted">
            数量 {sizing.units.toLocaleString()}通貨・損切り時 −{sizing.riskAtStop}円・必要証拠金 {sizing.margin.toLocaleString()}円{sizing.note && `（${sizing.note}）`}
          </span>
        )}
      </div>
      {reason && <p className="mt-2 text-xs text-hold">見送り：{reason}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        数量 ＝ 許容損失 ÷ 損切り幅 を {s.minUnit.toLocaleString()}通貨単位で切り捨て（必要証拠金 {s.marginRate * 100}% も確認）。予測の確率が高くても数量は増やしません。
        エントリーは予測時点の足の終値、手仕舞いは損切りか保有時間の終わりの足の終値（同じ足では損切りを優先）。
      </p>

      {trades.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-muted">取引 {trades.length}件（成績は「検証」タブ）</span>
          <button type="button" onClick={() => (confirmReset ? (resetTrades(), setConfirmReset(false)) : setConfirmReset(true))}
            className="rounded-md border border-line px-2 py-1 text-muted hover:text-ink">
            {confirmReset ? "もう一度押すと仮想口座をリセット" : "仮想口座をリセット"}
          </button>
        </div>
      )}
    </Card>
  );
}

function RecentRecords({ records }: { records: PredictionRecord[] }) {
  if (!records.length) return null;
  return (
    <Card title="最近の予測" right={<Link href="/predict/verify" className="text-xs text-accent hover:underline">すべての検証 →</Link>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line text-left">
              <th className="py-1.5 font-normal">時刻</th>
              <th className="py-1.5 text-right font-normal">価格</th>
              {HORIZONS.map((h) => <th key={h} className="py-1.5 pl-3 font-normal">{h}分後：予測 → 実際</th>)}
            </tr>
          </thead>
          <tbody>
            {records.slice(0, 8).map((r) => (
              <tr key={r.id} className="border-b border-line/50">
                <td className="num py-1.5">{fmtDateTime(r.at)}</td>
                <td className="num py-1.5 text-right">{r.price.toFixed(3)}</td>
                {HORIZONS.map((h) => {
                  const o = outcomeAt(r, h);
                  return (
                    <td key={h} className="py-1.5 pl-3">
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <ClsTag cls={r.horizons[h].direction} />
                        <span className="num text-xs text-muted">{r.horizons[h].percents[r.horizons[h].direction]}%</span>
                        <span className="text-muted">→</span>
                        {o.status === "settled" ? (
                          <>
                            <ClsTag cls={o.actual} />
                            <span className={`text-xs font-semibold ${o.hit ? "text-up" : "text-down"}`}>{o.hit ? "○的中" : "×外れ"}</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted">{o.status === "pending" ? "判定待ち" : "取得できず"}</span>
                        )}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted">{CLASS_LABEL.flat}は「横ばいの幅」未満の変化。判定時刻の足が確定するまでは「判定待ち」です。</p>
    </Card>
  );
}

