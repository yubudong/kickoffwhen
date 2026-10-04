import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { DictationExperience } from "@/components/dictation/dictation-experience";
import { childDictationViewService } from "@/modules/dictation/child-view-service";
import { requireChildActor } from "@/modules/devices/child-actor";

export default async function ChildDictationPage({
  params,
}: PageProps<"/child/dictation/[sessionId]">) {
  let actor;
  try {
    actor = await requireChildActor(
      new Request("http://internal.local/child/dictation", { headers: await headers() }),
    );
  } catch {
    redirect("/child/switch");
  }
  const { sessionId } = await params;
  let session;
  try {
    session = await childDictationViewService.getSession(actor, sessionId);
  } catch (error) {
    if (error instanceof Error && error.message === "TASK_AUDIO_NOT_READY") {
      return (
        <main className="page-shell dictation-shell">
          <section className="dictation-card">
            <h1>音频还没准备好</h1>
            <p>请让家长准备好音频后，再回来开始听写。</p>
            <a className="dictation-primary" href="/child">返回今日任务</a>
          </section>
        </main>
      );
    }
    notFound();
  }
  return <DictationExperience initialSession={session} />;
}
