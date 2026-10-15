// 株スイングの表示用フォーマット

export const yen = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? "—" : `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: digits })}円`;

export const signedYen = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v)).toLocaleString("ja-JP")}円`;

export const price = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("ja-JP", { maximumFractionDigits: 1, minimumFractionDigits: v < 1000 ? 1 : 0 });

export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(digits)}%`;

export const plainPct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;

export const rMul = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}R`;

/** 売買代金など大きな金額を「億円」で */
export const oku = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${(v / 1e8).toLocaleString("ja-JP", { maximumFractionDigits: v < 1e9 ? 1 : 0 })}億円`;

export const shortDate = (d: string | null | undefined) => (d ? d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1/$2/$3") : "—");

export const EXIT_LABEL: Record<string, string> = { stop: "損切り", target: "利確", time: "期限", end: "保有中" };
