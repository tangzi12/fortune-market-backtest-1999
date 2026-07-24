import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "191只一年十倍股 · M0年度预测全表",
  description: "逐只披露191个一年十倍事件的滚动主用神M0年度预测、历史资格、分数与捕获结果。",
};

export default function TenbaggerM0Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
