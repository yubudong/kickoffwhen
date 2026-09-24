import { pathToFileURL } from "node:url";

import nextEnvironment from "@next/env";

import { createConfiguredTtsProvider } from "./tts-runtime";

const IDLE_POLL_MS = 1_000;
const REVIEW_POLL_MS = 60_000;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function runWorker(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  nextEnvironment.loadEnvConfig(
    process.cwd(),
    process.env.NODE_ENV !== "production",
  );
  const [{ createJobWorker }, { privateMediaStore }, { createAutoReviewTaskService }] = await Promise.all([
    import("@/modules/jobs/worker"),
    import("@/modules/media/store"),
    import("@/modules/review/auto-review-task"),
  ]);
  const worker = createJobWorker({
    mediaStore: privateMediaStore,
    ttsProvider: createConfiguredTtsProvider(),
  });
  const autoReview = createAutoReviewTaskService();
  let nextReviewCheck = 0;
  while (!signal?.aborted) {
    if (Date.now() >= nextReviewCheck) {
      nextReviewCheck = Date.now() + REVIEW_POLL_MS;
      try {
        await autoReview.run();
      } catch (error) {
        console.error("Automatic review task check failed", error);
      }
    }
    const processed = await worker.runOnce();
    if (!processed) await wait(IDLE_POLL_MS);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  await runWorker(controller.signal);
}
