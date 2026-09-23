import { z } from "zod";

import {
  parentTaskPostResponseSchema,
  parentTaskBatchPostResponseSchema,
  type ParentTaskPostResponse,
  type ParentTaskBatchPostResponse,
} from "./task-types";

export type TaskSubmissionResult<T> =
  | { status: "busy" }
  | { status: "failed"; error: unknown }
  | { status: "succeeded"; value: T };

export function createTaskSubmissionController(
  createCommandId: () => string = () => crypto.randomUUID(),
) {
  let commandId = createCommandId();
  let inFlight = false;

  async function submit<T>(
    send: (stableCommandId: string) => Promise<T>,
  ): Promise<TaskSubmissionResult<T>> {
    if (inFlight) return { status: "busy" };
    inFlight = true;
    const stableCommandId = commandId;
    try {
      const value = await send(stableCommandId);
      commandId = createCommandId();
      return { status: "succeeded", value };
    } catch (error) {
      return { status: "failed", error };
    } finally {
      inFlight = false;
    }
  }

  return {
    getCommandId: () => commandId,
    submit,
  };
}

const taskErrorResponseSchema = z.object({
  error: z.string().min(1),
}).passthrough();

export async function readTaskCreationResponse(
  response: Response,
): Promise<ParentTaskPostResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("TASK_CREATE_RESPONSE_INVALID");
  }
  if (!response.ok) {
    const error = taskErrorResponseSchema.safeParse(body);
    throw new Error(error.success ? error.data.error : "TASK_CREATE_FAILED");
  }
  const result = parentTaskPostResponseSchema.safeParse(body);
  if (!result.success) throw new Error("TASK_CREATE_RESPONSE_INVALID");
  return result.data;
}

export async function readTaskBatchCreationResponse(response: Response): Promise<ParentTaskBatchPostResponse> {
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("TASK_CREATE_RESPONSE_INVALID"); }
  if (!response.ok) {
    const error = taskErrorResponseSchema.safeParse(body);
    throw new Error(error.success ? error.data.error : "TASK_CREATE_FAILED");
  }
  const result = parentTaskBatchPostResponseSchema.safeParse(body);
  if (!result.success) throw new Error("TASK_CREATE_RESPONSE_INVALID");
  return result.data;
}
