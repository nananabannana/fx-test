"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DemoBadge } from "./DemoBadge";

const NAV = [
  { href: "/", label: "FX分析" },
  { href: "/verify", label: "FX検証" },
  { href: "/binary", label: "ハイロー" },
  { href: "/stocks", label: "株スイング" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="FX Signal Lab">
          <Logo />
          <span className="hidden whitespace-nowrap text-[15px] font-bold tracking-tight min-[480px]:inline">FX Signal Lab</span>
          <span className="hidden sm:inline-flex">
            <DemoBadge label="DEMO" />
          </span>
        </Link>
        <nav className="flex rounded-lg border border-line bg-panel p-0.5 text-xs sm:text-sm">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors sm:px-3 ${
                  active ? "bg-panel-2 font-semibold text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <rect x="3" y="7" width="3" height="9" rx="0.5" fill="var(--color-down)" />
      <line x1="4.5" y1="4" x2="4.5" y2="19" stroke="var(--color-down)" strokeWidth="1" />
      <rect x="9.5" y="5" width="3" height="8" rx="0.5" fill="var(--color-up)" />
      <line x1="11" y1="2" x2="11" y2="16" stroke="var(--color-up)" strokeWidth="1" />
      <rect x="16" y="3" width="3" height="7" rx="0.5" fill="var(--color-up)" />
      <line x1="17.5" y1="1" x2="17.5" y2="13" stroke="var(--color-up)" strokeWidth="1" />
    </svg>
  );
}
