// バックテストの計算（画面・サーバーの両方で使える純粋な計算）
//
// ルール
// - 開示日の「翌営業日の寄り付き」で買う（開示を見てから注文する現実的なタイミング。先読みを防ぐ）
// - トレンドは開示日（以前で最後の営業日）の終値で判定
// - 損切り：買値 −stop%、利確：買値 +stop%×倍率、または保有 N 営業日目の大引けで手仕舞い
// - 1日のうちに損切りと利確の両方に届いた日は「損切りが先」とみなす（保守的）
// - 寄り付きで損切り・利確の値を飛び越えたら、寄り付きの値で約定
// - 売買ともに滑り（slippagePct）を不利な方向に加える

import type {
  Bar, BacktestMetrics, BacktestParams, BacktestResult, BacktestTrade, BucketStat, Disclosure,
  DisclosureScore, ExitReason, SignalOutcome, SkipReason, StockInfo, Trend,
} from "./types";
import { indexOnOrBefore, trendAt } from "./trend";
import { kindOf } from "./features";

export type StockData = {
  info: StockInfo;
  bars: Bar[];
  disclosures: Disclosure[];
  scores: Map<string, DisclosureScore>;
};

export type ExitResult = { exitIdx: number; exitPrice: number; reason: ExitReason; holdDays: number };

/** 買った日から先の足で、いつ・いくらで手仕舞うかを調べる */
export function simulateExit(
  bars: Bar[],
  entryIdx: number,
  entryPrice: number,
  stopPct: number,
  targetPct: number,
  maxHoldDays: number,
  slippagePct: number,
): ExitResult {
  const stop = entryPrice * (1 - stopPct);
  const target = entryPrice * (1 + targetPct);
  const sell = (p: number) => p * (1 - slippagePct);

  for (let i = entryIdx; i < bars.length; i++) {
    const b = bars[i];
    const holdDays = i - entryIdx + 1;
    if (i > entryIdx) {
      // 寄り付きで飛び越えた場合
      if (b.o <= stop) return { exitIdx: i, exitPrice: sell(b.o), reason: "stop", holdDays };
      if (b.o >= target) return { exitIdx: i, exitPrice: sell(b.o), reason: "target", holdDays };
    }
    if (b.l <= stop) return { exitIdx: i, exitPrice: sell(stop), reason: "stop", holdDays };
    if (b.h >= target) return { exitIdx: i, exitPrice: sell(target), reason: "target", holdDays };
    if (holdDays >= maxHoldDays) return { exitIdx: i, exitPrice: sell(b.c), reason: "time", holdDays };
  }
  const last = bars.length - 1;
  return { exitIdx: last, exitPrice: sell(bars[last].c), reason: "end", holdDays: last - entryIdx + 1 };
}

/** 全開示について「ルールどおりに入ったら」の結果を出す（条件で絞る前） */
export function buildSignals(stocks: StockData[], params: BacktestParams): SignalOutcome[] {
  const out: SignalOutcome[] = [];
  const targetPct = params.stopPct * params.rewardMultiple;

  for (const s of stocks) {
    const { bars } = s;
    if (bars.length < 2) continue;
    // 同じ日に複数の開示がある場合は、スコアの高い方を1つだけ使う
    const byEntry = new Map<number, SignalOutcome>();

    for (const d of s.disclosures) {
      if (kindOf(d.docType) === "other") continue;
      const signalIdx = indexOnOrBefore(bars, d.discDate);
      const entryIdx = signalIdx + 1;
      if (signalIdx < 0 || entryIdx >= bars.length) continue;
      if (bars[entryIdx].date <= d.discDate) continue;

      const t = trendAt(bars, signalIdx)!;
      const entryPrice = bars[entryIdx].o * (1 + params.slippagePct);
      const ex = simulateExit(bars, entryIdx, entryPrice, params.stopPct, targetPct, params.maxHoldDays, params.slippagePct);
      const returnPct = (ex.exitPrice - entryPrice) / entryPrice;
      const score = s.scores.get(d.id)?.score ?? null;

      const o: SignalOutcome = {
        code: s.info.code,
        name: s.info.name,
        disclosureId: d.id,
        discDate: d.discDate,
        score,
        trend: t.trend,
        avgTurnover20: t.avgTurnover20,
        entryDate: bars[entryIdx].date,
        entryPrice,
        exitDate: bars[ex.exitIdx].date,
        exitPrice: ex.exitPrice,
        exitReason: ex.reason,
        holdDays: ex.holdDays,
        returnPct,
        rMultiple: returnPct / params.stopPct,
      };
      const prev = byEntry.get(entryIdx);
      if (!prev || (o.score ?? -99) > (prev.score ?? -99)) byEntry.set(entryIdx, o);
    }
    out.push(...byEntry.values());
  }
  return out.sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (b.score ?? -99) - (a.score ?? -99));
}

/** 条件に合うシグナルか */
export function passesFilter(o: SignalOutcome, p: BacktestParams): boolean {
  if (p.minScore !== null && (o.score === null || o.score < p.minScore)) return false;
  if (!p.trends.includes(o.trend)) return false;
  if (p.minTurnover > 0 && (o.avgTurnover20 === null || o.avgTurnover20 < p.minTurnover)) return false;
  return true;
}

/** 資金・単元・同時保有を考えて、実際に取れた取引を並べる */
export function runPortfolio(signals: SignalOutcome[], p: BacktestParams) {
  const trades: BacktestTrade[] = [];
  const skipped: Record<SkipReason, number> = { unit_too_large: 0, no_cash: 0, overlap: 0 };
  let cash = p.capital;
  let realized = 0;
  const open: { code: string; exitDate: string; proceeds: number; pnl: number }[] = [];
  const lot = p.lotMode === "unit" ? 100 : 1;

  for (const s of signals.filter((o) => passesFilter(o, p))) {
    // 手仕舞いが済んだポジションのお金を戻す
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].exitDate < s.entryDate) {
        cash += open[i].proceeds;
        realized += open[i].pnl;
        open.splice(i, 1);
      }
    }
    if (open.some((o) => o.code === s.code)) {
      skipped.overlap++;
      continue;
    }
    const equity = p.capital + realized;
    const riskPerShare = s.entryPrice * p.stopPct;
    let shares = Math.floor((equity * p.riskPct) / riskPerShare / lot) * lot;
    if (shares <= 0) {
      skipped.unit_too_large++;
      continue;
    }
    const affordable = Math.floor((cash - p.feeYen) / s.entryPrice / lot) * lot;
    shares = Math.min(shares, affordable);
    if (shares <= 0) {
      skipped.no_cash++;
      continue;
    }
    const cost = shares * s.entryPrice + p.feeYen;
    const proceeds = shares * s.exitPrice - p.feeYen;
    const pnl = proceeds - cost;
    cash -= cost;
    open.push({ code: s.code, exitDate: s.exitDate, proceeds, pnl });
    trades.push({ ...s, shares, pnlYen: pnl });
  }
  return { trades, skipped };
}

function bucket(label: string, list: SignalOutcome[]): BucketStat {
  if (list.length === 0) return { label, n: 0, winRate: null, avgReturnPct: null, expectancyR: null };
  const wins = list.filter((o) => o.returnPct > 0).length;
  return {
    label,
    n: list.length,
    winRate: wins / list.length,
    avgReturnPct: mean(list.map((o) => o.returnPct)),
    expectancyR: mean(list.map((o) => o.rMultiple)),
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeMetrics(signalsCount: number, trades: BacktestTrade[], skipped: Record<SkipReason, number>, capital: number) {
  const wins = trades.filter((t) => t.pnlYen > 0);
  const losses = trades.filter((t) => t.pnlYen <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlYen, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.pnlYen, 0);
  const totalPnl = grossWin - grossLoss;

  // 資金の推移（手仕舞い日順）と最大ドローダウン
  const equity: { date: string; equity: number }[] = [];
  let eq = capital;
  let peak = capital;
  let maxDd = 0;
  for (const t of trades.slice().sort((a, b) => a.exitDate.localeCompare(b.exitDate))) {
    eq += t.pnlYen;
    equity.push({ date: t.exitDate, equity: Math.round(eq) });
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, (peak - eq) / peak);
  }

  const metrics: BacktestMetrics = {
    signals: signalsCount,
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? wins.length / trades.length : null,
    avgWinPct: mean(wins.map((t) => t.returnPct)),
    avgLossPct: mean(losses.map((t) => t.returnPct)),
    expectancyPct: mean(trades.map((t) => t.returnPct)),
    expectancyR: mean(trades.map((t) => t.rMultiple)),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    totalPnlYen: Math.round(totalPnl),
    endCapital: Math.round(capital + totalPnl),
    maxDrawdownPct: maxDd,
    avgHoldDays: mean(trades.map((t) => t.holdDays)),
    skipped,
  };
  return { metrics, equity };
}

export function runBacktest(stocks: StockData[], params: BacktestParams): BacktestResult {
  const signals = buildSignals(stocks, params);
  const { trades, skipped } = runPortfolio(signals, params);
  const { metrics, equity } = computeMetrics(signals.filter((s) => passesFilter(s, params)).length, trades, skipped, params.capital);

  // スコアとトレンドに意味があるかを見るための集計（条件で絞る前の全シグナル）
  const scored = signals.filter((s) => s.score !== null);
  const byScore = [
    bucket("−3 以下", scored.filter((s) => s.score! <= -3)),
    bucket("−2〜+2", scored.filter((s) => s.score! >= -2 && s.score! <= 2)),
    bucket("+3〜+5", scored.filter((s) => s.score! >= 3 && s.score! <= 5)),
    bucket("+6 以上", scored.filter((s) => s.score! >= 6)),
    bucket("未採点", signals.filter((s) => s.score === null)),
  ];
  const trendOrder: Trend[] = ["up", "neutral", "down"];
  const trendLabel: Record<Trend, string> = { up: "上昇", neutral: "中立", down: "下降" };
  const byTrend = trendOrder.map((t) => bucket(trendLabel[t], signals.filter((s) => s.trend === t)));

  const dates = stocks.flatMap((s) => (s.bars.length ? [s.bars[0].date, s.bars[s.bars.length - 1].date] : [])).sort();
  return {
    params,
    codes: stocks.map((s) => s.info.code),
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    metrics,
    trades,
    equity,
    byScore,
    byTrend,
  };
}

/** 損益が0になる勝率（平均利益・平均損失から） */
export function breakevenWinRate(avgWinPct: number | null, avgLossPct: number | null): number | null {
  if (avgWinPct === null || avgLossPct === null || avgWinPct - avgLossPct === 0) return null;
  return -avgLossPct / (avgWinPct - avgLossPct);
}
