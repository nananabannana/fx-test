// 分析の基本設定。将来、通貨ペアや予測期間を選べるようにするときはここを拡張します。

export const PAIR = "USD/JPY";
/** 予測期間の初期値（分） */
export const HORIZON_MINUTES = 5;
/** 選べる予測期間（分） */
export const HORIZON_OPTIONS = [5, 10, 15, 30] as const;
export type Horizon = (typeof HORIZON_OPTIONS)[number];
export const isHorizon = (v: unknown): v is Horizon => HORIZON_OPTIONS.includes(v as Horizon);

/** 1pip の価格幅（USD/JPY は 0.01円） */
export const PIP = 0.01;

/** この幅（pips）未満の値動きは「横ばい」とみなす */
export const FLAT_THRESHOLD_PIPS = 2;

/** チャートに表示する本数 */
export const CHART_WINDOW = 60;
