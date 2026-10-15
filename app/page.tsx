"use client";

import Link from "next/link";
import { usePredictions } from "@/lib/store";
import { PAIR, PIP } from "@/lib/config";
import { formatDateTime, formatPips, formatPrice, formatTime } from "@/lib/format";
import { CandleChart } from "@/components/CandleChart";
import { ResultPanel } from "@/components/ResultPanel";
import { HistoryList } from "@/components/HistoryList";
import { EngineSwitch, HorizonSwitch, ModeSwitch } from "@/components/ModeSwitch";
import { SourceBadge } from "@/components/SourceBadge";
import { LiveStatusBanner } from "@/components/LiveStatusBanner";

export default function AnalyzePage() {
  const {
    mode,
    setMode,
    engine,
    setEngine,
    horizon,
    setHorizon,
    analysisError,
    runDemoInstead,
    visibleCandles,
    history,
    latest,
    analyzing,
    canAnalyze,
    blockedReason,
    runAnalysis,
    advance,
    canAdvance,
    reset,
    live,
  } = usePredictions();

  const last = visibleCandles[visibleCandles.length - 1];
  const prev = visibleCandles[visibleCandles.length - 2];
  const change = last && prev ? (last.close - prev.close) / PIP : 0;
  const isLive = mode === "live";

  const onReset = () => {
    if (isLive && !window.confirm("実データの予測履歴をすべて消去します。よろしいですか？")) return;
    reset();
  };

  const engineText = engine === "claude" ? "Claude が分析します（1回ごとにAPI料金）" : "デモ指標で分析します（AIは使いません）";
  const caption = blockedReason
    ? blockedReason
    : isLive
      ? `直近の確定した1分足を、${engineText}`
      : `サンプル時間を6分進めて、${engineText}`;

  return (
    <div className="space-y-4">
      {/* 分析対象と実行ボタン */}
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ModeSwitch mode={mode} onChange={setMode} disabled={analyzing} />
            <EngineSwitch engine={engine} onChange={setEngine} disabled={analyzing} />
            <HorizonSwitch horizon={horizon} onChange={setHorizon} disabled={analyzing} />
          </div>
          {isLive && (
            <p className="flex items-center gap-2 text-xs text-muted">
              {live.status.loading && (
                <span className="size-3 animate-spin rounded-full border-2 border-muted/40 border-t-muted" aria-hidden />
              )}
              {live.status.fetchedAt
                ? `${live.status.provider ?? "API"}・${formatTime(live.status.fetchedAt)} 取得（1分ごとに自動更新）`
                : "取得待ち"}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <p className="text-xs text-muted">通貨ペア</p>
              <p className="text-2xl font-bold tracking-tight">{PAIR}</p>
            </div>
            <div>
              <p className="text-xs text-muted">予測期間</p>
              <p className="text-2xl font-bold tracking-tight">{horizon}分後</p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                {isLive ? "直近の確定値" : "現在値"} <SourceBadge source={mode} />
              </p>
              <p className="num text-2xl font-bold">
                {last ? formatPrice(last.close) : "—"}
                {last && prev && (
                  <span className={`ml-2 text-sm ${change >= 0 ? "text-up" : "text-down"}`}>{formatPips(change)}</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-1.5 sm:max-w-[280px] sm:items-end">
            <button
              type="button"
              onClick={runAnalysis}
              disabled={!canAnalyze}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-base font-bold text-bg shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analyzing ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-bg/40 border-t-bg" aria-hidden />
                  分析中…
                </>
              ) : engine === "claude" ? (
                "AI分析を実行"
              ) : (
                "指標で分析を実行"
              )}
            </button>
            <p className="text-[11px] leading-relaxed text-muted sm:text-right">{caption}</p>
          </div>
        </div>
      </section>

      {isLive && (
        <LiveStatusBanner
          status={live.status}
          stale={live.stale}
          lastTime={live.lastTime}
          onRetry={live.refresh}
          onUseDemo={() => setMode("demo")}
        />
      )}

      {/* チャートと結果 */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="flex flex-col rounded-2xl border border-line bg-panel p-3 sm:p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold">
              {PAIR} 1分足 <span className="font-normal text-muted">直近{visibleCandles.length || 60}本</span>
            </h2>
            <span className="text-xs text-muted">
              {last ? `${formatDateTime(last.time)} 時点` : ""}
              {isLive ? "（Twelve Data）" : "（架空データ）"}
            </span>
          </div>
          {visibleCandles.length > 1 ? (
            <CandleChart candles={visibleCandles} markers={history} />
          ) : (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted sm:h-[360px] lg:h-auto lg:min-h-[360px] lg:flex-1">
              {live.status.loading ? "実データを取得しています…" : "表示できるデータがありません"}
            </div>
          )}
          <p className="mt-2 px-1 text-[11px] text-muted">● 印は過去の予測時点（緑=上昇／赤=下落／黄=保留）</p>
        </section>

        <ResultPanel
          result={latest}
          analyzing={analyzing}
          mode={mode}
          engine={engine}
          error={analysisError}
          onRunDemo={runDemoInstead}
          onAdvance={advance}
          canAdvance={canAdvance}
        />
      </div>

      {/* 履歴 */}
      <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            予測履歴 <SourceBadge source={mode} />
          </h2>
          <div className="flex items-center gap-3 text-sm">
            <button type="button" onClick={onReset} className="text-muted underline-offset-4 hover:text-ink hover:underline">
              {isLive ? "履歴を消去" : "デモをリセット"}
            </button>
            <Link href="/verify" className="font-semibold text-accent underline-offset-4 hover:underline">
              検証画面へ →
            </Link>
          </div>
        </div>
        <HistoryList items={history.slice(0, 8)} />
      </section>
    </div>
  );
}
