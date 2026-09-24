import { createHash, randomBytes } from "node:crypto";

export const DEVICE_TOKEN_COOKIE = "family_learning_device";
export const CHILD_SESSION_COOKIE = "family_learning_child_session";
export const PARENT_UNLOCK_COOKIE = "family_learning_parent_unlock";

export const createOpaqueToken = () => randomBytes(32).toString("base64url");

export const hashOpaqueToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const cookieName = item.slice(0, separator).trim();
    if (cookieName !== name) continue;
    const value = item.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function tokenCookieOptions(
  nodeEnv: "development" | "test" | "production",
) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: nodeEnv === "production",
    path: "/",
  };
}
