"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { authClient } from "@/modules/auth/client";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setStatus("");

    const form = new FormData(event.currentTarget);
    const result = await authClient.signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
      callbackURL: "/onboarding",
    });

    setPending(false);
    if (result.error) {
      setError("注册未完成，请检查填写内容或直接登录。");
      return;
    }

    if (result.data.token === null) {
      setStatus("注册成功，请检查邮箱并完成验证。");
      return;
    }

    router.push("/onboarding");
    router.refresh();
  }

  return (
    <main className="page-shell">
      <section className="hero-card auth-card">
        <h1>注册家长账号</h1>
        <form className="auth-form" onSubmit={submit}>
          <label>
            称呼
            <input autoComplete="name" name="name" required />
          </label>
          <label>
            邮箱
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            密码
            <input autoComplete="new-password" minLength={8} name="password" required type="password" />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          {status ? <p role="status">{status}</p> : null}
          <button disabled={pending} type="submit">
            {pending ? "注册中…" : "注册"}
          </button>
        </form>
        <nav className="auth-links" aria-label="账号操作">
          <Link href="/sign-in">已有账号，去登录</Link>
        </nav>
      </section>
    </main>
  );
}
