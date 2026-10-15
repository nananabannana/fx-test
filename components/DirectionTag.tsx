import type { Direction } from "@/lib/types";
import { ACTUAL_LABEL, DIRECTION_LABEL } from "@/lib/format";

const STYLE: Record<Direction, string> = {
  up: "text-up bg-up/10 border-up/40",
  down: "text-down bg-down/10 border-down/40",
  hold: "text-hold bg-hold/10 border-hold/40",
};

const ICON: Record<Direction, string> = { up: "▲", down: "▼", hold: "―" };

/** 方向を色＋矢印＋文字で表示（色だけに頼らない） */
export function DirectionTag({
  direction,
  actual = false,
  size = "sm",
}: {
  direction: Direction;
  actual?: boolean;
  size?: "sm" | "lg";
}) {
  const label = actual ? ACTUAL_LABEL[direction] : DIRECTION_LABEL[direction];
  const sizing = size === "lg" ? "px-3 py-1 text-lg" : "px-2 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border font-semibold ${STYLE[direction]} ${sizing}`}>
      <span aria-hidden>{ICON[direction]}</span>
      {label}
    </span>
  );
}
