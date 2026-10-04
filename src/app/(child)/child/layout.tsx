import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ChildPageShowGuard } from "@/components/child/child-pageshow-guard";

import { requireChildActor } from "@/modules/devices/child-actor";
import {
  CHILD_SESSION_COOKIE,
  DEVICE_TOKEN_COOKIE,
} from "@/modules/devices/token";

export default async function ChildLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const rawChildSession = cookieStore.get(CHILD_SESSION_COOKIE)?.value;
  if (!rawChildSession) {
    if (!cookieStore.get(DEVICE_TOKEN_COOKIE)?.value) redirect("/pair");
    redirect("/child/switch");
  }

  try {
    await requireChildActor(
      new Request("http://internal.local/child", {
        headers: await headers(),
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "CHILD_SESSION_INVALID") {
      redirect("/child/switch");
    }
    throw error;
  }

  return <><ChildPageShowGuard />{children}</>;
}
