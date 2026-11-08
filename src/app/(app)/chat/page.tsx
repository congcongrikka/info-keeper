import { requireUserPage } from "@/lib/supabase/server";
import { getStats } from "@/lib/db";
import { isAiEnabled } from "@/lib/ai/provider";
import { ChatPanel } from "@/components/chat-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "问答" };

export default async function ChatPage() {
  const { supabase, user } = await requireUserPage();
  const stats = await getStats(supabase, user.id);

  return (
    <ChatPanel
      entryCount={stats.total}
      aiEnabled={isAiEnabled()}
      email={user.email ?? "you@example.com"}
    />
  );
}
