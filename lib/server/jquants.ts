// J-Quants API V2 クライアント（サーバー専用）
// - 認証は x-api-key ヘッダー
// - プランごとの回数制限（Free: 1分5回 / Light: 1分60回）に合わせて、自動で間隔をあける
// - pagination_key があれば続きを取りに行く
import "server-only";

const BASE = "https://api.jquants.com/v2";

export type JQuantsErrorCode = "no_key" | "invalid_key" | "rate_limit" | "plan" | "upstream" | "network";

export class JQuantsError extends Error {
  constructor(
    public code: JQuantsErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function jquantsPlan(): "free" | "light" | "standard" | "premium" {
  const p = (process.env.JQUANTS_PLAN || "free").toLowerCase();
  return p === "light" || p === "standard" || p === "premium" ? p : "free";
}

const RPM: Record<ReturnType<typeof jquantsPlan>, number> = { free: 5, light: 60, standard: 120, premium: 500 };

// 回数制限のための待ち行列（サーバー全体で共有）
let nextSlot = 0;
async function waitTurn() {
  const interval = Math.ceil(60_000 / RPM[jquantsPlan()]) + 300; // 少し余裕をもたせる
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + interval;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** GET して data 配列をすべて返す（ページ分割にも対応） */
export async function jquantsGet<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string>,
): Promise<T[]> {
  const apiKey = process.env.JQUANTS_API_KEY;
  if (!apiKey) {
    throw new JQuantsError("no_key", "J-Quants のAPIキーが設定されていません。.env.local に JQUANTS_API_KEY=（キー）を書いて再起動してください。");
  }
  const base = process.env.JQUANTS_API_BASE || BASE;
  const out: T[] = [];
  let paginationKey: string | undefined;
  let retried = false;

  for (let page = 0; page < 50; page++) {
    const url = new URL(base.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (paginationKey) url.searchParams.set("pagination_key", paginationKey);

    await waitTurn();
    let res: Response;
    try {
      res = await fetch(url, { headers: { "x-api-key": apiKey }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new JQuantsError("network", "J-Quants API に接続できませんでした。");
    }

    if (res.status === 429 && !retried) {
      // 回数制限にかかったら、1分待って1回だけやり直す
      retried = true;
      nextSlot = Date.now() + 61_000;
      page--;
      continue;
    }

    let body: { data?: T[]; pagination_key?: string; message?: string };
    try {
      body = await res.json();
    } catch {
      throw new JQuantsError("upstream", `J-Quants API の応答を読み取れませんでした（HTTP ${res.status}）。`);
    }

    if (!res.ok) {
      const msg = body?.message ?? "";
      if (res.status === 401 || res.status === 403) {
        if (/plan|subscription|契約|プラン/i.test(msg)) {
          throw new JQuantsError("plan", `今のプランでは使えないデータです（${msg}）。`);
        }
        throw new JQuantsError("invalid_key", "J-Quants のAPIキーが正しくないか、権限がありません。");
      }
      if (res.status === 429) {
        throw new JQuantsError("rate_limit", "J-Quants の回数制限にかかりました。1分ほど待ってからやり直してください。");
      }
      if (res.status === 400 && /plan|subscription|契約|プラン|期間/i.test(msg)) {
        throw new JQuantsError("plan", `今のプランで取得できる範囲外です（${msg}）。`);
      }
      throw new JQuantsError("upstream", `J-Quants API がエラーを返しました（HTTP ${res.status}${msg ? `：${msg}` : ""}）。`);
    }

    out.push(...(body.data ?? []));
    paginationKey = body.pagination_key || undefined;
    if (!paginationKey) break;
  }
  return out;
}

/** 文字列や空欄を数値に（空なら null） */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
