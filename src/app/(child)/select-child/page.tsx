import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ProfileSelector } from "@/components/child/profile-selector";
import { listAuthorizedChildren } from "@/modules/devices/service";
import { DEVICE_TOKEN_COOKIE } from "@/modules/devices/token";

export default async function SelectChildPage() {
  const rawDeviceToken = (await cookies()).get(DEVICE_TOKEN_COOKIE)?.value;
  if (!rawDeviceToken) redirect("/pair");

  let availableChildren;
  try {
    availableChildren = await listAuthorizedChildren(rawDeviceToken);
  } catch (error) {
    if (error instanceof Error && error.message === "DEVICE_INVALID") {
      redirect("/pair");
    }
    throw error;
  }
  return <ProfileSelector availableChildren={availableChildren} />;
}
