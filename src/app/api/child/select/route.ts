import { NextResponse } from "next/server";
import { z } from "zod";

import { selectChild } from "@/modules/devices/service";
import {
  CHILD_SESSION_COOKIE,
  DEVICE_TOKEN_COOKIE,
  readCookie,
  tokenCookieOptions,
} from "@/modules/devices/token";

const inputSchema = z.object({
  childId: z.string().uuid(),
  childPin: z.string().regex(/^\d{6}$/).optional(),
});

export async function POST(request: Request) {
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ error: "INVALID_CHILD_SELECTION" }, { status: 400 });
  }
  const rawDeviceToken = readCookie(request, DEVICE_TOKEN_COOKIE);
  if (!rawDeviceToken) {
    return NextResponse.json({ error: "DEVICE_INVALID" }, { status: 401 });
  }

  try {
    const selected = await selectChild(
      rawDeviceToken,
      input.data.childId,
      input.data.childPin,
    );
    const response = NextResponse.json({ selected: true });
    response.cookies.set(
      CHILD_SESSION_COOKIE,
      selected.rawChildSessionToken,
      {
        ...tokenCookieOptions(process.env.NODE_ENV),
        maxAge: 30 * 24 * 60 * 60,
      },
    );
    return response;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (error.message === "DEVICE_INVALID") {
      return NextResponse.json({ error: "DEVICE_INVALID" }, { status: 401 });
    }
    if (error.message === "CHILD_ACCESS_DENIED") {
      return NextResponse.json({ error: "CHILD_ACCESS_DENIED" }, { status: 403 });
    }
    if (error.message === "CHILD_PIN_REQUIRED") {
      return NextResponse.json({ error: "CHILD_PIN_REQUIRED" }, { status: 428 });
    }
    if (error.message === "CHILD_PIN_INVALID") {
      return NextResponse.json({ error: "CHILD_PIN_INVALID" }, { status: 403 });
    }
    throw error;
  }
}
