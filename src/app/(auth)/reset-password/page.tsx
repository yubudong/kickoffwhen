"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { authClient } from "@/modules/auth/client";

export default function ResetPasswordPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setPending(false);
      setError("重置链接无效或已过期。");
      return;
    }

    const form = new FormData(event.currentTarget);
    const result = await authClient.resetPassword({
      newPassword: String(form.get("password")),
      token,
    });

    setPending(false);
    if (result.error) {
      setError("重置链接无效或已过期。");
      return;
    }

    setMessage("密码已更新，请重新登录。");
  }

  return (
    <main className="page-shell">
      <section className="hero-card auth-card">
        <h1>设置新密码</h1>
        <form className="auth-form" onSubmit={submit}>
          <label>
            新密码
            <input autoComplete="new-password" minLength={8} name="password" required type="password" />
          </label>
          <button disabled={pending || Boolean(message)} type="submit">
            {pending ? "更新中…" : "更新密码"}
          </button>
          {error ? <p role="alert">{error}</p> : null}
          {message ? <p role="status">{message}</p> : null}
        </form>
        <nav className="auth-links" aria-label="账号操作">
          <Link href="/sign-in">返回登录</Link>
        </nav>
      </section>
    </main>
  );
}
