"use client";

import { type FormEvent, useState } from "react";

import type { Child } from "@/modules/families/service";

export function ChildrenManager({ initialChildren }: { initialChildren: Child[] }) {
  const [children, setChildren] = useState(initialChildren);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch("/api/parent/children", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nickname: String(form.get("nickname")),
        avatarKey: String(form.get("avatarKey")),
        grade: Number(form.get("grade")),
        textbookEditionIds: form.getAll("textbookEditionIds").map(String),
        childPin: String(form.get("childPin")) || undefined,
      }),
    });
    setPending(false);
    if (!response.ok) {
      setError("暂时未能创建，请检查后重试。");
      return;
    }
    const payload = (await response.json()) as { child: Child };
    setChildren((current) => [...current, payload.child]);
    formElement.reset();
  }

  return (
    <main className="page-shell children-shell">
      <section className="hero-card children-card">
        <p className="eyebrow">家长中心</p>
        <h1>孩子档案</h1>
        <div className="child-grid">
          {children.map((child) => (
            <article className="child-tile" key={child.id}>
              <span aria-hidden="true" className="avatar-badge">{child.avatarKey === "rocket-blue" ? "🚀" : "🌟"}</span>
              <strong>{child.nickname}</strong>
              <span>{child.grade} 年级</span>
            </article>
          ))}
        </div>
        <h2>添加孩子</h2>
        <form className="auth-form" onSubmit={create}>
          <label>孩子昵称<input name="nickname" required /></label>
          <label>头像<select defaultValue="child-1" name="avatarKey"><option value="child-1">笑脸</option><option value="rocket-blue">蓝色火箭</option></select></label>
          <label>年级<select defaultValue="1" name="grade">{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 年级</option>)}</select></label>
          <fieldset><legend>教材选择</legend><label><input name="textbookEditionIds" type="checkbox" value="cn-pep" />人教版语文</label><label><input name="textbookEditionIds" type="checkbox" value="math-pep" />人教版数学</label></fieldset>
          <label>可选儿童口令<input inputMode="numeric" maxLength={6} name="childPin" pattern="\d{6}" type="password" /></label>
          {error ? <p role="alert">{error}</p> : null}
          <button disabled={pending} type="submit">{pending ? "创建中…" : "添加孩子"}</button>
        </form>
      </section>
    </main>
  );
}
