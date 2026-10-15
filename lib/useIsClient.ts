"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** ブラウザで表示しているときだけ true（サーバーで作る最初の HTML では false） */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

/** 現在時刻（イベント処理の中で使う。描画中には呼ばない） */
export const nowMs = () => Date.now();
