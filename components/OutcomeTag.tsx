import type { Outcome } from "@/lib/types";
import { OUTCOME_LABEL } from "@/lib/format";

const STYLE: Record<Outcome, string> = {
  match: "border-up/40 text-up",
  miss: "border-down/40 text-down",
  excluded: "border-line text-muted",
  pending: "border-line text-muted border-dashed",
  unavailable: "border-line text-muted border-dashed",
};

const ICON: Record<Outcome, string> = { match: "○", miss: "×", excluded: "－", pending: "…", unavailable: "？" };

export function OutcomeTag({ outcome }: { outcome: Outcome }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold ${STYLE[outcome]}`}>
      <span aria-hidden>{ICON[outcome]}</span>
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}
