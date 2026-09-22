import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const startupModule = new URL("../../src/config/startup.ts", import.meta.url).href;

function isolatedEnvironment() {
  const environment = { ...process.env };
  for (const name of [
    "NODE_ENV",
    "DATABASE_URL",
    "APP_URL",
    "BETTER_AUTH_SECRET",
    "SMTP_URL",
    "MEDIA_ROOT",
    "AUTH_TEST_EMAIL_ENABLED",
    "AUTH_TEST_EMAIL_SECRET",
    "__NEXT_PROCESSED_ENV",
  ]) {
    delete environment[name];
  }
  return environment;
}

test(
  "pnpm start 未显式提供 NODE_ENV 时仍在监听前拒绝缺少 SMTP",
  async () => {
    const environment = isolatedEnvironment();
    Object.assign(environment, {
      DATABASE_URL: "postgres://app:app@127.0.0.1:5433/family_learning_test",
      APP_URL: "https://family.example.test",
      BETTER_AUTH_SECRET: "start-entry-only-secret-12345678901234567890",
    });

    const child = spawn("pnpm", ["start"], {
      cwd: projectRoot,
      detached: true,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";

    const outcome = await new Promise<{
      code: number | null;
      kind: "exit" | "ready" | "timeout";
    }>((resolve) => {
      const timer = setTimeout(
        () => resolve({ code: null, kind: "timeout" }),
        8_000,
      );
      const receive = (chunk: Buffer) => {
        output += chunk.toString();
        if (/\bReady\b|\bLocal:\s/.test(output)) {
          clearTimeout(timer);
          resolve({ code: null, kind: "ready" });
        }
      };
      child.stdout.on("data", receive);
      child.stderr.on("data", receive);
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve({ code, kind: "exit" });
      });
    });

    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The process group already exited.
      }
    }

    expect(outcome.kind).toBe("exit");
    expect(outcome.code).not.toBe(0);
    expect(output).toContain("SMTP_URL_REQUIRED");
    expect(output).not.toMatch(/\bReady\b|\bLocal:\s/);
  },
  15_000,
);

test("预检从隔离目录加载 .env.production", () => {
  const directory = mkdtempSync(join(tmpdir(), "auth-production-env-"));
  try {
    writeFileSync(
      join(directory, ".env.production"),
      [
        "DATABASE_URL=postgres://app:app@127.0.0.1:5433/family_learning_test",
        "APP_URL=https://family.example.test",
        "BETTER_AUTH_SECRET=env-file-only-secret-1234567890123456789012",
        "SMTP_URL=smtp://127.0.0.1:2525",
      ].join("\n"),
    );

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "--eval",
        `import { validateProductionStartup } from ${JSON.stringify(startupModule)}; validateProductionStartup(${JSON.stringify(directory)});`,
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: isolatedEnvironment(),
        timeout: 8_000,
      },
    );

    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
