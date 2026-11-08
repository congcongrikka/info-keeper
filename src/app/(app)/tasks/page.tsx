import { requireUserPage } from "@/lib/supabase/server";
import { listOpenTasks } from "@/lib/db";
import { isAiEnabled } from "@/lib/ai/provider";
import { TasksView } from "@/components/tasks-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "待办" };

export default async function TasksPage() {
  const { supabase, user } = await requireUserPage();
  const tasks = await listOpenTasks(supabase, user.id, 80);

  return <TasksView initialTasks={tasks} aiEnabled={isAiEnabled()} />;
}
