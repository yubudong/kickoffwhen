import { z } from "zod";

import type { ChildSessionView } from "./child-view-types";

const uuidSchema = z.string().uuid();

const recoveryDraftSchema = z.object({
  schemaVersion: z.literal(1),
  familyId: uuidSchema,
  childId: uuidSchema,
  sessionId: uuidSchema,
  roundNumber: z.number().int().positive(),
  serverVersion: z.number().int().nonnegative(),
  marks: z.record(uuidSchema, z.boolean()),
}).strict();

export type RecoveryDraft = z.infer<typeof recoveryDraftSchema>;
export type RecoveryScope = Omit<RecoveryDraft, "schemaVersion" | "marks"> & {
  completed?: boolean;
  allowedItemIds?: string[];
};

export function recoveryStorageKey(
  familyId: string,
  childId: string,
  sessionId: string,
): string {
  return `dictation:${familyId}:${childId}:${sessionId}`;
}

export function serializeRecoveryDraft(
  draft: Omit<RecoveryDraft, "schemaVersion">,
): string {
  return JSON.stringify(recoveryDraftSchema.parse({ schemaVersion: 1, ...draft }));
}

export function readRecoveryDraft(
  raw: string | null,
  scope: RecoveryScope,
): RecoveryDraft | null {
  if (!raw || scope.completed) return null;
  try {
    const draft = recoveryDraftSchema.parse(JSON.parse(raw));
    const allowed = scope.allowedItemIds ? new Set(scope.allowedItemIds) : null;
    return draft.familyId === scope.familyId &&
      draft.childId === scope.childId &&
      draft.sessionId === scope.sessionId &&
      draft.roundNumber === scope.roundNumber &&
      draft.serverVersion === scope.serverVersion &&
      (!allowed || Object.keys(draft.marks).every((itemId) => allowed.has(itemId)))
      ? draft
      : null;
  } catch {
    return null;
  }
}

export type CommandRetryState = Readonly<{ commandId: string }>;
export type PendingCommand = Readonly<{ commandId: string; serializedPayload: string }>;

export function createPendingCommand(
  body: Record<string, unknown>,
  commandId = crypto.randomUUID(),
): PendingCommand {
  const validCommandId = uuidSchema.parse(commandId);
  return { commandId: validCommandId, serializedPayload: JSON.stringify({ ...body, commandId: validCommandId }) };
}

export function pendingCommandMatches(pending: PendingCommand, body: Record<string, unknown>) {
  return pending.serializedPayload === JSON.stringify({ ...body, commandId: pending.commandId });
}

export function reconcileAuthoritativeCommand(
  session: ChildSessionView,
  state: {
    retryCommand: PendingCommand | null;
    retryLocked: boolean;
    dirtyMarks: boolean;
  },
) {
  const completed = session.phase === "completed";
  return {
    retryCommand: null,
    retryLocked: false,
    dirtyMarks: completed ? false : state.dirtyMarks,
    clearRecovery: completed,
  } as const;
}

export function createCommandRetryState(commandId = crypto.randomUUID()): CommandRetryState {
  return { commandId: uuidSchema.parse(commandId) };
}

export function settleCommandSuccess(
  _state: CommandRetryState,
  nextCommandId = crypto.randomUUID(),
): CommandRetryState {
  return createCommandRetryState(nextCommandId);
}
