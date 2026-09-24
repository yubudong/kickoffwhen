import { access, constants, mkdir } from "node:fs/promises";

export async function checkReadiness(input: {
  checkDatabase: () => Promise<void>;
  mediaRoot: string;
}) {
  try {
    await input.checkDatabase();
  } catch {
    throw new Error("DATABASE_UNAVAILABLE");
  }

  try {
    await mkdir(input.mediaRoot, { recursive: true });
    await access(input.mediaRoot, constants.R_OK | constants.W_OK);
  } catch {
    throw new Error("MEDIA_ROOT_UNAVAILABLE");
  }

  return { status: "ready" as const };
}
