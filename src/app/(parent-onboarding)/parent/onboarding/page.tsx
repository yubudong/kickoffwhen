import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/app/(parent)/parent/onboarding/onboarding-form";
import { db } from "@/db/client";
import {
  familyOwnerActorFromSession,
  onboardingDestination,
  type FamilyOwnerActor,
} from "@/modules/auth/actor";
import { auth } from "@/modules/auth/server";
import { guardians } from "@/modules/families/schema";
import { getFamilySetupStage } from "@/modules/families/service";

export default async function ParentOnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const [membership] = session
    ? await db
        .select({
          id: guardians.id,
          familyId: guardians.familyId,
          isOwner: guardians.isOwner,
        })
        .from(guardians)
        .where(eq(guardians.authUserId, session.user.id))
        .limit(1)
    : [];
  const destination = onboardingDestination(session, membership ?? null);

  if (destination === "sign-in") redirect("/sign-in");
  if (destination === "onboarding") {
    return (
      <OnboardingForm
        defaultOwnerName={session!.user.name}
        initialStage="family"
      />
    );
  }

  let actor: FamilyOwnerActor;
  try {
    actor = await familyOwnerActorFromSession(session, membership!);
  } catch (error) {
    if (error instanceof Error && error.message === "FAMILY_OWNER_REQUIRED") {
      redirect("/");
    }
    throw error;
  }
  const stage = await getFamilySetupStage(actor);
  if (stage === "pin") {
    return (
      <OnboardingForm
        defaultOwnerName={session!.user.name}
        initialStage="pin"
      />
    );
  }
  if (stage === "child") {
    return (
      <OnboardingForm
        defaultOwnerName={session!.user.name}
        initialStage="child"
      />
    );
  }
  redirect("/parent/children");
}
