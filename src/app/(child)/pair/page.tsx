"use client";

import { type FormEvent, useState } from "react";

export default function PairPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/child/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: String(form.get("code")),
        label: String(form.get("label")),
      }),
    });
    setPending(false);
    if (!response.ok) {
      setError("配对码无效或已过期，请让家长重新生成。");
      return;
    }
    window.location.replace("/child/switch");
  }

  return (
    <main className="page-shell">
      <section className="hero-card auth-card">
        <p className="eyebrow">连接家庭学习空间</p>
        <h1>配对这台设备</h1>
        <form className="auth-form" onSubmit={pair}>
          <label>
            配对码
            <input autoCapitalize="characters" autoComplete="one-time-code" name="code" required />
          </label>
          <label>
            设备名称
            <input name="label" placeholder="例如：客厅 iPad" required />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <button disabled={pending} type="submit">
            {pending ? "连接中…" : "连接设备"}
          </button>
        </form>
      </section>
    </main>
  );
}
