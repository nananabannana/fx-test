-- FX Signal Lab「株スイング」用テーブル
-- Supabase の SQL Editor に貼り付けて実行します。
--
-- 方針
-- - アプリはサーバー側（API Route）から service_role キーで読み書きする
-- - ブラウザから直接は触らせないため、RLS を有効にしてポリシーは作らない（anon キーでは何も読めない）
-- - J-Quants の生データもキャッシュとして保存し、無料プランの回数制限（1分5回）を節約する

-- 銘柄マスタ
create table if not exists stocks (
  code        text primary key,           -- 5桁コード（例: 72030）
  name        text not null default '',
  sector33    text not null default '',
  market      text not null default '',
  updated_at  timestamptz not null default now()
);

-- 日足（J-Quants /v2/equities/bars/daily のキャッシュ）
-- 分割などに対応するため、バックテストは調整後価格（adj_*）を使う
create table if not exists price_bars (
  code     text not null,
  date     date not null,
  o        numeric, h numeric, l numeric, c numeric, vo numeric, va numeric, -- va = 売買代金（円）
  adj_o    numeric, adj_h numeric, adj_l numeric, adj_c numeric, adj_vo numeric,
  primary key (code, date)
);

-- 決算・開示の数値（J-Quants /v2/fins/summary のキャッシュ）
create table if not exists disclosures (
  id          text primary key,           -- "{Code}-{DiscNo}"
  code        text not null,
  disc_date   date not null,
  disc_time   text not null default '',
  doc_type    text not null default '',
  period_type text not null default '',   -- 1Q, 2Q, 3Q, FY など
  raw         jsonb not null,             -- J-Quants の1行をそのまま保存
  created_at  timestamptz not null default now()
);
create index if not exists disclosures_code_date on disclosures (code, disc_date);

-- Claude による開示スコア（同じ開示でもモデルやプロンプトの版ごとに保存して比べられる）
create table if not exists disclosure_scores (
  id              text primary key,       -- "{disclosure_id}:{model}:{prompt_version}"
  disclosure_id   text not null references disclosures(id) on delete cascade,
  model           text not null,
  prompt_version  text not null,
  score           integer not null,       -- -10〜+10（0=中立）
  sub_scores      jsonb not null,         -- 項目別（-2〜+2）
  summary         text not null default '',
  reasons         jsonb not null default '[]',
  used_text       boolean not null default false, -- 短信本文を貼り付けて読ませたか
  created_at      timestamptz not null default now()
);
create index if not exists disclosure_scores_disc on disclosure_scores (disclosure_id);

-- バックテストの実行記録
create table if not exists backtest_runs (
  id          text primary key,
  params      jsonb not null,             -- ルール（損切り・利確・日数・スコア条件など）
  universe    jsonb not null,             -- 対象銘柄コード
  metrics     jsonb not null,             -- 勝率・期待値・最大DDなど
  created_at  timestamptz not null default now()
);

create table if not exists backtest_trades (
  id            text primary key,
  run_id        text not null references backtest_runs(id) on delete cascade,
  code          text not null,
  disclosure_id text not null,
  score         integer,
  trend         text not null,            -- up / neutral / down
  entry_date    date not null,
  entry_price   numeric not null,
  exit_date     date not null,
  exit_price    numeric not null,
  exit_reason   text not null,            -- stop / target / time / end
  shares        numeric not null,
  return_pct    numeric not null,
  r_multiple    numeric not null,
  pnl_yen       numeric not null
);
create index if not exists backtest_trades_run on backtest_trades (run_id);

-- 検証ログ（実弾なしの記録＝ペーパートレード）
create table if not exists paper_trades (
  id            text primary key,
  code          text not null,
  name          text not null default '',
  disclosure_id text,
  score         integer,
  trend         text not null,
  status        text not null default 'planned', -- planned（翌日寄り待ち）/ open / closed
  signal_date   date not null,            -- 判断した日（開示日など）
  entry_date    date,
  entry_price   numeric,
  stop_pct      numeric not null,
  target_pct    numeric not null,
  max_hold_days integer not null,
  shares        numeric not null default 0,
  exit_date     date,
  exit_price    numeric,
  exit_reason   text,
  return_pct    numeric,
  r_multiple    numeric,
  pnl_yen       numeric,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 取得履歴（同じデータを何度も取りに行かないため）
create table if not exists fetch_log (
  key         text primary key,           -- 例: "bars:72030"
  fetched_at  timestamptz not null default now()
);

-- RLS：有効化のみ（ポリシーなし＝ anon / authenticated からは読み書き不可）
alter table stocks            enable row level security;
alter table price_bars        enable row level security;
alter table disclosures       enable row level security;
alter table disclosure_scores enable row level security;
alter table backtest_runs     enable row level security;
alter table backtest_trades   enable row level security;
alter table paper_trades      enable row level security;
alter table fetch_log         enable row level security;
