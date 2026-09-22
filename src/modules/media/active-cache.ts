import { and, eq, gt, isNull, or, type SQLWrapper } from "drizzle-orm";

import { privateMedia } from "./schema";

export type ActiveTtsMediaScope = {
  dedupeKey: string;
  familyId: string;
  childId: string;
  at: Date;
};

export function activeTtsMediaPredicate(scope: {
  dedupeKey: string | SQLWrapper;
  familyId: string | SQLWrapper;
  childId: string | SQLWrapper;
  at: Date;
}) {
  return and(
    eq(privateMedia.dedupeKey, scope.dedupeKey),
    eq(privateMedia.familyId, scope.familyId),
    eq(privateMedia.childId, scope.childId),
    eq(privateMedia.kind, "tts_audio"),
    isNull(privateMedia.deletedAt),
    or(isNull(privateMedia.expiresAt), gt(privateMedia.expiresAt, scope.at)),
  );
}

export function isActiveTtsMedia(
  media: {
    dedupeKey: string | null;
    familyId: string;
    childId: string | null;
    kind: string;
    expiresAt: Date | null;
    deletedAt: Date | null;
  },
  scope: ActiveTtsMediaScope,
): boolean {
  return Boolean(
    media.dedupeKey === scope.dedupeKey &&
      media.familyId === scope.familyId &&
      media.childId === scope.childId &&
      media.kind === "tts_audio" &&
      media.deletedAt === null &&
      (media.expiresAt === null || media.expiresAt > scope.at),
  );
}
