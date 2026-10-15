import { StocksNav } from "@/components/stocks/StocksNav";
import { StatusNotice } from "@/components/stocks/StatusNotice";

export const metadata = { title: "株スイング｜FX Signal Lab" };

export default function StocksLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">株スイング</h1>
          <p className="text-xs text-muted">日本株の決算・開示 × トレンドで、日足スイングのルールを検証します（実際の売買はしません）</p>
        </div>
        <StocksNav />
      </div>
      <StatusNotice />
      {children}
    </div>
  );
}
