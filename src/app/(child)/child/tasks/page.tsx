import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ChildHeader } from "@/components/child/child-header";
import { ChildTaskList } from "@/components/dictation/child-task-list";
import { childDictationViewService } from "@/modules/dictation/child-view-service";
import { requireChildActor } from "@/modules/devices/child-actor";
import { getChildProfile } from "@/modules/devices/service";

export default async function ChildTasksPage() {
  let actor;
  try {
    actor = await requireChildActor(new Request("http://internal.local/child/tasks", { headers: await headers() }));
  } catch {
    redirect("/child/switch");
  }
  const [child, tasks] = await Promise.all([
    getChildProfile(actor),
    childDictationViewService.listTasks(actor),
  ]);
  return (
    <div className="child-shell">
      <ChildHeader avatarKey={child.avatarKey} nickname={child.nickname} />
      <main className="page-shell child-page-shell">
        <section className="hero-card child-home-card">
          <h1>{child.nickname}的今日任务</h1>
          <ChildTaskList tasks={tasks} />
        </section>
      </main>
    </div>
  );
}
