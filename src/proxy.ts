import { type NextRequest, NextResponse } from "next/server";

import {
  CHILD_SESSION_COOKIE,
  DEVICE_TOKEN_COOKIE,
  PARENT_UNLOCK_COOKIE,
} from "@/modules/devices/token";

function hasGuardianSession(request: NextRequest) {
  return Boolean(
    request.cookies.get("better-auth.session_token")?.value ||
      request.cookies.get("__Secure-better-auth.session_token")?.value,
  );
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const hasDevice = Boolean(request.cookies.get(DEVICE_TOKEN_COOKIE)?.value);
  const hasChildSession = Boolean(
    request.cookies.get(CHILD_SESSION_COOKIE)?.value,
  );
  const hasParentUnlock = Boolean(
    request.cookies.get(PARENT_UNLOCK_COOKIE)?.value,
  );

  if (path === "/parent-unlock") {
    if (!hasDevice) {
      return NextResponse.redirect(new URL("/sign-in", request.url));
    }
    return NextResponse.next();
  }

  if (path === "/parent" || path.startsWith("/parent/")) {
    if (!hasGuardianSession(request) && !hasParentUnlock) {
      return NextResponse.redirect(
        new URL(hasDevice ? "/parent-unlock" : "/sign-in", request.url),
      );
    }
    return NextResponse.next();
  }

  if (path === "/child/switch") {
    return hasDevice
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/pair", request.url));
  }

  if (path === "/child") {
    if (hasChildSession) return NextResponse.next();
    return NextResponse.redirect(
      new URL(hasDevice ? "/child/switch" : "/pair", request.url),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/parent/:path*", "/parent-unlock", "/child/:path*"],
};
