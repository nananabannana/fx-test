// 短期予測のサーバー処理：直近の足の取得（使い回し）・学習用データの更新・学習・予測
import "server-only";

import type { Candle } from "../types";
import { getProvider, type FxProvider } from "./fxProvider";
import { LiveDataError } from "./twelveData";
import { loadHistory, loadModel, saveHistory, saveModel } from "./predictStore";
import { computeFeatures, classifyRegime, isFailure, REGIME_NOTE, REGIME_LABEL, WINDOW } from "../predict/features";
import { HORIZONS, predictHorizon, trainModel, type FxModel, type Horizon, type HorizonPrediction, type TrainSettings } from "../predict/model";
import type { CandlesPayload, PredictRun } from "../predict/types";
import { parseEvents, sessionOf, SESSION_LABEL, type FxEvent } from "../conditions";
import { readFile } from "fs/promises";
import path from "path";

const MIN = 60_000;
const DAY = 86_400_000;
/** 直近の足を使い回す時間 */
const CACHE_MS = 50_000;
/** 最新の足がこれより古ければ分析しない */
export const STALE_MS = 10 * MIN;
/** 学習に使う期間 */
export const HISTORY_DAYS = 30;
/** 1回の取得の範囲（分）。最大5,000本 */
const CHUNK_MIN = 4_800;
/** 無料枠（1分8回）を超えないための間隔 */
const CALL_GAP_MS = 9_000;

export class PredictError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function toPredictError(e: unknown): PredictError {
  if (e instanceof PredictError) return e;
  if (e instanceof LiveDataError) return new PredictError(e.code, e.message);
  console.error("[predict]", e);
  return new PredictError("internal", "予期しないエラーが起きました。サーバーのログを確認してください。");
}

// API のルートごとに別々に読み込まれても共有できるよう、状態は globalThis に置く
type Shared = {
  recent: { at: number; payload: CandlesPayload } | null;
  inflight: Promise<CandlesPayload> | null;
  training: boolean;
  lastTrainAt: number;
  runs: Map<string, PredictRun>;
};
const g = globalThis as unknown as { __fxPredict?: Shared };
const S: Shared = (g.__fxPredict ??= { recent: null, inflight: null, training: false, lastTrainAt: 0, runs: new Map() });

export async function getRecent(): Promise<CandlesPayload> {
  if (S.recent && Date.now() - S.recent.at < CACHE_MS) return S.recent.payload;
  S.inflight ??= (async () => {
    const p = getProvider();
    const candles = await p.recent(WINDOW);
    const payload = { candles, fetchedAt: Date.now(), provider: p.name, delayNote: p.delayNote };
    S.recent = { at: Date.now(), payload };
    return payload;
  })().finally(() => {
    S.inflight = null;
  });
  return S.inflight;
}

// ---------------- 学習 ----------------

export const isTraining = () => S.training;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 保存してある1分足に、足りない期間を取得して足す（直近 HISTORY_DAYS 日ぶんを保つ） */
export async function updateHistory(provider: FxProvider, now: number): Promise<{ candles: Candle[]; calls: number }> {
  const stored = await loadHistory();
  const from = now - HISTORY_DAYS * DAY;
  const kept = stored.filter((c) => c.time >= from);
  const last = kept.at(-1)?.time;
  let start = last !== undefined ? last + MIN : Math.floor(from / MIN) * MIN;
  const end = Math.floor(now / MIN) * MIN;
  const map = new Map(kept.map((c) => [c.time, c]));
  let calls = 0;
  while (start < end) {
    const stop = Math.min(end, start + CHUNK_MIN * MIN);
    if (calls > 0) await sleep(CALL_GAP_MS);
    const got = await provider.range(start, stop);
    calls++;
    for (const c of got) map.set(c.time, c);
    start = stop;
  }
  const candles = [...map.values()].sort((a, b) => a.time - b.time);
  await saveHistory(candles);
  return { candles, calls };
}

export async function runTraining(settings: Partial<TrainSettings> | undefined): Promise<{ model: FxModel; calls: number }> {
  if (S.training) throw new PredictError("busy", "いま学習中です。終わるまでお待ちください。");
  if (Date.now() - S.lastTrainAt < 5 * MIN) throw new PredictError("cooldown", "学習は5分に1回までです。少し待ってからお試しください。");
  S.training = true;
  try {
    const provider = getProvider();
    const now = Date.now();
    const { candles, calls } = await updateHistory(provider, now);
    const m = trainModel(candles, { settings, now, source: provider.name });
    if ("error" in m) throw new PredictError("not_enough", m.error);
    await saveModel(m);
    S.lastTrainAt = Date.now();
    return { model: m, calls };
  } finally {
    S.training = false;
  }
}

// ---------------- 予測 ----------------

async function loadEvents(): Promise<FxEvent[]> {
  try {
    const raw = JSON.parse((await readFile(path.join(process.cwd(), "data", "events.json"), "utf8")).replace(/^﻿/, ""));
    return parseEvents(raw).events;
  } catch {
    return [];
  }
}

export const getRun = (id: string) => S.runs.get(id) ?? null;

export const COST_NOTE = "スプレッド・取引コストは反映していません（設定で「使わない」）。実際の損益はコストのぶん悪くなります。";

export async function runPrediction(): Promise<PredictRun> {
  const model = await loadModel();
  if (!model) throw new PredictError("no_model", "予測モデルがまだありません。「モデル」タブで学習してください。");
  const data = await getRecent();
  const last = data.candles.at(-1);
  const now = Date.now();
  if (!last) throw new PredictError("no_data", "価格データを取得できませんでした。");
  if (now - (last.time + MIN) > STALE_MS) {
    throw new PredictError("stale", "最新の足が10分以上前で止まっています。市場が閉まっている間（週末など）は分析しません。");
  }
  const f = computeFeatures(data.candles);
  if (isFailure(f)) throw new PredictError("insufficient", `分析に必要なデータが足りません：${f.reason}`);
  const regime = classifyRegime(f.raw, model.regime);
  const horizons = {} as Record<Horizon, HorizonPrediction>;
  for (const h of HORIZONS) horizons[h] = predictHorizon(model, h, f, regime);

  const events = (await loadEvents()).filter((e) => e.importance !== "low" && Math.abs(e.time - f.t) <= 30 * MIN);
  const session = sessionOf(f.t);
  const cautions: string[] = [];
  const delayMin = Math.floor((now - (last.time + MIN)) / MIN);
  if (delayMin >= 3) cautions.push(`最新の足は ${delayMin} 分前のものです（データの遅れ）。`);
  if (horizons[5].provisional || horizons[10].provisional) {
    cautions.push("確率は暫定の推定値です：" + [...new Set([...horizons[5].provisionalReasons, ...horizons[10].provisionalReasons])].join("／"));
  }
  const ageDays = (now - model.createdAt) / DAY;
  if (ageDays > 7) cautions.push(`モデルの学習から ${Math.floor(ageDays)} 日たっています。相場の性質が変わっている可能性があるので、再学習をおすすめします。`);
  for (const e of events) {
    const diff = Math.round((e.time - f.t) / MIN);
    cautions.push(`指標発表「${e.name}」の${diff >= 0 ? `${diff}分前` : `${-diff}分後`}です。発表前後は値動きが急になり、予測が当てになりにくくなります。`);
  }
  if (regime === "highvol") cautions.push(`相場状態は「${REGIME_LABEL.highvol}」です。${REGIME_NOTE.highvol}`);
  if (session === "late") cautions.push(`${SESSION_LABEL.late}の時間帯です。取引が少なく、スプレッドが広がりやすい時間です。`);
  cautions.push(COST_NOTE);

  const run: PredictRun = {
    id: `p-${f.t}-${model.version}`,
    at: f.t,
    price: f.raw.price,
    fetchedAt: data.fetchedAt,
    provider: data.provider,
    delayNote: data.delayNote,
    modelVersion: model.version,
    modelCreatedAt: model.createdAt,
    regime,
    session,
    raw: f.raw,
    horizons,
    events,
    cautions,
    costNote: COST_NOTE,
  };
  S.runs.set(run.id, run);
  if (S.runs.size > 200) S.runs.delete(S.runs.keys().next().value!);
  return run;
}
