// 銘柄のデータを J-Quants から取って保存する（半日以内に取得済みなら何もしない）
// 無料プランは1分5回までなので、1銘柄あたり最大3回の問い合わせに約40秒かかることがあります。
import { NextResponse } from "next/server";
import { ensureBars, ensureDisclosures, ensureStock, getStock } from "@/lib/server/stockRepo";
import { badRequest, errorResponse, parseCode } from "@/lib/server/apiError";
import { getDb } from "@/lib/server/db";
import type { PrepareResponse } from "@/lib/stocks/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { code?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("リクエストの形式が正しくありません。");
  }
  const code = parseCode(body.code);
  if (!code) return badRequest("銘柄コードは4桁（例: 7203）で入力してください。");
  const force = body.force === true;

  if (process.env.VERCEL && getDb().kind === "local") {
    return badRequest("Vercel 上では Supabase の設定が必要です（SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY）。");
  }

  try {
    const stock = (await ensureStock(code, force)) ?? (await getStock(code));
    if (!stock) return badRequest(`銘柄コード ${code.slice(0, 4)} は見つかりませんでした。`);
    const bars = await ensureBars(code, force);
    const disclosures = await ensureDisclosures(code, force);
    const res: PrepareResponse = { ok: true, stock, bars, disclosures, cached: bars === -1 && disclosures === -1 };
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
