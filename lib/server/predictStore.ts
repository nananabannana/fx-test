// 短期予測の保存先（サーバー専用）：.data/ フォルダに JSON で保存（手元で使う前提）
// - fx-history-1m.json：学習用の1分足（直近約1か月）
// - fx-models/<version>.json：学習したモデル。current.json がいま使うモデル
import "server-only";

import { promises as fs } from "fs";
import path from "path";
import type { Candle } from "../types";
import type { FxModel } from "../predict/model";

const DIR = path.join(process.cwd(), ".data");
const HISTORY = path.join(DIR, "fx-history-1m.json");
const MODELS = path.join(DIR, "fx-models");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value));
  await fs.rename(tmp, file);
}

export async function loadHistory(): Promise<Candle[]> {
  const v = await readJson<Candle[]>(HISTORY);
  return Array.isArray(v) ? v : [];
}

export const saveHistory = (c: Candle[]) => writeJson(HISTORY, c);

const g = globalThis as unknown as { __fxModelCache?: { model: FxModel | null; at: number } | null };

export async function loadModel(): Promise<FxModel | null> {
  const hit = g.__fxModelCache;
  if (hit && Date.now() - hit.at < 30_000) return hit.model;
  const m = await readJson<FxModel>(path.join(MODELS, "current.json"));
  const model = m && m.kind === "lr1" && m.horizons?.[5] && m.horizons?.[10] ? m : null;
  g.__fxModelCache = { model, at: Date.now() };
  return model;
}

export async function saveModel(m: FxModel) {
  await writeJson(path.join(MODELS, `${m.version}.json`), m);
  await writeJson(path.join(MODELS, "current.json"), m);
  g.__fxModelCache = { model: m, at: Date.now() };
}
