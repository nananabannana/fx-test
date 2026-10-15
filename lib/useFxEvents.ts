"use client";

// data/events.json（主要指標イベント）を読み込む

import { useEffect, useState } from "react";
import type { FxEvent } from "./conditions";
import type { EventsResponse } from "@/app/api/events/route";

export type EventsState =
  | { status: "loading" }
  | { status: "ok"; events: FxEvent[]; errors: string[] }
  | { status: "error"; message: string };

export function useFxEvents(): EventsState {
  const [state, setState] = useState<EventsState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    fetch("/api/events", { cache: "no-store" })
      .then((r) => r.json() as Promise<EventsResponse>)
      .then((b) => {
        if (!alive) return;
        setState(b.ok ? { status: "ok", events: b.events, errors: b.errors } : { status: "error", message: b.error.message });
      })
      .catch(() => alive && setState({ status: "error", message: "イベント一覧を読み込めませんでした。" }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
