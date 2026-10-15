export function DemoBadge({ label = "デモ" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-demo/50 bg-demo/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-demo">
      <span aria-hidden className="size-1.5 rounded-full bg-demo" />
      {label}
    </span>
  );
}
