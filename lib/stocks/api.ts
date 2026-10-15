// 株スイングの API の応答の形（サーバーとブラウザで共有）

import type {
  BacktestParams, BacktestResult, Bar, Disclosure, DisclosureFeatures, DisclosureScore, PaperTrade, StockInfo, TrendInfo,
} from "./types";

export type ApiFail = { ok: false; error: { code: string; message: string } };

export type StatusResponse = {
  ok: true;
  storage: "supabase" | "local";
  jquants: { configured: boolean; plan: string; rpm: number };
  claude: { configured: boolean; model: string };
  onVercel: boolean;
};

export type PrepareResponse =
  | { ok: true; stock: StockInfo | null; bars: number; disclosures: number; cached: boolean }
  | ApiFail;

export type DisclosureView = {
  disclosure: Pick<Disclosure, "id" | "code" | "discDate" | "discTime" | "docType" | "periodType">;
  features: DisclosureFeatures;
  score: DisclosureScore | null;
};

export type StockDetailResponse =
  | {
      ok: true;
      stock: StockInfo | null;
      bars: Bar[];
      trend: TrendInfo | null;
      disclosures: DisclosureView[];
    }
  | ApiFail;

export type ScoreResponse = { ok: true; score: DisclosureScore; cached: boolean } | ApiFail;

export type BacktestRequest = { codes: string[]; params: BacktestParams; save?: boolean };
export type BacktestResponse = { ok: true; result: BacktestResult; runId: string | null; missing: string[] } | ApiFail;
export type BacktestRunSummary = {
  id: string;
  createdAt: string;
  params: BacktestParams;
  codes: string[];
  metrics: BacktestResult["metrics"];
};
export type BacktestListResponse = { ok: true; runs: BacktestRunSummary[] } | ApiFail;

export type PaperListResponse = { ok: true; trades: PaperTrade[] } | ApiFail;
export type PaperCreateRequest = {
  code: string;
  disclosureId?: string | null;
  score?: number | null;
  signalDate?: string;
  stopPct: number;
  targetPct: number;
  maxHoldDays: number;
  shares: number;
  note?: string;
};
