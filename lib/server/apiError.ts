// API Route 共通のエラー応答（サーバー専用）
import "server-only";

import { NextResponse } from "next/server";
import { JQuantsError } from "./jquants";
import { ScoreError } from "./disclosureScorer";
import { DbError } from "./db";

export type ApiError = { code: string; message: string };

export function errorResponse(e: unknown) {
  if (e instanceof JQuantsError) {
    const status = e.code === "rate_limit" ? 429 : e.code === "no_key" ? 503 : 502;
    return NextResponse.json({ ok: false, error: { code: `jquants_${e.code}`, message: e.message } }, { status });
  }
  if (e instanceof ScoreError) {
    const status = e.code === "rate_limit" ? 429 : e.code === "no_key" ? 503 : 502;
    return NextResponse.json({ ok: false, error: { code: `claude_${e.code}`, message: e.message } }, { status });
  }
  if (e instanceof DbError) {
    return NextResponse.json({ ok: false, error: { code: "db", message: e.message } }, { status: 500 });
  }
  console.error(e);
  return NextResponse.json({ ok: false, error: { code: "unknown", message: "予期しないエラーが起きました。" } }, { status: 500 });
}

export function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: { code: "bad_request", message } }, { status: 400 });
}

/** 銘柄コードの形を確認して5桁にする（4桁・5桁の英数字のみ） */
export function parseCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase();
  if (!/^[0-9A-Z]{4,5}$/.test(c)) return null;
  return c.length === 4 ? `${c}0` : c;
}
