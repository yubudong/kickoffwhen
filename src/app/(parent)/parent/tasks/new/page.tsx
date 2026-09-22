import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireParentActor } from "@/modules/auth/parent-access";
import { createTaskBuilderQueryService } from "@/modules/dictation/task-builder-query";
import { getFamilySetupStage } from "@/modules/families/service";

import { TaskBuilderForm } from "./task-builder-form";

export default async function NewTaskPage() {
  let actor;
  try {
    actor = await requireParentActor(await headers());
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") redirect("/sign-in");
    if (error instanceof Error && error.message === "GUARDIAN_MEMBERSHIP_REQUIRED") redirect("/onboarding");
    if (error instanceof Error && error.message === "FAMILY_OWNER_REQUIRED") redirect("/");
    if (error instanceof Error && error.message === "PARENT_UNLOCK_INVALID") redirect("/parent-unlock");
    throw error;
  }
  if ((await getFamilySetupStage(actor)) !== "complete") redirect("/parent/onboarding");

  const data = await createTaskBuilderQueryService().getTaskBuilderData(actor);

  return (
    <main className="stack">
      <div>
        <p className="eyebrow">学习任务</p>
        <h1>创建今日听写</h1>
        <p>到期复习会自动优先，新内容由家长选择。音频未就绪时任务会清楚标记为准备中。</p>
      </div>
      <TaskBuilderForm
        childOptions={data.children}
        cards={data.cards}
      />
    </main>
  );
}
