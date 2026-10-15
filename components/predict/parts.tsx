// 短期予測画面の小さな部品
import type { Cls } from "@/lib/predict/evaluate";
import { CLASS_LABEL } from "@/lib/predict/evaluate";

const CLS_STYLE: Record<Cls, string> = {
  up: "border-up/40 text-up",
  down: "border-down/40 text-down",
  flat: "border-line text-muted",
};
const CLS_ICON: Record<Cls, string> = { up: "▲", flat: "―", down: "▼" };
const BAR: Record<Cls, string> = { up: "bg-up", flat: "bg-muted/60", down: "bg-down" };

/** 方向のタグ（色だけに頼らず、記号と文字を併記） */
export function ClsTag({ cls, size = "sm" }: { cls: Cls; size?: "sm" | "lg" }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border font-semibold ${CLS_STYLE[cls]} ${size === "lg" ? "px-2.5 py-1 text-base" : "px-1.5 py-0.5 text-xs"}`}>
      <span aria-hidden>{CLS_ICON[cls]}</span>
      {CLASS_LABEL[cls]}
    </span>
  );
}

/** 3方向の確率（数値つきの横棒） */
export function ProbBars({ percents, highlight }: { percents: Record<Cls, number>; highlight?: Cls }) {
  return (
    <div className="space-y-1.5">
      {(["up", "flat", "down"] as Cls[]).map((c) => (
        <div key={c} className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-2 text-sm">
          <span className={`text-xs ${highlight === c ? "font-semibold text-ink" : "text-muted"}`}>
            {CLS_ICON[c]} {CLASS_LABEL[c]}
          </span>
          <span className="h-2.5 overflow-hidden rounded-full bg-panel-2">
            <span className={`block h-full rounded-full ${BAR[c]}`} style={{ width: `${percents[c]}%` }} />
          </span>
          <span className={`num text-right ${highlight === c ? "font-bold" : "text-muted"}`}>{percents[c]}%</span>
        </div>
      ))}
    </div>
  );
}

export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
export const fmtTime = (t: number) => new Date(t).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
export const fmtTimeSec = (t: number) => new Date(t).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtDateTime = (t: number) =>
  new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const yen = (v: number) => {
  const r = Math.round(v);
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toLocaleString("ja-JP")}円`;
};
