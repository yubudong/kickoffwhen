import "server-only";

import type { FamilyOwnerActor } from "./actor";
import { requireFamilyOwnerActor } from "./actor";
import { actorFromParentUnlock } from "@/modules/devices/parent-mode-access";
import {
  DEVICE_TOKEN_COOKIE,
  PARENT_UNLOCK_COOKIE,
  readCookie,
} from "@/modules/devices/token";

function requestFromHeaders(headers: Headers) {
  return new Request("http://internal.local/parent", { headers });
}

export function hasDeviceCredential(headers: Headers): boolean {
  return Boolean(readCookie(requestFromHeaders(headers), DEVICE_TOKEN_COOKIE));
}

export async function resolveParentAccess(
  headers: Headers,
): Promise<{ actor: FamilyOwnerActor; mode: "guardian" | "device" }> {
  let sessionError: unknown;
  try {
    return {
      actor: await requireFamilyOwnerActor(headers),
      mode: "guardian",
    };
  } catch (error) {
    sessionError = error;
  }

  const request = requestFromHeaders(headers);
  const rawDeviceToken = readCookie(request, DEVICE_TOKEN_COOKIE);
  const rawUnlockToken = readCookie(request, PARENT_UNLOCK_COOKIE);
  if (!rawDeviceToken || !rawUnlockToken) throw sessionError;

  return {
    actor: await actorFromParentUnlock(rawDeviceToken, rawUnlockToken),
    mode: "device",
  };
}

export async function requireParentActor(
  headers: Headers,
): Promise<FamilyOwnerActor> {
  return (await resolveParentAccess(headers)).actor;
}
