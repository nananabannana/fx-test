// 「株スイング」で使う型（サーバーとブラウザの両方で使う）

/** 日足1本（調整後価格を使う） */
export type Bar = {
  date: string; // YYYY-MM-DD
  o: number;
  h: number;
  l: number;
  c: number;
  vo: number | null;
  /** 売買代金（円、調整なし） */
  va: number | null;
};

export type StockInfo = {
  code: string; // 5桁
  name: string;
  sector33: string;
  market: string;
};

/** J-Quants /v2/fins/summary の1行（値はすべて文字列） */
export type SummaryRaw = Record<string, string>;

export type Disclosure = {
  id: string;
  code: string;
  discDate: string; // YYYY-MM-DD
  discTime: string;
  docType: string;
  periodType: string;
  raw: SummaryRaw;
};

/** 開示から計算した比較用の数字（％はすべて 0.123 = 12.3% の形） */
export type DisclosureFeatures = {
  kind: "earnings" | "forecast_revision" | "dividend_revision" | "other";
  periodType: string;
  /** 前年同期比（実績） */
  yoy: { sales: number | null; op: number | null; np: number | null };
  /** 今期予想の修正率（直前の開示の予想と比べて） */
  revision: { sales: number | null; op: number | null; np: number | null; div: number | null };
  /** 通期決算のときの来期予想（今期実績比） */
  guidance: { sales: number | null; op: number | null; np: number | null; div: number | null };
  /** 四半期決算のときの、通期営業利益予想に対する進捗率と標準進捗 */
  progress: { op: number | null; standard: number | null };
  /** 営業利益率（実績） */
  opMargin: number | null;
};

export type SubScores = {
  revision: number;
  guidance: number;
  dividend: number;
  growth: number;
  progress: number;
};

export type DisclosureScore = {
  id: string;
  disclosureId: string;
  model: string;
  promptVersion: string;
  /** -10〜+10 */
  score: number;
  subScores: SubScores;
  summary: string;
  reasons: string[];
  usedText: boolean;
  createdAt: string;
};

export type Trend = "up" | "neutral" | "down";

export type TrendInfo = {
  trend: Trend;
  close: number;
  sma25: number | null;
  sma75: number | null;
  /** 直近20日の平均売買代金（円） */
  avgTurnover20: number | null;
};

// ---- バックテスト ----

export type LotMode = "unit" | "odd";

export type BacktestParams = {
  /** スコアの下限（null ならスコアを条件にしない） */
  minScore: number | null;
  /** エントリーを許すトレンド */
  trends: Trend[];
  /** 損切り幅（0.06 = 6%） */
  stopPct: number;
  /** 利確 = 損切り幅 × この倍率 */
  rewardMultiple: number;
  /** この営業日数で手仕舞い */
  maxHoldDays: number;
  /** 初期資金（円） */
  capital: number;
  /** 1回の許容損失（資金に対する割合、0.01 = 1%） */
  riskPct: number;
  /** unit=100株単位のみ、odd=単元未満株も可 */
  lotMode: LotMode;
  /** 片道の滑り（0.001 = 0.1%） */
  slippagePct: number;
  /** 1回の売買の手数料（円・片道） */
  feeYen: number;
  /** 直近20日の平均売買代金の下限（円） */
  minTurnover: number;
};

export type ExitReason = "stop" | "target" | "time" | "end";

/** 1つの開示に対する「ルールどおりに入ったらどうなったか」 */
export type SignalOutcome = {
  code: string;
  name: string;
  disclosureId: string;
  discDate: string;
  score: number | null;
  trend: Trend;
  avgTurnover20: number | null;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  exitReason: ExitReason;
  holdDays: number;
  returnPct: number;
  rMultiple: number;
};

export type SkipReason = "unit_too_large" | "no_cash" | "overlap";

export type BacktestTrade = SignalOutcome & {
  shares: number;
  pnlYen: number;
};

export type BucketStat = {
  label: string;
  n: number;
  winRate: number | null;
  avgReturnPct: number | null;
  expectancyR: number | null;
};

export type BacktestMetrics = {
  signals: number;
  trades: number;
  wins: number;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  expectancyPct: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  totalPnlYen: number;
  endCapital: number;
  maxDrawdownPct: number;
  avgHoldDays: number | null;
  skipped: Record<SkipReason, number>;
};

export type BacktestResult = {
  params: BacktestParams;
  codes: string[];
  period: { from: string | null; to: string | null };
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equity: { date: string; equity: number }[];
  /** スコアの帯ごとの成績（スコア条件を外した全シグナルで計算） */
  byScore: BucketStat[];
  /** トレンドごとの成績（同上） */
  byTrend: BucketStat[];
};

// ---- 検証ログ（ペーパートレード） ----

export type PaperStatus = "planned" | "open" | "closed";

export type PaperTrade = {
  id: string;
  code: string;
  name: string;
  disclosureId: string | null;
  score: number | null;
  trend: Trend;
  status: PaperStatus;
  signalDate: string;
  entryDate: string | null;
  entryPrice: number | null;
  stopPct: number;
  targetPct: number;
  maxHoldDays: number;
  shares: number;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: ExitReason | null;
  returnPct: number | null;
  rMultiple: number | null;
  pnlYen: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_PARAMS: BacktestParams = {
  minScore: 3,
  trends: ["up"],
  stopPct: 0.06,
  rewardMultiple: 2,
  maxHoldDays: 20,
  capital: 400_000,
  riskPct: 0.015,
  lotMode: "unit",
  slippagePct: 0.001,
  feeYen: 0,
  minTurnover: 500_000_000,
};

/** 4桁コードを J-Quants の5桁にそろえる */
export function toCode5(code: string): string {
  const c = code.trim().toUpperCase();
  return c.length === 4 ? `${c}0` : c;
}

/** 画面表示用の4桁コード */
export function toCode4(code: string): string {
  return code.length === 5 && code.endsWith("0") ? code.slice(0, 4) : code;
}
