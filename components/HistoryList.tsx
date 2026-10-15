import type { VerifiedPrediction } from "@/lib/types";
import { formatDateTime, formatPips, formatPrice } from "@/lib/format";
import { DirectionTag } from "./DirectionTag";
import { OutcomeTag } from "./OutcomeTag";
import { EngineTag } from "./SourceBadge";

/** 予測履歴。スマホでは縦並びのカード、PCでは表形式になります。 */
export function HistoryList({ items }: { items: VerifiedPrediction[] }) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">まだ履歴がありません。</p>;
  }
  return (
    <div>
      <div className="hidden grid-cols-[1.2fr_1fr_1fr_1fr_1fr_0.8fr] gap-3 border-b border-line px-3 pb-2 text-xs text-muted md:grid">
        <span>予測時刻</span>
        <span>予測</span>
        <span className="text-right">基準価格</span>
        <span className="text-right">実績（期間後）</span>
        <span className="text-right">変化（pips）</span>
        <span className="text-right">照合</span>
      </div>
      <ul className="divide-y divide-line">
        {items.map((p) => (
          <li
            key={p.id}
            className="grid grid-cols-2 items-center gap-x-3 gap-y-1.5 px-1 py-3 text-sm md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_0.8fr] md:px-3"
          >
            <span className="num text-muted md:text-ink">{formatDateTime(p.at)}</span>
            <span className="flex items-center gap-1.5 justify-self-end md:justify-self-start">
              <DirectionTag direction={p.direction} />
              <span className="num rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted">{p.horizonMinutes}分</span>
              <EngineTag engine={p.engine ?? "demo"} />
            </span>
            <span className="num text-muted md:text-right md:text-ink">
              <span className="md:hidden">基準 </span>
              {formatPrice(p.basePrice)}
            </span>
            <span className="num justify-self-end md:text-right">
              <span className="text-muted md:hidden">実績 </span>
              {p.actualPrice !== null ? formatPrice(p.actualPrice) : "—"}
            </span>
            <span
              className={`num md:text-right ${
                p.changePips === null ? "text-muted" : p.changePips > 0 ? "text-up" : p.changePips < 0 ? "text-down" : ""
              }`}
            >
              <span className="text-muted md:hidden">変化 </span>
              {p.changePips !== null ? formatPips(p.changePips) : "—"}
            </span>
            <span className="justify-self-end">
              <OutcomeTag outcome={p.outcome} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
