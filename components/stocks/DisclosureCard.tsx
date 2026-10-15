"use client";

import { useState } from "react";
import type { DisclosureView } from "@/lib/stocks/api";
import { KIND_LABEL } from "@/lib/stocks/features";
import { pct, shortDate } from "@/lib/stocks/format";
import { Button, inputClass, ScoreBadge, Spinner } from "./ui";

const SUB_LABEL: Record<string, string> = {
  revision: "予想修正",
  guidance: "来期予想",
  dividend: "配当",
  growth: "成長",
  progress: "進捗",
};

export function DisclosureCard({
  view,
  scoring,
  onScore,
  onRecord,
}: {
  view: DisclosureView;
  scoring: boolean;
  onScore: (text?: string) => void;
  onRecord: () => void;
}) {
  const { disclosure: d, features: f, score } = view;
  const [open, setOpen] = useState(false);
  const [showText, setShowText] = useState(false);
  const [text, setText] = useState("");

  const rows: [string, string][] = [];
  if (f.yoy.op !== null || f.yoy.sales !== null) rows.push(["前年同期比", `売上 ${pct(f.yoy.sales)}／営業益 ${pct(f.yoy.op)}`]);
  if (f.revision.op !== null || f.revision.sales !== null)
    rows.push([f.periodType === "FY" && f.kind === "earnings" ? "予想に対する着地" : "今期予想の修正", `売上 ${pct(f.revision.sales)}／営業益 ${pct(f.revision.op)}`]);
  if (f.revision.div !== null) rows.push(["配当予想の修正", pct(f.revision.div)]);
  if (f.guidance.op !== null || f.guidance.sales !== null) rows.push(["来期予想（今期比）", `売上 ${pct(f.guidance.sales)}／営業益 ${pct(f.guidance.op)}`]);
  if (f.guidance.div !== null) rows.push(["来期配当（今期比）", pct(f.guidance.div)]);
  if (f.progress.op !== null && f.progress.standard !== null)
    rows.push(["営業益の進捗", `${(f.progress.op * 100).toFixed(0)}%（標準 ${(f.progress.standard * 100).toFixed(0)}%）`]);

  return (
    <li className="rounded-xl border border-line bg-panel-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="num text-sm font-semibold">{shortDate(d.discDate)}</span>
          <span className="text-xs text-muted">{d.discTime.slice(0, 5)}</span>
          <span className="rounded bg-panel px-1.5 py-0.5 text-[11px]">
            {KIND_LABEL[f.kind]}
            {f.kind === "earnings" && f.periodType ? `・${f.periodType}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ScoreBadge score={score?.score ?? null} />
          {score?.usedText && <span className="text-[10px] text-hold">本文あり</span>}
        </div>
      </div>

      {rows.length > 0 ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-line/50 py-0.5">
              <dt className="text-muted">{k}</dt>
              <dd className="num text-right">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-xs text-muted">比較できる数値がありません。</p>
      )}

      {score && (
        <div className="mt-2">
          <p className="text-sm leading-relaxed">{score.summary}</p>
          <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-xs text-accent hover:underline">
            {open ? "根拠を閉じる" : "根拠と項目別スコアを見る"}
          </button>
          {open && (
            <div className="mt-2 space-y-2 text-xs">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(score.subScores).map(([k, v]) => (
                  <span key={k} className={`num rounded px-1.5 py-0.5 ${v > 0 ? "bg-up/15 text-up" : v < 0 ? "bg-down/15 text-down" : "bg-panel text-muted"}`}>
                    {SUB_LABEL[k] ?? k} {v > 0 ? `+${v}` : v}
                  </span>
                ))}
              </div>
              <ul className="list-disc space-y-1 pl-4 leading-relaxed">
                {score.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <p className="text-muted">{score.model}・プロンプト {score.promptVersion}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => onScore()} disabled={scoring}>
          {scoring ? <Spinner /> : null}
          {score && !score.usedText ? "採点し直す" : "Claude で採点"}
        </Button>
        <Button variant="ghost" onClick={() => setShowText((v) => !v)}>
          {showText ? "本文入力を閉じる" : "短信本文も読ませる"}
        </Button>
        <Button variant="ghost" onClick={onRecord}>
          検証ログに記録
        </Button>
      </div>

      {showText && (
        <div className="mt-2 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="決算短信のサマリーや「業績予想の修正に関するお知らせ」の本文を貼り付け"
            className={inputClass}
          />
          <p className="text-[11px] leading-relaxed text-muted">
            本文には会社名が入るため匿名になりません。このスコアは画面での参考用で、バックテストには使いません。
          </p>
          <Button onClick={() => onScore(text)} disabled={scoring || !text.trim()}>
            本文も含めて採点
          </Button>
        </div>
      )}
    </li>
  );
}
