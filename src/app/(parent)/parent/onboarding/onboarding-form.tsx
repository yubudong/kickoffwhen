"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { SignOutButton } from "@/app/onboarding/sign-out-button";

type Stage = "family" | "pin" | "child";

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("REQUEST_FAILED");
}

export function OnboardingForm({
  defaultOwnerName,
  initialStage,
}: {
  defaultOwnerName: string;
  initialStage: Stage;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(initialStage);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: (form: FormData) => Promise<void>,
  ) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await action(new FormData(event.currentTarget));
    } catch {
      setError("暂时未能保存，请检查后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-card auth-card onboarding-card">
        <p className="eyebrow">家庭入门 · {stage === "family" ? "1" : stage === "pin" ? "2" : "3"}/3</p>
        <h1>把家庭学习空间准备好</h1>

        {stage === "family" ? (
          <form
            className="auth-form"
            onSubmit={(event) =>
              submit(event, async (form) => {
                await postJson("/api/parent/family", {
                  familyName: String(form.get("familyName")),
                  ownerName: String(form.get("ownerName")),
                });
                setStage("pin");
              })
            }
          >
            <label>
              家庭名称
              <input name="familyName" placeholder="例如：星河家庭" required />
            </label>
            <label>
              家长显示名
              <input defaultValue={defaultOwnerName} name="ownerName" required />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <button disabled={pending} type="submit">
              {pending ? "保存中…" : "下一步：设置家长 PIN"}
            </button>
          </form>
        ) : null}

        {stage === "pin" ? (
          <form
            className="auth-form"
            onSubmit={(event) =>
              submit(event, async (form) => {
                await postJson("/api/parent/pin", { pin: String(form.get("pin")) });
                setStage("child");
              })
            }
          >
            <p>进入家长管理操作时使用，请不要与儿童口令相同。</p>
            <label>
              6 位家长 PIN
              <input inputMode="numeric" maxLength={6} name="pin" pattern="\d{6}" required type="password" />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <button disabled={pending} type="submit">
              {pending ? "保存中…" : "下一步：创建孩子"}
            </button>
          </form>
        ) : null}

        {stage === "child" ? (
          <form
            className="auth-form"
            onSubmit={(event) =>
              submit(event, async (form) => {
                await postJson("/api/parent/children", {
                  nickname: String(form.get("nickname")),
                  avatarKey: String(form.get("avatarKey")),
                  grade: Number(form.get("grade")),
                  textbookEditionIds: form.getAll("textbookEditionIds").map(String),
                  childPin: String(form.get("childPin")) || undefined,
                });
                router.push("/parent/children");
                router.refresh();
              })
            }
          >
            <label>
              孩子昵称
              <input name="nickname" placeholder="只需家里常用的称呼" required />
            </label>
            <label>
              头像
              <select defaultValue="child-1" name="avatarKey">
                <option value="child-1">笑脸</option>
                <option value="rocket-blue">蓝色火箭</option>
                <option value="planet-yellow">黄色星球</option>
              </select>
            </label>
            <label>
              年级
              <select defaultValue="1" name="grade">
                {Array.from({ length: 12 }, (_, index) => (
                  <option key={index + 1} value={index + 1}>{index + 1} 年级</option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>教材选择</legend>
              <label><input name="textbookEditionIds" type="checkbox" value="cn-pep" />人教版语文</label>
              <label><input name="textbookEditionIds" type="checkbox" value="math-pep" />人教版数学</label>
            </fieldset>
            <label>
              可选儿童口令
              <input inputMode="numeric" maxLength={6} name="childPin" pattern="\d{6}" type="password" />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <button disabled={pending} type="submit">
              {pending ? "创建中…" : "创建孩子并完成"}
            </button>
          </form>
        ) : null}

        <div className="secondary-action"><SignOutButton /></div>
      </section>
    </main>
  );
}
