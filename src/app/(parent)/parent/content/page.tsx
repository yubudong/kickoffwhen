import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireParentActor } from "@/modules/auth/parent-access";
import { getFamilySetupStage } from "@/modules/families/service";
import { listCards } from "@/modules/learning-content/service";

export default async function ContentPage() {
  let actor;
  try {
    actor = await requireParentActor(await headers());
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") redirect("/sign-in");
    if (error instanceof Error && error.message === "GUARDIAN_MEMBERSHIP_REQUIRED") redirect("/onboarding");
    if (error instanceof Error && error.message === "FAMILY_OWNER_REQUIRED") redirect("/");
    if (error instanceof Error && error.message === "PARENT_UNLOCK_INVALID") redirect("/parent-unlock");
    throw error;
  }
  if ((await getFamilySetupStage(actor)) === "pin") redirect("/parent/onboarding");

  const cards = await listCards(actor, {});
  return (
    <main className="page-shell content-shell">
      <section className="hero-card content-card">
        <p className="eyebrow">家长中心</p>
        <h1>学习内容</h1>
        <p>当前家庭已有 {cards.length} 张可用学习卡片。</p>
        <Link className="primary-link" href="/parent/content/new">添加学习内容</Link>
        <div className="card-list">
          {cards.length === 0 ? <p>还没有学习卡片。可从单条输入或批量粘贴开始。</p> : cards.map((card) => <article className="card-row" key={card.id}><strong>{card.answerText}</strong><span>{card.subject === "chinese" ? "语文" : "英语"} · {card.source}</span></article>)}
        </div>
      </section>
    </main>
  );
}
