import { requireUserPage } from "@/lib/supabase/server";
import { getStats, listEntries } from "@/lib/db";
import { isAiEnabled } from "@/lib/ai/provider";
import { InboxView } from "@/components/inbox-view";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  // 先确认是谁，再取数：多用户下绝不能靠「查不到就是空」来兜底
  const { supabase, user } = await requireUserPage();
  const [entries, stats] = await Promise.all([
    listEntries(supabase, { userId: user.id, limit: 60 }),
    getStats(supabase, user.id),
  ]);

  return <InboxView initialEntries={entries} aiEnabled={isAiEnabled()} stats={stats} />;
}
