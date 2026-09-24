import { z } from "zod";

import type { ChildActor } from "@/modules/auth/actor";
import type { ChildSessionView } from "@/modules/dictation/child-view-types";
import type { DictationSnapshot } from "@/modules/dictation/session-types";

const uuidSchema = z.string().uuid();
const base = {
  commandId: uuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  roundNumber: z.number().int().positive(),
};
const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("playback"),
    ...base,
    playedItemIds: z.array(uuidSchema).min(1),
    sequenceFinished: z.boolean(),
  }).strict(),
  z.object({
    type: z.literal("grading"),
    ...base,
    marks: z.array(z.object({ itemId: uuidSchema, correct: z.boolean() }).strict()).min(1),
  }).strict(),
]);

type Command = z.infer<typeof commandSchema>;
type Dependencies = {
  resolveActor: (request: Request) => Promise<ChildActor>;
  recordPlayback: (
    actor: ChildActor,
    input: Omit<Extract<Command, { type: "playback" }>, "type"> & { sessionId: string },
  ) => Promise<DictationSnapshot>;
  submitMarks: (
    actor: ChildActor,
    input: Omit<Extract<Command, { type: "grading" }>, "type"> & { sessionId: string },
  ) => Promise<DictationSnapshot>;
  getSession: (actor: ChildActor, sessionId: string) => Promise<ChildSessionView>;
  getSessionFromSnapshot?: (actor: ChildActor, snapshot: DictationSnapshot) => Promise<ChildSessionView>;
};

export function createChildSessionCommandHandler(dependencies: Dependencies) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ sessionId: string }> },
  ): Promise<Response> {
    let actor: ChildActor;
    try {
      actor = await dependencies.resolveActor(request);
    } catch {
      return Response.json({ error: "CHILD_SESSION_REQUIRED" }, { status: 401 });
    }
    let sessionId: string;
    let command: Command;
    try {
      ({ sessionId } = await context.params);
      sessionId = uuidSchema.parse(sessionId);
      command = commandSchema.parse(await request.json());
    } catch {
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    try {
      let snapshot: DictationSnapshot;
      if (command.type === "playback") {
        snapshot = await dependencies.recordPlayback(actor, {
          commandId: command.commandId,
          expectedVersion: command.expectedVersion,
          roundNumber: command.roundNumber,
          playedItemIds: command.playedItemIds,
          sequenceFinished: command.sequenceFinished,
          sessionId,
        });
      } else {
        snapshot = await dependencies.submitMarks(actor, {
          commandId: command.commandId,
          expectedVersion: command.expectedVersion,
          roundNumber: command.roundNumber,
          marks: command.marks,
          sessionId,
        });
      }
      const session = await (dependencies.getSessionFromSnapshot
        ? dependencies.getSessionFromSnapshot(actor, snapshot)
        : dependencies.getSession(actor, sessionId));
      if (snapshot.phase !== "completed" && session.phase === "completed") {
        return Response.json({ error: "SESSION_CHANGED", session }, { status: 409 });
      }
      return Response.json({ session });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "DICTATION_SESSION_NOT_FOUND") {
        return Response.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
      }
      if (message === "TASK_AUDIO_NOT_READY") {
        return Response.json({ error: "AUDIO_NOT_READY" }, { status: 409 });
      }
      if (["TASK_NOT_ACTIVE", "DICTATION_SESSION_NOT_ACTIVE"].includes(message)) {
        try {
          const session = await dependencies.getSession(actor, sessionId);
          if (session.phase === "completed") {
            return Response.json({ error: "SESSION_CHANGED", session }, { status: 409 });
          }
        } catch {
          // Cancelled, inconsistent, or no longer authorized lifecycles are deliberately hidden.
        }
        return Response.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
      }
      if (["DICTATION_VERSION_CONFLICT", "DICTATION_ROUND_CONFLICT"].includes(message)) {
        try {
          return Response.json(
            { error: "SESSION_CHANGED", session: await dependencies.getSession(actor, sessionId) },
            { status: 409 },
          );
        } catch {
          return Response.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
        }
      }
      if (message === "DICTATION_IDEMPOTENCY_CONFLICT") {
        return Response.json({ error: "COMMAND_CONFLICT" }, { status: 409 });
      }
      return Response.json({ error: "COMMAND_REJECTED" }, { status: 409 });
    }
  };
}

async function productionDependencies(): Promise<Dependencies> {
  const [{ requireChildActor }, { createDictationSessionService }, { childDictationViewService }] =
    await Promise.all([
      import("@/modules/devices/child-actor"),
      import("@/modules/dictation/session-service"),
      import("@/modules/dictation/child-view-service"),
    ]);
  const service = createDictationSessionService();
  return {
    resolveActor: requireChildActor,
    recordPlayback: service.recordPlayback,
    submitMarks: service.submitBatchMarks,
    getSession: childDictationViewService.getSession,
    getSessionFromSnapshot: childDictationViewService.getSessionFromSnapshot,
  };
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/child/dictation/[sessionId]/commands">,
) {
  return createChildSessionCommandHandler(await productionDependencies())(request, context);
}
