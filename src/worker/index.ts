import { pathToFileURL } from "node:url";

import nextEnvironment from "@next/env";

import { createConfiguredTtsProvider } from "./tts-runtime";

const IDLE_POLL_MS = 1_000;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function runWorker(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  nextEnvironment.loadEnvConfig(
    process.cwd(),
    process.env.NODE_ENV !== "production",
  );
  const [{ createJobWorker }, { privateMediaStore }] = await Promise.all([
    import("@/modules/jobs/worker"),
    import("@/modules/media/store"),
  ]);
  const worker = createJobWorker({
    mediaStore: privateMediaStore,
    ttsProvider: createConfiguredTtsProvider(),
  });
  while (!signal?.aborted) {
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
