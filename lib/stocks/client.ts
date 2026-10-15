"use client";

// ブラウザから自分のサーバー（/api/stocks/...）を呼ぶための小さな関数

export class ApiCallError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new ApiCallError("network", "アプリのサーバーに接続できませんでした。起動しているか確認してください。");
  }
  let body: { ok?: boolean; error?: { code: string; message: string } };
  try {
    body = await res.json();
  } catch {
    throw new ApiCallError("bad_response", `サーバーの応答を読み取れませんでした（HTTP ${res.status}）。`);
  }
  if (!body.ok) throw new ApiCallError(body.error?.code ?? "unknown", body.error?.message ?? "エラーが起きました。");
  return body as T;
}

export const apiGet = <T>(url: string) => call<T>(url);
export const apiSend = <T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) =>
  call<T>(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** 最近見た銘柄（このブラウザだけに保存） */
const RECENT_KEY = "fx-signal-lab:stocks:recent";
export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function pushRecent(code4: string): string[] {
  const next = [code4, ...loadRecent().filter((c) => c !== code4)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 保存できなくても動作は続ける */
  }
  return next;
}
