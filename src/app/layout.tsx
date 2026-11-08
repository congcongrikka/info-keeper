import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/service-worker";

export const metadata: Metadata = {
  applicationName: "信息管家",
  title: {
    default: "信息管家 · 把零散的想法收进一处",
    template: "%s · 信息管家",
  },
  description:
    "个人知识管家：随手记录想法、资料与待办，自动分类摘要、关联相关内容，支持智能问答、阶段总结与一键备份。邀请制，每个人的记录只有自己能看见。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "信息管家",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  other: {
    // 两个都要写：Android/Chrome 认标准的 mobile-web-app-capable，
    // iOS Safari 至今仍只认带 apple- 前缀的那个。缺了 apple 这个，
    // iPhone 从主屏图标打开会退回「带地址栏的 Safari」，navigator.standalone 为 false，
    // 网页推送也就跟着不可用 —— 而这正是 iOS 上开每日早报的硬门槛。
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e1e2e",
  width: "device-width",
  initialScale: 1,
  // maximumScale: 5 保留用户双指缩放的能力（无障碍要求）。
  // 输入框聚焦时的自动放大已经由 globals.css 里的 16px 兜底规则解决，
  // 不需要靠 user-scalable=no 止血——那会牺牲视力不好的用户。
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh antialiased">
        <div className="relative z-0 min-h-dvh">{children}</div>
        <ServiceWorker />
      </body>
    </html>
  );
}
