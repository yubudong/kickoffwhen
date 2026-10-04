import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { onboardingDestination } from "@/modules/auth/actor";
import { auth } from "@/modules/auth/server";
import { guardians } from "@/modules/families/schema";

export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const [membership] = session
    ? await db
        .select({ id: guardians.id, familyId: guardians.familyId })
        .from(guardians)
        .where(eq(guardians.authUserId, session.user.id))
        .limit(1)
    : [];

  const destination = onboardingDestination(session, membership ?? null);
  if (destination === "sign-in") redirect("/sign-in");
  redirect("/parent/onboarding");
}
