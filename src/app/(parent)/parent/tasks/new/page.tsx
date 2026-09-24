import Link from "next/link";
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
        <h1>今日听写</h1><nav className="parent-nav"><Link href="/parent/tasks/new">布置听写</Link><Link href="/parent/tasks/content">听写内容库</Link></nav><p>布置后自动加入孩子的今日待办，听写完成后交由家长审核。</p>
        <p>到期词会自动生成单独的复习任务；新内容按教材单元或课次选择。</p>
      </div>
      <TaskBuilderForm
        childOptions={data.children}
        cards={data.cards}
        catalog={data.catalog}
      />
    </main>
  );
}
