"use client";

// ハイロー検証：判定時刻と購入価格を決めて、損益分岐を確認し、実弾なしで記録して自動判定する

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveCandles } from "@/lib/useLiveCandles";
import { nowMs, useIsClient } from "@/lib/useIsClient";
import {
  breakeven, expectedValue, nextEvenHour, payoff, settle, stats, toCsv,
  type BinaryDirection, type BinaryKind, type BinaryRecord, type Pricing,
} from "@/lib/binary";
import type { AnalyzeResponse } from "@/lib/analysisTypes";
import { PAIR, PIP } from "@/lib/config";
import { ScoreBars } from "@/components/ScoreBars";
import { Button, Card, ErrorBox, Field, inputClass, Kpi, Notice, Spinner } from "@/components/stocks/ui";

const STORE_KEY = "fx-signal-lab:binary:v1";
const MINUTE = 60_000;

const yen = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v)).toLocaleString("ja-JP")}円`;
const pctTxt = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
const fmtDT = (ms: number) =>
  new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
/** <input type="datetime-local"> 用（このPCのタイムゾーン） */
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const roundUpMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE;

function loadRecords(): BinaryRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export default function BinaryPage() {
  // 時刻を使う画面なので、サーバーで作る最初の HTML とずれないよう、ブラウザで表示してから描く
  const isClient = useIsClient();
  if (!isClient) return <p className="py-10 text-center text-sm text-muted">読み込み中…</p>;
  return <BinaryView />;
}

function BinaryView() {
  const live = useLiveCandles(true);
  const last = live.candles.at(-1);
  const rate = last?.close ?? null;

  const [kind, setKind] = useState<BinaryKind>("ladder");
  const [direction, setDirection] = useState<BinaryDirection>("high");
  const [judgeAt, setJudgeAt] = useState<number>(() => nextEvenHour(nowMs()));
  const [strikeText, setStrikeText] = useState("");
  const [mode, setMode] = useState<Pricing["mode"]>("price");
  const [price, setPrice] = useState(500);
  const [units, setUnits] = useState(1);
  const [multiplier, setMultiplier] = useState(1.85);
  const [stake, setStake] = useState(1000);
  const [assumed, setAssumed] = useState(50);
  const [note, setNote] = useState("");

  const [ai, setAi] = useState<BinaryRecord["ai"] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [records, setRecords] = useState<BinaryRecord[]>(loadRecords);
  const [now, setNow] = useState(nowMs);
  const settling = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(records));
    } catch {
      /* 保存できなくても動作は続ける */
    }
  }, [records]);

  // 目標レートは、入力されるまでは現在値を表示する
  const strikeValue = strikeText === "" && rate !== null ? rate.toFixed(3) : strikeText;

  const pricing: Pricing = mode === "price" ? { mode, price } : { mode, multiplier, stake };
  const be = breakeven(pricing);
  const po = payoff(pricing, mode === "price" ? units : 1);
  const strike = kind === "ladder" ? Number(strikeValue) : rate;
  const minutesLeft = Math.round((judgeAt - now) / MINUTE);
  const validStrike = strike !== null && Number.isFinite(strike) && strike > 0;
  const canRecord = rate !== null && validStrike && be !== null && judgeAt - now >= MINUTE && !live.stale;

  // 判定時刻を過ぎた記録を自動で判定する
  const settleDue = useCallback(async () => {
    if (settling.current) return;
    settling.current = true;
    try {
      const due = records.filter((r) => r.status === "pending" && r.judgeAt <= Date.now() - 45_000).slice(0, 5);
      for (const r of due) {
        const inWindow = live.candles.find((c) => c.time === r.judgeAt - MINUTE);
        let settled: BinaryRecord | null = null;
        if (inWindow) {
          settled = settle(r, inWindow.close);
        } else {
          try {
            const res = await fetch(`/api/rate-at?t=${r.judgeAt}`, { cache: "no-store" });
            const body = await res.json();
            if (body.ok) settled = settle(r, body.rate);
            else if (body.error?.code === "no_data") settled = { ...r, status: "unavailable" };
          } catch {
            /* 次の機会にやり直す */
          }
        }
        if (settled) setRecords((list) => list.map((x) => (x.id === r.id ? settled! : x)));
      }
    } finally {
      settling.current = false;
    }
  }, [records, live.candles]);

  useEffect(() => {
    settleDue();
  }, [now, live.status.fetchedAt, settleDue]);

  const askClaude = async () => {
    if (!validStrike || live.candles.length < 20 || !last) return;
    setAiBusy(true);
    setAiError(null);
    setAi(null);
    try {
      const horizon = Math.max(1, Math.min(360, Math.round((judgeAt - (last.time + MINUTE)) / MINUTE)));
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pair: PAIR,
          horizonMinutes: horizon,
          candles: live.candles.slice(-150),
          dataKind: "live",
          strike: kind === "ladder" ? strike : undefined,
        }),
      });
      const body = (await res.json()) as AnalyzeResponse;
      if (!body.ok) throw new Error(body.error.message);
      setAi({ ...body.result.scores, direction: body.result.direction, reasons: body.result.reasons, model: body.model });
    } catch (e) {
      setAiError((e as Error).message || "Claude に聞けませんでした。");
    } finally {
      setAiBusy(false);
    }
  };

  const record = () => {
    if (!canRecord || rate === null || strike === null) return;
    const r: BinaryRecord = {
      id: `bin-${nowMs().toString(36)}`,
      createdAt: nowMs(),
      kind,
      direction,
      strike: Math.round(strike * 1000) / 1000,
      entryRate: rate,
      judgeAt,
      pricing,
      units: mode === "price" ? units : 1,
      ai: ai ?? undefined,
      status: "pending",
      note,
    };
    setRecords((list) => [r, ...list]);
    setNote("");
    setAi(null);
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(records)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `highlow-records-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const all = useMemo(() => stats(records), [records]);
  const withAi = useMemo(() => {
    const agree = records.filter((r) => r.ai && r.ai.direction === (r.direction === "high" ? "up" : "down"));
    const other = records.filter((r) => !agree.includes(r));
    return { agree: stats(agree), other: stats(other) };
  }, [records]);

  // AI の見込みを「上か下か」だけで見たときの、選んだ方向の割合
  const aiSide = ai ? (direction === "high" ? ai.up : ai.down) / Math.max(1, ai.up + ai.down) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">ハイロー検証</h1>
        <p className="text-xs text-muted">判定時刻と購入価格から損益分岐を計算し、実弾なしで記録して判定時刻のレートで自動判定します（実際の購入はしません）</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title="条件">
          <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs text-muted">{PAIR} 現在値</span>
            <span className="num text-2xl font-bold">{rate === null ? "—" : rate.toFixed(3)}</span>
            {last && <span className="text-xs text-muted">{fmtDT(last.time + MINUTE)} 時点（Twelve Data）</span>}
            {live.status.loading && <Spinner />}
          </div>
          {live.status.error && <div className="mb-3"><ErrorBox message={live.status.error.message} onRetry={live.refresh} /></div>}
          {live.stale && <div className="mb-3"><Notice tone="warn">最新のレートが10分以上前で止まっています。市場が閉まっている間は記録できません。</Notice></div>}

          <div className="space-y-4">
            <Segment
              label="種類"
              value={kind}
              onChange={setKind}
              options={[["ladder", "ラダー（目標レート）"], ["highlow", "ハイロー（現在値基準）"]]}
            />
            <Segment label="方向" value={direction} onChange={setDirection} options={[["high", "HIGH（上）"], ["low", "LOW（下）"]]} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="判定時刻" hint={minutesLeft > 0 ? `あと約${minutesLeft}分` : "過去の時刻です"}>
                <input
                  type="datetime-local"
                  value={toLocalInput(judgeAt)}
                  onChange={(e) => {
                    const t = Date.parse(e.target.value);
                    if (Number.isFinite(t)) setJudgeAt(roundUpMinute(t));
                  }}
                  className={`${inputClass} num`}
                />
              </Field>
              {kind === "ladder" ? (
                <Field
                  label="目標レート"
                  hint={validStrike && rate !== null ? `現在値から ${((Number(strikeValue) - rate) / PIP).toFixed(1)} pips` : "例：150.250"}
                >
                  <input inputMode="decimal" value={strikeValue} onChange={(e) => setStrikeText(e.target.value)} className={`${inputClass} num`} />
                </Field>
              ) : (
                <Field label="目標レート" hint="記録した時点の現在値になります">
                  <input disabled value={rate?.toFixed(3) ?? ""} className={`${inputClass} num opacity-60`} />
                </Field>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {[5, 15, 30, 60, 120].map((m) => (
                <button key={m} type="button" onClick={() => setJudgeAt(roundUpMinute(Date.now() + m * MINUTE))} className="rounded border border-line px-2 py-1 hover:bg-panel-2">
                  +{m >= 60 ? `${m / 60}時間` : `${m}分`}
                </button>
              ))}
              <button type="button" onClick={() => setJudgeAt(nextEvenHour(Date.now()))} className="rounded border border-line px-2 py-1 hover:bg-panel-2">
                次の偶数時（2時間ごと）
              </button>
            </div>

            <Segment label="価格" value={mode} onChange={setMode} options={[["price", "購入価格（1,000円払い）"], ["multiplier", "倍率"]]} />
            {mode === "price" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="1枚の購入価格（円）" hint="当たれば1枚1,000円">
                  <input type="number" min={1} max={999} value={price} onChange={(e) => setPrice(Number(e.target.value))} className={`${inputClass} num`} />
                </Field>
                <Field label="枚数">
                  <input type="number" min={1} max={100} value={units} onChange={(e) => setUnits(Math.max(1, Number(e.target.value)))} className={`${inputClass} num`} />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="倍率（払い戻し）" hint="例：1.85倍">
                  <input type="number" min={1.01} max={10} step={0.01} value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))} className={`${inputClass} num`} />
                </Field>
                <Field label="1回の投資額（円）">
                  <input type="number" min={1} step={100} value={stake} onChange={(e) => setStake(Number(e.target.value))} className={`${inputClass} num`} />
                </Field>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="損益分岐">
            {be === null ? (
              <p className="text-sm text-down">購入価格は1〜999円、倍率は1より大きい値にしてください。</p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-2">
                  <Kpi label="必要な勝率（損益分岐）" value={pctTxt(be)} tone={be > 0.55 ? "down" : undefined} />
                  <Kpi label="勝ち／負け（1回）" value={<span className="text-base">{yen(po.win)} / {yen(po.lose)}</span>} />
                </dl>
                <div className="mt-4">
                  <label className="flex items-center justify-between text-xs text-muted">
                    <span>もし勝率が <b className="num text-ink">{assumed}%</b> なら</span>
                    <span className={`num text-sm font-semibold ${expectedValue(pricing, units, assumed / 100) >= 0 ? "text-up" : "text-down"}`}>
                      1回あたり {yen(expectedValue(pricing, mode === "price" ? units : 1, assumed / 100))}
                    </span>
                  </label>
                  <input type="range" min={30} max={70} value={assumed} onChange={(e) => setAssumed(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-accent)]" />
                  <p className="mt-1 text-[11px] text-muted">100回続けると {yen(expectedValue(pricing, mode === "price" ? units : 1, assumed / 100) * 100)}</p>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-muted">
                  目標レートが現在値から離れるほど購入価格は安く（＝必要な勝率は低く）なりますが、当たりにくくなります。大事なのは「価格に対して当たりやすいか」です。
                </p>
              </>
            )}
          </Card>

          <Card title="Claude の見込み（任意）">
            <Button onClick={askClaude} disabled={aiBusy || !validStrike || live.candles.length < 20 || minutesLeft < 1}>
              {aiBusy && <Spinner />}判定時刻の見込みを聞く
            </Button>
            {aiError && <div className="mt-3"><ErrorBox message={aiError} /></div>}
            {ai && (
              <div className="mt-3 space-y-3">
                <ScoreBars scores={{ up: ai.up, down: ai.down, hold: ai.hold }} highlight={ai.direction} />
                <p className="text-sm">
                  上か下かだけで見ると、{direction === "high" ? "HIGH" : "LOW"} の見込みは <b className="num">{pctTxt(aiSide, 0)}</b>
                  （損益分岐 {pctTxt(be)}）
                </p>
                <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed">
                  {ai.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
                <Notice>この見込みは Claude の主観で、確率として正しい保証はありません。記録して「Claude と同じ方向」の勝率を確かめてから信用してください。</Notice>
              </div>
            )}
          </Card>

          <Card>
            <Field label="メモ（任意）">
              <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="例：デモ口座で購入、指標発表前" />
            </Field>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={record} disabled={!canRecord}>この条件で記録する</Button>
              <span className="text-xs text-muted">
                {fmtDT(judgeAt)} 判定・{direction === "high" ? "HIGH" : "LOW"}・目標 {validStrike ? strike!.toFixed(3) : "—"}
              </span>
            </div>
          </Card>
        </div>
      </div>

      <Card
        title="成績（判定済みの記録）"
        right={records.length > 0 && <Button variant="ghost" onClick={exportCsv}>CSV で書き出す</Button>}
      >
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Kpi label="判定済み" value={`${all.settled}件`} hint={`判定待ち ${records.filter((r) => r.status === "pending").length}件`} />
          <Kpi label="勝率" value={pctTxt(all.winRate)} hint={all.ci ? `95%の範囲 ${pctTxt(all.ci.low, 0)}〜${pctTxt(all.ci.high, 0)}` : undefined} />
          <Kpi label="平均の損益分岐" value={pctTxt(all.avgBreakeven)} />
          <Kpi label="合計損益（仮）" value={yen(all.totalPnl)} tone={all.totalPnl > 0 ? "up" : all.totalPnl < 0 ? "down" : undefined} />
          <Kpi label="1回あたり" value={all.evPerTrade === null ? "—" : yen(all.evPerTrade)} />
        </dl>
        <div className="mt-3">
          {all.verdict === "none" ? (
            <Notice>まだ判定済みの記録がありません。</Notice>
          ) : all.verdict === "above" ? (
            <Notice>勝率の95%の範囲の下限が損益分岐を上回っています。偶然ではない可能性がありますが、条件を変えずに件数を増やして確かめてください。</Notice>
          ) : all.verdict === "below" ? (
            <Notice tone="warn">勝率の95%の範囲の上限が損益分岐を下回っています。この条件では、続けるほど負ける可能性が高いです。</Notice>
          ) : (
            <Notice tone="warn">
              勝率の範囲が損益分岐をまたいでいるため、まだ「勝てる」とも「負ける」とも言えません。
              {all.neededN !== null && all.neededN > all.settled && ` 今の勝率が続くとして、見分けるにはおよそ${all.neededN.toLocaleString()}件が必要です。`}
            </Notice>
          )}
        </div>
        {(withAi.agree.settled > 0 || withAi.other.settled > 0) && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 text-left font-normal">区分</th>
                  <th className="py-1.5 text-right font-normal">件数</th>
                  <th className="py-1.5 text-right font-normal">勝率</th>
                  <th className="py-1.5 text-right font-normal">損益分岐</th>
                  <th className="py-1.5 text-right font-normal">合計損益</th>
                </tr>
              </thead>
              <tbody className="num">
                {([["Claude と同じ方向", withAi.agree], ["それ以外（未使用・逆・保留）", withAi.other]] as const).map(([label, s]) => (
                  <tr key={label} className="border-b border-line/50">
                    <td className="py-1.5 font-sans">{label}</td>
                    <td className="py-1.5 text-right">{s.settled}</td>
                    <td className="py-1.5 text-right">{pctTxt(s.winRate)}</td>
                    <td className="py-1.5 text-right">{pctTxt(s.avgBreakeven)}</td>
                    <td className={`py-1.5 text-right ${s.totalPnl > 0 ? "text-up" : s.totalPnl < 0 ? "text-down" : ""}`}>{yen(s.totalPnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          判定は Twelve Data の1分足の終値で行います。業者の判定レートとは数銭ずれることがあり、目標レートぎりぎりの結果は業者と食い違う場合があります。同値は負けとして数えます。
        </p>
      </Card>

      <Card title={`記録一覧（${records.length}件）`}>
        {records.length === 0 ? (
          <p className="text-sm text-muted">まだ記録がありません。</p>
        ) : (
          <ul className="space-y-2">
            {records.map((r) => {
              const rbe = breakeven(r.pricing);
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip r={r} now={now} />
                    <span className={`font-semibold ${r.direction === "high" ? "text-up" : "text-down"}`}>{r.direction === "high" ? "▲HIGH" : "▼LOW"}</span>
                    <span className="num text-xs">目標 {r.strike.toFixed(3)}</span>
                    <span className="text-xs text-muted">{fmtDT(r.judgeAt)} 判定</span>
                    <span className="num text-xs text-muted">
                      {r.pricing.mode === "price" ? `${r.pricing.price}円×${r.units}` : `${r.pricing.multiplier}倍・${r.pricing.stake}円`}（分岐 {pctTxt(rbe, 0)}）
                    </span>
                    {r.ai && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">Claude {r.ai.direction === "up" ? "上" : r.ai.direction === "down" ? "下" : "保留"}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    {r.settleRate !== undefined && <span className="num text-xs text-muted">判定 {r.settleRate.toFixed(3)}</span>}
                    {r.pnlYen !== undefined && <span className={`num font-semibold ${r.pnlYen > 0 ? "text-up" : "text-down"}`}>{yen(r.pnlYen)}</span>}
                    <button
                      type="button"
                      onClick={() => window.confirm("この記録を削除しますか？") && setRecords((l) => l.filter((x) => x.id !== r.id))}
                      className="text-xs text-muted hover:text-down"
                    >
                      削除
                    </button>
                  </div>
                  {r.note && <p className="w-full text-xs text-muted">メモ：{r.note}</p>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-muted">記録はこのブラウザだけに保存されます。消えないよう、ときどき CSV で書き出してください。</p>
      </Card>
    </div>
  );
}

function StatusChip({ r, now }: { r: BinaryRecord; now: number }) {
  if (r.status === "pending") {
    const m = Math.ceil((r.judgeAt - now) / MINUTE);
    return <span className="rounded-md border border-dashed border-line px-2 py-0.5 text-xs text-muted">{m > 0 ? `あと${m}分` : "判定中…"}</span>;
  }
  const map = {
    won: ["勝ち", "border-up/40 text-up"],
    lost: ["負け", "border-down/40 text-down"],
    unavailable: ["判定不可", "border-line text-muted"],
  } as const;
  const [label, style] = map[r.status];
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${style}`}>{label}</span>;
}

function Segment<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div>
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-line bg-panel-2 p-0.5 text-sm">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`rounded-md px-3 py-1 ${value === v ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
