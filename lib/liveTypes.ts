// 実データ取得まわりで、サーバーとブラウザの両方が使う型

import type { Candle } from "./types";

export type LiveErrorCode = "no_key" | "invalid_key" | "rate_limit" | "upstream" | "network";

export type LiveError = { code: LiveErrorCode; message: string };

export type CandlesResponse =
  | { ok: true; candles: Candle[]; fetchedAt: number; provider: string }
  | { ok: false; error: LiveError };
