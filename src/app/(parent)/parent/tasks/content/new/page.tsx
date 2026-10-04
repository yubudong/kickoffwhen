import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireParentActor } from "@/modules/auth/parent-access";
import { getFamilySetupStage } from "@/modules/families/service";

import { ContentEntryForm } from "../../../content/new/content-entry-form";

export default async function NewContentPage() {
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
  return <ContentEntryForm />;
}
