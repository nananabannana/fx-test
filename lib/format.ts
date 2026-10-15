import type { Direction, Outcome } from "./types";

const timeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatTime = (ms: number) => timeFmt.format(ms);
export const formatDateTime = (ms: number) => dateTimeFmt.format(ms);
export const formatPrice = (n: number) => n.toFixed(3);
export const formatPips = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

export const DIRECTION_LABEL: Record<Direction, string> = {
  up: "上昇",
  down: "下落",
  hold: "判断保留",
};

export const ACTUAL_LABEL: Record<Direction, string> = {
  up: "上昇",
  down: "下落",
  hold: "横ばい",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  match: "一致",
  miss: "不一致",
  excluded: "対象外",
  pending: "確認待ち",
  unavailable: "取得できず",
};
