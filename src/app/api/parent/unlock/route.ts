import { NextResponse } from "next/server";
import { z } from "zod";

import { unlockWithParentPin } from "@/modules/devices/parent-mode-access";
import {
  DEVICE_TOKEN_COOKIE,
  PARENT_UNLOCK_COOKIE,
  readCookie,
  tokenCookieOptions,
} from "@/modules/devices/token";

const inputSchema = z.object({
  pin: z.string().regex(/^\d{6}$/),
});

export async function POST(request: Request) {
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json(
      { error: "INVALID_PARENT_PIN" },
      { status: 400 },
    );
  }

  const rawDeviceToken = readCookie(request, DEVICE_TOKEN_COOKIE);
  if (!rawDeviceToken) {
    return NextResponse.json({ error: "DEVICE_INVALID" }, { status: 401 });
  }

  try {
    const unlocked = await unlockWithParentPin(rawDeviceToken, input.data.pin);
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(PARENT_UNLOCK_COOKIE, unlocked.rawUnlockToken, {
      ...tokenCookieOptions(process.env.NODE_ENV),
      maxAge: 15 * 60,
    });
    return response;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (error.message === "DEVICE_INVALID") {
      return NextResponse.json({ error: "DEVICE_INVALID" }, { status: 401 });
    }
    if (error.message === "PARENT_PIN_INVALID") {
      return NextResponse.json(
        { error: "PARENT_PIN_INVALID" },
        { status: 403 },
      );
    }
    throw error;
  }
}
