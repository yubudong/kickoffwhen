import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ChildHeader } from "@/components/child/child-header";
import { ChildTaskList } from "@/components/dictation/child-task-list";
import { childDictationViewService } from "@/modules/dictation/child-view-service";
import { requireChildActor } from "@/modules/devices/child-actor";
import { getChildProfile } from "@/modules/devices/service";

export default async function ChildHomePage() {
  const requestHeaders = await headers();
  let actor;
  try {
    actor = await requireChildActor(
      new Request("http://internal.local/child", { headers: requestHeaders }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "CHILD_SESSION_INVALID") {
      redirect("/child/switch");
    }
    throw error;
  }
  const child = await getChildProfile(actor);
  const tasks = await childDictationViewService.listTasks(actor);

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
