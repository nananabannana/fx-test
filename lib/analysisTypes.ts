// 分析APIまわりで、サーバーとブラウザの両方が使う型

import type { Candle } from "./types";
import type { AnalysisResult } from "./analyzer";

/** 分析エンジン。demo=簡単な指標による機械的な分析、claude=Claude API */
export type Engine = "demo" | "claude";

export type AnalyzeErrorCode =
  | "no_key"
  | "invalid_key"
  | "no_credit"
  | "rate_limit"
  | "daily_limit"
  | "too_soon"
  | "overloaded"
  | "bad_request"
  | "bad_output"
  | "network";

export type AnalyzeRequest = {
  pair: string;
  horizonMinutes: number;
  candles: Candle[];
  /** "demo"=架空のサンプル、"live"=実データ。プロンプトで区別する */
  dataKind: "demo" | "live";
  /** ラダー型など：判定時刻にこのレートより上か下かを判断する（省略時は現在値と比べる） */
  strike?: number;
};

export type AnalyzeResponse =
  | { ok: true; result: AnalysisResult; model: string; cached: boolean }
  | { ok: false; error: { code: AnalyzeErrorCode; message: string } };
