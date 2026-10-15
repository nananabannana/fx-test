// 3択（上昇・横ばい・下降）の確率予測の評価。学習時のテストと、実際の記録の検証で共通に使う。

export const CLASSES = ["up", "flat", "down"] as const;
export type Cls = (typeof CLASSES)[number];
export const CLASS_LABEL: Record<Cls, string> = { up: "上昇", flat: "横ばい", down: "下降" };
export const clsIndex = (c: Cls) => CLASSES.indexOf(c);

export type CalibrationBin = { lo: number; hi: number; n: number; avgProb: number | null; accuracy: number | null };

export type ProbMetrics = {
  n: number;
  accuracy: number | null;
  /** 多クラスのブライアスコア（0〜2。小さいほど良い） */
  brier: number | null;
  logLoss: number | null;
  /** confusion[実際][予測] */
  confusion: number[][];
  perClass: { cls: Cls; support: number; predicted: number; precision: number | null; recall: number | null }[];
  /** 一番高い確率（＝予測した方向の確率）ごとの当たり具合 */
  calibration: CalibrationBin[];
  /** 較正誤差（予測した確率と実際の的中率のずれの平均） */
  ece: number | null;
};

export type Scored = { p: number[]; y: number };

const BINS: [number, number][] = [
  [0, 0.4],
  [0.4, 0.5],
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 1.0001],
];

const argmax = (p: number[]) => p.reduce((bi, v, i) => (v > p[bi] ? i : bi), 0);

export function evaluateProbs(items: Scored[]): ProbMetrics {
  const K = CLASSES.length;
  const confusion = Array.from({ length: K }, () => new Array(K).fill(0));
  let correct = 0;
  let brier = 0;
  let ll = 0;
  const bins = BINS.map(([lo, hi]) => ({ lo, hi, n: 0, sumP: 0, hit: 0 }));
  for (const { p, y } of items) {
    const k = argmax(p);
    confusion[y][k]++;
    if (k === y) correct++;
    for (let c = 0; c < K; c++) brier += (p[c] - (c === y ? 1 : 0)) ** 2;
    ll -= Math.log(Math.max(1e-12, p[y]));
    const b = bins.find((x) => p[k] >= x.lo && p[k] < x.hi)!;
    b.n++;
    b.sumP += p[k];
    if (k === y) b.hit++;
  }
  const n = items.length;
  const calibration = bins.map((b) => ({
    lo: b.lo,
    hi: Math.min(1, b.hi),
    n: b.n,
    avgProb: b.n ? b.sumP / b.n : null,
    accuracy: b.n ? b.hit / b.n : null,
  }));
  const ece = n ? calibration.reduce((s, b) => s + (b.n ? (b.n / n) * Math.abs((b.avgProb ?? 0) - (b.accuracy ?? 0)) : 0), 0) : null;
  const perClass = CLASSES.map((cls, i) => {
    const support = confusion[i].reduce((a, b) => a + b, 0);
    const predicted = confusion.reduce((a, row) => a + row[i], 0);
    return {
      cls,
      support,
      predicted,
      precision: predicted ? confusion[i][i] / predicted : null,
      recall: support ? confusion[i][i] / support : null,
    };
  });
  return {
    n,
    accuracy: n ? correct / n : null,
    brier: n ? brier / n : null,
    logLoss: n ? ll / n : null,
    confusion,
    perClass,
    calibration,
    ece,
  };
}

/** 最大ドローダウン（資産の推移から。金額） */
export function maxDrawdown(equity: number[]): number {
  let peak = -Infinity;
  let dd = 0;
  for (const v of equity) {
    peak = Math.max(peak, v);
    dd = Math.max(dd, peak - v);
  }
  return dd;
}
