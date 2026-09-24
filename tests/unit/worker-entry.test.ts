import { expect, test } from "vitest";

test("worker入口在外部Provider未配置时可安全加载并响应停止信号", async () => {
  const { runWorker } = await import("@/worker/index");
  const controller = new AbortController();
  controller.abort();

  await expect(runWorker(controller.signal)).resolves.toBeUndefined();
});
