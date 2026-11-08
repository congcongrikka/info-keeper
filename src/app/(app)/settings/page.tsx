import { requireUserPage } from "@/lib/supabase/server";
import { getStats } from "@/lib/db";
import { isAiEnabled } from "@/lib/ai/provider";
import { isEmailConfigured } from "@/lib/email";
import { isPushConfigured } from "@/lib/push";
import { SettingsView } from "@/components/settings-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "设置" };

export default async function SettingsPage() {
  const { supabase, user } = await requireUserPage();
  const stats = await getStats(supabase, user.id);

  return (
    <SettingsView
      email={user.email ?? ""}
      userId={user.id}
      aiEnabled={isAiEnabled()}
      aiModel={process.env.AI_MODEL ?? "deepseek-chat"}
      stats={stats}
      pushConfigured={isPushConfigured()}
      // 公钥本来就是公开的（浏览器订阅时要用），这里显式传给前端，不靠 NEXT_PUBLIC_ 构建期内联
      vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
      emailConfigured={isEmailConfigured()}
    />
  );
}
