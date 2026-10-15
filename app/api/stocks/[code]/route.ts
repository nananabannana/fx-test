// 保存済みの銘柄データ（日足・トレンド・開示とスコア）を返す。J-Quants には問い合わせない。
import { NextResponse } from "next/server";
import { getBars, getDisclosures, getLatestScores, getStock } from "@/lib/server/stockRepo";
import { badRequest, errorResponse, parseCode } from "@/lib/server/apiError";
import { computeFeatures, kindOf, sortDisclosures } from "@/lib/stocks/features";
import { trendAt } from "@/lib/stocks/trend";
import type { StockDetailResponse } from "@/lib/stocks/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const code = parseCode((await ctx.params).code);
  if (!code) return badRequest("銘柄コードが正しくありません。");
  try {
    const [stock, bars, disclosures] = await Promise.all([getStock(code), getBars(code), getDisclosures(code)]);
    const sorted = sortDisclosures(disclosures).filter((d) => kindOf(d.docType) !== "other");
    const scores = await getLatestScores(sorted.map((d) => d.id));
    const res: StockDetailResponse = {
      ok: true,
      stock,
      bars,
      trend: bars.length ? trendAt(bars, bars.length - 1) : null,
      disclosures: sorted
        .map((d) => ({
          disclosure: { id: d.id, code: d.code, discDate: d.discDate, discTime: d.discTime, docType: d.docType, periodType: d.periodType },
          features: computeFeatures(d, disclosures),
          score: scores.get(d.id) ?? null,
        }))
        .reverse(),
    };
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
