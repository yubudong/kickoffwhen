import type { Actor } from "@/modules/auth/actor";

export type PrivateMediaKind = "tts_audio" | "ocr_source" | "habit_photo";

export type PrivateMediaMimeType =
  | "audio/mpeg"
  | "image/jpeg"
  | "image/png";

export type PrivateMediaRef = {
  id: string;
  familyId: string;
  childId: string | null;
  kind: PrivateMediaKind;
  expiresAt: Date | null;
};

export type PutPrivateMediaInput = {
  familyId: string;
  childId: string | null;
  kind: PrivateMediaKind;
  bytes: Uint8Array;
  mimeType: PrivateMediaMimeType;
  expiresAt: Date | null;
  dedupeKey?: string | null;
};

export type MediaAuthorizationInput = {
  familyId: string;
  childId: string | null;
  kind: PrivateMediaKind;
  deletedAt: Date | null;
};

export function authorizePrivateMediaAccess(
  actor: Actor,
  media: MediaAuthorizationInput,
  hasActiveTaskAccess = false,
): boolean {
  if (media.deletedAt || actor.familyId !== media.familyId) return false;
  if (actor.role === "guardian") return true;

  return Boolean(
    hasActiveTaskAccess &&
      media.kind === "tts_audio" &&
      media.childId === actor.childId,
  );
}
