"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/modules/auth/client";

export function ParentSignOutButton({
  accessMode,
}: {
  accessMode: "guardian" | "device";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setPending(true);
    setError("");
    try {
      const unlockResponse = await fetch("/api/parent/sign-out", {
        method: "POST",
      });
      if (!unlockResponse.ok) throw new Error("PARENT_SIGN_OUT_FAILED");

      if (accessMode === "guardian") {
        const result = await authClient.signOut();
        if (result.error) throw new Error("PARENT_SIGN_OUT_FAILED");
        router.replace("/sign-in");
        router.refresh();
      } else {
        window.location.replace("/child/switch");
      }
    } catch {
      setPending(false);
      setError("暂时无法退出，请重试。");
    }
  }

  return (
    <>
      <button disabled={pending} onClick={signOut} type="button">
        {pending
          ? "退出中…"
          : accessMode === "guardian"
            ? "退出登录"
            : "退出家长模式"}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </>
  );
}
