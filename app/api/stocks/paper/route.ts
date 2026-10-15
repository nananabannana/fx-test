// 検証ログ（実弾なしの記録）
// GET    一覧
// POST   新しく記録（翌営業日の寄り付きで買ったことにする）
// PATCH  { action: "refresh" } 保存済みの日足で状況を更新（日足が古ければ J-Quants から取り直す）
// DELETE ?id=... 記録を削除
import { NextResponse } from "next/server";
import {
  deletePaperTrade, ensureBars, getBars, getDisclosure, getStock, listPaperTrades, savePaperTrades,
} from "@/lib/server/stockRepo";
import { badRequest, errorResponse, parseCode } from "@/lib/server/apiError";
import { updatePaperTrade } from "@/lib/stocks/paper";
import { trendAt } from "@/lib/stocks/trend";
import type { PaperCreateRequest, PaperListResponse } from "@/lib/stocks/api";
import type { PaperTrade } from "@/lib/stocks/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    return NextResponse.json({ ok: true, trades: await listPaperTrades() } satisfies PaperListResponse);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  let body: PaperCreateRequest;
  try {
    body = await req.json();
  } catch {
    return badRequest("リクエストの形式が正しくありません。");
  }
  const code = parseCode(body.code);
  if (!code) return badRequest("銘柄コードが正しくありません。");
  const okNum = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  if (!okNum(body.stopPct, 0.01, 0.3) || !okNum(body.targetPct, 0.01, 1) || !okNum(body.maxHoldDays, 1, 120) || !okNum(body.shares, 0, 1e7)) {
    return badRequest("損切り・利確・日数・株数の値を確認してください。");
  }

  try {
    const [stock, bars] = await Promise.all([getStock(code), getBars(code)]);
    if (bars.length === 0) return badRequest("先に銘柄のデータを取得してください。");
    const last = bars[bars.length - 1];
    const signalDate = typeof body.signalDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.signalDate) ? body.signalDate : last.date;
    const idx = bars.findLastIndex((b) => b.date <= signalDate);
    const trend = idx >= 0 ? trendAt(bars, idx)!.trend : "neutral";
    const disclosure = body.disclosureId ? await getDisclosure(body.disclosureId) : null;

    const now = new Date().toISOString();
    let p: PaperTrade = {
      id: `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      code,
      name: stock?.name ?? "",
      disclosureId: disclosure?.id ?? null,
      score: typeof body.score === "number" ? Math.round(body.score) : null,
      trend,
      status: "planned",
      signalDate,
      entryDate: null,
      entryPrice: null,
      stopPct: body.stopPct,
      targetPct: body.targetPct,
      maxHoldDays: Math.round(body.maxHoldDays),
      shares: Math.round(body.shares),
      exitDate: null,
      exitPrice: null,
      exitReason: null,
      returnPct: null,
      rMultiple: null,
      pnlYen: null,
      note: typeof body.note === "string" ? body.note.slice(0, 500) : "",
      createdAt: now,
      updatedAt: now,
    };
    // 過去の日付で記録した場合は、その後の足ですぐに結果を出す
    p = updatePaperTrade(p, bars, now);
    await savePaperTrades([p]);
    return NextResponse.json({ ok: true, trades: [p] } satisfies PaperListResponse);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request) {
  let body: { action?: unknown; fetch?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (body.action !== "refresh") return badRequest("action が正しくありません。");
  try {
    const list = await listPaperTrades();
    const active = list.filter((p) => p.status !== "closed");
    const codes = [...new Set(active.map((p) => p.code))];
    const errors: string[] = [];
    for (const code of codes) {
      if (body.fetch === true) {
        try {
          await ensureBars(code);
        } catch (e) {
          errors.push(`${code.slice(0, 4)}: ${(e as Error).message}`);
        }
      }
      const bars = await getBars(code);
      const updated = active.filter((p) => p.code === code).map((p) => updatePaperTrade(p, bars));
      await savePaperTrades(updated);
    }
    return NextResponse.json({ ok: true, trades: await listPaperTrades(), errors });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id が必要です。");
  try {
    await deletePaperTrade(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
