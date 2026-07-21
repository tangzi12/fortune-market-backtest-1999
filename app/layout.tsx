import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "年运历史回测 · 命理信号 × 真实K线",
  description: "从1999年起，以年K与节气月K检验股票年运、月运信号的历史同步程度。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "年运历史回测 · 命理信号 × 真实K线",
    description: "覆盖 S&P 500 与 Nasdaq-100 共 518 只股票，对照复权年K与节气月K验证历史同步程度。",
    locale: "zh_CN",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "年运历史回测" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "年运历史回测 · 命理信号 × 真实K线",
    description: "固定参数，对照 1999 年以来真实复权行情检验股票年运与月运。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
