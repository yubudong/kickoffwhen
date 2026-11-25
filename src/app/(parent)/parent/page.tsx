import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireParentActor } from "@/modules/auth/parent-access";
import { ParentActionCenter } from '@/components/engagement/parent-action-center';
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
      <ParentActionCenter />
    </main>
  );
}
