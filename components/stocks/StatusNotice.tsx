"use client";

// 接続設定の状態を表示（足りない設定があるときだけ目立たせる）

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/stocks/client";
import type { StatusResponse } from "@/lib/stocks/api";
import { Notice } from "./ui";

export function StatusNotice() {
  const [s, setS] = useState<StatusResponse | null>(null);
  useEffect(() => {
    apiGet<StatusResponse>("/api/stocks/status").then(setS).catch(() => setS(null));
  }, []);
  if (!s) return null;

  const missing: string[] = [];
  if (!s.jquants.configured) missing.push("JQUANTS_API_KEY（J-Quants のAPIキー）");
  if (!s.claude.configured) missing.push("ANTHROPIC_API_KEY（開示スコアに使用）");
  const vercelLocal = s.onVercel && s.storage === "local";

  return (
    <div className="space-y-2">
      {(missing.length > 0 || vercelLocal) && (
        <Notice tone="warn">
          {missing.length > 0 && (
            <p>
              .env.local に次の設定がありません：{missing.join("、")}。書き足したらサーバーを再起動してください。
            </p>
          )}
          {vercelLocal && <p>Vercel 上ではファイルに保存できません。SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。</p>}
        </Notice>
      )}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>
          J-Quants：{s.jquants.configured ? `${s.jquants.plan} プラン（1分${s.jquants.rpm}回まで）` : "未設定"}
          {s.jquants.plan === "free" && "・データは12週間遅れ"}
        </span>
        <span>Claude：{s.claude.configured ? s.claude.model : "未設定"}</span>
        <span>保存先：{s.storage === "supabase" ? "Supabase" : "このPCのファイル（.data フォルダ）"}</span>
      </p>
    </div>
  );
}
