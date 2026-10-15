import { PredictNav } from "./PredictNav";

export const metadata = { title: "短期予測｜FX Signal Lab" };

export default function PredictLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm">
        <p className="text-xs leading-relaxed text-muted">
          <b className="text-ink">短期予測（デモ・検証専用）</b>：USD/JPY の5分後・10分後を数値モデルで予測します。実際の注文は送りません。予測精度や利益を保証するものではありません。
        </p>
        <PredictNav />
      </div>
      {children}
    </div>
  );
}
