import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PredictionProvider } from "@/lib/store";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "FX Signal Lab（デモ）",
  description: "USD/JPY の短期の方向分析と、日本株の決算×トレンド検証を行う個人用アプリ（分析・検証専用）。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh">
        <PredictionProvider>
          <Header />
          <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs leading-relaxed text-muted sm:px-6">
            本アプリは分析・検証専用です。取引・発注・口座連携の機能はありません。FX のサンプルモードの価格は架空のデータ、
            実データは Twelve Data、日本株は J-Quants から取得しますが、遅延や欠落がありえます。予測・スコア・バックテストの結果は
            過去データに基づく参考値で、将来の値動きや利益を保証するものではありません。
          </footer>
        </PredictionProvider>
      </body>
    </html>
  );
}
