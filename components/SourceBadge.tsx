import type { DataSource } from "@/lib/types";
import type { Engine } from "@/lib/analysisTypes";

/**
 * データと分析エンジンの出どころを示すバッジ。
 * - サンプル（架空データ）は紫、実データは青
 * - 結果用（kind="result"）では、分析エンジンも併記する
 */
export function SourceBadge({
  source,
  kind = "data",
  engine,
}: {
  source: DataSource;
  kind?: "data" | "result";
  engine?: Engine;
}) {
  const data = source === "demo" ? "サンプル" : "実データ";
  const label = kind === "result" ? `${data} × ${engine === "claude" ? "Claude" : "デモ指標"}` : data;
  const style =
    source === "demo"
      ? "border-demo/50 bg-demo/10 text-demo"
      : "border-accent/50 bg-accent/10 text-accent";
  const dot = source === "demo" ? "bg-demo" : "bg-accent";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${style}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

/** 履歴の行などに付ける、小さなエンジン表示 */
export function EngineTag({ engine }: { engine: Engine }) {
  return (
    <span
      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        engine === "claude" ? "bg-accent/15 text-accent" : "bg-panel-2 text-muted"
      }`}
    >
      {engine === "claude" ? "Claude" : "指標"}
    </span>
  );
}
