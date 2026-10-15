"use client";

import type { LiveStatus } from "@/lib/useLiveCandles";
import { formatDateTime } from "@/lib/format";

/** 実データモードの取得状況・エラー・休場をわかりやすく伝える */
export function LiveStatusBanner({
  status,
  stale,
  lastTime,
  onRetry,
  onUseDemo,
}: {
  status: LiveStatus;
  stale: boolean;
  lastTime: number | null;
  onRetry: () => void;
  onUseDemo: () => void;
}) {
  if (status.error) {
    const hint =
      status.error.code === "no_key"
        ? "プロジェクト直下の .env.local に FX_DATA_API_KEY=（キー）を書き、ターミナルで Ctrl+C → npm run dev で再起動してください。"
        : status.error.code === "invalid_key"
          ? "Twelve Data のダッシュボードでキーを確認し、.env.local を直して再起動してください。"
          : status.error.code === "rate_limit"
            ? "無料プランは1分8回・1日800回までです。数分おいてから「再取得」を押してください。"
            : "通信状況を確認して「再取得」を押してください。";
    return (
      <Banner tone="error" title={status.error.message}>
        <p>{hint}</p>
        {lastTime && <p className="mt-1">表示中のデータは {formatDateTime(lastTime)} までに取得したものです。</p>}
        <Actions onRetry={onRetry} onUseDemo={onUseDemo} loading={status.loading} />
      </Banner>
    );
  }

  if (stale && lastTime) {
    return (
      <Banner tone="info" title="市場が閉まっているようです">
        <p>
          最新の足が {formatDateTime(lastTime)} で止まっています。土日や祝日など、市場が閉まっている間は新しい予測を出せません。
          操作を試すときはサンプルモードを使ってください。
        </p>
        <Actions onRetry={onRetry} onUseDemo={onUseDemo} loading={status.loading} />
      </Banner>
    );
  }

  return null;
}

function Banner({ tone, title, children }: { tone: "error" | "info"; title: string; children: React.ReactNode }) {
  const style = tone === "error" ? "border-down/40 bg-down/10" : "border-hold/40 bg-hold/10";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-2xl border p-4 text-sm leading-relaxed ${style}`}>
      <p className="mb-1 font-semibold">{title}</p>
      <div className="text-ink/80">{children}</div>
    </div>
  );
}

function Actions({ onRetry, onUseDemo, loading }: { onRetry: () => void; onUseDemo: () => void; loading: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onRetry}
        disabled={loading}
        className="rounded-lg border border-line bg-panel px-3 py-1.5 hover:bg-panel-2 disabled:opacity-50"
      >
        {loading ? "取得中…" : "再取得"}
      </button>
      <button type="button" onClick={onUseDemo} className="rounded-lg px-3 py-1.5 text-muted hover:text-ink">
        サンプルモードに切り替える
      </button>
    </div>
  );
}
