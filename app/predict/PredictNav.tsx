"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/predict", label: "予測" },
  { href: "/predict/verify", label: "検証" },
  { href: "/predict/model", label: "モデル" },
];

export function PredictNav() {
  const p = usePathname();
  return (
    <nav className="flex rounded-lg border border-line bg-panel-2 p-0.5 text-sm">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href}
          className={`whitespace-nowrap rounded-md px-3 py-1 ${p === t.href ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
