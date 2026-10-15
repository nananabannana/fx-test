// 株データの取得と保存（サーバー専用）
// J-Quants から取った値は保存しておき、半日以内なら保存分を使う（回数制限の節約）。
import "server-only";

import { getDb } from "./db";
import { jquantsGet, num } from "./jquants";
import type { Bar, Disclosure, DisclosureScore, PaperTrade, StockInfo, SummaryRaw } from "../stocks/types";

const STALE_MS = 12 * 60 * 60 * 1000;

async function isFresh(key: string): Promise<boolean> {
  const rows = await getDb().select<{ key: string; fetched_at: string }>("fetch_log", { eq: { key } });
  return rows.length > 0 && Date.now() - Date.parse(rows[0].fetched_at) < STALE_MS;
}

async function markFetched(key: string) {
  await getDb().upsert("fetch_log", [{ key, fetched_at: new Date().toISOString() }]);
}

// ---------------- 銘柄情報 ----------------

export async function ensureStock(code: string, force = false): Promise<StockInfo | null> {
  const db = getDb();
  if (!force && (await isFresh(`master:${code}`))) {
    return (await getStock(code)) ?? null;
  }
  const rows = await jquantsGet<Record<string, string>>("/equities/master", { code });
  const r = rows[rows.length - 1];
  if (!r) {
    await markFetched(`master:${code}`);
    return null;
  }
  const info: StockInfo = { code: r.Code || code, name: r.CoName ?? "", sector33: r.S33Nm ?? "", market: r.MktNm ?? "" };
  await db.upsert("stocks", [{ code: info.code, name: info.name, sector33: info.sector33, market: info.market, updated_at: new Date().toISOString() }]);
  await markFetched(`master:${code}`);
  return info;
}

export async function getStock(code: string): Promise<StockInfo | null> {
  const rows = await getDb().select<StockInfo>("stocks", { eq: { code } });
  return rows[0] ?? null;
}

export async function getStocks(codes: string[]): Promise<Map<string, StockInfo>> {
  if (codes.length === 0) return new Map();
  const rows = await getDb().select<StockInfo>("stocks", { in: { column: "code", values: codes } });
  return new Map(rows.map((r) => [r.code, r]));
}

// ---------------- 日足 ----------------

type BarRow = {
  code: string;
  date: string;
  o: number | null; h: number | null; l: number | null; c: number | null; vo: number | null; va: number | null;
  adj_o: number | null; adj_h: number | null; adj_l: number | null; adj_c: number | null; adj_vo: number | null;
};

export async function ensureBars(code: string, force = false): Promise<number> {
  if (!force && (await isFresh(`bars:${code}`))) return -1;
  const rows = await jquantsGet<Record<string, unknown>>("/equities/bars/daily", { code });
  const mapped: BarRow[] = rows
    .filter((r) => typeof r.Date === "string")
    .map((r) => ({
      code,
      date: String(r.Date),
      o: num(r.O), h: num(r.H), l: num(r.L), c: num(r.C), vo: num(r.Vo), va: num(r.Va),
      adj_o: num(r.AdjO), adj_h: num(r.AdjH), adj_l: num(r.AdjL), adj_c: num(r.AdjC), adj_vo: num(r.AdjVo),
    }));
  await getDb().upsert("price_bars", mapped);
  await markFetched(`bars:${code}`);
  return mapped.length;
}

/** 調整後価格の日足（取引のなかった日は除く） */
export async function getBars(code: string): Promise<Bar[]> {
  const rows = await getDb().select<BarRow>("price_bars", { eq: { code }, order: { column: "date", ascending: true } });
  const bars: Bar[] = [];
  for (const r of rows) {
    const o = num(r.adj_o ?? r.o);
    const h = num(r.adj_h ?? r.h);
    const l = num(r.adj_l ?? r.l);
    const c = num(r.adj_c ?? r.c);
    if (o === null || h === null || l === null || c === null) continue;
    bars.push({ date: String(r.date).slice(0, 10), o, h, l, c, vo: num(r.adj_vo ?? r.vo), va: num(r.va) });
  }
  return bars;
}

// ---------------- 開示（決算サマリー） ----------------

type DisclosureRow = {
  id: string;
  code: string;
  disc_date: string;
  disc_time: string;
  doc_type: string;
  period_type: string;
  raw: SummaryRaw;
};

const toDisclosure = (r: DisclosureRow): Disclosure => ({
  id: r.id,
  code: r.code,
  discDate: String(r.disc_date).slice(0, 10),
  discTime: r.disc_time,
  docType: r.doc_type,
  periodType: r.period_type,
  raw: r.raw,
});

export async function ensureDisclosures(code: string, force = false): Promise<number> {
  if (!force && (await isFresh(`summary:${code}`))) return -1;
  const rows = await jquantsGet<SummaryRaw>("/fins/summary", { code });
  const mapped: DisclosureRow[] = rows
    .filter((r) => r.DiscDate)
    .map((r) => ({
      id: `${r.Code || code}-${r.DiscNo || `${r.DiscDate}${r.DiscTime}${r.DocType}`}`,
      code,
      disc_date: r.DiscDate,
      disc_time: r.DiscTime ?? "",
      doc_type: r.DocType ?? "",
      period_type: r.CurPerType ?? "",
      raw: r,
    }));
  await getDb().upsert("disclosures", mapped);
  await markFetched(`summary:${code}`);
  return mapped.length;
}

export async function getDisclosures(code: string): Promise<Disclosure[]> {
  const rows = await getDb().select<DisclosureRow>("disclosures", { eq: { code }, order: { column: "disc_date", ascending: true } });
  return rows.map(toDisclosure);
}

export async function getDisclosure(id: string): Promise<Disclosure | null> {
  const rows = await getDb().select<DisclosureRow>("disclosures", { eq: { id } });
  return rows[0] ? toDisclosure(rows[0]) : null;
}

// ---------------- 開示スコア ----------------

type ScoreRow = {
  id: string;
  disclosure_id: string;
  model: string;
  prompt_version: string;
  score: number;
  sub_scores: DisclosureScore["subScores"];
  summary: string;
  reasons: string[];
  used_text: boolean;
  created_at: string;
};

const toScore = (r: ScoreRow): DisclosureScore => ({
  id: r.id,
  disclosureId: r.disclosure_id,
  model: r.model,
  promptVersion: r.prompt_version,
  score: Number(r.score),
  subScores: r.sub_scores,
  summary: r.summary,
  reasons: r.reasons ?? [],
  usedText: !!r.used_text,
  createdAt: r.created_at,
});

export async function saveScore(s: DisclosureScore) {
  await getDb().upsert("disclosure_scores", [
    {
      id: s.id,
      disclosure_id: s.disclosureId,
      model: s.model,
      prompt_version: s.promptVersion,
      score: s.score,
      sub_scores: s.subScores,
      summary: s.summary,
      reasons: s.reasons,
      used_text: s.usedText,
      created_at: s.createdAt,
    },
  ]);
}

/**
 * 開示ごとの最新スコア。
 * バックテスト用（anonymousOnly）では、短信本文を読ませた＝匿名でないスコアを除く。
 */
export async function getLatestScores(disclosureIds: string[], anonymousOnly = false): Promise<Map<string, DisclosureScore>> {
  const out = new Map<string, DisclosureScore>();
  if (disclosureIds.length === 0) return out;
  for (let i = 0; i < disclosureIds.length; i += 200) {
    const rows = await getDb().select<ScoreRow>("disclosure_scores", {
      in: { column: "disclosure_id", values: disclosureIds.slice(i, i + 200) },
    });
    for (const r of rows) {
      if (anonymousOnly && r.used_text) continue;
      const cur = out.get(r.disclosure_id);
      if (!cur || r.created_at > cur.createdAt) out.set(r.disclosure_id, toScore(r));
    }
  }
  return out;
}

// ---------------- 検証ログ ----------------

type PaperRow = {
  id: string; code: string; name: string; disclosure_id: string | null; score: number | null; trend: PaperTrade["trend"];
  status: PaperTrade["status"]; signal_date: string; entry_date: string | null; entry_price: number | null;
  stop_pct: number; target_pct: number; max_hold_days: number; shares: number;
  exit_date: string | null; exit_price: number | null; exit_reason: PaperTrade["exitReason"];
  return_pct: number | null; r_multiple: number | null; pnl_yen: number | null; note: string;
  created_at: string; updated_at: string;
};

const d10 = (v: string | null) => (v ? String(v).slice(0, 10) : null);

const toPaper = (r: PaperRow): PaperTrade => ({
  id: r.id, code: r.code, name: r.name, disclosureId: r.disclosure_id, score: num(r.score), trend: r.trend,
  status: r.status, signalDate: d10(r.signal_date)!, entryDate: d10(r.entry_date), entryPrice: num(r.entry_price),
  stopPct: Number(r.stop_pct), targetPct: Number(r.target_pct), maxHoldDays: Number(r.max_hold_days), shares: Number(r.shares),
  exitDate: d10(r.exit_date), exitPrice: num(r.exit_price), exitReason: r.exit_reason,
  returnPct: num(r.return_pct), rMultiple: num(r.r_multiple), pnlYen: num(r.pnl_yen), note: r.note ?? "",
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export async function listPaperTrades(): Promise<PaperTrade[]> {
  const rows = await getDb().select<PaperRow>("paper_trades", { order: { column: "created_at", ascending: false } });
  return rows.map(toPaper);
}

export async function savePaperTrades(list: PaperTrade[]) {
  await getDb().upsert(
    "paper_trades",
    list.map((p) => ({
      id: p.id, code: p.code, name: p.name, disclosure_id: p.disclosureId, score: p.score, trend: p.trend,
      status: p.status, signal_date: p.signalDate, entry_date: p.entryDate, entry_price: p.entryPrice,
      stop_pct: p.stopPct, target_pct: p.targetPct, max_hold_days: p.maxHoldDays, shares: p.shares,
      exit_date: p.exitDate, exit_price: p.exitPrice, exit_reason: p.exitReason,
      return_pct: p.returnPct, r_multiple: p.rMultiple, pnl_yen: p.pnlYen, note: p.note,
      created_at: p.createdAt, updated_at: p.updatedAt,
    })),
  );
}

export async function deletePaperTrade(id: string) {
  await getDb().remove("paper_trades", { id });
}
