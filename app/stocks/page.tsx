"use client";

// 銘柄分析：J-Quants からデータを取り、トレンド判定と開示スコアを見る

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend, ApiCallError, loadRecent, pushRecent } from "@/lib/stocks/client";
import type { PrepareResponse, ScoreResponse, StockDetailResponse, PaperListResponse } from "@/lib/stocks/api";
import { DEFAULT_PARAMS, toCode4, toCode5 } from "@/lib/stocks/types";
import { oku, price, shortDate, yen } from "@/lib/stocks/format";
import { PriceChart, PriceChartLegend } from "@/components/stocks/PriceChart";
import { DisclosureCard } from "@/components/stocks/DisclosureCard";
import { Button, Card, ErrorBox, Field, inputClass, Kpi, Notice, Spinner, TrendBadge } from "@/components/stocks/ui";

type Detail = Extract<StockDetailResponse, { ok: true }>;
type RecordDraft = { disclosureId: string | null; score: number | null; signalDate: string };

export default function StockAnalysisPage() {
  const [input, setInput] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "prepare" | "load">("idle");
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecordDraft | null>(null);

  // 最近見た銘柄はブラウザでしか読めないため、表示後に読み込む
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 上のとおり
  useEffect(() => setRecent(loadRecent()), []);

  const load = useCallback(async (raw: string, force = false) => {
    const code4 = raw.trim().toUpperCase();
    if (!/^[0-9A-Z]{4}$/.test(code4)) {
      setError("銘柄コードは4桁（例: 7203）で入力してください。");
      return;
    }
    setInput(code4);
    setError(null);
    setScoreError(null);
    setDraft(null);
    try {
      setPhase("prepare");
      await apiSend<PrepareResponse>("/api/stocks/prepare", "POST", { code: code4, force });
      setPhase("load");
      const d = await apiGet<Detail>(`/api/stocks/${toCode5(code4)}`);
      setDetail(d);
      setRecent(pushRecent(code4));
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : "データを取得できませんでした。");
    } finally {
      setPhase("idle");
    }
  }, []);

  const score = async (disclosureId: string, text?: string) => {
    setScoringId(disclosureId);
    setScoreError(null);
    try {
      const r = await apiSend<Extract<ScoreResponse, { ok: true }>>("/api/stocks/score", "POST", { disclosureId, text, force: !text });
      setDetail((d) =>
        d && { ...d, disclosures: d.disclosures.map((v) => (v.disclosure.id === disclosureId ? { ...v, score: r.score } : v)) },
      );
    } catch (e) {
      setScoreError(e instanceof ApiCallError ? e.message : "採点できませんでした。");
    } finally {
      setScoringId(null);
    }
  };

  const busy = phase !== "idle";
  const t = detail?.trend;
  const lastBar = detail?.bars[detail.bars.length - 1];

  // 資金40万円・許容損失1.5%・損切り6% のときの株数の目安
  const riskBudget = DEFAULT_PARAMS.capital * DEFAULT_PARAMS.riskPct;
  const perShareRisk = t ? t.close * DEFAULT_PARAMS.stopPct : null;
  const maxShares = perShareRisk ? Math.floor(riskBudget / perShareRisk) : null;

  return (
    <div className="space-y-4">
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(input);
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="w-40">
            <Field label="銘柄コード（4桁）">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                inputMode="text"
                maxLength={4}
                placeholder="7203"
                className={`${inputClass} num`}
              />
            </Field>
          </div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy && <Spinner />}
            {phase === "prepare" ? "J-Quants から取得中…" : phase === "load" ? "読み込み中…" : "データを取得"}
          </Button>
          {recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted">最近：</span>
              {recent.map((c) => (
                <button key={c} type="button" disabled={busy} onClick={() => load(c)} className="num rounded border border-line px-2 py-1 hover:bg-panel-2">
                  {c}
                </button>
              ))}
            </div>
          )}
        </form>
        {phase === "prepare" && (
          <p className="mt-3 text-xs text-muted">
            初めての銘柄は J-Quants から銘柄情報・日足・決算を取得します。無料プランは1分5回までのため、最大40秒ほどかかります。
          </p>
        )}
        {error && <div className="mt-3"><ErrorBox message={error} onRetry={() => load(input)} /></div>}
      </Card>

      {detail && (
        <>
          <Card
            title={
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-lg">{detail.stock?.name || toCode4(input)}</span>
                <span className="num text-sm text-muted">{toCode4(detail.stock?.code ?? input)}</span>
                <span className="text-xs font-normal text-muted">
                  {[detail.stock?.market, detail.stock?.sector33].filter(Boolean).join("・")}
                </span>
              </span>
            }
            right={
              <Button variant="ghost" onClick={() => load(input, true)} disabled={busy}>
                最新データを取り直す
              </Button>
            }
          >
            {t && lastBar ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <TrendBadge trend={t.trend} size="lg" />
                  <span className="text-xs text-muted">{shortDate(lastBar.date)} 終値で判定（終値 &gt; 25日線 &gt; 75日線 なら上昇）</span>
                </div>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Kpi label="終値" value={price(t.close)} />
                  <Kpi label="25日線" value={price(t.sma25)} />
                  <Kpi label="75日線" value={price(t.sma75)} />
                  <Kpi label="平均売買代金（20日）" value={oku(t.avgTurnover20)} />
                </dl>
                <div className="mt-4">
                  <PriceChart
                    bars={detail.bars}
                    markers={detail.disclosures.map((v) => ({ date: v.disclosure.discDate, score: v.score?.score ?? null, label: v.disclosure.id }))}
                  />
                  <PriceChartLegend />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">日足データがありません。</p>
            )}
          </Card>

          {t && maxShares !== null && (
            <Card title="資金40万円で買うと（損切り6%・許容損失1.5%の場合）">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi label="100株の購入額" value={yen(t.close * 100)} tone={t.close * 100 > DEFAULT_PARAMS.capital ? "down" : undefined} />
                <Kpi label="100株で損切りしたときの損失" value={yen(t.close * 100 * DEFAULT_PARAMS.stopPct)} />
                <Kpi label="1回の許容損失" value={yen(riskBudget)} />
                <Kpi
                  label="許容損失内で買える株数"
                  value={`${maxShares.toLocaleString()}株`}
                  tone={maxShares >= 100 ? "up" : "down"}
                  hint={maxShares >= 100 ? "100株単位で買えます" : "100株に届かない（単元未満株なら可）"}
                />
              </dl>
            </Card>
          )}

          {draft && (
            <RecordForm
              code={toCode4(detail.stock?.code ?? input)}
              draft={draft}
              close={t?.close ?? null}
              onDone={() => setDraft(null)}
            />
          )}

          <Card title={`決算・開示（${detail.disclosures.length}件）`}>
            <Notice>
              Claude には銘柄名・日付・金額を伏せて、前年比や予想修正率などの比率だけを渡して採点します（バックテストで「答えを知っている」状態を避けるため）。1件あたりの料金は Haiku で0.1円未満です。
            </Notice>
            {scoreError && <div className="mt-3"><ErrorBox message={scoreError} /></div>}
            {detail.disclosures.length === 0 ? (
              <p className="mt-3 text-sm text-muted">開示データがありません。</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {detail.disclosures.map((v) => (
                  <DisclosureCard
                    key={v.disclosure.id}
                    view={v}
                    scoring={scoringId === v.disclosure.id}
                    onScore={(text) => score(v.disclosure.id, text)}
                    onRecord={() => {
                      setDraft({ disclosureId: v.disclosure.id, score: v.score?.score ?? null, signalDate: v.disclosure.discDate });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {!detail && !busy && !error && (
        <Notice>
          銘柄コードを入れて「データを取得」を押すと、日足・25日線/75日線のトレンド・決算の数値が表示されます。
          まとめて検証するときは <Link href="/stocks/backtest" className="text-accent underline">バックテスト</Link> へ。
        </Notice>
      )}
    </div>
  );
}

function RecordForm({ code, draft, close, onDone }: { code: string; draft: RecordDraft; close: number | null; onDone: () => void }) {
  const [stop, setStop] = useState(6);
  const [mult, setMult] = useState(2);
  const [days, setDays] = useState(20);
  const defaultShares = close ? Math.max(0, Math.floor((DEFAULT_PARAMS.capital * DEFAULT_PARAMS.riskPct) / (close * 0.06))) : 0;
  const [shares, setShares] = useState(defaultShares >= 100 ? Math.floor(defaultShares / 100) * 100 : defaultShares);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setState("saving");
    setErr(null);
    try {
      await apiSend<PaperListResponse>("/api/stocks/paper", "POST", {
        code,
        disclosureId: draft.disclosureId,
        score: draft.score,
        signalDate: draft.signalDate,
        stopPct: stop / 100,
        targetPct: (stop * mult) / 100,
        maxHoldDays: days,
        shares,
        note,
      });
      setState("saved");
    } catch (e) {
      setErr(e instanceof ApiCallError ? e.message : "記録できませんでした。");
      setState("idle");
    }
  };

  return (
    <Card title={`検証ログに記録：${code}（${shortDate(draft.signalDate)} の開示）`} right={<Button variant="ghost" onClick={onDone}>閉じる</Button>}>
      {state === "saved" ? (
        <div className="space-y-2 text-sm">
          <p>記録しました。開示の翌営業日の寄り付きで買ったものとして、損切り・利確・期限を毎回チェックします。</p>
          <Link href="/stocks/log" className="font-semibold text-accent hover:underline">検証ログを見る →</Link>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Field label="損切り（%）"><input type="number" min={1} max={30} step={0.5} value={stop} onChange={(e) => setStop(Number(e.target.value))} className={`${inputClass} num`} /></Field>
            <Field label="利確（損切りの何倍）"><input type="number" min={0.5} max={10} step={0.5} value={mult} onChange={(e) => setMult(Number(e.target.value))} className={`${inputClass} num`} /></Field>
            <Field label="最長保有（営業日）"><input type="number" min={1} max={120} value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputClass} num`} /></Field>
            <Field label="株数（仮）"><input type="number" min={0} step={1} value={shares} onChange={(e) => setShares(Number(e.target.value))} className={`${inputClass} num`} /></Field>
            <Field label="メモ"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} /></Field>
          </div>
          <p className="text-xs text-muted">利確は +{(stop * mult).toFixed(1)}%。株数は損益の円換算に使うだけで、0でも記録できます。</p>
          {err && <ErrorBox message={err} />}
          <Button variant="primary" onClick={submit} disabled={state === "saving"}>
            {state === "saving" && <Spinner />}記録する
          </Button>
        </div>
      )}
    </Card>
  );
}
