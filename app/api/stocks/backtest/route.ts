// バックテスト：保存済みのデータだけで計算する（J-Quants / Claude には問い合わせない）
// スコアは「匿名で採点したもの」だけを使う（短信本文を読ませたスコアは除く）
import { NextResponse } from "next/server";
import { getBars, getDisclosures, getLatestScores, getStocks } from "@/lib/server/stockRepo";
import { getDb } from "@/lib/server/db";
import { badRequest, errorResponse, parseCode } from "@/lib/server/apiError";
import { runBacktest, type StockData } from "@/lib/stocks/backtest";
import { DEFAULT_PARAMS, type BacktestParams, type Trend } from "@/lib/stocks/types";
import type { BacktestListResponse, BacktestResponse, BacktestRunSummary } from "@/lib/stocks/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function sanitizeParams(input: unknown): BacktestParams {
  const p = { ...DEFAULT_PARAMS, ...(typeof input === "object" && input ? input : {}) } as Record<string, unknown>;
  const numIn = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  const trends = Array.isArray(p.trends)
    ? (p.trends.filter((t) => t === "up" || t === "neutral" || t === "down") as Trend[])
    : DEFAULT_PARAMS.trends;
  return {
    minScore: p.minScore === null ? null : numIn(p.minScore, -10, 10, DEFAULT_PARAMS.minScore ?? 0),
    trends: trends.length ? trends : ["up"],
    stopPct: numIn(p.stopPct, 0.01, 0.3, DEFAULT_PARAMS.stopPct),
    rewardMultiple: numIn(p.rewardMultiple, 0.5, 10, DEFAULT_PARAMS.rewardMultiple),
    maxHoldDays: Math.round(numIn(p.maxHoldDays, 1, 120, DEFAULT_PARAMS.maxHoldDays)),
    capital: numIn(p.capital, 10_000, 1e10, DEFAULT_PARAMS.capital),
    riskPct: numIn(p.riskPct, 0.001, 0.1, DEFAULT_PARAMS.riskPct),
    lotMode: p.lotMode === "odd" ? "odd" : "unit",
    slippagePct: numIn(p.slippagePct, 0, 0.02, DEFAULT_PARAMS.slippagePct),
    feeYen: numIn(p.feeYen, 0, 10_000, DEFAULT_PARAMS.feeYen),
    minTurnover: numIn(p.minTurnover, 0, 1e13, DEFAULT_PARAMS.minTurnover),
  };
}

export async function POST(req: Request) {
  let body: { codes?: unknown; params?: unknown; save?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("リクエストの形式が正しくありません。");
  }
  const codes = Array.isArray(body.codes)
    ? [...new Set(body.codes.map(parseCode).filter((c): c is string => !!c))].slice(0, 100)
    : [];
  if (codes.length === 0) return badRequest("銘柄コードを1つ以上指定してください。");
  const params = sanitizeParams(body.params);

  try {
    const infos = await getStocks(codes);
    const stocks: StockData[] = [];
    const missing: string[] = [];
    for (const code of codes) {
      const [bars, disclosures] = await Promise.all([getBars(code), getDisclosures(code)]);
      if (bars.length === 0) {
        missing.push(code);
        continue;
      }
      const scores = await getLatestScores(disclosures.map((d) => d.id), true);
      stocks.push({ info: infos.get(code) ?? { code, name: "", sector33: "", market: "" }, bars, disclosures, scores });
    }
    const result = runBacktest(stocks, params);

    let runId: string | null = null;
    if (body.save === true && result.trades.length >= 0) {
      runId = `bt-${Date.now().toString(36)}`;
      const db = getDb();
      await db.upsert("backtest_runs", [
        { id: runId, params, universe: result.codes, metrics: result.metrics, created_at: new Date().toISOString() },
      ]);
      if (result.trades.length) {
        await db.upsert(
          "backtest_trades",
          result.trades.map((t, i) => ({
            id: `${runId}-${i}`, run_id: runId, code: t.code, disclosure_id: t.disclosureId, score: t.score, trend: t.trend,
            entry_date: t.entryDate, entry_price: t.entryPrice, exit_date: t.exitDate, exit_price: t.exitPrice,
            exit_reason: t.exitReason, shares: t.shares, return_pct: t.returnPct, r_multiple: t.rMultiple, pnl_yen: t.pnlYen,
          })),
        );
      }
    }
    return NextResponse.json({ ok: true, result, runId, missing } satisfies BacktestResponse);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET() {
  try {
    const rows = await getDb().select<{
      id: string; created_at: string; params: BacktestParams; universe: string[]; metrics: BacktestRunSummary["metrics"];
    }>("backtest_runs", { order: { column: "created_at", ascending: false }, limit: 20 });
    const runs: BacktestRunSummary[] = rows.map((r) => ({ id: r.id, createdAt: r.created_at, params: r.params, codes: r.universe, metrics: r.metrics }));
    return NextResponse.json({ ok: true, runs } satisfies BacktestListResponse);
  } catch (e) {
    return errorResponse(e);
  }
}
