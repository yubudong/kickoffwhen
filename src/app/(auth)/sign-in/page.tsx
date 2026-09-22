"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { authClient } from "@/modules/auth/client";

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });

    setPending(false);
    if (result.error) {
      setError("邮箱或密码不正确。");
      return;
    }

    router.push("/parent");
    router.refresh();
  }

  return (
    <main className="page-shell">
      <section className="hero-card auth-card">
        <h1>家长登录</h1>
        <form className="auth-form" onSubmit={submit}>
          <label>
            邮箱
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            密码
            <input autoComplete="current-password" minLength={8} name="password" required type="password" />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <button disabled={pending} type="submit">
            {pending ? "登录中…" : "登录"}
          </button>
        </form>
        <nav className="auth-links" aria-label="账号操作">
          <Link href="/sign-up">注册家长账号</Link>
          <Link href="/forgot-password">忘记密码</Link>
        </nav>
      </section>
    </main>
  );
}
