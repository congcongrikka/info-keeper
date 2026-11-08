import { requireUserPage } from "@/lib/supabase/server";
import { getStats, listReviews } from "@/lib/db";
import { isAiEnabled } from "@/lib/ai/provider";
import { InsightsView } from "@/components/insights-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "洞察" };

export default async function InsightsPage() {
  const { supabase, user } = await requireUserPage();
  const [reviews, stats] = await Promise.all([
    listReviews(supabase, user.id),
    getStats(supabase, user.id),
  ]);

  return <InsightsView initialReviews={reviews} aiEnabled={isAiEnabled()} total={stats.total} />;
}
