"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/modules/auth/client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <button disabled={pending} onClick={signOut} type="button">
      {pending ? "退出中…" : "退出登录"}
    </button>
  );
}
