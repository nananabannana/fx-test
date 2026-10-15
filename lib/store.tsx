"use client";

// 画面間で共有する状態を管理します。
// - デモモード: 架空のサンプルデータ（時間は手動で進める）
// - 実データモード: /api/candles から取得した USD/JPY の1分足（1分ごとに自動更新）
// 2つのモードの履歴は混ぜず、それぞれこのブラウザの localStorage に保存します。
// 分析エンジンは「Claude（/api/analyze 経由）」と「デモ指標（ブラウザ内の簡単な計算）」を選べます。
// Claude が失敗しても、勝手にデモ指標へ切り替えることはしません。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Candle, DataSource, Prediction, VerifiedPrediction } from "./types";
import { CHART_WINDOW, HORIZON_MINUTES, PAIR, isHorizon, type Horizon } from "./config";
import { generateSampleCandles } from "./sampleData";
import { analyzeDemo, demoAnalyzer, type AnalysisInput, type AnalysisResult } from "./analyzer";
import { findActualPrice, verifyPrediction } from "./verify";
import { useLiveCandles, type LiveStatus } from "./useLiveCandles";
import type { AnalyzeResponse, Engine } from "./analysisTypes";
import { usePathname } from "next/navigation";
import { atr5m, conditionsAt, sessionOf, type ConditionFields } from "./conditions";

const DEMO_KEY = "fx-signal-lab:demo:v2";
const LIVE_KEY = "fx-signal-lab:live:v1";
const MODE_KEY = "fx-signal-lab:mode";
const ENGINE_KEY = "fx-signal-lab:engine";
const HORIZON_KEY = "fx-signal-lab:horizon";
const INITIAL_CURSOR = 120;
/** デモで「AI分析を実行」1回ごとに進めるサンプル時間（分） */
const STEP_MINUTES = 6;
const MINUTE = 60_000;
/** 実データの履歴として保存する最大件数 */
const LIVE_HISTORY_MAX = 200;

const sampleCandles = generateSampleCandles();

function demoInput(index: number, horizonMinutes: number = HORIZON_MINUTES): AnalysisInput {
  return { pair: PAIR, horizonMinutes, candles: sampleCandles.slice(0, index + 1) };
}

export type AnalysisError = { code: string; message: string };

/** Claude で分析する（サーバーの /api/analyze 経由。APIキーはサーバー側にだけある） */
async function analyzeViaClaude(
  candles: Candle[],
  dataKind: DataSource,
  horizonMinutes: number,
): Promise<{ result: AnalysisResult; model: string }> {
  let res: Response;
  try {
    res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pair: PAIR, horizonMinutes, candles: candles.slice(-150), dataKind }),
    });
  } catch {
    throw { code: "network", message: "アプリのサーバーに接続できませんでした。" } satisfies AnalysisError;
  }
  let body: AnalyzeResponse;
  try {
    body = (await res.json()) as AnalyzeResponse;
  } catch {
    throw { code: "network", message: "サーバーの応答を読み取れませんでした。" } satisfies AnalysisError;
  }
  if (!body.ok) throw body.error satisfies AnalysisError;
  return { result: body.result, model: body.model };
}

function makePrediction(
  candle: Candle,
  source: DataSource,
  result: AnalysisResult,
  engine: Engine = "demo",
  model?: string,
  horizonMinutes: number = HORIZON_MINUTES,
  /** 予測時点までの足（条件の記録用） */
  history: Candle[] = [],
): Prediction {
  return {
    ...conditionsAt(history, candle.time + MINUTE, candle.time),
    id: `${source}-${engine}-${horizonMinutes}-${candle.time}`,
    engine,
    ...(model ? { model } : {}),
    at: candle.time,
    pair: PAIR,
    horizonMinutes,
    basePrice: candle.close,
    source,
    ...result,
  };
}

/** デモの初回表示用サンプル履歴（過去の8回分） */
function initialDemoHistory(): Prediction[] {
  const list: Prediction[] = [];
  for (let i = INITIAL_CURSOR - STEP_MINUTES * 8; i < INITIAL_CURSOR; i += STEP_MINUTES) {
    list.unshift(makePrediction(sampleCandles[i], "demo", analyzeDemo(demoInput(i)), "demo", undefined, HORIZON_MINUTES, sampleCandles.slice(0, i + 1)));
  }
  return list;
}

/**
 * 条件（セッション・ATR）が欠けている古い記録を、手元の足から補完する。
 * final=true（サンプルのように全履歴が手元にある）なら、計算できないものは「不明」で確定させる。
 */
function fillConditions(list: Prediction[], candles: Candle[], final: boolean): Prediction[] {
  let changed = false;
  const next = list.map((p) => {
    const patch: ConditionFields = {};
    if (!p.session) patch.session = sessionOf(p.at);
    if (p.atrPips === undefined && !p.atrUnavailable) {
      const atr = atr5m(candles, p.at + MINUTE);
      if (atr !== null) patch.atrPips = atr;
      else if (final) patch.atrUnavailable = true;
    }
    if (Object.keys(patch).length === 0) return p;
    changed = true;
    return { ...p, ...patch };
  });
  return changed ? next : list;
}

function load<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

type Store = {
  mode: DataSource;
  setMode: (m: DataSource) => void;
  engine: Engine;
  setEngine: (e: Engine) => void;
  /** 予測期間（分） */
  horizon: Horizon;
  setHorizon: (h: Horizon) => void;
  /** 直近の分析で起きたエラー（成功したら消える） */
  analysisError: AnalysisError | null;
  /** エラー時に、デモ指標で分析し直す */
  runDemoInstead: () => Promise<void>;
  /** チャートに表示する足 */
  visibleCandles: Candle[];
  history: VerifiedPrediction[];
  latest: VerifiedPrediction | null;
  analyzing: boolean;
  canAnalyze: boolean;
  /** 分析できない理由（できる場合は null） */
  blockedReason: string | null;
  runAnalysis: () => Promise<void>;
  /** デモ専用：新しい予測は出さず、サンプル時刻だけ進める（直近の予測の期間ぶん） */
  advance: () => void;
  canAdvance: boolean;
  reset: () => void;
  patchPrediction: (id: string, patch: ConditionFields) => void;
  /** 実データ専用 */
  live: { status: LiveStatus; stale: boolean; refresh: () => Promise<void>; lastTime: number | null };
};

const StoreContext = createContext<Store | null>(null);

export function PredictionProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DataSource>("demo");
  const [loaded, setLoaded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [engine, setEngineState] = useState<Engine>("claude");
  const [horizon, setHorizonState] = useState<Horizon>(HORIZON_MINUTES as Horizon);
  const [analysisError, setAnalysisError] = useState<AnalysisError | null>(null);

  // デモの状態
  const [cursor, setCursor] = useState(INITIAL_CURSOR);
  const [demoPredictions, setDemoPredictions] = useState<Prediction[]>(initialDemoHistory);
  const [demoLatestId, setDemoLatestId] = useState<string | null>(null);

  // 実データの状態
  const [livePredictions, setLivePredictions] = useState<Prediction[]>([]);
  const [liveLatestId, setLiveLatestId] = useState<string | null>(null);
  // 実データの自動更新は旧モード（◯分後予測）の画面を開いているときだけ
  const pathname = usePathname();
  const onFxPage = pathname.startsWith("/legacy");
  const live = useLiveCandles(loaded && mode === "live" && onFxPage);

  // 保存済みの状態を読み込む
  useEffect(() => {
    const m = load<DataSource>(MODE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage はブラウザでしか読めないため、表示後に復元する
    if (m === "demo" || m === "live") setModeState(m);
    const e = load<Engine>(ENGINE_KEY);
    if (e === "demo" || e === "claude") setEngineState(e);
    const h = load<number>(HORIZON_KEY);
    if (isHorizon(h)) setHorizonState(h);
    const d = load<{ cursor: number; predictions: Prediction[]; latestId: string | null }>(DEMO_KEY);
    if (d && typeof d.cursor === "number" && Array.isArray(d.predictions)) {
      setCursor(d.cursor);
      setDemoPredictions(fillConditions(d.predictions, sampleCandles, true));
      setDemoLatestId(d.latestId ?? null);
    }
    const l = load<{ predictions: Prediction[]; latestId: string | null }>(LIVE_KEY);
    if (l && Array.isArray(l.predictions)) {
      setLivePredictions(fillConditions(l.predictions, [], false));
      setLiveLatestId(l.latestId ?? null);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    save(MODE_KEY, mode);
    save(ENGINE_KEY, engine);
    save(HORIZON_KEY, horizon);
    save(DEMO_KEY, { cursor, predictions: demoPredictions, latestId: demoLatestId });
    save(LIVE_KEY, { predictions: livePredictions, latestId: liveLatestId });
  }, [loaded, mode, engine, horizon, cursor, demoPredictions, demoLatestId, livePredictions, liveLatestId]);

  // 実データ：予測期間後の足が届いたら、実績価格を予測に書き込んで確定させる
  useEffect(() => {
    if (live.candles.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部から届いた足に合わせて記録を確定させる
    setLivePredictions((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        if (p.resolvedPrice != null) return p;
        const price = findActualPrice(p, live.candles);
        if (price === null) return p;
        changed = true;
        return { ...p, resolvedPrice: price };
      });
      // ATR が欠けた記録も、手元の足（直近約2.5時間）で計算できれば補完する
      return fillConditions(changed ? next : prev, live.candles, false);
    });
  }, [live.candles]);

  const setMode = useCallback((m: DataSource) => {
    if (analyzing) return;
    setModeState(m);
    setAnalysisError(null);
  }, [analyzing]);

  const setEngine = useCallback((e: Engine) => {
    if (analyzing) return;
    setEngineState(e);
    setAnalysisError(null);
  }, [analyzing]);

  const setHorizon = useCallback((h: Horizon) => {
    if (analyzing) return;
    setHorizonState(h);
    setAnalysisError(null);
  }, [analyzing]);

  // ---- 分析できるかどうか ----
  const demoNext = cursor + STEP_MINUTES;
  const demoCanAnalyze = demoNext + horizon < sampleCandles.length;
  const liveLast = live.candles[live.candles.length - 1] ?? null;

  let blockedReason: string | null = null;
  if (mode === "demo") {
    if (!demoCanAnalyze) blockedReason = "サンプルデータの終わりに達しました。リセットしてください。";
  } else if (!liveLast) {
    blockedReason = live.status.loading ? "実データを取得しています…" : "実データがまだ取得できていません。";
  } else if (live.stale) {
    blockedReason = "最新の足が10分以上前で止まっています。市場が閉まっている間（土日など）は分析できません。";
  }
  const canAnalyze = !analyzing && blockedReason === null;

  /** 指定したエンジンで分析する。成功したときだけ履歴に追加し、サンプル時刻を進める */
  const analyze = useCallback(
    async (useEngine: Engine) => {
      if (!canAnalyze) return;
      setAnalyzing(true);
      setAnalysisError(null);
      try {
        // 分析対象の足（予測時点）と、それまでの足
        let target: Candle;
        let candles: Candle[];
        if (mode === "demo") {
          target = sampleCandles[demoNext];
          candles = sampleCandles.slice(0, demoNext + 1);
        } else if (liveLast) {
          target = liveLast;
          candles = live.candles;
        } else {
          return;
        }

        let result: AnalysisResult;
        let model: string | undefined;
        if (useEngine === "claude") {
          ({ result, model } = await analyzeViaClaude(candles, mode, horizon));
        } else {
          result = await demoAnalyzer({ pair: PAIR, horizonMinutes: horizon, candles });
        }

        const p = makePrediction(target, mode, result, useEngine, model, horizon, candles);
        if (mode === "demo") {
          setCursor(demoNext);
          setDemoPredictions((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
          setDemoLatestId(p.id);
        } else {
          setLivePredictions((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, LIVE_HISTORY_MAX));
          setLiveLatestId(p.id);
        }
      } catch (e) {
        const err = e as Partial<AnalysisError>;
        setAnalysisError({
          code: err.code ?? "unknown",
          message: err.message ?? "分析中にエラーが起きました。",
        });
      } finally {
        setAnalyzing(false);
      }
    },
    [canAnalyze, mode, demoNext, live.candles, liveLast, horizon],
  );

  const runAnalysis = useCallback(() => analyze(engine), [analyze, engine]);
  const runDemoInstead = useCallback(() => analyze("demo"), [analyze]);

  const latestDemo = demoPredictions.find((p) => p.id === demoLatestId);
  const advanceStep = latestDemo?.horizonMinutes ?? horizon;
  const canAdvance = mode === "demo" && cursor + advanceStep < sampleCandles.length;
  const advance = useCallback(() => {
    if (analyzing || mode !== "demo") return;
    setCursor((c) => Math.min(c + advanceStep, sampleCandles.length - 1));
  }, [analyzing, mode, advanceStep]);

  /** いま選んでいるデータの記録に、条件の補完結果を書き込む */
  const patchPrediction = useCallback(
    (id: string, patch: ConditionFields) => {
      const apply = (l: Prediction[]) => l.map((p) => (p.id === id ? { ...p, ...patch } : p));
      if (mode === "demo") setDemoPredictions(apply);
      else setLivePredictions(apply);
    },
    [mode],
  );

  const reset = useCallback(() => {
    setAnalysisError(null);
    if (mode === "demo") {
      setCursor(INITIAL_CURSOR);
      setDemoPredictions(initialDemoHistory());
      setDemoLatestId(null);
    } else {
      setLivePredictions([]);
      setLiveLatestId(null);
    }
  }, [mode]);

  const value = useMemo<Store>(() => {
    let visibleCandles: Candle[];
    let history: VerifiedPrediction[];
    let latestId: string | null;
    if (mode === "demo") {
      // 「実績」は現在のサンプル時刻までに確定した足だけで判定する
      const known = sampleCandles.slice(0, cursor + 1);
      visibleCandles = sampleCandles.slice(Math.max(0, cursor + 1 - CHART_WINDOW), cursor + 1);
      history = demoPredictions.map((p) => verifyPrediction(p, known));
      latestId = demoLatestId;
    } else {
      visibleCandles = live.candles.slice(-CHART_WINDOW);
      history = livePredictions.map((p) => verifyPrediction(p, live.candles));
      latestId = liveLatestId;
    }
    return {
      mode,
      setMode,
      engine,
      setEngine,
      horizon,
      setHorizon,
      analysisError,
      runDemoInstead,
      visibleCandles,
      history,
      latest: history.find((h) => h.id === latestId) ?? null,
      analyzing,
      canAnalyze,
      blockedReason,
      runAnalysis,
      advance,
      canAdvance,
      reset,
      patchPrediction,
      live: {
        status: live.status,
        stale: live.stale,
        refresh: live.refresh,
        lastTime: liveLast?.time ?? null,
      },
    };
  }, [
    mode, setMode, engine, setEngine, horizon, setHorizon, analysisError, runDemoInstead, cursor, demoPredictions, demoLatestId, livePredictions, liveLatestId,
    live.candles, live.status, live.stale, live.refresh, liveLast,
    analyzing, canAnalyze, blockedReason, runAnalysis, advance, canAdvance, reset, patchPrediction,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function usePredictions(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("usePredictions は PredictionProvider の中で使ってください");
  return ctx;
}
