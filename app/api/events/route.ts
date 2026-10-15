// 主要指標イベントの一覧（data/events.json を毎回読み直す。書き換えてもサーバーの再起動は不要）

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEvents, type FxEvent } from "@/lib/conditions";

export const dynamic = "force-dynamic";

export type EventsResponse =
  | { ok: true; events: FxEvent[]; errors: string[] }
  | { ok: false; error: { code: string; message: string } };

export async function GET() {
  const file = path.join(process.cwd(), "data", "events.json");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return json({ ok: true, events: [], errors: ["data/events.json がありません。"] });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return json({ ok: false, error: { code: "bad_json", message: "data/events.json の書き方（JSON）に誤りがあります。カンマや引用符を確認してください。" } }, 500);
  }
  const { events, errors } = parseEvents(raw);
  return json({ ok: true, events, errors });
}

function json(body: EventsResponse, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
