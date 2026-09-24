import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ParentNav } from "@/components/parent/parent-nav";
import {
  hasDeviceCredential,
  resolveParentAccess,
} from "@/modules/auth/parent-access";

export default async function ParentLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const requestHeaders = await headers();
  let accessMode: "guardian" | "device";
  try {
    accessMode = (await resolveParentAccess(requestHeaders)).mode;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "GUARDIAN_MEMBERSHIP_REQUIRED"
    ) {
      redirect("/onboarding");
    }
    if (
      error instanceof Error &&
      ["AUTHENTICATION_REQUIRED", "PARENT_UNLOCK_INVALID"].includes(
        error.message,
      )
    ) {
      redirect(
        hasDeviceCredential(requestHeaders) ? "/parent-unlock" : "/sign-in",
      );
    }
    if (error instanceof Error && error.message === "FAMILY_OWNER_REQUIRED") {
      redirect("/");
    }
    throw error;
  }

  return (
    <div className="parent-shell">
      <ParentNav accessMode={accessMode} />
      {children}
    </div>
  );
}
