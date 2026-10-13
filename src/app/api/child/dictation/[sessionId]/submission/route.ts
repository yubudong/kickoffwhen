import { requireChildActor } from "@/modules/devices/child-actor";
import { env } from "@/config/runtime";
import { childDictationViewService } from "@/modules/dictation/child-view-service";
import { createDictationSessionService } from "@/modules/dictation/session-service";
import { createDictationSubmissionHandler } from "@/modules/dictation/submission-http";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const service = createDictationSessionService();
  return createDictationSubmissionHandler({ resolveActor: requireChildActor,
    getSession: childDictationViewService.getSession, submitPhotos: service.submitPhotos,
    submissionPhotos: service.submissionPhotos, appOrigin: new URL(env.appUrl).origin })(request, context);
}
