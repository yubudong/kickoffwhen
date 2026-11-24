import { requireParentActor } from "@/modules/auth/parent-access";
import { requireChildActor } from "@/modules/devices/child-actor";
import { createDictationSessionService } from "@/modules/dictation/session-service";
import { attachmentResponse } from "@/modules/todos/attachments";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireParentActor(request.headers); }
  catch {
    try { actor = await requireChildActor(request); }
    catch { return new Response(null, { status: 401 }); }
  }
  try {
    const { id } = await context.params;
    const photo = await createDictationSessionService().photoForActor(actor, id);
    return await attachmentResponse(id, photo.mimeType, request.headers.get("range"));
  } catch { return new Response(null, { status: 404 }); }
}
