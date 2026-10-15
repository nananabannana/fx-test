// 短期予測の API と画面で共通の型

import type { Candle } from "../types";
import type { FxEvent, Session } from "../conditions";
import type { Raw, Regime } from "./features";
import type { FxModel, Horizon, HorizonPrediction } from "./model";

export type ApiError = { code: string; message: string };

export type CandlesPayload = { candles: Candle[]; fetchedAt: number; provider: string; delayNote: string };
export type CandlesResult = ({ ok: true } & CandlesPayload) | { ok: false; error: ApiError };

export type PredictRun = {
  id: string;
  /** 分析に使った最後の確定1分足の開始時刻（価格はこの足の終値） */
  at: number;
  price: number;
  fetchedAt: number;
  provider: string;
  delayNote: string;
  modelVersion: string;
  modelCreatedAt: number;
  regime: Regime;
  session: Session;
  raw: Raw;
  horizons: Record<Horizon, HorizonPrediction>;
  /** 指標発表など（data/events.json） */
  events: FxEvent[];
  cautions: string[];
  /** スプレッド・取引コストは反映していない */
  costNote: string;
};

export type RunResult = { ok: true; run: PredictRun } | { ok: false; error: ApiError };

export type ModelResult =
  | { ok: true; model: FxModel | null; training: boolean; history: { candles: number; from: number | null; to: number | null } }
  | { ok: false; error: ApiError };

export type TrainResult = { ok: true; model: FxModel; calls: number } | { ok: false; error: ApiError };

export type Explanation = { summary: string; points: string[]; cautions: string[]; removed: number };
export type ExplainResult = { ok: true; explanation: Explanation; model: string; cached: boolean } | { ok: false; error: ApiError };
