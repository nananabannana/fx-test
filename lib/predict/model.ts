// 短期予測モデル（5分後・10分後の上昇/横ばい/下降の確率）
//
// - 予測対象：分析時点の終値と、h 分後の1分足の終値の差
// - 横ばい：差が「横ばいの幅」未満。幅 = max(最小幅, 係数 × 1分足ATR × √h)。学習時に決めてモデルに保存する
// - 学習：時間順に並べ、古い期間で学習 → 新しい期間でテスト。テストの直前 h 分は捨てる（答えの重なりを防ぐ）
// - テストは h 分おきの重ならない時点だけで評価する（隣どうしの結果がほぼ同じになるのを避ける）
// - 標準化の平均・ばらつきは学習期間だけから計算する

import type { Candle } from "../types";
import { PIP } from "../config";
import {
  classifyRegime, computeFeatures, DEFAULT_EFFICIENCY, FEATURE_LABEL, FEATURE_NAMES, isFailure, WINDOW,
  type FeatureName, type FeatureResult, type Raw, type Regime, type RegimeThresholds,
} from "./features";
import { fitStandardizer, predictProba, standardize, toPercents, trainSoftmax, type Standardizer, type Weights } from "./logistic";
import { CLASSES, evaluateProbs, type Cls, type ProbMetrics, type Scored } from "./evaluate";

const MIN = 60_000;

export const HORIZONS = [5, 10] as const;
export type Horizon = (typeof HORIZONS)[number];

export const MODEL_KIND = "lr1";

export type TrainSettings = {
  /** 横ばいの最小幅（pips） */
  flatMinPips: number;
  /** 横ばいの幅の係数（× 1分足ATR × √h） */
  flatAtrK: number;
  /** テストに回す割合（新しい側） */
  testFraction: number;
};

export const DEFAULT_SETTINGS: TrainSettings = { flatMinPips: 1, flatAtrK: 0.5, testFraction: 0.25 };

export function validSettings(s: Partial<TrainSettings> | undefined): TrainSettings {
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : d);
  return {
    flatMinPips: num(s?.flatMinPips, 0, 20, DEFAULT_SETTINGS.flatMinPips),
    flatAtrK: num(s?.flatAtrK, 0, 3, DEFAULT_SETTINGS.flatAtrK),
    testFraction: num(s?.testFraction, 0.1, 0.5, DEFAULT_SETTINGS.testFraction),
  };
}

export function flatBandPips(atr1Pips: number, h: number, s: TrainSettings): number {
  return Math.round(Math.max(s.flatMinPips, s.flatAtrK * atr1Pips * Math.sqrt(h)) * 10) / 10;
}

export function labelOf(deltaPips: number, bandPips: number): Cls {
  if (Math.abs(deltaPips) < bandPips) return "flat";
  return deltaPips > 0 ? "up" : "down";
}

export type TestReport = ProbMetrics & {
  /** 「いつも学習期間の比率で答える」基準 */
  baseline: { probs: number[]; accuracy: number | null; brier: number | null; logLoss: number | null; majority: Cls };
  byRegime: Record<Regime, { n: number; accuracy: number | null }>;
  trainN: number;
};

export type HorizonModel = {
  horizon: Horizon;
  weights: Weights;
  scaler: Standardizer;
  /** 変動幅の目安：|h分後の変化| ÷ (ATR×√h) の学習期間の中央値 */
  moveRatio: number;
  /** 学習期間の各クラスの割合 */
  trainShare: number[];
  test: TestReport;
  provisional: boolean;
  provisionalReasons: string[];
};

export type FxModel = {
  version: string;
  kind: typeof MODEL_KIND;
  createdAt: number;
  featureNames: FeatureName[];
  settings: TrainSettings;
  data: { from: number; to: number; candles: number; source: string };
  split: { trainFrom: number; trainTo: number; testFrom: number; testTo: number };
  regime: RegimeThresholds;
  horizons: Record<Horizon, HorizonModel>;
};

/** 学習・テストに使う特徴量を、全期間について計算する（各時点はその時点までの足だけを使う） */
export function buildFeatureRows(candles: Candle[]): FeatureResult[] {
  const rows: FeatureResult[] = [];
  for (let i = 129; i < candles.length; i++) {
    const r = computeFeatures(candles.slice(Math.max(0, i - WINDOW + 1), i + 1));
    if (!isFailure(r)) rows.push(r);
  }
  return rows;
}

const median = (v: number[]) => {
  if (!v.length) return 1;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const quantile = (v: number[], q: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

const jstStamp = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");

export type TrainError = { error: string };

export function trainModel(candles: Candle[], opts: { settings?: Partial<TrainSettings>; now: number; source: string }): FxModel | TrainError {
  const settings = validSettings(opts.settings);
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const byTime = new Map(sorted.map((c) => [c.time, c.close]));
  const rows = buildFeatureRows(sorted);
  if (rows.length < 2000) return { error: `特徴量を計算できた時点が ${rows.length} 件しかありません（2,000件以上必要）。学習期間を確認してください。` };

  const cut = rows[Math.floor(rows.length * (1 - settings.testFraction))].t;
  const regime: RegimeThresholds = {
    atr5Pips: quantile(rows.filter((r) => r.t < cut).map((r) => r.raw.atr5Pips), 0.8),
    efficiency: DEFAULT_EFFICIENCY,
  };

  const horizons = {} as Record<Horizon, HorizonModel>;
  let split = { trainFrom: 0, trainTo: 0, testFrom: 0, testTo: 0 };
  for (const h of HORIZONS) {
    type S = { r: FeatureResult; y: number; delta: number };
    const samples: S[] = [];
    for (const r of rows) {
      const future = byTime.get(r.t + h * MIN);
      if (future === undefined) continue;
      const delta = (future - r.raw.price) / PIP;
      samples.push({ r, delta, y: CLASSES.indexOf(labelOf(delta, flatBandPips(r.raw.atr1Pips, h, settings))) });
    }
    // 学習：テスト開始より h 分以上前（答えの時刻がテスト期間に入らない）
    const train = samples.filter((s) => s.r.t + h * MIN < cut);
    // テスト：h 分おきの重ならない時点
    const testAll = samples.filter((s) => s.r.t >= cut);
    const test: S[] = [];
    for (const s of testAll) if (!test.length || s.r.t >= test[test.length - 1].r.t + h * MIN) test.push(s);
    if (train.length < 1500 || test.length < 100) {
      return { error: `${h}分後の学習データ（${train.length}件）かテストデータ（${test.length}件）が少なすぎます。` };
    }

    const scaler = fitStandardizer(train.map((s) => s.r.x));
    const W = trainSoftmax(
      train.map((s) => standardize(s.r.x, scaler)),
      train.map((s) => s.y),
      CLASSES.length,
    );
    const share = CLASSES.map((_, k) => train.filter((s) => s.y === k).length / train.length);
    const scored: (Scored & { regime: Regime })[] = test.map((s) => ({
      p: predictProba(W, standardize(s.r.x, scaler)),
      y: s.y,
      regime: classifyRegime(s.r.raw, regime),
    }));
    const metrics = evaluateProbs(scored);
    const base = evaluateProbs(test.map((s) => ({ p: share, y: s.y })));
    const majority = CLASSES[share.indexOf(Math.max(...share))];
    const byRegime = {} as TestReport["byRegime"];
    for (const g of ["trend", "range", "highvol"] as Regime[]) {
      const sub = scored.filter((s) => s.regime === g);
      byRegime[g] = { n: sub.length, accuracy: sub.length ? evaluateProbs(sub).accuracy : null };
    }

    const reasons: string[] = [];
    if (metrics.n < 500) reasons.push(`テスト件数が ${metrics.n} 件と少ない（500件未満）`);
    if (metrics.brier !== null && base.brier !== null && metrics.brier >= base.brier) {
      reasons.push("テスト期間で、過去の比率で答えるだけの基準より確率の精度（ブライアスコア）が良くない");
    }
    if (metrics.ece !== null && metrics.ece > 0.05) reasons.push(`確率と実際の的中率のずれが大きい（較正誤差 ${(metrics.ece * 100).toFixed(1)}%）`);
    const days = (sorted[sorted.length - 1].time - sorted[0].time) / 86_400_000;
    if (days < 14) reasons.push(`学習に使ったデータが ${days.toFixed(0)} 日分と短い`);

    horizons[h] = {
      horizon: h,
      weights: W,
      scaler,
      moveRatio: median(train.map((s) => Math.abs(s.delta) / (s.r.raw.atr1Pips * Math.sqrt(h)))),
      trainShare: share,
      test: {
        ...metrics,
        baseline: { probs: share, accuracy: base.accuracy, brier: base.brier, logLoss: base.logLoss, majority },
        byRegime,
        trainN: train.length,
      },
      provisional: reasons.length > 0,
      provisionalReasons: reasons,
    };
    split = { trainFrom: train[0].r.t, trainTo: train[train.length - 1].r.t, testFrom: test[0].r.t, testTo: test[test.length - 1].r.t };
  }

  return {
    version: `${MODEL_KIND}-${jstStamp(opts.now)}`,
    kind: MODEL_KIND,
    createdAt: opts.now,
    featureNames: [...FEATURE_NAMES],
    settings,
    data: { from: sorted[0].time, to: sorted[sorted.length - 1].time, candles: sorted.length, source: opts.source },
    split,
    regime,
    horizons,
  };
}

// ---------------- 予測 ----------------

export type Contribution = { name: FeatureName; label: string; effect: number };

export type HorizonPrediction = {
  horizon: Horizon;
  /** 上昇・横ばい・下降の確率（合計1） */
  probs: Record<Cls, number>;
  /** 画面表示用の整数％（合計100） */
  percents: Record<Cls, number>;
  direction: Cls;
  bandPips: number;
  /** 変動幅の目安（pips） */
  movePips: number;
  /** 上昇寄り（+）／下降寄り（−）に効いた要素（大きい順） */
  contributions: Contribution[];
  provisional: boolean;
  provisionalReasons: string[];
  testAccuracy: number | null;
  baselineAccuracy: number | null;
  regimeAccuracy: { n: number; accuracy: number | null };
  /** 学習期間の比率（比較用の基準の確率） */
  baseProbs: number[];
};

export function predictHorizon(model: FxModel, h: Horizon, f: FeatureResult, regime: Regime): HorizonPrediction {
  const hm = model.horizons[h];
  const z = standardize(f.x, hm.scaler);
  const p = predictProba(hm.weights, z);
  const [up, flat, down] = p;
  const percents = toPercents(p);
  const k = p.indexOf(Math.max(...p));
  // 上昇と下降の係数の差 × 今の値：プラスなら上昇寄り
  const merged = new Map<string, Contribution>();
  model.featureNames.forEach((name, j) => {
    const e = (hm.weights[0][j + 1] - hm.weights[2][j + 1]) * z[j];
    const key = name === "hourSin" || name === "hourCos" ? "hour" : name;
    const cur = merged.get(key);
    if (cur) cur.effect += e;
    else merged.set(key, { name, label: FEATURE_LABEL[name], effect: e });
  });
  const contributions = [...merged.values()].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return {
    horizon: h,
    probs: { up, flat, down },
    percents: { up: percents[0], flat: percents[1], down: percents[2] },
    direction: CLASSES[k],
    bandPips: flatBandPips(f.raw.atr1Pips, h, model.settings),
    movePips: Math.round(hm.moveRatio * f.raw.atr1Pips * Math.sqrt(h) * 10) / 10,
    contributions,
    provisional: hm.provisional,
    provisionalReasons: hm.provisionalReasons,
    testAccuracy: hm.test.accuracy,
    baselineAccuracy: hm.test.baseline.accuracy,
    regimeAccuracy: hm.test.byRegime[regime],
    baseProbs: hm.trainShare,
  };
}

export type { Raw };
