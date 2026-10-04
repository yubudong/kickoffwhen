import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ContentLibraryTree } from "@/components/content/content-library-tree";
import { requireParentActor } from "@/modules/auth/parent-access";
import { getFamilySetupStage } from "@/modules/families/service";
import { createLearningContentService } from "@/modules/learning-content/service";

export default async function ContentPage() {
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
  if ((await getFamilySetupStage(actor)) === "pin") redirect("/parent/onboarding");

  const library = await createLearningContentService().listContentLibrary(actor);
  return (
    <main className="page-shell content-shell">
      <section className="hero-card content-card">
        <p className="eyebrow">家长中心</p>
        <h1>听写内容库</h1><nav className="parent-nav"><Link href="/parent/tasks/new">布置听写</Link><Link href="/parent/tasks/content">听写内容库</Link></nav>
        <p>当前家庭已有 {library.total} 张可用学习卡片。</p>
        <Link className="primary-link" href="/parent/tasks/content/new">添加听写内容库</Link>
        <ContentLibraryTree library={library} />
      </section>
    </main>
  );
}
