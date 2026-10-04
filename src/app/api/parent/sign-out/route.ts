import { NextResponse } from "next/server";

import { revokeParentUnlock } from "@/modules/devices/parent-mode-access";
import {
  PARENT_UNLOCK_COOKIE,
  readCookie,
  tokenCookieOptions,
} from "@/modules/devices/token";

export async function POST(request: Request) {
  const rawUnlockToken = readCookie(request, PARENT_UNLOCK_COOKIE);
  if (rawUnlockToken) await revokeParentUnlock(rawUnlockToken);

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(PARENT_UNLOCK_COOKIE, "", {
    ...tokenCookieOptions(process.env.NODE_ENV),
    maxAge: 0,
  });
  return response;
}
