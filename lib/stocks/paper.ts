// 検証ログ（ペーパートレード）の更新計算
// 記録した翌営業日の寄り付きで「買ったことにする」→ 毎回、最新の日足で損切り・利確・日数をチェックする

import type { Bar, PaperTrade } from "./types";
import { simulateExit } from "./backtest";

const SLIPPAGE = 0.001;

export function updatePaperTrade(p: PaperTrade, bars: Bar[], now = new Date().toISOString()): PaperTrade {
  if (p.status === "closed") return p;
  const entryIdx = bars.findIndex((b) => b.date > p.signalDate);
  if (entryIdx < 0) return { ...p, status: "planned", updatedAt: now };

  const entryPrice = p.entryPrice ?? bars[entryIdx].o * (1 + SLIPPAGE);
  const ex = simulateExit(bars, entryIdx, entryPrice, p.stopPct, p.targetPct, p.maxHoldDays, SLIPPAGE);
  const returnPct = (ex.exitPrice - entryPrice) / entryPrice;
  const base = {
    ...p,
    entryDate: bars[entryIdx].date,
    entryPrice,
    returnPct,
    rMultiple: returnPct / p.stopPct,
    pnlYen: p.shares ? Math.round(p.shares * (ex.exitPrice - entryPrice)) : null,
    updatedAt: now,
  };
  if (ex.reason === "end") {
    // まだ手仕舞い条件に届いていない：最新の終値での含み損益
    return { ...base, status: "open", exitDate: null, exitPrice: null, exitReason: null };
  }
  return { ...base, status: "closed", exitDate: bars[ex.exitIdx].date, exitPrice: ex.exitPrice, exitReason: ex.reason };
}
