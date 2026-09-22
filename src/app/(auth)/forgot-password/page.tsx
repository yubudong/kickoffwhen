"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { authClient } from "@/modules/auth/client";

const genericMessage = "如果该邮箱存在，重置邮件已发送。";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);

    const form = new FormData(event.currentTarget);
    await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: "/reset-password",
    });

    setPending(false);
    setMessage(genericMessage);
  }

  return (
    <main className="page-shell">
      <section className="hero-card auth-card">
        <h1>重置密码</h1>
        <p>填写邮箱，我们会发送后续指引。</p>
        <form className="auth-form" onSubmit={submit}>
          <label>
            邮箱
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <button disabled={pending} type="submit">
            {pending ? "发送中…" : "发送重置邮件"}
          </button>
          {message ? <p role="status">{message}</p> : null}
        </form>
        <nav className="auth-links" aria-label="账号操作">
          <Link href="/sign-in">返回登录</Link>
        </nav>
      </section>
    </main>
  );
}
