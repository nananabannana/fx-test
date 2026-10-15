"use client";

// バックテスト：① データ取得 → ② 開示を採点 → ③ 実行 の3段階

import { useEffect, useRef, useState } from "react";
import { apiGet, apiSend, ApiCallError } from "@/lib/stocks/client";
import type { BacktestListResponse, BacktestResponse, BacktestRunSummary, PrepareResponse, StockDetailResponse } from "@/lib/stocks/api";
import { DEFAULT_PARAMS, toCode4, toCode5, type BacktestParams, type BacktestResult, type Trend } from "@/lib/stocks/types";
import { plainPct, rMul, signedYen } from "@/lib/stocks/format";
import { BacktestResultView } from "@/components/stocks/BacktestResultView";
import { Button, Card, ErrorBox, Field, inputClass, Notice, Spinner } from "@/components/stocks/ui";

/** 例：流動性の高い大型株（おすすめ銘柄ではありません） */
const EXAMPLE = "7203 6758 8306 8316 8411 9432 9434 8058 8001 7267 6501 6902 4502 9433 7011";
const FORM_KEY = "fx-signal-lab:stocks:backtest-form";

type CodeState = { code: string; status: "wait" | "busy" | "done" | "error"; note?: string };

export default function BacktestPage() {
  const [codesText, setCodesText] = useState(EXAMPLE);
  const [p, setP] = useState<BacktestParams>(DEFAULT_PARAMS);
  const [states, setStates] = useState<CodeState[]>([]);
  const [step, setStep] = useState<"idle" | "prepare" | "score" | "run">("idle");
  const [scoreProgress, setScoreProgress] = useState<{ done: number; total: number; errors: number } | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState(true);
  const [runs, setRuns] = useState<BacktestRunSummary[]>([]);
  const cancel = useRef(false);

  const loadRuns = () =>
    apiGet<Extract<BacktestListResponse, { ok: true }>>("/api/stocks/backtest")
      .then((r) => setRuns(r.runs))
      .catch(() => setRuns([]));

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FORM_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 保存した入力はブラウザでしか読めないため、表示後に復元する
      if (saved?.codesText) setCodesText(saved.codesText);
      if (saved?.p) setP({ ...DEFAULT_PARAMS, ...saved.p });
    } catch {
      /* 無視 */
    }
    loadRuns();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify({ codesText, p }));
    } catch {
      /* 無視 */
    }
  }, [codesText, p]);

  const codes = [...new Set(codesText.toUpperCase().split(/[\s,、]+/).filter((c) => /^[0-9A-Z]{4}$/.test(c)))];
  const busy = step !== "idle";

  const prepareAll = async () => {
    cancel.current = false;
    setError(null);
    setStep("prepare");
    const list: CodeState[] = codes.map((code) => ({ code, status: "wait" }));
    setStates(list);
    for (let i = 0; i < list.length; i++) {
      if (cancel.current) break;
      list[i] = { ...list[i], status: "busy" };
      setStates([...list]);
      try {
        const r = await apiSend<Extract<PrepareResponse, { ok: true }>>("/api/stocks/prepare", "POST", { code: list[i].code });
        list[i] = { ...list[i], status: "done", note: r.cached ? "保存済み" : `${r.stock?.name ?? ""}` };
      } catch (e) {
        list[i] = { ...list[i], status: "error", note: e instanceof ApiCallError ? e.message : "取得できませんでした" };
        if (e instanceof ApiCallError && (e.code === "jquants_no_key" || e.code === "jquants_invalid_key")) break;
      }
      setStates([...list]);
    }
    setStep("idle");
  };

  const scoreAll = async () => {
    cancel.current = false;
    setError(null);
    setStep("score");
    // 匿名で採点していない開示を集める
    const todo: string[] = [];
    for (const code of codes) {
      try {
        const d = await apiGet<Extract<StockDetailResponse, { ok: true }>>(`/api/stocks/${toCode5(code)}`);
        for (const v of d.disclosures) if (!v.score || v.score.usedText) todo.push(v.disclosure.id);
      } catch {
        /* データ未取得の銘柄はとばす */
      }
    }
    const prog = { done: 0, total: todo.length, errors: 0 };
    setScoreProgress({ ...prog });
    for (const id of todo) {
      if (cancel.current) break;
      try {
        await apiSend("/api/stocks/score", "POST", { disclosureId: id });
      } catch (e) {
        prog.errors++;
        if (e instanceof ApiCallError && /no_key|invalid_key|no_credit|daily_limit/.test(e.code)) {
          setError(e.message);
          break;
        }
      }
      prog.done++;
      setScoreProgress({ ...prog });
    }
    setStep("idle");
  };

  const run = async () => {
    setError(null);
    setStep("run");
    try {
      const r = await apiSend<Extract<BacktestResponse, { ok: true }>>("/api/stocks/backtest", "POST", { codes, params: p, save });
      setResult(r.result);
      setMissing(r.missing);
      if (save) loadRuns();
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : "バックテストを実行できませんでした。");
    } finally {
      setStep("idle");
    }
  };

  const set = <K extends keyof BacktestParams>(k: K, v: BacktestParams[K]) => setP((x) => ({ ...x, [k]: v }));
  const toggleTrend = (t: Trend) =>
    set("trends", p.trends.includes(t) ? p.trends.filter((x) => x !== t) : [...p.trends, t]);

  const doneCount = states.filter((s) => s.status === "done").length;

  return (
    <div className="space-y-4">
      <Card title="対象銘柄">
        <Field label={`銘柄コード（4桁・スペースや改行区切り）：${codes.length}銘柄`} hint="初期値は流動性の高い大型株の例です（おすすめではありません）。">
          <textarea value={codesText} onChange={(e) => setCodesText(e.target.value)} rows={3} className={`${inputClass} num`} disabled={busy} />
        </Field>
      </Card>

      <Card title="ルール">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="スコアの下限" hint="空欄でスコア不問">
            <input
              type="number" min={-10} max={10}
              value={p.minScore ?? ""}
              onChange={(e) => set("minScore", e.target.value === "" ? null : Number(e.target.value))}
              className={`${inputClass} num`}
            />
          </Field>
          <Field label="損切り（%）">
            <input type="number" min={1} max={30} step={0.5} value={+(p.stopPct * 100).toFixed(2)} onChange={(e) => set("stopPct", Number(e.target.value) / 100)} className={`${inputClass} num`} />
          </Field>
          <Field label="利確（損切りの何倍）" hint={`= +${(p.stopPct * p.rewardMultiple * 100).toFixed(1)}%`}>
            <input type="number" min={0.5} max={10} step={0.5} value={p.rewardMultiple} onChange={(e) => set("rewardMultiple", Number(e.target.value))} className={`${inputClass} num`} />
          </Field>
          <Field label="最長保有（営業日）">
            <input type="number" min={1} max={120} value={p.maxHoldDays} onChange={(e) => set("maxHoldDays", Number(e.target.value))} className={`${inputClass} num`} />
          </Field>
          <Field label="資金（円）">
            <input type="number" min={10000} step={10000} value={p.capital} onChange={(e) => set("capital", Number(e.target.value))} className={`${inputClass} num`} />
          </Field>
          <Field label="1回の許容損失（%）" hint={`= ${Math.round(p.capital * p.riskPct).toLocaleString()}円`}>
            <input type="number" min={0.1} max={10} step={0.1} value={+(p.riskPct * 100).toFixed(2)} onChange={(e) => set("riskPct", Number(e.target.value) / 100)} className={`${inputClass} num`} />
          </Field>
          <Field label="平均売買代金の下限（億円）">
            <input type="number" min={0} step={1} value={p.minTurnover / 1e8} onChange={(e) => set("minTurnover", Number(e.target.value) * 1e8)} className={`${inputClass} num`} />
          </Field>
          <Field label="滑り（片道 %）">
            <input type="number" min={0} max={2} step={0.05} value={+(p.slippagePct * 100).toFixed(2)} onChange={(e) => set("slippagePct", Number(e.target.value) / 100)} className={`${inputClass} num`} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <fieldset className="flex items-center gap-3">
            <legend className="sr-only">エントリーするトレンド</legend>
            <span className="text-xs text-muted">トレンド</span>
            {(["up", "neutral", "down"] as Trend[]).map((t) => (
              <label key={t} className="flex items-center gap-1">
                <input type="checkbox" checked={p.trends.includes(t)} onChange={() => toggleTrend(t)} />
                {t === "up" ? "上昇" : t === "neutral" ? "中立" : "下降"}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex items-center gap-3">
            <legend className="sr-only">株数の単位</legend>
            <span className="text-xs text-muted">株数</span>
            <label className="flex items-center gap-1">
              <input type="radio" name="lot" checked={p.lotMode === "unit"} onChange={() => set("lotMode", "unit")} />
              100株単位
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="lot" checked={p.lotMode === "odd"} onChange={() => set("lotMode", "odd")} />
              単元未満株も可
            </label>
          </fieldset>
          <button type="button" onClick={() => setP(DEFAULT_PARAMS)} className="text-xs text-muted hover:text-ink hover:underline">
            初期値に戻す
          </button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          買いは開示日の翌営業日の寄り付き。損切りと利確に同じ日に届いたら損切りが先とみなします（保守的）。トレンドは開示日の終値で判定します。
        </p>
      </Card>

      <Card title="実行">
        <ol className="space-y-4">
          <li>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">① データを取得</span>
              <Button onClick={prepareAll} disabled={busy || codes.length === 0}>
                {step === "prepare" && <Spinner />}J-Quants から取得
              </Button>
              {states.length > 0 && <span className="text-xs text-muted">{doneCount} / {states.length} 銘柄</span>}
            </div>
            <p className="mt-1 text-[11px] text-muted">
              無料プランは1分5回まで。初回は1銘柄あたり最大40秒ほどかかります（15銘柄なら約10分）。半日以内に取得した銘柄はとばします。
            </p>
            {states.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {states.map((s) => (
                  <li
                    key={s.code}
                    title={s.note}
                    className={`num rounded border px-2 py-0.5 text-xs ${
                      s.status === "done" ? "border-up/40 text-up" : s.status === "error" ? "border-down/40 text-down" : s.status === "busy" ? "border-accent text-accent" : "border-line text-muted"
                    }`}
                  >
                    {s.code}
                    {s.status === "busy" && " …"}
                    {s.status === "error" && " ×"}
                  </li>
                ))}
              </ul>
            )}
            {states.some((s) => s.status === "error") && (
              <p className="mt-1 text-xs text-down">{states.find((s) => s.status === "error")?.note}</p>
            )}
          </li>

          <li>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">② 開示を Claude で採点</span>
              <Button onClick={scoreAll} disabled={busy}>
                {step === "score" && <Spinner />}未採点をまとめて採点
              </Button>
              {scoreProgress && (
                <span className="text-xs text-muted">
                  {scoreProgress.done} / {scoreProgress.total} 件{scoreProgress.errors > 0 && `（失敗 ${scoreProgress.errors}）`}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted">
              銘柄名・日付・金額を伏せて採点します。1件0.1円未満（Haiku）。採点済みはとばすので、何度押しても二重に料金はかかりません。スコアを使わないなら、この手順はとばせます。
            </p>
          </li>

          <li>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">③ バックテスト</span>
              <Button variant="primary" onClick={run} disabled={busy || codes.length === 0 || p.trends.length === 0}>
                {step === "run" && <Spinner />}実行
              </Button>
              <label className="flex items-center gap-1 text-xs text-muted">
                <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
                結果を保存
              </label>
            </div>
          </li>
        </ol>
        {busy && step !== "run" && (
          <div className="mt-3">
            <Button variant="ghost" onClick={() => (cancel.current = true)}>途中で止める</Button>
          </div>
        )}
        {error && <div className="mt-3"><ErrorBox message={error} /></div>}
        {missing.length > 0 && (
          <div className="mt-3">
            <Notice tone="warn">データ未取得のため除外：{missing.map(toCode4).join(" ")}（① を先に実行してください）</Notice>
          </div>
        )}
      </Card>

      {result && <BacktestResultView result={result} />}

      {runs.length > 0 && (
        <Card title="保存した実行結果（最新20件）">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line text-left">
                  <th className="py-1.5 font-normal">日時</th>
                  <th className="py-1.5 font-normal">条件</th>
                  <th className="py-1.5 text-right font-normal">取引</th>
                  <th className="py-1.5 text-right font-normal">勝率</th>
                  <th className="py-1.5 text-right font-normal">期待値</th>
                  <th className="py-1.5 text-right font-normal">損益</th>
                </tr>
              </thead>
              <tbody className="num">
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line/50">
                    <td className="py-1.5 text-xs">{new Date(r.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="py-1.5 font-sans text-xs text-muted">
                      スコア{r.params.minScore === null ? "不問" : `${r.params.minScore}以上`}・損切り{(r.params.stopPct * 100).toFixed(0)}%×{r.params.rewardMultiple}・{r.params.maxHoldDays}日・{r.params.lotMode === "unit" ? "100株" : "単元未満可"}・{r.codes.length}銘柄
                    </td>
                    <td className="py-1.5 text-right">{r.metrics.trades}</td>
                    <td className="py-1.5 text-right">{plainPct(r.metrics.winRate)}</td>
                    <td className={`py-1.5 text-right ${(r.metrics.expectancyR ?? 0) > 0 ? "text-up" : "text-down"}`}>{rMul(r.metrics.expectancyR)}</td>
                    <td className="py-1.5 text-right">{signedYen(r.metrics.totalPnlYen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
