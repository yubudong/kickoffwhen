import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireParentActor } from "@/modules/auth/parent-access";
import { getFamilySetupStage } from "@/modules/families/service";

export default async function ParentPage() {
  const requestHeaders = await headers();
  try {
    const actor = await requireParentActor(requestHeaders);
    if ((await getFamilySetupStage(actor)) !== "complete") {
      redirect("/parent/onboarding");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "GUARDIAN_MEMBERSHIP_REQUIRED"
    ) {
      redirect("/onboarding");
    }
    if (
      error instanceof Error &&
      error.message === "AUTHENTICATION_REQUIRED"
    ) {
      redirect("/sign-in");
    }
    if (error instanceof Error && error.message === "PARENT_UNLOCK_INVALID") {
      redirect("/parent-unlock");
    }
    if (error instanceof Error && error.message === "FAMILY_OWNER_REQUIRED") {
      redirect("/");
    }
    throw error;
  }

  return (
    <main className="page-shell parent-page-shell">
      <section className="hero-card">
        <p className="eyebrow">家长中心</p>
        <h1>家长中心</h1>
        <p>家庭学习概览将在后续阶段开放。</p>
      </section>
    </main>
  );
}
