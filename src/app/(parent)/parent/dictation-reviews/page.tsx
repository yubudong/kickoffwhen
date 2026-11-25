import Link from 'next/link';
import { headers } from "next/headers";
import { requireParentActor } from "@/modules/auth/parent-access";
import { createDictationSessionService } from "@/modules/dictation/session-service";
import { ParentReviewBoard } from "@/components/dictation/parent-review-board";
export default async function DictationReviewsPage() {
  const actor = await requireParentActor(await headers());
  const reviews = await createDictationSessionService().listParentReviews(actor);
  return <main className="page-shell"><section className="hero-card dictation-review-shell"><p className="eyebrow">家长中心</p><h1>听写批改</h1><p>查看孩子上传的照片，逐词核对听写结果。</p><p><Link href="/parent/keyboard-dictation">键盘听写复核与报告 →</Link></p><ParentReviewBoard initialReviews={reviews} /></section></main>;
}
