"use client";

import type { DataSource, VerifiedPrediction } from "@/lib/types";
import type { Engine } from "@/lib/analysisTypes";
import type { AnalysisError } from "@/lib/store";
import { formatDateTime, formatPips, formatPrice, OUTCOME_LABEL } from "@/lib/format";
import { SourceBadge } from "./SourceBadge";
import { DirectionTag } from "./DirectionTag";
import { ScoreBars } from "./ScoreBars";
import { OutcomeTag } from "./OutcomeTag";

export function ResultPanel({
  result,
  analyzing,
  mode,
  engine,
  error,
  onRunDemo,
  onAdvance,
  canAdvance,
}: {
  result: VerifiedPrediction | null;
  analyzing: boolean;
  mode: DataSource;
  engine: Engine;
  error: { code: string; message: string } | AnalysisError | null;
  onRunDemo: () => void;
  onAdvance: () => void;
  canAdvance: boolean;
}) {
  // 表示中の結果があればその記録のエンジン、なければ今選んでいるエンジン
  const shownEngine: Engine = analyzing || !result ? engine : (result.engine ?? "demo");
  const isClaude = result?.engine === "claude";

  return (
    <section aria-live="polite" className="flex h-full flex-col rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted">予測結果</h2>
        <SourceBadge source={mode} kind="result" engine={shownEngine} />
      </div>

      {error && !analyzing && <ErrorBox error={error} onRunDemo={onRunDemo} />}

      {analyzing ? (
        <Loading engine={engine} />
      ) : !result ? (
        !error && <Empty engine={engine} />
      ) : (
        <div className="flex flex-1 flex-col gap-5">
          <div>
            <p className="mb-2 text-xs text-muted">
              {formatDateTime(result.at)} 時点 → {result.horizonMinutes}分後の方向
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <DirectionTag direction={result.direction} size="lg" />
              <span className="num text-sm text-muted">基準 {formatPrice(result.basePrice)}</span>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted">
              {isClaude ? "見込み（Claude の自己評価）" : "予測スコア（デモ指標の参考値）"}
            </h3>
            <ScoreBars scores={result.scores} highlight={result.direction} />
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              {isClaude
                ? "Claude が与えられたデータから主観的につけた見込みです。実際の確率や的中率ではありません。精度は検証画面で確かめてください。"
                : "簡単な指標から機械的に出した参考値です。実際の確率や的中率ではありません。"}
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted">
              分析理由{isClaude ? `（${result.model ?? "Claude"}）` : "（デモ指標）"}
            </h3>
            <ul className="space-y-2 text-sm leading-relaxed">
              {result.reasons.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-auto rounded-xl border border-line bg-panel-2 p-3">
            {result.outcome === "pending" && result.source === "live" ? (
              <p className="text-sm text-muted">
                {result.horizonMinutes}分後の実績：{OUTCOME_LABEL.pending}（{result.horizonMinutes}分後の足が確定すると自動で照合します）
              </p>
            ) : result.outcome === "unavailable" ? (
              <p className="text-sm text-muted">{result.horizonMinutes}分後の実績：{OUTCOME_LABEL.unavailable}（データの取得範囲外です）</p>
            ) : result.outcome === "pending" ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted">{result.horizonMinutes}分後の実績：{OUTCOME_LABEL.pending}</p>
                <button
                  type="button"
                  onClick={onAdvance}
                  disabled={!canAdvance}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-panel disabled:opacity-40"
                >
                  サンプル時間を{result.horizonMinutes}分進める
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span className="text-muted">{result.horizonMinutes}分後の実績</span>
                {result.actualDirection && <DirectionTag direction={result.actualDirection} actual />}
                <span className="num">
                  {formatPrice(result.actualPrice!)}（{formatPips(result.changePips!)} pips）
                </span>
                <OutcomeTag outcome={result.outcome} />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const HINT: Record<string, string> = {
  no_key: "プロジェクト直下の .env.local に ANTHROPIC_API_KEY=（キー）を1行追加し、サーバーを再起動（Ctrl+C → npm run dev）してください。",
  invalid_key: "Claude Console でキーを確認し、.env.local を直して再起動してください。",
  no_credit: "Claude Console の Billing でクレジットを追加してください。",
  rate_limit: "1分ほど待ってからもう一度お試しください。",
  overloaded: "1分ほど待ってからもう一度お試しください。",
  daily_limit: "明日になると回数が戻ります。",
  too_soon: "数秒待ってからもう一度押してください。",
};

function ErrorBox({ error, onRunDemo }: { error: { code: string; message: string }; onRunDemo: () => void }) {
  return (
    <div role="alert" className="mb-4 rounded-xl border border-down/40 bg-down/10 p-3 text-sm leading-relaxed">
      <p className="font-semibold">{error.message}</p>
      {HINT[error.code] && <p className="mt-1 text-ink/80">{HINT[error.code]}</p>}
      <button
        type="button"
        onClick={onRunDemo}
        className="mt-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm hover:bg-panel-2"
      >
        今回はデモ指標で分析する
      </button>
    </div>
  );
}

function Empty({ engine }: { engine: Engine }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted">
      <p>「AI分析を実行」を押すと、ここに予測結果が表示されます。</p>
      <p className="text-xs">
        {engine === "claude"
          ? "Claude がローソク足と指標を読んで、指定した時間後の方向と理由を答えます（1回ごとにAPI料金がかかります）。"
          : "デモ指標は、移動平均・勢い・RSI から機械的に判断します（AIは使いません）。"}
      </p>
    </div>
  );
}

function Loading({ engine }: { engine: Engine }) {
  return (
    <div className="flex flex-1 flex-col gap-4 py-2" aria-label="分析中">
      <div className="h-8 w-32 animate-pulse rounded-md bg-panel-2" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-3 animate-pulse rounded bg-panel-2" />
        ))}
      </div>
      <div className="h-20 animate-pulse rounded-lg bg-panel-2" />
      <p className="text-xs text-muted">
        {engine === "claude" ? "Claude が分析しています（数秒〜十数秒）…" : "データを分析しています…"}
      </p>
    </div>
  );
}
