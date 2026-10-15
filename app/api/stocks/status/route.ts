// 接続設定の状態（キーがあるかどうかだけを返し、キーの中身は返さない）
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { jquantsPlan } from "@/lib/server/jquants";
import { DEFAULT_MODEL } from "@/lib/server/claudeAnalyzer";
import type { StatusResponse } from "@/lib/stocks/api";

export const dynamic = "force-dynamic";

const RPM = { free: 5, light: 60, standard: 120, premium: 500 } as const;

export async function GET() {
  const plan = jquantsPlan();
  const body: StatusResponse = {
    ok: true,
    storage: getDb().kind,
    jquants: { configured: !!process.env.JQUANTS_API_KEY, plan, rpm: RPM[plan] },
    claude: { configured: !!process.env.ANTHROPIC_API_KEY, model: process.env.CLAUDE_MODEL || DEFAULT_MODEL },
    onVercel: !!process.env.VERCEL,
  };
  return NextResponse.json(body);
}
