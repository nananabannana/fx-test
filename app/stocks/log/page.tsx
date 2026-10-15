"use client";

// 検証ログ：実弾なしで記録したトレードの成績を追う

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet, apiSend, ApiCallError } from "@/lib/stocks/client";
import type { PaperListResponse } from "@/lib/stocks/api";
import { toCode4, type PaperTrade } from "@/lib/stocks/types";
import { EXIT_LABEL, pct, plainPct, price, rMul, shortDate, signedYen } from "@/lib/stocks/format";
import { TREND_LABEL } from "@/lib/stocks/trend";
import { Button, Card, ErrorBox, Kpi, Notice, ScoreBadge, Spinner } from "@/components/stocks/ui";

const STATUS: Record<PaperTrade["status"], { label: string; style: string }> = {
  planned: { label: "寄り付き待ち", style: "border-line text-muted border-dashed" },
  open: { label: "保有中", style: "border-accent/50 text-accent" },
  closed: { label: "決済済み", style: "border-line text-ink" },
};

export default function PaperLogPage() {
  const [trades, setTrades] = useState<PaperTrade[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<Extract<PaperListResponse, { ok: true }>>("/api/stocks/paper");
      setTrades(r.trades);
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : "読み込めませんでした。");
      setTrades([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ ok: true; trades: PaperTrade[]; errors: string[] }>("/api/stocks/paper", "PATCH", { action: "refresh", fetch: true });
      setTrades(r.trades);
      setWarnings(r.errors);
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : "更新できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("この記録を削除しますか？")) return;
    try {
      await apiSend("/api/stocks/paper?id=" + encodeURIComponent(id), "DELETE");
      setTrades((t) => t?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : "削除できませんでした。");
    }
  };

  const closed = (trades ?? []).filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (t.returnPct ?? 0) > 0);
  const avgR = closed.length ? closed.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / closed.length : null;
  const totalYen = closed.reduce((s, t) => s + (t.pnlYen ?? 0), 0);
  const curve = closed
    .slice()
    .sort((a, b) => (a.exitDate ?? "").localeCompare(b.exitDate ?? ""))
    .reduce<{ date: string; r: number }[]>((acc, t) => {
      acc.push({ date: t.exitDate ?? "", r: +((acc.at(-1)?.r ?? 0) + (t.rMultiple ?? 0)).toFixed(2) });
      return acc;
    }, []);

  return (
    <div className="space-y-4">
      <Card
        title="検証ログ（実弾なしの記録）"
        right={
          <Button onClick={refresh} disabled={busy || !trades?.some((t) => t.status !== "closed")}>
            {busy && <Spinner />}最新の日足で更新
          </Button>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          <Link href="/stocks" className="text-accent hover:underline">銘柄分析</Link> の開示から「検証ログに記録」すると、翌営業日の寄り付きで買ったものとして、
          損切り・利確・期限を日足でチェックします。無料プランは12週間遅れのデータなので、日々の追跡にはライトプランが必要です。
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="決済済み" value={`${closed.length}件`} hint={`保有中・待ち ${(trades?.length ?? 0) - closed.length}件`} />
          <Kpi label="勝率" value={plainPct(closed.length ? wins.length / closed.length : null)} />
          <Kpi label="期待値（1回あたり）" value={rMul(avgR)} tone={avgR === null ? "muted" : avgR > 0 ? "up" : "down"} />
          <Kpi label="合計損益（仮の株数）" value={signedYen(totalYen)} tone={totalYen > 0 ? "up" : totalYen < 0 ? "down" : undefined} />
        </dl>
        {closed.length > 0 && closed.length < 30 && (
          <div className="mt-3">
            <Notice tone="warn">決済済みが {closed.length} 件です。30件を超えるまでは、成績は偶然の影響が大きいと考えてください。</Notice>
          </div>
        )}
        {error && <div className="mt-3"><ErrorBox message={error} /></div>}
        {warnings.length > 0 && (
          <div className="mt-3"><Notice tone="warn">一部の銘柄は日足を取り直せませんでした：{warnings.join(" / ")}</Notice></div>
        )}
      </Card>

      {curve.length > 1 && (
        <Card title="累積の損益（R＝損切り幅を1とした単位）">
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickFormatter={(d: string) => d.slice(5).replace("-", "/")} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} minTickGap={30} />
                <YAxis orientation="right" tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                <ReferenceLine y={0} stroke="var(--color-muted)" strokeDasharray="3 3" />
                <Tooltip isAnimationActive={false} formatter={(v) => [`${v}R`, "累積"]} contentStyle={{ background: "var(--color-panel-2)", border: "1px solid var(--color-line)", fontSize: 12 }} />
                <Line type="stepAfter" dataKey="r" stroke="var(--color-accent)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card title="記録一覧">
        {trades === null ? (
          <p className="text-sm text-muted">読み込み中…</p>
        ) : trades.length === 0 ? (
          <p className="text-sm text-muted">まだ記録がありません。</p>
        ) : (
          <ul className="space-y-2">
            {trades.map((t) => (
              <li key={t.id} className="rounded-xl border border-line bg-panel-2 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${STATUS[t.status].style}`}>{STATUS[t.status].label}</span>
                    <span className="num font-semibold">{toCode4(t.code)}</span>
                    <span className="text-muted">{t.name}</span>
                    <ScoreBadge score={t.score} />
                    <span className="text-xs text-muted">{TREND_LABEL[t.trend]}トレンド</span>
                  </div>
                  <button type="button" onClick={() => remove(t.id)} className="text-xs text-muted hover:text-down">削除</button>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div><dt className="text-muted">判断日</dt><dd className="num">{shortDate(t.signalDate)}</dd></div>
                  <div><dt className="text-muted">買い</dt><dd className="num">{t.entryDate ? `${shortDate(t.entryDate)} ${price(t.entryPrice)}` : "—"}</dd></div>
                  <div>
                    <dt className="text-muted">{t.status === "closed" ? "売り" : "ルール"}</dt>
                    <dd className="num">
                      {t.status === "closed"
                        ? `${shortDate(t.exitDate)} ${price(t.exitPrice)}（${EXIT_LABEL[t.exitReason ?? "end"]}）`
                        : `損切り−${(t.stopPct * 100).toFixed(1)}%／利確+${(t.targetPct * 100).toFixed(1)}%／${t.maxHoldDays}日`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t.status === "closed" ? "結果" : "含み損益"}</dt>
                    <dd className={`num ${(t.returnPct ?? 0) > 0 ? "text-up" : (t.returnPct ?? 0) < 0 ? "text-down" : ""}`}>
                      {t.returnPct === null ? "—" : `${pct(t.returnPct)}（${rMul(t.rMultiple)}）${t.pnlYen !== null && t.shares ? ` ${signedYen(t.pnlYen)}` : ""}`}
                    </dd>
                  </div>
                </dl>
                {t.note && <p className="mt-2 text-xs text-muted">メモ：{t.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
