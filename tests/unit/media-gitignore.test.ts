import { spawnSync } from "node:child_process";

import { expect, test } from "vitest";

test("默认私密媒体目录不会被Git纳入版本控制", () => {
  const result = spawnSync("git", ["check-ignore", "var/media/example.mp3"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("var/media/example.mp3");
});
