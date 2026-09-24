"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function ParentUnlockForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const pin = String(new FormData(event.currentTarget).get("pin"));
    const response = await fetch("/api/parent/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    setPending(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(
        payload?.error === "DEVICE_INVALID"
          ? "这台设备已失效，请重新配对。"
          : "家长 PIN 不正确或暂时已锁定。",
      );
      return;
    }

    router.replace("/parent");
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={unlock}>
      <label>
        6 位家长 PIN
        <input
          autoComplete="off"
          inputMode="numeric"
          maxLength={6}
          name="pin"
          pattern="\d{6}"
          required
          type="password"
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={pending} type="submit">
        {pending ? "验证中…" : "进入家长模式"}
      </button>
    </form>
  );
}
