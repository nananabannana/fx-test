// GMOクリック証券「外為オプション」（USD/JPY ラダー型）の検証用ロジック
//
// ルール（公式「取引ルール」より、アプリで使う部分）
// - 判定（満期）時刻：11,13,15,17,19,21,23,翌1,翌3,翌5時（JST）の1日10回号
// - 各回号は満期の3時間前に開始。満期2分前以降は新規・決済とも不可
// - 取引時間：月〜金 8:00〜翌5:00（JST）
// - ペイアウト：1枚1,000円（外れは0円）、購入価格は1〜999円
// - 判定レート：満期前に最後に更新された MID レート
// - 目標レートの本数・間隔は非公開 → ユーザーが手入力
// - 目標レートと同値の扱いは不明 → 当面「引き分け」として集計から除外
//
// 時刻はすべて「UTC ミリ秒 + 9時間」で JST を計算する（実行環境のタイムゾーンに依存しない）。
// 祝日・年末年始の休業は判定しない（土日のみ）。

export const PAYOUT = 1000;
export const EXPIRY_HOURS_JST = [11, 13, 15, 17, 19, 21, 23, 1, 3, 5] as const;
export const ROUND_LENGTH_MIN = 180;
export const CUTOFF_BEFORE_MIN = 2;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const JST = 9 * HOUR;

// ---------------- 回号 ----------------

export type Round = {
  /** 例："2026-10-15T15:00" （JSTの満期日時） */
  id: string;
  /** 満期（UTCミリ秒） */
  expiry: number;
  /** 購入開始（満期の3時間前） */
  start: number;
  /** 購入締切（満期の2分前） */
  cutoff: number;
  /** 例："10/15 15:00回" */
  label: string;
};

export type OpenRound = Round & { minutesToExpiry: number; minutesToCutoff: number };

/** JST の暦日番号（1970-01-01 JST を 0 とする）と、その日の曜日（0=日） */
const jstDayIndex = (t: number) => Math.floor((t + JST) / DAY);
const weekdayOfJstDay = (d: number) => new Date(d * DAY).getUTCDay();

function fmtJst(t: number) {
  const d = new Date(t + JST);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    iso: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
    label: `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}回`,
  };
}

export function makeRound(expiry: number): Round {
  const f = fmtJst(expiry);
  return { id: f.iso, expiry, start: expiry - ROUND_LENGTH_MIN * MIN, cutoff: expiry - CUTOFF_BEFORE_MIN * MIN, label: f.label };
}

/** 取引日 d（JST の月〜金）に属する10回号。翌1・3・5時の満期は翌日の日付になる */
function roundsOfTradingDay(d: number): Round[] {
  const wd = weekdayOfJstDay(d);
  if (wd === 0 || wd === 6) return [];
  const midnight = d * DAY - JST; // その日の 0:00 JST（UTCミリ秒）
  return EXPIRY_HOURS_JST.map((h) => makeRound(midnight + (h >= 11 ? h : 24 + h) * HOUR));
}

/** now の前後の回号を時刻順に */
export function roundsAround(now: number, daysBefore = 1, daysAfter = 7): Round[] {
  const d0 = jstDayIndex(now);
  const out: Round[] = [];
  for (let d = d0 - daysBefore; d <= d0 + daysAfter; d++) out.push(...roundsOfTradingDay(d));
  return out.sort((a, b) => a.expiry - b.expiry);
}

/** 今、購入できる回号（開始済み・締切前）。満期が近い順 */
export function getOpenRounds(now: number): OpenRound[] {
  return roundsAround(now)
    .filter((r) => r.start <= now && now < r.cutoff)
    .map((r) => ({ ...r, minutesToExpiry: (r.expiry - now) / MIN, minutesToCutoff: (r.cutoff - now) / MIN }));
}

/** 次に購入できるようになる回号（今買える回号がなくても、ある場合でも「これから始まる最初の回号」） */
export function getNextRound(now: number): Round | null {
  return roundsAround(now).find((r) => r.start > now) ?? null;
}

/** id（"YYYY-MM-DDTHH:mm" JST）から回号を復元 */
export function roundFromId(id: string): Round | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(id);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - JST;
  return makeRound(t);
}

// ---------------- 確率モデル ----------------

/** 標準正規分布の累積分布関数（Abramowitz-Stegun 26.2.17、誤差 < 7.5e-8） */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

const clampProb = (p: number) => Math.min(0.999, Math.max(0.001, p));

/** 直近の終値から、1分あたりの対数リターンの標準偏差 */
export function volatilityPerMinute(closes: number[], lookback = 120): number | null {
  const xs = closes.slice(-(lookback + 1));
  if (xs.length < 21) return null;
  const r: number[] = [];
  for (let i = 1; i < xs.length; i++) if (xs[i - 1] > 0 && xs[i] > 0) r.push(Math.log(xs[i] / xs[i - 1]));
  if (r.length < 20) return null;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v);
}

/**
 * 基準モデル：満期に目標レートより上になる確率（ドリフトなし）
 * P(S_T > K) = Φ( ln(S/K) / (σ√T) )   σ=1分あたりのボラティリティ、T=残り分数
 */
export function probAbove(closes: number[], spot: number, strike: number, minutesLeft: number, lookback = 120): number | null {
  const sigma = volatilityPerMinute(closes, lookback);
  if (sigma === null || minutesLeft <= 0 || spot <= 0 || strike <= 0) return null;
  const sd = sigma * Math.sqrt(minutesLeft);
  if (sd === 0) return spot > strike ? 0.999 : spot < strike ? 0.001 : 0.5;
  return clampProb(normCdf(Math.log(spot / strike) / sd));
}

/**
 * 指標エンジン：直近20分の勢いが半分だけ続くと仮定したドリフト付きモデル
 * P = Φ( (ln(S/K) + D) / (σ√T) )
 * D（満期までの勢いによる移動）は、満期までの変動の目安 σ√T の半分までに制限する
 * （勢いは長続きしないことが多く、確率が極端にならないようにするため）
 */
export function probAboveIndicator(closes: number[], spot: number, strike: number, minutesLeft: number): number | null {
  const sigma = volatilityPerMinute(closes);
  if (sigma === null || minutesLeft <= 0 || closes.length < 21) return null;
  const n = 20;
  const recent = closes.slice(-(n + 1));
  const muPerMin = Math.log(recent[recent.length - 1] / recent[0]) / n;
  const sd = sigma * Math.sqrt(minutesLeft);
  if (sd === 0) return probAbove(closes, spot, strike, minutesLeft);
  const drift = Math.max(-0.5 * sd, Math.min(0.5 * sd, muPerMin * 0.5 * minutesLeft));
  return clampProb(normCdf((Math.log(spot / strike) + drift) / sd));
}

// ---------------- 期待値 ----------------

export type Direction = "high" | "low";

export type Evaluation = {
  /** 選んだ方向が当たる確率 */
  pWin: number;
  /** 損益分岐の勝率（購入価格 ÷ 1,000） */
  breakeven: number;
  /** pWin − breakeven */
  edge: number;
  /** 1枚あたりの期待値（円） */
  evPerUnit: number;
  /** edge が安全幅 margin を超えているか */
  candidate: boolean;
};

export function evaluate(opts: { probAbove: number; direction: Direction; price: number; margin?: number }): Evaluation {
  const margin = opts.margin ?? 0.02;
  const pWin = opts.direction === "high" ? opts.probAbove : 1 - opts.probAbove;
  const breakeven = opts.price / PAYOUT;
  const edge = pWin - breakeven;
  const evPerUnit = pWin * PAYOUT - opts.price;
  return { pWin, breakeven, edge, evPerUnit, candidate: edge > margin && evPerUnit > 0 };
}

// ---------------- 記録と照合 ----------------

export type Engine = "claude" | "indicator" | "baseline";

export type TradeRecord = {
  id: string;
  createdAt: number;
  roundId: string;
  expiry: number;
  strike: number;
  direction: Direction;
  /** 1枚の購入価格（円） */
  price: number;
  units: number;
  /** 記録した時点の現在値 */
  spot: number;
  /** 記録した時点の満期までの分数 */
  minutesLeft: number;
  /** 判断に使ったエンジン */
  engine: Engine;
  /** 各エンジンの「満期に目標レートより上になる確率」（記録時点） */
  probs: Partial<Record<Engine, number>>;
  claudeReasons?: string[];
  margin: number;
  /** 実際に購入したか（記録のみなら false） */
  executed: boolean;
  /** Twelve Data の満期直前1分足の終値（自動） */
  expiryRateAuto?: number;
  /** GMO 画面の判定レート（手入力。あればこちらを優先） */
  expiryRateManual?: number;
  /** 自動取得できなかった（休場など） */
  autoUnavailable?: boolean;
  note: string;
};

export type Outcome = "win" | "lose" | "draw" | "pending";

export function expiryRate(r: TradeRecord): number | undefined {
  return r.expiryRateManual ?? r.expiryRateAuto;
}

export function outcomeOf(r: TradeRecord): Outcome {
  const rate = expiryRate(r);
  if (rate === undefined) return "pending";
  if (rate === r.strike) return "draw";
  const above = rate > r.strike;
  return (r.direction === "high") === above ? "win" : "lose";
}

export function pnlOf(r: TradeRecord): number | null {
  const o = outcomeOf(r);
  if (o === "pending") return null;
  if (o === "draw") return 0;
  return o === "win" ? (PAYOUT - r.price) * r.units : -r.price * r.units;
}

// ---------------- 集計 ----------------

/** 勝率の95%信頼区間（ウィルソン法） */
export function wilson(wins: number, n: number): { low: number; high: number } | null {
  if (n === 0) return null;
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export type Summary = {
  total: number;
  settled: number;
  wins: number;
  losses: number;
  draws: number;
  pending: number;
  winRate: number | null;
  /** 95%の範囲の半分の幅（±） */
  winRateMargin: number | null;
  ci: { low: number; high: number } | null;
  avgBreakeven: number | null;
  totalPnl: number;
  units: number;
  pnlPerUnit: number | null;
  /** 判断できるほど件数があるか */
  enoughData: boolean;
};

export function summarize(records: TradeRecord[]): Summary {
  let wins = 0, losses = 0, draws = 0, pending = 0, totalPnl = 0, units = 0, beSum = 0;
  for (const r of records) {
    const o = outcomeOf(r);
    if (o === "pending") { pending++; continue; }
    if (o === "draw") { draws++; continue; }
    if (o === "win") wins++; else losses++;
    totalPnl += pnlOf(r) ?? 0;
    units += r.units;
    beSum += r.price / PAYOUT;
  }
  const settled = wins + losses;
  const ci = wilson(wins, settled);
  return {
    total: records.length,
    settled,
    wins,
    losses,
    draws,
    pending,
    winRate: settled ? wins / settled : null,
    winRateMargin: ci ? (ci.high - ci.low) / 2 : null,
    ci,
    avgBreakeven: settled ? beSum / settled : null,
    totalPnl,
    units,
    pnlPerUnit: units ? totalPnl / units : null,
    enoughData: settled >= 100,
  };
}

export type CalibrationBin = {
  /** 例："40–50%" */
  label: string;
  from: number;
  to: number;
  n: number;
  /** その帯の予測確率の平均 */
  avgPred: number | null;
  /** 実際に目標レートより上だった割合 */
  hitRate: number | null;
};

/**
 * 較正：エンジンの「上になる確率」と、実際に上だった割合を確率帯ごとに比べる。
 * 選んだ方向（High/Low）に関係なく、同じ予測を全件使えるので件数をかせげる。
 */
export function calibration(records: TradeRecord[], engine: Engine, bins = 10): CalibrationBin[] {
  const out: CalibrationBin[] = Array.from({ length: bins }, (_, i) => ({
    label: `${Math.round((i / bins) * 100)}–${Math.round(((i + 1) / bins) * 100)}%`,
    from: i / bins,
    to: (i + 1) / bins,
    n: 0,
    avgPred: null,
    hitRate: null,
  }));
  const acc = out.map(() => ({ pred: 0, hit: 0 }));
  for (const r of records) {
    const p = r.probs[engine];
    const rate = expiryRate(r);
    if (p === undefined || rate === undefined || rate === r.strike) continue;
    const i = Math.min(bins - 1, Math.floor(p * bins));
    out[i].n++;
    acc[i].pred += p;
    if (rate > r.strike) acc[i].hit++;
  }
  out.forEach((b, i) => {
    if (b.n) {
      b.avgPred = acc[i].pred / b.n;
      b.hitRate = acc[i].hit / b.n;
    }
  });
  return out;
}

/** ブライアスコア（0に近いほど確率が正確。常に50%と言うと0.25） */
export function brier(records: TradeRecord[], engine: Engine): { score: number; n: number } | null {
  let s = 0, n = 0;
  for (const r of records) {
    const p = r.probs[engine];
    const rate = expiryRate(r);
    if (p === undefined || rate === undefined || rate === r.strike) continue;
    const y = rate > r.strike ? 1 : 0;
    s += (p - y) ** 2;
    n++;
  }
  return n ? { score: s / n, n } : null;
}
