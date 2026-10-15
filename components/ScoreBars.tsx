import type { Direction, DirectionScores } from "@/lib/types";
import { DIRECTION_LABEL } from "@/lib/format";

const ORDER: Direction[] = ["up", "down", "hold"];
const BAR: Record<Direction, string> = { up: "bg-up", down: "bg-down", hold: "bg-hold" };

export function ScoreBars({ scores, highlight }: { scores: DirectionScores; highlight: Direction }) {
  return (
    <ul className="space-y-2.5">
      {ORDER.map((d) => (
        <li key={d}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className={d === highlight ? "font-semibold" : "text-muted"}>{DIRECTION_LABEL[d]}</span>
            <span className="num text-muted">{scores[d]}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-panel-2" role="presentation">
            <div
              className={`h-full rounded-full ${BAR[d]} ${d === highlight ? "" : "opacity-40"}`}
              style={{ width: `${scores[d]}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
