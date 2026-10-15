// 多クラスのロジスティック回帰（ソフトマックス回帰）。上昇・横ばい・下降の3択に使う。
// 外部ライブラリを使わず、全データの勾配降下（Adam）で学習する。結果は同じデータなら毎回同じ。

export type Standardizer = { mean: number[]; std: number[] };

export function fitStandardizer(X: number[][]): Standardizer {
  const d = X[0]?.length ?? 0;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j];
  for (let j = 0; j < d; j++) mean[j] /= Math.max(1, X.length);
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / Math.max(1, X.length)) || 1;
  return { mean, std };
}

export function standardize(x: number[], s: Standardizer): number[] {
  return x.map((v, j) => (v - s.mean[j]) / s.std[j]);
}

/** W[k] = [バイアス, 係数...]（K クラス × (d+1)） */
export type Weights = number[][];

export function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export function predictProba(W: Weights, z: number[]): number[] {
  return softmax(W.map((w) => w[0] + z.reduce((acc, v, j) => acc + w[j + 1] * v, 0)));
}

export function trainSoftmax(
  Z: number[][],
  y: number[],
  K: number,
  opts: { l2?: number; epochs?: number; lr?: number } = {},
): Weights {
  const l2 = opts.l2 ?? 1e-3;
  const epochs = opts.epochs ?? 400;
  const lr = opts.lr ?? 0.05;
  const n = Z.length;
  const d = Z[0]?.length ?? 0;
  const W: Weights = Array.from({ length: K }, () => new Array(d + 1).fill(0));
  const m: Weights = W.map((r) => r.map(() => 0));
  const v: Weights = W.map((r) => r.map(() => 0));
  const b1 = 0.9;
  const b2 = 0.999;
  const eps = 1e-8;
  if (n === 0) return W;

  const logits = new Float64Array(K);
  for (let ep = 1; ep <= epochs; ep++) {
    const G: Weights = W.map((r) => r.map(() => 0));
    for (let i = 0; i < n; i++) {
      const zi = Z[i];
      let mx = -Infinity;
      for (let k = 0; k < K; k++) {
        const w = W[k];
        let s = w[0];
        for (let j = 0; j < d; j++) s += w[j + 1] * zi[j];
        logits[k] = s;
        if (s > mx) mx = s;
      }
      let sum = 0;
      for (let k = 0; k < K; k++) {
        logits[k] = Math.exp(logits[k] - mx);
        sum += logits[k];
      }
      for (let k = 0; k < K; k++) {
        const g = logits[k] / sum - (y[i] === k ? 1 : 0);
        const Gk = G[k];
        Gk[0] += g;
        for (let j = 0; j < d; j++) Gk[j + 1] += g * zi[j];
      }
    }
    for (let k = 0; k < K; k++) {
      for (let j = 0; j <= d; j++) {
        const g = G[k][j] / n + (j > 0 ? l2 * W[k][j] : 0);
        m[k][j] = b1 * m[k][j] + (1 - b1) * g;
        v[k][j] = b2 * v[k][j] + (1 - b2) * g * g;
        const mh = m[k][j] / (1 - b1 ** ep);
        const vh = v[k][j] / (1 - b2 ** ep);
        W[k][j] -= (lr * mh) / (Math.sqrt(vh) + eps);
      }
    }
  }
  return W;
}

/** 合計がちょうど100になる整数の％に（最大剰余法） */
export function toPercents(p: number[]): number[] {
  const raw = p.map((v) => v * 100);
  const floor = raw.map(Math.floor);
  let rest = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    floor[i]++;
    rest--;
  }
  return floor;
}
