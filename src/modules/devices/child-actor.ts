import type { ChildActor } from "@/modules/auth/actor";

import { requireChildActorFromRequest } from "./service";
import { CHILD_SESSION_COOKIE, DEVICE_TOKEN_COOKIE } from "./token";

export { CHILD_SESSION_COOKIE, DEVICE_TOKEN_COOKIE };

export function requireChildActor(request: Request): Promise<ChildActor> {
  return requireChildActorFromRequest(request);
}
