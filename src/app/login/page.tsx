import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { SetupNotice } from "@/components/setup-notice";
import { hasSupabaseEnv } from "@/lib/env";
import { isSignupOpen } from "@/lib/invite";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "登录",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <span className="neon-soft size-6 animate-pulse rounded-full bg-miku" />
        </div>
      }
    >
      {/* 只在服务端读一次环境变量：浏览器永远拿不到 INVITE_CODE 的值 */}
      <LoginForm signupOpen={isSignupOpen()} />
    </Suspense>
  );
}
