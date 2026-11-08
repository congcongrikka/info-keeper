import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { isAiEnabled } from "@/lib/ai/provider";
import { AppShell } from "@/components/app-shell";
import { SetupNotice } from "@/components/setup-notice";
import { hasSupabaseEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 没配置 Supabase 时给出可操作的引导，而不是白屏 500
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const user = await getUser();
  if (!user) redirect("/login");

  return (
    <AppShell email={user.email ?? "我"} aiEnabled={isAiEnabled()}>
      {children}
    </AppShell>
  );
}
