"use client";

// 短期予測の検証：予測と実際の結果、5分後と10分後の比較、方向別・時間帯別の成績、
// 確率の正確さ（ブライアスコア・較正）、予測に従った仮想取引と、実際に入れた仮想取引の成績。

import { useMemo, useState } from "react";
import Link from "next/link";
import { useIsClient } from "@/lib/useIsClient";
import { usePredictStore, useRecentCandles } from "@/lib/predict/usePredict";
import { horizonStats, recordsCsv, FOLLOW_UNITS } from "@/lib/predict/stats";
import { CLASS_LABEL } from "@/lib/predict/evaluate";
import { HORIZONS, type Horizon } from "@/lib/predict/model";
import { balanceOf, outcomeAt, type DemoTrade } from "@/lib/predict/demo";
import { maxDrawdown } from "@/lib/predict/evaluate";
import { REGIME_LABEL } from "@/lib/predict/features";
import { useFxEvents } from "@/lib/useFxEvents";
import { ConditionAnalysis, type CondItem } from "@/components/ConditionAnalysis";
import { Card, Kpi, Notice } from "@/components/stocks/ui";
import { ClsTag, fmtDateTime, pct, yen } from "@/components/predict/parts";
import { CalibrationTable, ConfusionTable, EquityChart } from "@/components/predict/tables";

/** これ未満は「信頼性が低い」 */
const LOW_N = 100;

export default function PredictVerifyPage() {
  const isClient = useIsClient();
  if (!isClient) return <p className="py-10 text-center text-sm text-muted">読み込み中…</p>;
  return <VerifyView />;
}

function VerifyView() {
  const live = useRecentCandles();
  const candles = useMemo(() => live.data?.candles ?? [], [live.data]);
  const store = usePredictStore(candles);
  const events = useFxEvents();
  const versions = useMemo(() => [...new Set(store.records.map((r) => r.modelVersion))], [store.records]);
  const [version, setVersion] = useState<string>("all");
  const [h, setH] = useState<Horizon>(5);
  const [shown, setShown] = useState(50);
  const records = useMemo(() => (version === "all" ? store.records : store.records.filter((r) => r.modelVersion === version)), [store.records, version]);
  const stats = useMemo(() => ({ 5: horizonStats(records, 5), 10: horizonStats(records, 10) }), [records]);
  const s = stats[h];

  const condItems: CondItem[] = records.flatMap((r) => {
    const o = outcomeAt(r, h);
    const dir = r.horizons[h].direction;
    return [{
      id: r.id, time: r.at, session: r.session, atrPips: r.atrPips,
      result: o.status !== "settled" ? "pending" : dir === "flat" ? "excluded" : o.hit ? "win" : "lose",
    } satisfies CondItem];
  });

  const exportCsv = () => {
    const blob = new Blob([recordsCsv(records)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fx-short-term-predictions.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-muted">
            モデル
            <select value={version} onChange={(e) => setVersion(e.target.value)} className="rounded-md border border-line bg-panel-2 px-2 py-1 text-sm text-ink">
              <option value="all">すべて（{store.records.length}件）</option>
              {versions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <div role="tablist" aria-label="予測時間" className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5 text-sm">
            {HORIZONS.map((x) => (
              <button key={x} type="button" role="tab" aria-selected={h === x} onClick={() => setH(x)}
                className={`rounded-md px-3 py-1 ${h === x ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                {x}分後
              </button>
            ))}
          </div>
          <button type="button" onClick={exportCsv} disabled={!records.length} className="ml-auto rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs hover:bg-panel disabled:opacity-50">
            CSVで書き出す
          </button>
        </div>
        {version === "all" && versions.length > 1 && <p className="mt-2 text-xs text-hold">複数のモデルの記録が混ざっています。モデルを比べるときは1つに絞ってください。</p>}
      </Card>

      <Card title="5分後と10分後の比較">
        {stats[5].settled < LOW_N && (
          <div className="mb-3">
            <Notice tone="warn">判定済みが {stats[5].settled}件（5分後）と少なく、評価の信頼性は低いです。{LOW_N}件以上、できれば数百件たまるまでは「当たる／当たらない」は判断できません。</Notice>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 text-left font-normal">予測</th>
                <th className="py-1.5 text-right font-normal">判定済み</th>
                <th className="py-1.5 text-right font-normal">的中率（95%区間）</th>
                <th className="py-1.5 text-right font-normal">基準の的中率</th>
                <th className="py-1.5 text-right font-normal">ブライア</th>
                <th className="py-1.5 text-right font-normal">基準のブライア</th>
                <th className="py-1.5 text-right font-normal">較正誤差</th>
              </tr>
            </thead>
            <tbody className="num">
              {HORIZONS.map((x) => {
                const st = stats[x];
                const better = st.metrics.brier !== null && st.base.brier !== null ? st.metrics.brier < st.base.brier : null;
                return (
                  <tr key={x} className={`border-b border-line/50 ${st.settled < LOW_N ? "text-muted" : ""}`}>
                    <td className="py-1.5 font-sans">{x}分後{st.settled < LOW_N && <span className="ml-1.5 rounded border border-line px-1 text-[10px]">件数少</span>}</td>
                    <td className="py-1.5 text-right">{st.settled}<span className="ml-1 text-[10px] text-muted">待ち{st.pending}</span></td>
                    <td className="py-1.5 text-right">{pct(st.metrics.accuracy)}{st.ci && <span className="ml-1 text-[11px] text-muted">{pct(st.ci.low, 0)}〜{pct(st.ci.high, 0)}</span>}</td>
                    <td className="py-1.5 text-right">{pct(st.base.accuracy)}</td>
                    <td className={`py-1.5 text-right ${better === true ? "text-up" : better === false ? "text-down" : ""}`}>{st.metrics.brier?.toFixed(3) ?? "—"}</td>
                    <td className="py-1.5 text-right">{st.base.brier?.toFixed(3) ?? "—"}</td>
                    <td className="py-1.5 text-right">{pct(st.metrics.ece)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          基準＝「いつも学習期間の比率（上昇・横ばい・下降の割合）で答える」予測。ブライアスコアは確率の正確さ（3択、0〜2・小さいほど良い）で、基準より小さければ緑。
          的中は「上昇・横ばい・下降」の3択で、横ばいの幅はそれぞれの予測時点の値です。
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`方向別の成績（${h}分後）`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 text-left font-normal">予測</th>
                  <th className="py-1.5 text-right font-normal">予測した回数</th>
                  <th className="py-1.5 text-right font-normal">的中率</th>
                  <th className="py-1.5 text-right font-normal">実際に起きた回数</th>
                  <th className="py-1.5 text-right font-normal">見逃さなかった割合</th>
                </tr>
              </thead>
              <tbody className="num">
                {s.metrics.perClass.map((c) => (
                  <tr key={c.cls} className="border-b border-line/50">
                    <td className="py-1.5"><ClsTag cls={c.cls} /></td>
                    <td className="py-1.5 text-right">{c.predicted}</td>
                    <td className="py-1.5 text-right">{pct(c.precision)}</td>
                    <td className="py-1.5 text-right">{c.support}</td>
                    <td className="py-1.5 text-right">{pct(c.recall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="mb-1 mt-4 text-xs font-semibold text-muted">混同行列</h3>
          <ConfusionTable confusion={s.metrics.confusion} />
        </Card>
        <Card title={`確率の正確さ（${h}分後）`}>
          <CalibrationTable bins={s.metrics.calibration} />
        </Card>
      </div>

      <Card title={`時間帯別の的中率（${h}分後・JST）`}>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 lg:grid-cols-12">
          {s.hourly.map((x) => {
            const acc = x.n ? x.hits / x.n : null;
            return (
              <div key={x.hour} className={`rounded-lg border border-line px-2 py-1.5 text-center ${x.n < 30 ? "opacity-60" : ""}`}>
                <div className="text-[10px] text-muted">{x.hour}時台</div>
                <div className="num text-sm font-semibold">{acc === null ? "—" : pct(acc, 0)}</div>
                <div className="num text-[10px] text-muted">{x.n}件</div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted">30件未満の時間は薄く表示しています。セッション・ボラティリティ・指標イベント別は下の表で見られます。</p>
      </Card>

      <ConditionAnalysis
        items={condItems}
        atrPopulation={store.records.map((r) => r.atrPips)}
        events={events}
        backfill={null}
        onPatch={() => {}}
        defaultMultiplier="2"
        note={<>上の「モデル」「{h}分後」の選択に連動します。ここでの勝率は「上昇・下降」の予測だけ（横ばい予測は対象外）で、方向が当たれば一致です。コストのない売買の損益分岐は50%（払戻倍率2倍）です。</>}
      />

      <Card title={`予測に従った仮想取引（${h}分後・${FOLLOW_UNITS.toLocaleString()}通貨・コスト未反映）`}>
        <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Kpi label="取引回数" value={`${s.follow.n}回`} hint="横ばい予測は見送り" />
          <Kpi label="勝率" value={s.follow.n ? pct(s.follow.wins / s.follow.n) : "—"} />
          <Kpi label="合計損益" value={yen(s.follow.totalYen)} tone={s.follow.totalYen > 0 ? "up" : s.follow.totalYen < 0 ? "down" : undefined} />
          <Kpi label="1回あたりの期待損益" value={s.follow.avgYen === null ? "—" : yen(s.follow.avgYen)} hint="スプレッド等は差し引いていません" />
          <Kpi label="最大ドローダウン" value={`−${s.follow.maxDD.toLocaleString()}円`} />
        </dl>
        <EquityChart points={s.follow.curve.map((c) => ({ label: fmtDateTime(c.t), value: c.value }))} />
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          予測時点の終値で入り、{h}分後の足の終値で出たと仮定した損益の累計です。実際はスプレッドのぶん、1回あたり数十銭〜数円（1,000通貨）悪くなります。
        </p>
      </Card>

      <DemoTradeStats trades={store.trades} start={store.settings.startBalance} />

      <Card title="予測履歴">
        {records.length === 0 ? (
          <Notice>まだ予測がありません。<Link href="/predict" className="text-accent underline">予測</Link>画面で「AI分析を実行」すると記録されます。</Notice>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line text-left">
                  <th className="py-1.5 font-normal">分析日時</th>
                  <th className="py-1.5 text-right font-normal">価格</th>
                  <th className="py-1.5 pl-3 font-normal">状態</th>
                  {HORIZONS.map((x) => <th key={x} className="py-1.5 pl-3 font-normal">{x}分後：予測 → 実際（変化）</th>)}
                  <th className="py-1.5 pl-3 font-normal">モデル</th>
                </tr>
              </thead>
              <tbody>
                {records.slice(0, shown).map((r) => (
                  <tr key={r.id} className="border-b border-line/50">
                    <td className="num py-1.5">{fmtDateTime(r.at)}</td>
                    <td className="num py-1.5 text-right">{r.price.toFixed(3)}</td>
                    <td className="py-1.5 pl-3 text-xs text-muted">{REGIME_LABEL[r.regime]}</td>
                    {HORIZONS.map((x) => {
                      const o = outcomeAt(r, x);
                      const hr = r.horizons[x];
                      return (
                        <td key={x} className="py-1.5 pl-3">
                          <span className="inline-flex flex-wrap items-center gap-1">
                            <ClsTag cls={hr.direction} />
                            <span className="num text-xs text-muted">{hr.percents[hr.direction]}%</span>
                            <span className="text-muted">→</span>
                            {o.status === "settled" ? (
                              <>
                                <ClsTag cls={o.actual} />
                                <span className="num text-xs text-muted">{o.deltaPips > 0 ? "+" : ""}{o.deltaPips}</span>
                                <span className={`text-xs font-semibold ${o.hit ? "text-up" : "text-down"}`}>{o.hit ? "○" : "×"}</span>
                              </>
                            ) : (
                              <span className="text-xs text-muted">{o.status === "pending" ? "判定待ち" : "取得できず"}</span>
                            )}
                          </span>
                        </td>
                      );
                    })}
                    <td className="num py-1.5 pl-3 text-[11px] text-muted">{r.modelVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + 100)} className="mt-2 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs hover:bg-panel">
                さらに表示（残り {records.length - shown}件・全件は CSV でも）
              </button>
            )}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">{CLASS_LABEL.flat}は予測時点の「横ばいの幅」未満の変化。予測時点のスプレッドは記録していません（使わない設定）。</p>
      </Card>
    </div>
  );
}

function DemoTradeStats({ trades, start }: { trades: DemoTrade[]; start: number }) {
  const closed = trades.filter((t) => t.status === "closed").sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0));
  const curve = closed.reduce<{ label: string; value: number }[]>(
    (acc, t) => [...acc, { label: fmtDateTime(t.exitTime ?? t.exitAt), value: acc[acc.length - 1].value + (t.pnlYen ?? 0) }],
    [{ label: "開始", value: start }],
  );
  const wins = closed.filter((t) => (t.pnlYen ?? 0) > 0).length;
  const total = closed.reduce((s, t) => s + (t.pnlYen ?? 0), 0);
  return (
    <Card title="仮想取引の成績（予測画面で入れた取引）">
      <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Kpi label="仮想資金" value={`${balanceOf(trades, start).toLocaleString("ja-JP")}円`} hint={`開始 ${start.toLocaleString("ja-JP")}円`} />
        <Kpi label="決済済み" value={`${closed.length}回`} hint={`保有中 ${trades.length - closed.length}`} />
        <Kpi label="勝率" value={closed.length ? pct(wins / closed.length) : "—"} />
        <Kpi label="合計損益" value={yen(total)} tone={total > 0 ? "up" : total < 0 ? "down" : undefined} hint="コスト未反映" />
        <Kpi label="最大ドローダウン" value={`−${maxDrawdown(curve.map((c) => c.value)).toLocaleString()}円`} />
      </dl>
      <EquityChart points={curve} base={start} />
      {closed.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line text-left">
                <th className="py-1.5 font-normal">エントリー</th>
                <th className="py-1.5 font-normal">売買</th>
                <th className="py-1.5 text-right font-normal">数量</th>
                <th className="py-1.5 text-right font-normal">入り → 出</th>
                <th className="py-1.5 font-normal pl-3">理由</th>
                <th className="py-1.5 text-right font-normal">損益</th>
              </tr>
            </thead>
            <tbody className="num">
              {closed.slice().reverse().slice(0, 50).map((t) => (
                <tr key={t.id} className="border-b border-line/50">
                  <td className="py-1.5">{fmtDateTime(t.entryAt)}</td>
                  <td className="py-1.5 font-sans">{t.side === "buy" ? "▲ 買い" : "▼ 売り"}</td>
                  <td className="py-1.5 text-right">{t.units.toLocaleString()}</td>
                  <td className="py-1.5 text-right">{t.entry.toFixed(3)} → {t.exitPrice?.toFixed(3)}</td>
                  <td className="py-1.5 pl-3 font-sans text-xs">{t.exitReason === "stop" ? "損切り" : "時間"}</td>
                  <td className={`py-1.5 text-right ${(t.pnlYen ?? 0) > 0 ? "text-up" : (t.pnlYen ?? 0) < 0 ? "text-down" : ""}`}>{yen(t.pnlYen ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
