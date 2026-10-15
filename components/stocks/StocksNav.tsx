"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/stocks", label: "銘柄分析" },
  { href: "/stocks/backtest", label: "バックテスト" },
  { href: "/stocks/log", label: "検証ログ" },
];

export function StocksNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="株スイングのメニュー" className="flex rounded-lg border border-line bg-panel p-0.5 text-sm">
      {NAV.map((n) => {
        const active = pathname === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 transition-colors ${active ? "bg-panel-2 font-semibold text-ink" : "text-muted hover:text-ink"}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
