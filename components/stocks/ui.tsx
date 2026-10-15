"use client";

// 株スイング画面の共通部品

import type { ReactNode } from "react";
import type { Trend } from "@/lib/stocks/types";
import { TREND_LABEL } from "@/lib/stocks/trend";

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel p-4 sm:p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "up" | "down" | "muted"; hint?: string }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "muted" ? "text-muted" : "";
  return (
    <div className="rounded-xl border border-line bg-panel-2 px-3 py-2.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`num text-lg font-bold ${color}`}>{value}</dd>
      {hint && <p className="mt-0.5 text-[10px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

const TREND_STYLE: Record<Trend, string> = {
  up: "border-up/40 bg-up/10 text-up",
  neutral: "border-line bg-panel-2 text-muted",
  down: "border-down/40 bg-down/10 text-down",
};
const TREND_ICON: Record<Trend, string> = { up: "▲", neutral: "―", down: "▼" };

export function TrendBadge({ trend, size = "sm" }: { trend: Trend; size?: "sm" | "lg" }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border font-semibold ${TREND_STYLE[trend]} ${size === "lg" ? "px-3 py-1 text-base" : "px-2 py-0.5 text-xs"}`}>
      <span aria-hidden>{TREND_ICON[trend]}</span>
      {TREND_LABEL[trend]}トレンド
    </span>
  );
}

export function ScoreBadge({ score, size = "sm" }: { score: number | null; size?: "sm" | "lg" }) {
  if (score === null) {
    return <span className="whitespace-nowrap rounded-md border border-dashed border-line px-2 py-0.5 text-xs text-muted">未採点</span>;
  }
  const tone = score >= 3 ? "border-up/40 bg-up/10 text-up" : score <= -3 ? "border-down/40 bg-down/10 text-down" : "border-line bg-panel-2 text-ink";
  return (
    <span className={`num inline-flex items-baseline gap-1 whitespace-nowrap rounded-md border font-bold ${tone} ${size === "lg" ? "px-3 py-1 text-lg" : "px-2 py-0.5 text-xs"}`}>
      {score > 0 ? `+${score}` : score}
      <span className="text-[10px] font-normal opacity-70">/10</span>
    </span>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-down/40 bg-down/10 p-3 text-sm leading-relaxed">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 rounded-lg border border-line bg-panel px-3 py-1.5 hover:bg-panel-2">
          やり直す
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const style = tone === "warn" ? "border-hold/40 bg-hold/10" : "border-line bg-panel-2";
  return <div className={`rounded-xl border p-3 text-xs leading-relaxed text-ink/85 ${style}`}>{children}</div>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  type?: "button" | "submit";
}) {
  const style =
    variant === "primary"
      ? "bg-accent font-bold text-bg hover:brightness-110"
      : variant === "ghost"
        ? "text-muted hover:text-ink"
        : "border border-line bg-panel-2 hover:bg-panel";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${style}`}>
      {children}
    </button>
  );
}

export function Spinner() {
  return <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent";
