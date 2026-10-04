import { NextResponse } from "next/server";

import { claimPairingCode } from "@/modules/devices/service";
import {
  CHILD_SESSION_COOKIE,
  DEVICE_TOKEN_COOKIE,
  tokenCookieOptions,
} from "@/modules/devices/token";

function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  return forwarded?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | { code?: unknown; label?: unknown }
    | null;
  const code = typeof payload?.code === "string" ? payload.code : "";
  const label = typeof payload?.label === "string" ? payload.label : "";

  try {
    const paired = await claimPairingCode(code, label, clientAddress(request));
    const response = NextResponse.json({ deviceId: paired.deviceId }, { status: 201 });
    const options = tokenCookieOptions(process.env.NODE_ENV);
    response.cookies.set(DEVICE_TOKEN_COOKIE, paired.rawDeviceToken, {
      ...options,
      maxAge: 180 * 24 * 60 * 60,
    });
    response.cookies.set(CHILD_SESSION_COOKIE, "", { ...options, maxAge: 0 });
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "PAIRING_CODE_INVALID") {
      return NextResponse.json(
        { error: "PAIRING_CODE_INVALID" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "PAIRING_RATE_LIMITED") {
      return NextResponse.json(
        { error: "PAIRING_RATE_LIMITED" },
        { status: 429 },
      );
    }
    throw error;
  }
}
