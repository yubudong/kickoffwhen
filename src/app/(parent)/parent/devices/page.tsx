import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { FamilyOwnerActor } from "@/modules/auth/actor";
import { requireParentActor } from "@/modules/auth/parent-access";
import { listDevices } from "@/modules/devices/service";
import { getFamilySetupStage, listChildren } from "@/modules/families/service";

import { DevicesManager } from "./devices-manager";

export default async function DevicesPage() {
  let actor: FamilyOwnerActor;
  try {
    actor = await requireParentActor(await headers());
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      redirect("/sign-in");
    }
    if (
      error instanceof Error &&
      error.message === "GUARDIAN_MEMBERSHIP_REQUIRED"
    ) {
      redirect("/onboarding");
    }
    if (error instanceof Error && error.message === "FAMILY_OWNER_REQUIRED") {
      redirect("/");
    }
    if (error instanceof Error && error.message === "PARENT_UNLOCK_INVALID") {
      redirect("/parent-unlock");
    }
    throw error;
  }
  if ((await getFamilySetupStage(actor)) !== "complete") {
    redirect("/parent/onboarding");
  }

  const [children, devices] = await Promise.all([
    listChildren(actor),
    listDevices(actor),
  ]);
  return (
    <DevicesManager
      availableChildren={children.filter((child) => child.active)}
      initialDevices={devices.map((device) => ({
        ...device,
        lastActiveAt: device.lastActiveAt.toISOString(),
        revokedAt: device.revokedAt?.toISOString() ?? null,
      }))}
    />
  );
}
