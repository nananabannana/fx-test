// シンプルなテクニカル指標

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** RSI（単純平均版） */
export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  const slice = values.slice(-(period + 1));
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i] - slice[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  if (gain + loss === 0) return 50;
  return (gain / (gain + loss)) * 100;
}
