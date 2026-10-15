"use client";

import type { DataSource } from "@/lib/types";
import type { Engine } from "@/lib/analysisTypes";
import { HORIZON_OPTIONS, type Horizon } from "@/lib/config";

/** 小さな切り替えボタン（ラジオボタンとして動く） */
function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5 text-sm">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={`rounded-md px-3 py-1 transition-colors disabled:opacity-50 ${
                active ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ModeSwitch(props: { mode: DataSource; onChange: (m: DataSource) => void; disabled?: boolean }) {
  return (
    <Segmented
      label="データ"
      value={props.mode}
      onChange={props.onChange}
      disabled={props.disabled}
      options={[
        { value: "demo", label: "サンプル" },
        { value: "live", label: "実データ" },
      ]}
    />
  );
}

export function EngineSwitch(props: { engine: Engine; onChange: (e: Engine) => void; disabled?: boolean }) {
  return (
    <Segmented
      label="分析"
      value={props.engine}
      onChange={props.onChange}
      disabled={props.disabled}
      options={[
        { value: "claude", label: "Claude AI" },
        { value: "demo", label: "デモ指標" },
      ]}
    />
  );
}

export function HorizonSwitch(props: { horizon: Horizon; onChange: (h: Horizon) => void; disabled?: boolean }) {
  return (
    <Segmented
      label="期間"
      value={props.horizon}
      onChange={props.onChange}
      disabled={props.disabled}
      options={HORIZON_OPTIONS.map((h) => ({ value: h, label: `${h}分` }))}
    />
  );
}
