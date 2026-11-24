import { z } from "zod";
import { env } from "@/config/runtime";
import { requireParentActor } from "@/modules/auth/parent-access";
import { createDictationSessionService } from "@/modules/dictation/session-service";

export async function GET(request: Request) {
  let actor;
  try { actor = await requireParentActor(request.headers); }
  catch { return Response.json({ error: "请登录家长账号。" }, { status: 401 }); }
  return Response.json({ reviews: await createDictationSessionService().listParentReviews(actor) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  let actor;
  try { actor = await requireParentActor(request.headers); }
  catch { return Response.json({ error: "请登录家长账号。" }, { status: 401 }); }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env.appUrl).origin) return Response.json({ error: "请求来源无效。" }, { status: 403 });
  try {
    const input = z.object({ sessionId: z.string().uuid(), commandId: z.string().uuid(),
      expectedVersion: z.number().int().nonnegative(), roundNumber: z.number().int().positive(),
      marks: z.array(z.object({ itemId: z.string().uuid(), correct: z.boolean() }).strict()).min(1).max(200),
    }).strict().parse(await request.json());
    const result = await createDictationSessionService().submitBatchMarks(actor, input);
    return Response.json({ ok: true, phase: result.phase });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "请逐词标记全部题目。" : "批改状态已更新或保存未成功，请刷新后重试。" }, { status: error instanceof z.ZodError ? 400 : 409 });
  }
}
