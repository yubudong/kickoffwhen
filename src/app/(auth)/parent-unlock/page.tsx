import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireFamilyOwnerActor } from "@/modules/auth/actor";
import { listAuthorizedChildren } from "@/modules/devices/service";
import { DEVICE_TOKEN_COOKIE } from "@/modules/devices/token";

import { ParentUnlockForm } from "./parent-unlock-form";

export default async function ParentUnlockPage() {
  try {
    await requireFamilyOwnerActor(await headers());
    redirect("/parent");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      ![
        "AUTHENTICATION_REQUIRED",
        "GUARDIAN_MEMBERSHIP_REQUIRED",
        "FAMILY_OWNER_REQUIRED",
      ].includes(error.message)
    ) {
      throw error;
    }
  }

  const rawDeviceToken = (await cookies()).get(DEVICE_TOKEN_COOKIE)?.value;
  if (!rawDeviceToken) redirect("/sign-in");
  try {
    await listAuthorizedChildren(rawDeviceToken);
  } catch (error) {
    if (error instanceof Error && error.message === "DEVICE_INVALID") {
      redirect("/pair");
    }
    throw error;
  }

  return (
    <main className="page-shell">
      <section className="hero-card auth-card">
        <p className="eyebrow">家长保护</p>
        <h1>进入家长模式</h1>
        <p>验证该家庭独立的家长 PIN，本次解锁有效 15 分钟。</p>
        <ParentUnlockForm />
      </section>
    </main>
  );
}
