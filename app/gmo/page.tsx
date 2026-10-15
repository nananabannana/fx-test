"use client";

// 外為オプション（GMOクリック証券・USD/JPY ラダー）
// 回号 × 目標レート × High/Low で「満期に目標レートより上になる確率」を見積もり、
// 購入価格から損益分岐・エッジ・期待値を出して記録する（実際の購入はしません）

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveCandles } from "@/lib/useLiveCandles";
import { nowMs, useIsClient } from "@/lib/useIsClient";
import { useGmoRecords, recordsToCsv } from "@/lib/useGmoRecords";
import {
  evaluate, expiryRate, getNextRound, getOpenRounds, outcomeOf, pnlOf, probAbove, probAboveIndicator,
  type Direction, type Engine, type OpenRound, type TradeRecord,
} from "@/lib/gmoOption";
import { PIP } from "@/lib/config";
import { Button, Card, ErrorBox, Field, inputClass, Notice, Spinner } from "@/components/stocks/ui";

const MIN = 60_000;
const ENGINE_LABEL: Record<Engine, string> = { baseline: "基準モデル", indicator: "指標", claude: "Claude" };

const fmtTime = (ms: number) => new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
const fmtDT = (ms: number) =>
  new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
const signedPt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v * 100).toFixed(1)}pt`;
const yen = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v)).toLocaleString("ja-JP")}円`;
const dur = (min: number) => {
  const m = Math.max(0, Math.floor(min));
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`;
};

export default function GmoPage() {
  // 時刻を扱う画面なので、サーバーで作る HTML とずれないようブラウザで表示してから描く
  const isClient = useIsClient();
  if (!isClient) return <p className="py-10 text-center text-sm text-muted">読み込み中…</p>;
  return <GmoView />;
}

function GmoView() {
  const live = useLiveCandles(true);
  const last = live.candles.at(-1);
  const spot = last?.close ?? null;
  const closes = useMemo(() => live.candles.map((c) => c.close), [live.candles]);
  const { records, add, update, remove } = useGmoRecords(live.candles);

  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const open = getOpenRounds(now);
  const next = getNextRound(now);
  const [roundId, setRoundId] = useState<string | null>(null);
  const round: OpenRound | null = open.find((r) => r.id === roundId) ?? open[0] ?? null;

  const [strikeText, setStrikeText] = useState("");
  const [step, setStep] = useState(0.1);
  const [direction, setDirection] = useState<Direction>("high");
  const [price, setPrice] = useState(500);
  const [units, setUnits] = useState(1);
  const [marginPct, setMarginPct] = useState(2);
  const [engine, setEngine] = useState<Engine>("baseline");
  const [executed, setExecuted] = useState(false);
  const [note, setNote] = useState("");
  const [claude, setClaude] = useState<{ prob: number; reasons: string[]; key: string } | null>(null);
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 目標レートは、入力されるまでは現在値を表示する
  const strikeValue = strikeText === "" && spot !== null ? spot.toFixed(3) : strikeText;
  const strike = Number(strikeValue);
  const validStrike = Number.isFinite(strike) && strike > 0;
  const minutesLeft = round ? (round.expiry - now) / MIN : 0;
  const margin = marginPct / 100;
  const validPrice = Number.isInteger(price) && price >= 1 && price <= 999;

  // 条件が変わったら Claude の答えは使えない
  const claudeKey = `${round?.id}:${validStrike ? strike.toFixed(3) : ""}`;
  const claudeProb = claude && claude.key === claudeKey ? claude.prob : undefined;

  const probs: Partial<Record<Engine, number>> = {};
  if (round && spot !== null && validStrike) {
    const b = probAbove(closes, spot, strike, minutesLeft);
    const i = probAboveIndicator(closes, spot, strike, minutesLeft);
    if (b !== null) probs.baseline = b;
    if (i !== null) probs.indicator = i;
  }
  if (claudeProb !== undefined) probs.claude = claudeProb;

  const rows = (["baseline", "indicator", "claude"] as Engine[]).map((e) => ({
    engine: e,
    prob: probs[e],
    ev: probs[e] !== undefined && validPrice ? evaluate({ probAbove: probs[e]!, direction, price, margin }) : null,
  }));
  const chosen = rows.find((r) => r.engine === engine)!;

  const askClaude = async () => {
    if (!round || !validStrike || live.candles.length < 30) return;
    setClaudeBusy(true);
    setClaudeError(null);
    try {
      const res = await fetch("/api/gmo/prob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candles: live.candles.slice(-150), strike, minutesLeft }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error.message);
      setClaude({ prob: body.probAbove, reasons: body.reasons, key: claudeKey });
    } catch (e) {
      setClaudeError((e as Error).message || "Claude に聞けませんでした。");
    } finally {
      setClaudeBusy(false);
    }
  };

  const canRecord = !!round && spot !== null && validStrike && validPrice && units >= 1 && chosen.prob !== undefined && !live.stale;

  const record = () => {
    if (!canRecord || !round || spot === null) return;
    const r: TradeRecord = {
      id: `gmo-${nowMs().toString(36)}`,
      createdAt: nowMs(),
      roundId: round.id,
      expiry: round.expiry,
      strike: Math.round(strike * 1000) / 1000,
      direction,
      price,
      units,
      spot,
      minutesLeft,
      engine,
      probs: { ...probs },
      claudeReasons: claudeProb !== undefined ? claude?.reasons : undefined,
      margin,
      executed,
      note,
    };
    add(r);
    setNote("");
    setExecuted(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const exportCsv = () => {
    const blob = new Blob([recordsToCsv(records)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gmo-option-records-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">外為オプション（USD/JPY）</h1>
          <p className="text-xs text-muted">GMOクリック証券の回号・購入価格に合わせて、確率と期待値を検証します（実際の購入はしません）</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">現在値（Twelve Data）</p>
          <p className="num text-2xl font-bold">
            {spot === null ? "—" : spot.toFixed(3)}
            {live.status.loading && <span className="ml-2 inline-block align-middle"><Spinner /></span>}
          </p>
          {last && <p className="text-[11px] text-muted">{fmtTime(last.time + MIN)} 時点の確定1分足</p>}
        </div>
      </div>

      {live.status.error && <ErrorBox message={live.status.error.message} onRetry={live.refresh} />}
      {live.stale && <Notice tone="warn">最新のレートが10分以上前で止まっています。市場が閉まっている間は記録できません。</Notice>}

      <Card title="回号">
        {open.length === 0 ? (
          <Notice tone="warn">
            今は購入できる回号がありません（取引時間：月〜金 8:00〜翌5:00、満期2分前で締切）。
            {next && <> 次は <b>{next.label}</b>（{fmtDT(next.start)} 開始・あと{dur((next.start - now) / MIN)}）です。</>}
          </Notice>
        ) : (
          <div role="radiogroup" aria-label="回号" className="grid gap-2 sm:grid-cols-2">
            {open.map((r) => {
              const active = r.id === round?.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setRoundId(r.id)}
                  className={`rounded-xl border p-3 text-left transition ${active ? "border-accent bg-accent/10" : "border-line bg-panel-2 hover:border-muted"}`}
                >
                  <p className="text-base font-bold">{r.label}</p>
                  <p className="num mt-1 text-xs text-muted">
                    満期まで {dur(r.minutesToExpiry)}・締切まで <span className={r.minutesToCutoff < 10 ? "text-down" : ""}>{dur(r.minutesToCutoff)}</span>
                  </p>
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">満期：11・13・15・17・19・21・23・翌1・翌3・翌5時。各回号は満期の3時間前に開始。祝日・年末年始の休業は判定していません。</p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card title="条件">
          <div className="space-y-4">
            <div>
              <Field
                label="目標レート（GMOの画面から入力）"
                hint={validStrike && spot !== null ? (Math.abs(spot - strike) < PIP / 20 ? "現在値と同じ" : `現在値より ${Math.abs((spot - strike) / PIP).toFixed(1)} pips ${spot > strike ? "下" : "上"}`) : "例：150.250"}
              >
                <input inputMode="decimal" value={strikeValue} onChange={(e) => setStrikeText(e.target.value)} className={`${inputClass} num`} />
              </Field>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <button type="button" onClick={() => validStrike && setStrikeText((strike - step).toFixed(3))} className="rounded border border-line px-2 py-1 hover:bg-panel-2">−{step}</button>
                <button type="button" onClick={() => validStrike && setStrikeText((strike + step).toFixed(3))} className="rounded border border-line px-2 py-1 hover:bg-panel-2">+{step}</button>
                <button type="button" onClick={() => spot !== null && setStrikeText(spot.toFixed(3))} className="rounded border border-line px-2 py-1 hover:bg-panel-2">現在値</button>
                <label className="ml-1 flex items-center gap-1 text-muted">
                  刻み
                  <select value={step} onChange={(e) => setStep(Number(e.target.value))} className="rounded border border-line bg-panel-2 px-1 py-0.5">
                    {[0.01, 0.05, 0.1, 0.2, 0.25, 0.5].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div>
              <span className="mb-1 block text-xs text-muted">方向</span>
              <div role="radiogroup" aria-label="方向" className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5 text-sm">
                {(["high", "low"] as Direction[]).map((d) => (
                  <button key={d} type="button" role="radio" aria-checked={direction === d} onClick={() => setDirection(d)}
                    className={`rounded-md px-4 py-1 ${direction === d ? `bg-panel font-semibold shadow-sm ${d === "high" ? "text-up" : "text-down"}` : "text-muted hover:text-ink"}`}>
                    {d === "high" ? "▲ High" : "▼ Low"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="購入価格（円）" hint="1〜999円">
                <input type="number" min={1} max={999} value={price} onChange={(e) => setPrice(Math.round(Number(e.target.value)))} className={`${inputClass} num`} />
              </Field>
              <Field label="枚数">
                <input type="number" min={1} max={100} value={units} onChange={(e) => setUnits(Math.max(1, Math.round(Number(e.target.value))))} className={`${inputClass} num`} />
              </Field>
              <Field label="安全幅（%）" hint="候補の基準">
                <input type="number" min={0} max={20} step={0.5} value={marginPct} onChange={(e) => setMarginPct(Number(e.target.value))} className={`${inputClass} num`} />
              </Field>
            </div>
            {!validPrice && <p className="text-xs text-down">購入価格は1〜999円の整数で入力してください。</p>}
            <p className="text-xs text-muted">
              損益分岐の勝率 <b className="num text-ink">{validPrice ? pct(price / 1000) : "—"}</b>・当たり {validPrice ? yen((1000 - price) * units) : "—"}／外れ {validPrice ? yen(-price * units) : "—"}
            </p>
          </div>
        </Card>

        <Card title={round ? `確率と期待値（${round.label}・満期まで${dur(minutesLeft)}）` : "確率と期待値"}>
          {!round ? (
            <p className="text-sm text-muted">購入できる回号があるときに計算します。</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-line text-left">
                      <th className="py-1.5 font-normal">エンジン</th>
                      <th className="py-1.5 text-right font-normal">上になる確率</th>
                      <th className="py-1.5 text-right font-normal">{direction === "high" ? "High" : "Low"}の勝率</th>
                      <th className="py-1.5 text-right font-normal">エッジ</th>
                      <th className="py-1.5 text-right font-normal">1枚の期待値</th>
                      <th className="py-1.5 text-right font-normal">判定</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    {rows.map((r) => (
                      <tr key={r.engine} className={`border-b border-line/50 ${r.engine === engine ? "bg-accent/5" : ""}`}>
                        <td className="py-2 font-sans">
                          <label className="flex items-center gap-2">
                            <input type="radio" name="engine" checked={engine === r.engine} onChange={() => setEngine(r.engine)} />
                            {ENGINE_LABEL[r.engine]}
                          </label>
                        </td>
                        <td className="py-2 text-right">
                          {r.engine === "claude" && r.prob === undefined ? (
                            <button type="button" onClick={askClaude} disabled={claudeBusy || !validStrike || live.candles.length < 30}
                              className="inline-flex items-center gap-1 rounded border border-line px-2 py-0.5 font-sans text-xs hover:bg-panel-2 disabled:opacity-50">
                              {claudeBusy && <Spinner />}聞く
                            </button>
                          ) : (
                            <>
                              {pct(r.prob)}
                              {r.engine === "claude" && r.prob !== undefined && probs.baseline !== undefined && (
                                <span className="ml-1 text-[10px] text-muted">（基準比 {signedPt(r.prob - probs.baseline)}）</span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="py-2 text-right">{pct(r.ev?.pWin)}</td>
                        <td className={`py-2 text-right ${r.ev ? (r.ev.edge > 0 ? "text-up" : "text-down") : ""}`}>{r.ev ? signedPt(r.ev.edge) : "—"}</td>
                        <td className={`py-2 text-right ${r.ev ? (r.ev.evPerUnit > 0 ? "text-up" : "text-down") : ""}`}>{r.ev ? yen(r.ev.evPerUnit) : "—"}</td>
                        <td className="py-2 text-right font-sans">
                          {r.ev?.candidate ? (
                            <span className="rounded-md border border-up/50 bg-up/10 px-2 py-0.5 text-xs font-semibold text-up">候補</span>
                          ) : r.ev ? (
                            <span className="text-xs text-muted">見送り</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {claudeError && <div className="mt-3"><ErrorBox message={claudeError} /></div>}
              {claudeProb !== undefined && claude && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink/85">
                  {claude.reasons.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                基準モデル＝直近120分の1分足の変動の大きさから計算した、方向の偏りがない場合の確率。指標＝直近20分の勢いが半分続くと仮定したもの。
                「候補」はエッジが安全幅（{marginPct}%）を超えたときだけ出ます。確率は見積もりで、正しさは「OP検証」の較正で確かめてください。
              </p>
            </>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <Field label="メモ（任意）">
              <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="例：指標発表前、デモ口座で購入" />
            </Field>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={executed} onChange={(e) => setExecuted(e.target.checked)} />
            実際に購入した
          </label>
          <Button variant="primary" onClick={record} disabled={!canRecord}>
            {ENGINE_LABEL[engine]}の判断で記録する
          </Button>
        </div>
        {saved && <p className="mt-2 text-xs text-up">記録しました。満期後に自動で判定レートを取得します。</p>}
        {chosen.prob === undefined && round && <p className="mt-2 text-xs text-muted">{ENGINE_LABEL[engine]}の確率がまだありません。</p>}
      </Card>

      <RecordList records={records} now={now} onUpdate={update} onRemove={remove} onExport={exportCsv} />
    </div>
  );
}

function RecordList({
  records, now, onUpdate, onRemove, onExport,
}: {
  records: TradeRecord[];
  now: number;
  onUpdate: (id: string, patch: Partial<TradeRecord>) => void;
  onRemove: (id: string) => void;
  onExport: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? records : records.slice(0, 15);
  return (
    <Card
      title={`記録（${records.length}件）`}
      right={
        <div className="flex items-center gap-3 text-sm">
          <Link href="/gmo/verify" className="font-semibold text-accent hover:underline">OP検証へ →</Link>
          {records.length > 0 && <Button variant="ghost" onClick={onExport}>CSV</Button>}
        </div>
      }
    >
      {records.length === 0 ? (
        <p className="text-sm text-muted">まだ記録がありません。</p>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <RecordRow key={r.id} r={r} now={now} onUpdate={onUpdate} onRemove={onRemove} />
          ))}
        </ul>
      )}
      {records.length > 15 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs text-accent hover:underline">
          {showAll ? "最新15件だけ表示" : `すべて表示（${records.length}件）`}
        </button>
      )}
      <p className="mt-3 text-[11px] text-muted">
        判定レートは Twelve Data の満期直前1分足の終値を自動で入れます。GMO の画面の判定レートを入力すると、そちらを優先します。同値は引き分け（集計から除外）。記録はこのブラウザだけに保存されるので、ときどき CSV で書き出してください。
      </p>
    </Card>
  );
}

function RecordRow({
  r, now, onUpdate, onRemove,
}: {
  r: TradeRecord;
  now: number;
  onUpdate: (id: string, patch: Partial<TradeRecord>) => void;
  onRemove: (id: string) => void;
}) {
  const o = outcomeOf(r);
  const pnl = pnlOf(r);
  const [manual, setManual] = useState(r.expiryRateManual?.toFixed(3) ?? "");
  const chip =
    o === "pending"
      ? { label: r.expiry > now ? `満期まで${dur((r.expiry - now) / MIN)}` : r.autoUnavailable ? "レート取得不可" : "判定中…", style: "border-dashed border-line text-muted" }
      : o === "win"
        ? { label: "勝ち", style: "border-up/40 text-up" }
        : o === "lose"
          ? { label: "負け", style: "border-down/40 text-down" }
          : { label: "引き分け", style: "border-line text-muted" };
  const used = r.probs[r.engine];
  const ev = used !== undefined ? evaluate({ probAbove: used, direction: r.direction, price: r.price, margin: r.margin }) : null;

  return (
    <li className="rounded-xl border border-line bg-panel-2 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${chip.style}`}>{chip.label}</span>
          <span className="font-semibold">{r.roundId.slice(5, 10).replace("-", "/")} {r.roundId.slice(11)}回</span>
          <span className={`font-semibold ${r.direction === "high" ? "text-up" : "text-down"}`}>{r.direction === "high" ? "▲High" : "▼Low"}</span>
          <span className="num text-xs">目標 {r.strike.toFixed(3)}</span>
          <span className="num text-xs text-muted">{r.price}円×{r.units}</span>
          <span className="text-xs text-muted">
            {ENGINE_LABEL[r.engine]} {pct(ev?.pWin, 0)}（分岐 {pct(r.price / 1000, 0)}）
          </span>
          {ev?.candidate && <span className="rounded bg-up/15 px-1.5 py-0.5 text-[10px] text-up">候補だった</span>}
          {r.executed && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">実購入</span>}
        </div>
        <div className="flex items-center gap-3">
          {pnl !== null && <span className={`num font-semibold ${pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "text-muted"}`}>{yen(pnl)}</span>}
          <button type="button" onClick={() => window.confirm("この記録を削除しますか？") && onRemove(r.id)} className="text-xs text-muted hover:text-down">削除</button>
        </div>
      </div>
      {r.expiry <= now && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="text-muted">
            自動 <span className="num text-ink">{r.expiryRateAuto?.toFixed(3) ?? "—"}</span>
          </span>
          <label className="flex items-center gap-1 text-muted">
            GMOの判定レート
            <input
              inputMode="decimal"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onBlur={() => {
                const v = Number(manual);
                onUpdate(r.id, { expiryRateManual: manual.trim() && Number.isFinite(v) && v > 0 ? v : undefined });
              }}
              placeholder="手入力"
              className="num w-24 rounded border border-line bg-panel px-2 py-1 text-ink"
            />
          </label>
          <label className="flex items-center gap-1 text-muted">
            <input type="checkbox" checked={r.executed} onChange={(e) => onUpdate(r.id, { executed: e.target.checked })} />
            実購入
          </label>
          {expiryRate(r) !== undefined && r.expiryRateManual !== undefined && <span className="text-accent">手入力を使用中</span>}
        </div>
      )}
      {r.note && <p className="mt-1 text-xs text-muted">メモ：{r.note}</p>}
    </li>
  );
}
