import Link from "next/link";

export const metadata = { title: "旧モード｜FX Signal Lab" };

export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hold/40 bg-hold/10 px-4 py-2.5 text-sm">
        <p>
          <b>旧モード</b>：「◯分後の方向」を予測する以前の仕様です。記録はそのまま残しています。
        </p>
        <nav className="flex flex-wrap gap-3 text-xs">
          <Link href="/legacy" className="text-accent hover:underline">◯分後予測</Link>
          <Link href="/legacy/verify" className="text-accent hover:underline">◯分後の検証</Link>
          <Link href="/binary" className="text-accent hover:underline">汎用ハイロー検証</Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
