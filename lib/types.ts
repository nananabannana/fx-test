// アプリ全体で使う型定義

import type { ConditionFields } from "./conditions";

/** ローソク足1本分のデータ（1分足） */
export type Candle = {
  /** 足の開始時刻（UNIXミリ秒） */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** 予測の方向 */
export type Direction = "up" | "down" | "hold";

/** 各方向のスコア（合計100、単位は%表記用の整数） */
export type DirectionScores = Record<Direction, number>;

/** データの出どころ。demo=架空のサンプル、live=為替データAPIの実データ */
export type DataSource = "demo" | "live";

/** 1回分の予測 */
export type Prediction = {
  id: string;
  /** 予測の基準にした足の時刻 */
  at: number;
  pair: string;
  horizonMinutes: number;
  /** 予測時点の価格 */
  basePrice: number;
  direction: Direction;
  scores: DirectionScores;
  reasons: string[];
  source: DataSource;
  /** 分析エンジン（古い記録にはないので、無ければ "demo" とみなす） */
  engine?: "demo" | "claude";
  /** Claude で分析したときのモデル名 */
  model?: string;
  /** 予測期間後の実績が確定したら保存する（実データでは古い足が取得範囲から外れるため） */
  resolvedPrice?: number;
} & ConditionFields;

/** 予測と実績の照合結果 */
export type Outcome = "match" | "miss" | "excluded" | "pending" | "unavailable";

export type VerifiedPrediction = Prediction & {
  actualPrice: number | null;
  /** 価格変化（pips）。USD/JPY は 0.01円 = 1pip */
  changePips: number | null;
  actualDirection: Direction | null;
  outcome: Outcome;
};
