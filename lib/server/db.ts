// 保存先の切り替え（サーバー専用）
// - SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY があれば Supabase に保存
// - なければ、プロジェクト直下の .data/ フォルダに JSON で保存（手元で試す用。Vercel では使えない）
import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type TableName =
  | "stocks"
  | "price_bars"
  | "disclosures"
  | "disclosure_scores"
  | "backtest_runs"
  | "backtest_trades"
  | "paper_trades"
  | "fetch_log";

/** 各テーブルの主キー（upsert のときに使う） */
const KEYS: Record<TableName, string[]> = {
  stocks: ["code"],
  price_bars: ["code", "date"],
  disclosures: ["id"],
  disclosure_scores: ["id"],
  backtest_runs: ["id"],
  backtest_trades: ["id"],
  paper_trades: ["id"],
  fetch_log: ["key"],
};

type Row = Record<string, unknown>;
type Value = string | number | boolean | null;

export type SelectOptions = {
  eq?: Record<string, Value>;
  in?: { column: string; values: Value[] };
  order?: { column: string; ascending?: boolean };
  limit?: number;
};

export interface Db {
  kind: "supabase" | "local";
  upsert(table: TableName, rows: Row[]): Promise<void>;
  select<T = Row>(table: TableName, opts?: SelectOptions): Promise<T[]>;
  remove(table: TableName, eq: Record<string, Value>): Promise<void>;
}

export class DbError extends Error {}

let instance: Db | null = null;

export function getDb(): Db {
  if (instance) return instance;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  instance = url && key ? new SupabaseDb(createClient(url, key, { auth: { persistSession: false } })) : new LocalDb();
  return instance;
}

// ---------------- Supabase ----------------

class SupabaseDb implements Db {
  kind = "supabase" as const;
  constructor(private client: SupabaseClient) {}

  async upsert(table: TableName, rows: Row[]) {
    // 一度に送りすぎないよう 500 行ずつ
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.client
        .from(table)
        .upsert(rows.slice(i, i + 500), { onConflict: KEYS[table].join(",") });
      if (error) throw new DbError(`Supabase への保存に失敗しました（${table}）：${error.message}`);
    }
  }

  async select<T = Row>(table: TableName, opts: SelectOptions = {}): Promise<T[]> {
    // Supabase は1回に最大1000行なので、ページを分けて全部読む
    const page = 1000;
    const out: T[] = [];
    for (let from = 0; ; from += page) {
      let q = this.client.from(table).select("*");
      for (const [k, v] of Object.entries(opts.eq ?? {})) q = q.eq(k, v as string);
      if (opts.in) q = q.in(opts.in.column, opts.in.values as string[]);
      if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? true });
      const end = opts.limit ? Math.min(from + page, opts.limit) - 1 : from + page - 1;
      const { data, error } = await q.range(from, end);
      if (error) throw new DbError(`Supabase の読み込みに失敗しました（${table}）：${error.message}`);
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < page || (opts.limit && out.length >= opts.limit)) break;
    }
    return out;
  }

  async remove(table: TableName, eq: Record<string, Value>) {
    let q = this.client.from(table).delete();
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v as string);
    const { error } = await q;
    if (error) throw new DbError(`Supabase の削除に失敗しました（${table}）：${error.message}`);
  }
}

// ---------------- ローカル JSON ----------------

const DATA_DIR = path.join(process.cwd(), ".data");

class LocalDb implements Db {
  kind = "local" as const;
  private cache = new Map<TableName, Row[]>();
  private queue: Promise<unknown> = Promise.resolve();

  private file(table: TableName) {
    return path.join(DATA_DIR, `${table}.json`);
  }

  private async load(table: TableName): Promise<Row[]> {
    const hit = this.cache.get(table);
    if (hit) return hit;
    let rows: Row[] = [];
    try {
      rows = JSON.parse(await fs.readFile(this.file(table), "utf8")) as Row[];
    } catch {
      rows = [];
    }
    this.cache.set(table, rows);
    return rows;
  }

  private async save(table: TableName, rows: Row[]) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = this.file(table) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(rows));
    await fs.rename(tmp, this.file(table));
    this.cache.set(table, rows);
  }

  /** 書き込みを1つずつ順番に行う（同時書き込みで壊れないように） */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  upsert(table: TableName, rows: Row[]) {
    return this.serial(async () => {
      const keys = KEYS[table];
      const current = await this.load(table);
      const index = new Map(current.map((r, i) => [keys.map((k) => String(r[k])).join("|"), i]));
      const next = current.slice();
      for (const row of rows) {
        const k = keys.map((key) => String(row[key])).join("|");
        const i = index.get(k);
        if (i === undefined) {
          index.set(k, next.length);
          next.push(row);
        } else {
          next[i] = { ...next[i], ...row };
        }
      }
      await this.save(table, next);
    });
  }

  async select<T = Row>(table: TableName, opts: SelectOptions = {}): Promise<T[]> {
    let rows = await this.load(table);
    for (const [k, v] of Object.entries(opts.eq ?? {})) rows = rows.filter((r) => r[k] === v);
    if (opts.in) {
      const set = new Set(opts.in.values);
      rows = rows.filter((r) => set.has(r[opts.in!.column] as Value));
    }
    if (opts.order) {
      const { column, ascending = true } = opts.order;
      rows = rows.slice().sort((a, b) => {
        const x = a[column] as string | number;
        const y = b[column] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows as T[];
  }

  remove(table: TableName, eq: Record<string, Value>) {
    return this.serial(async () => {
      const rows = await this.load(table);
      await this.save(
        table,
        rows.filter((r) => !Object.entries(eq).every(([k, v]) => r[k] === v)),
      );
    });
  }
}
