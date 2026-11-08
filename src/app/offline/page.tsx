import Link from "next/link";
import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "离线" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="neon-soft flex size-14 items-center justify-center rounded-2xl bg-miku/15 text-miku">
        <WifiOff className="size-6" strokeWidth={1.6} />
      </div>
      <p className="mt-5 text-[20px] font-semibold text-bright">现在没有网络</p>
      <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-faint">
        已看过的内容还能翻，但新的记录要联网才能保存和同步。等信号回来再试。
      </p>
      <Link
        href="/"
        className="neon-soft mt-6 rounded-full bg-miku px-4 py-2 text-[12.5px] font-medium text-night transition hover:neon"
      >
        返回
      </Link>
    </div>
  );
}
