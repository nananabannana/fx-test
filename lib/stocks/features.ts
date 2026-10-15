// J-Quants の決算サマリー（数値）から、判断に使う比較の数字を作る。
// Claude に渡すのも、画面に出すのも、この計算結果（％と比率だけ）です。
// 金額そのものは渡さない：金額の大きさから会社が特定され、後の株価を Claude が「知っている」状態になるのを防ぐため。

import type { Disclosure, DisclosureFeatures, SummaryRaw } from "./types";

const n = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** 変化率（基準が0や欠損なら null、極端な値は ±1000% で打ち止め） */
const change = (cur: number | null, base: number | null): number | null => {
  if (cur === null || base === null || base === 0) return null;
  const r = (cur - base) / Math.abs(base);
  return Math.max(-10, Math.min(10, r));
};

export function kindOf(docType: string): DisclosureFeatures["kind"] {
  if (/FinancialStatements/i.test(docType)) return "earnings";
  if (/EarnForecastRevision/i.test(docType)) return "forecast_revision";
  if (/DividendForecastRevision/i.test(docType)) return "dividend_revision";
  return "other";
}

/** 開示の並び順（日付→時刻） */
export function sortDisclosures(list: Disclosure[]): Disclosure[] {
  return list.slice().sort((a, b) => (a.discDate + a.discTime).localeCompare(b.discDate + b.discTime));
}

type ForecastSet = { sales: number | null; op: number | null; np: number | null; div: number | null };

/** ある開示の時点で、事業年度 fyEnd に対して出ていた予想 */
function forecastFor(raw: SummaryRaw, fyEnd: string): ForecastSet | null {
  if (raw.CurFYEn === fyEnd) {
    const f = { sales: n(raw.FSales), op: n(raw.FOP), np: n(raw.FNP), div: n(raw.FDivAnn) };
    if (Object.values(f).some((v) => v !== null)) return f;
  }
  if (raw.NxtFYEn === fyEnd) {
    const f = { sales: n(raw.NxFSales), op: n(raw.NxFOP), np: n(raw.NxFNp), div: n(raw.NxFDivAnn) };
    if (Object.values(f).some((v) => v !== null)) return f;
  }
  return null;
}

/** 直前までの開示のうち、同じ事業年度の予想が最後に出ていたもの */
function previousForecast(prior: Disclosure[], fyEnd: string): ForecastSet | null {
  for (let i = prior.length - 1; i >= 0; i--) {
    const f = forecastFor(prior[i].raw, fyEnd);
    if (f) return f;
  }
  return null;
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

export function computeFeatures(target: Disclosure, all: Disclosure[]): DisclosureFeatures {
  const sorted = sortDisclosures(all);
  const idx = sorted.findIndex((d) => d.id === target.id);
  const prior = idx >= 0 ? sorted.slice(0, idx) : sorted.filter((d) => d.discDate < target.discDate);
  const r = target.raw;
  const kind = kindOf(target.docType);
  const periodType = r.CurPerType || target.periodType || "";

  // 前年同期比：同じ期間種別で、期末日がおよそ1年前の決算
  const yoy = { sales: null as number | null, op: null as number | null, np: null as number | null };
  if (kind === "earnings" && r.CurPerEn) {
    const lastYear = new Date(Date.parse(r.CurPerEn) - 365 * 86_400_000).toISOString().slice(0, 10);
    const prev = [...prior].reverse().find(
      (d) => kindOf(d.docType) === "earnings" && d.raw.CurPerType === periodType && d.raw.CurPerEn && dayDiff(d.raw.CurPerEn, lastYear) < 45,
    );
    if (prev) {
      yoy.sales = change(n(r.Sales), n(prev.raw.Sales));
      yoy.op = change(n(r.OP), n(prev.raw.OP));
      yoy.np = change(n(r.NP), n(prev.raw.NP));
    }
  }

  // 今期予想の修正率（通期決算では「直前の予想に対する着地」）
  const revision = { sales: null as number | null, op: null as number | null, np: null as number | null, div: null as number | null };
  if (r.CurFYEn) {
    const before = previousForecast(prior, r.CurFYEn);
    const now = forecastFor(r, r.CurFYEn);
    if (before && now) {
      revision.sales = change(now.sales, before.sales);
      revision.op = change(now.op, before.op);
      revision.np = change(now.np, before.np);
      revision.div = change(now.div, before.div);
    } else if (before && kind === "earnings" && periodType === "FY") {
      revision.sales = change(n(r.Sales), before.sales);
      revision.op = change(n(r.OP), before.op);
      revision.np = change(n(r.NP), before.np);
      revision.div = change(n(r.DivAnn), before.div);
    }
  }

  // 通期決算のときの来期予想（今期実績比）
  const guidance = { sales: null as number | null, op: null as number | null, np: null as number | null, div: null as number | null };
  if (kind === "earnings" && periodType === "FY") {
    guidance.sales = change(n(r.NxFSales), n(r.Sales));
    guidance.op = change(n(r.NxFOP), n(r.OP));
    guidance.np = change(n(r.NxFNp), n(r.NP));
    guidance.div = change(n(r.NxFDivAnn), n(r.DivAnn));
  }

  // 四半期の進捗率（営業利益の累計 ÷ 通期予想）
  const standard: Record<string, number> = { "1Q": 0.25, "2Q": 0.5, "3Q": 0.75 };
  const progress = { op: null as number | null, standard: standard[periodType] ?? null };
  if (kind === "earnings" && progress.standard !== null) {
    const op = n(r.OP);
    const fop = n(r.FOP);
    if (op !== null && fop !== null && fop > 0) progress.op = op / fop;
  }

  const sales = n(r.Sales);
  const opv = n(r.OP);
  const opMargin = sales && opv !== null && sales > 0 ? opv / sales : null;

  return { kind, periodType, yoy, revision, guidance, progress, opMargin };
}

/** 画面用：0.123 → "+12.3%" */
export function pct(v: number | null, digits = 1): string {
  if (v === null) return "—";
  return `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
}

export const KIND_LABEL: Record<DisclosureFeatures["kind"], string> = {
  earnings: "決算",
  forecast_revision: "業績予想の修正",
  dividend_revision: "配当予想の修正",
  other: "その他",
};
