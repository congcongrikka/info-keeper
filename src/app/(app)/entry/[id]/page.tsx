import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient, requireUserPage } from "@/lib/supabase/server";
import { getEntry, listRelated } from "@/lib/db";
import { isAiEnabled } from "@/lib/ai/provider";
import { EntryDetail } from "@/components/entry-detail";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "记录" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // 未登录时不查库：不给匿名请求留下「这个 id 存不存在」的差异信号
  if (!user) return { title: "记录" };

  const entry = await getEntry(supabase, id, user.id);
  return { title: entry?.title ?? "记录" };
}

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { supabase, user } = await requireUserPage();
  const entry = await getEntry(supabase, id, user.id);
  // 别人的 id 和不存在的 id 走同一条路：都给 404，不泄露存在性
  if (!entry) notFound();

  const related = await listRelated(supabase, id, user.id);

  return <EntryDetail entry={entry} related={related} aiEnabled={isAiEnabled()} />;
}
