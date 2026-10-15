"use client";

// 予測モデル：学習と、学習に使っていない期間でのテスト結果

import { useEffect, useState } from "react";
import { useIsClient } from "@/lib/useIsClient";
import type { ModelResult, TrainResult } from "@/lib/predict/types";
import { DEFAULT_SETTINGS, HORIZONS, type FxModel, type HorizonModel } from "@/lib/predict/model";
import { CLASS_LABEL, CLASSES } from "@/lib/predict/evaluate";
import { REGIME_LABEL, type Regime } from "@/lib/predict/features";
import { Button, Card, ErrorBox, Kpi, Notice, Spinner } from "@/components/stocks/ui";
import { fmtDateTime, pct } from "@/components/predict/parts";
import { CalibrationTable, ConfusionTable } from "@/components/predict/tables";

export default function ModelPage() {
  const isClient = useIsClient();
  if (!isClient) return <p className="py-10 text-center text-sm text-muted">読み込み中…</p>;
  return <ModelView />;
}

function ModelView() {
  const [state, setState] = useState<ModelResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [minPips, setMinPips] = useState(String(DEFAULT_SETTINGS.flatMinPips));
  const [atrK, setAtrK] = useState(String(DEFAULT_SETTINGS.flatAtrK));

  const load = () =>
    fetch("/api/predict/model", { cache: "no-store" })
      .then((r) => r.json() as Promise<ModelResult>)
      .then(setState)
      .catch(() => setState({ ok: false, error: { code: "network", message: "モデルの状態を読み込めませんでした。" } }));
  useEffect(() => {
    load();
  }, []);

  const train = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/predict/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { flatMinPips: Number(minPips), flatAtrK: Number(atrK) } }),
      });
      const body = (await res.json()) as TrainResult;
      if (body.ok) {
        setDone(`学習が終わりました（モデル ${body.model.version}・API ${body.calls}回）。`);
        await load();
      } else setError(body.error.message);
    } catch {
      setError("アプリのサーバーに接続できませんでした（学習には1〜2分かかります）。");
    } finally {
      setBusy(false);
    }
  };

  const model = state?.ok ? state.model : null;

  return (
    <div className="space-y-4">
      <Card title="学習">
        <p className="mb-3 text-sm leading-relaxed text-ink/85">
          Twelve Data から直近約1か月の1分足を取得し（保存済みの分は取得しない）、古い約3週間で学習 → 新しい約1週間でテストします。
          初回は API を約9回使い、無料枠を守るため間隔をあけるので1〜2分かかります。2回目からは足りない期間だけ取得します。
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted">横ばいの最小幅（pips）
            <input type="number" min={0} max={20} step={0.1} value={minPips} onChange={(e) => setMinPips(e.target.value)}
              className="num mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">横ばいの幅の係数（× 1分足ATR × √分）
            <input type="number" min={0} max={3} step={0.05} value={atrK} onChange={(e) => setAtrK(e.target.value)}
              className="num mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
          </label>
          <div className="flex items-end">
            <Button variant="primary" onClick={train} disabled={busy || (state?.ok && state.training)}>
              {busy && <Spinner />}{busy ? "学習中…（1〜2分）" : model ? "再学習する" : "学習する"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          横ばいの幅 = max(最小幅, 係数 × 1分足ATR × √予測分数)。この幅より小さい変化を「横ばい」とします。スプレッドは使わない設定のため、幅には含めていません。
          幅を変えると予測の対象そのものが変わるので、変えたら再学習が必要です（記録にはモデルの名前が残ります）。
        </p>
        {state?.ok && (
          <p className="mt-2 text-[11px] text-muted">
            保存済みの1分足：{state.history.candles.toLocaleString()}本
            {state.history.from && state.history.to && `（${fmtDateTime(state.history.from)}〜${fmtDateTime(state.history.to)}）`}
          </p>
        )}
        {error && <div className="mt-3"><ErrorBox message={error} /></div>}
        {done && <div className="mt-3"><Notice>{done}</Notice></div>}
      </Card>

      {!state ? (
        <p className="text-sm text-muted">読み込み中…</p>
      ) : !state.ok ? (
        <ErrorBox message={state.error.message} />
      ) : !model ? (
        <Notice>まだモデルがありません。上の「学習する」を押してください。</Notice>
      ) : (
        <ModelReport m={model} />
      )}
    </div>
  );
}

function ModelReport({ m }: { m: FxModel }) {
  return (
    <>
      <Card title={`いまのモデル：${m.version}`}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {[
            ["方式", "多クラスのロジスティック回帰（上昇・横ばい・下降）"],
            ["学習した日時", fmtDateTime(m.createdAt)],
            ["データ", `${m.data.source}・1分足 ${m.data.candles.toLocaleString()}本（${fmtDateTime(m.data.from)}〜${fmtDateTime(m.data.to)}）`],
            ["学習期間", `${fmtDateTime(m.split.trainFrom)}〜${fmtDateTime(m.split.trainTo)}`],
            ["テスト期間（学習に使っていない）", `${fmtDateTime(m.split.testFrom)}〜${fmtDateTime(m.split.testTo)}`],
            ["横ばいの幅", `max(${m.settings.flatMinPips} pips, ${m.settings.flatAtrK} × ATR × √分)`],
            ["高ボラティリティの境目", `5分足ATR ${m.regime.atr5Pips} pips 以上（学習期間の上位20%）`],
            ["特徴量", `${m.featureNames.length}個（変化率・EMA/SMA乖離・RSI・MACD・ATR比・レンジ位置・高値安値の切り上げ/切り下げ・ブレイク・一方向性・時間帯）`],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-xs text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          データリークの防止：各時点の特徴量はその時点までの足だけで計算し、5分足・15分足は確定した足だけを使います。時間順に分けて、テスト開始の直前（予測分数ぶん）は学習から外しています。
          標準化の平均・ばらつきも学習期間だけから計算しています。テストは予測分数おきの重ならない時点で評価しています。
        </p>
      </Card>
      {HORIZONS.map((h) => <HorizonReport key={h} h={h} hm={m.horizons[h]} />)}
    </>
  );
}

function HorizonReport({ h, hm }: { h: number; hm: HorizonModel }) {
  const t = hm.test;
  const better = t.brier !== null && t.baseline.brier !== null && t.brier < t.baseline.brier;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {h}分後のテスト結果
          {hm.provisional ? (
            <span className="rounded border border-hold/50 px-1.5 py-px text-[10px] font-normal text-hold">確率は暫定の推定値</span>
          ) : (
            <span className="rounded border border-up/40 px-1.5 py-px text-[10px] font-normal text-up">テストの基準を満たす</span>
          )}
        </span>
      }
    >
      {hm.provisional && (
        <div className="mb-3">
          <Notice tone="warn">暫定の理由：{hm.provisionalReasons.join("／")}</Notice>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="テスト件数" value={`${t.n.toLocaleString()}件`} hint={`学習 ${t.trainN.toLocaleString()}件`} />
        <Kpi label="的中率" value={pct(t.accuracy)} hint={`基準（いつも「${CLASS_LABEL[t.baseline.majority]}」）${pct(t.baseline.accuracy)}`} />
        <Kpi label="ブライアスコア" value={t.brier?.toFixed(3) ?? "—"} tone={better ? "up" : "down"} hint={`基準 ${t.baseline.brier?.toFixed(3) ?? "—"}（小さいほど良い）`} />
        <Kpi label="較正誤差" value={pct(t.ece)} hint="5%以下が目安" />
      </dl>
      <p className="mt-2 text-[11px] text-muted">
        学習期間の比率：{CLASSES.map((c, i) => `${CLASS_LABEL[c]} ${pct(hm.trainShare[i], 0)}`).join("・")}。
        相場状態別の的中率：{(["trend", "range", "highvol"] as Regime[]).map((g) => `${REGIME_LABEL[g]} ${pct(t.byRegime[g].accuracy, 0)}（${t.byRegime[g].n}件）`).join("・")}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-semibold text-muted">混同行列（テスト期間）</h3>
          <ConfusionTable confusion={t.confusion} />
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold text-muted">確率の正確さ（テスト期間）</h3>
          <CalibrationTable bins={t.calibration} />
        </div>
      </div>
    </Card>
  );
}
