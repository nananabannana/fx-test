"use client";

import Link from "next/link";
import { useState } from "react";
import { usePredictions } from "@/lib/store";
import { summarize } from "@/lib/verify";
import { FLAT_THRESHOLD_PIPS, HORIZON_OPTIONS, PAIR } from "@/lib/config";
import { HistoryList } from "@/components/HistoryList";
import { ChangeChart } from "@/components/ChangeChart";
import { SourceBadge } from "@/components/SourceBadge";

export default function VerifyPage() {
  const { history: everything, mode } = usePredictions();
  const isLive = mode === "live";
  const [filter, setFilter] = useState<"all" | "claude" | "demo">("all");
  const [hFilter, setHFilter] = useState<number | "all">("all");
  // 期間が違う予測を混ぜると比べられないので、期間で絞り込めるようにする
  const all = hFilter === "all" ? everything : everything.filter((h) => h.horizonMinutes === hFilter);
  const history = filter === "all" ? all : all.filter((h) => (h.engine ?? "demo") === filter);
  const usedHorizons = HORIZON_OPTIONS.filter((h) => everything.some((p) => p.horizonMinutes === h));
  const s = summarize(history);
  const byEngine = (["claude", "demo"] as const).map((e) => ({
    engine: e,
    ...summarize(all.filter((h) => (h.engine ?? "demo") === e)),
  }));

  const stats = [
    { label: "予測の総数", value: s.total },
    { label: "一致", value: s.match, tone: "text-up" },
    { label: "不一致", value: s.miss, tone: "text-down" },
    { label: "対象外（判断保留）", value: s.excluded },
    { label: isLive ? "確認待ち／取得できず" : "確認待ち", value: s.pending },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold">予測と実績の比較</h1>
          <SourceBadge source={mode} />
        </div>
        <p className="text-sm leading-relaxed text-muted">
          {PAIR} の予測を、予測期間（5〜30分）後の終値と照らし合わせています。
          {isLive
            ? "実データでの照合です。件数が少ないうちは偶然の影響が大きく、実力の判断には使えません。"
            : "架空のデータに対する照合なので、実際の予測精度を示すものではありません。"}
          表示を切り替えるには分析画面の「サンプル／実データ」を使います。
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
        <div role="tablist" aria-label="予測期間で絞り込み" className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5 text-sm">
          {(["all", ...usedHorizons] as (number | "all")[]).map((h) => (
            <button
              key={h}
              type="button"
              role="tab"
              aria-selected={hFilter === h}
              onClick={() => setHFilter(h)}
              className={`rounded-md px-3 py-1 ${hFilter === h ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {h === "all" ? "全期間" : `${h}分`}
            </button>
          ))}
        </div>
        <div role="tablist" aria-label="分析エンジンで絞り込み" className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5 text-sm">
          {(
            [
              ["all", "すべて"],
              ["claude", "Claude"],
              ["demo", "デモ指標"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={filter === v}
              onClick={() => setFilter(v)}
              className={`rounded-md px-3 py-1 ${filter === v ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        </div>
        {hFilter === "all" && usedHorizons.length > 1 && (
          <p className="mt-2 text-xs text-hold">期間の違う予測が混ざっています。成績を比べるときは期間を1つに絞ってください。</p>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {stats.map((st) => (
            <div key={st.label} className="rounded-xl border border-line bg-panel-2 px-3 py-2.5">
              <dt className="text-[11px] text-muted">{st.label}</dt>
              <dd className={`num text-xl font-bold ${st.tone ?? ""}`}>{st.value}</dd>
            </div>
          ))}
        </dl>

        {filter === "all" && byEngine.every((b) => b.evaluated > 0) && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm">
              <caption className="mb-1 text-left text-xs text-muted">エンジン別（判断保留を除く）</caption>
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 text-left font-normal">エンジン</th>
                  <th className="py-1.5 text-right font-normal">照合数</th>
                  <th className="py-1.5 text-right font-normal">一致</th>
                  <th className="py-1.5 text-right font-normal">一致率</th>
                </tr>
              </thead>
              <tbody className="num">
                {byEngine.map((b) => (
                  <tr key={b.engine} className="border-b border-line/60">
                    <td className="py-1.5 font-sans">{b.engine === "claude" ? "Claude" : "デモ指標"}</td>
                    <td className="py-1.5 text-right">{b.evaluated}</td>
                    <td className="py-1.5 text-right">{b.match}</td>
                    <td className="py-1.5 text-right">{Math.round((b.match / b.evaluated) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {s.evaluated > 0 && (
          <p className="mt-3 text-xs text-muted">
            照合できた {s.evaluated} 件中 {s.match} 件が一致。
            {isLive
              ? "数百件以上たまるまでは、偶然による差と見分けがつきません。"
              : "件数が少なく、データも架空のため、この数字から実力は判断できません。"}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-panel p-3 sm:p-4">
        <h2 className="mb-2 px-1 text-sm font-semibold">
          予測期間後の値動き（pips） <span className="font-normal text-muted">古い順</span>
        </h2>
        <ChangeChart items={history} />
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-muted">
          <span><span className="text-up">■</span> 一致</span>
          <span><span className="text-down">■</span> 不一致</span>
          <span><span className="text-muted">■</span> 対象外</span>
          <span><span className="text-hold">■</span> 帯＝横ばい扱い（±{FLAT_THRESHOLD_PIPS} pips 未満）</span>
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">照合の一覧</h2>
        <HistoryList items={history} />
      </section>

      <section className="rounded-2xl border border-line bg-panel p-4 text-sm leading-relaxed sm:p-5">
        <h2 className="mb-2 font-semibold">照合のルール</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>予測時点の終値と、予測期間（5・10・15・30分）後の足の終値を比べます。</li>
          <li>変化が ±{FLAT_THRESHOLD_PIPS} pips 未満なら「横ばい」とし、上昇・下落の予測は不一致になります。</li>
          <li>「判断保留」の予測は一致・不一致の集計から外します。</li>
          <li>
            まだ予測期間が経っていない予測は「確認待ち」です。
            {isLive ? "期間後の足が確定すると自動で照合されます。" : "分析画面で時間を進めると確定します。"}
          </li>
          {isLive && <li>アプリを閉じていて期間後の足を取得できず、取得範囲（約2.5時間）から外れた予測は「取得できず」になります。</li>}
        </ul>
        <Link href="/legacy" className="mt-3 inline-block font-semibold text-accent underline-offset-4 hover:underline">
          ← 分析画面に戻る
        </Link>
      </section>
    </div>
  );
}
