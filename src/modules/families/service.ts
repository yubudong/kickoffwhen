import { and, eq } from "drizzle-orm";

import { db, type DbTransaction } from "@/db/client";
import type { FamilyOwnerActor } from "@/modules/auth/actor";
import {
  hashChildPin,
  hashParentPin,
  verifyPinHash,
} from "@/modules/auth/parent-pin";

import { isFamilyAlreadyExistsConflict } from "./errors";
import { children, families, guardians, parentPins } from "./schema";
import {
  createChildInputSchema,
  createFamilyOwnerInputSchema,
  parentPinSchema,
  type CreateChildInput,
  type CreateFamilyOwnerInput,
} from "./validation";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

type FamilyDatabase = typeof db | DbTransaction;

type PinDependencies = {
  hashChildPin: (pin: string) => Promise<string>;
  hashParentPin: (pin: string) => Promise<string>;
  verifyPinHash: (hash: string, pin: string) => Promise<boolean>;
};

export type Child = {
  id: string;
  familyId: string;
  nickname: string;
  avatarKey: string;
  grade: number;
  active: boolean;
};

export type FamilySetupStage = "pin" | "child" | "complete";

export type FamilyService = ReturnType<typeof createFamilyService>;

function actorFromMembership(membership: {
  id: string;
  familyId: string;
}): FamilyOwnerActor {
  return {
    role: "guardian",
    familyRole: "owner",
    familyId: membership.familyId,
    guardianId: membership.id,
  };
}

function toChild(row: typeof children.$inferSelect): Child {
  return {
    id: row.id,
    familyId: row.familyId,
    nickname: row.nickname,
    avatarKey: row.avatarKey,
    grade: row.grade,
    active: row.active,
  };
}

export function createFamilyService(
  database: FamilyDatabase = db,
  pinDependencies: PinDependencies = {
    hashChildPin,
    hashParentPin,
    verifyPinHash,
  },
) {
  async function createFamilyOwner(
    authUserId: string,
    input: CreateFamilyOwnerInput,
  ): Promise<FamilyOwnerActor> {
    const value = createFamilyOwnerInputSchema.parse(input);

    try {
      return await database.transaction(async (tx) => {
        const [family] = await tx
          .insert(families)
          .values({ name: value.familyName })
          .returning({ id: families.id });
        const [owner] = await tx
          .insert(guardians)
          .values({
            authUserId,
            displayName: value.ownerName,
            familyId: family.id,
            isOwner: true,
          })
          .returning({ id: guardians.id, familyId: guardians.familyId });

        return actorFromMembership(owner);
      });
    } catch (error) {
      if (isFamilyAlreadyExistsConflict(error)) {
        throw new Error("FAMILY_ALREADY_EXISTS", { cause: error });
      }
      throw error;
    }
  }

  async function createChild(
    actor: FamilyOwnerActor,
    input: CreateChildInput,
  ): Promise<Child> {
    const value = createChildInputSchema.parse(input);
    const childPinHash = value.childPin
      ? await pinDependencies.hashChildPin(value.childPin)
      : null;
    const [child] = await database
      .insert(children)
      .values({
        familyId: actor.familyId,
        nickname: value.nickname,
        avatarKey: value.avatarKey,
        grade: value.grade,
        textbookEditionIds: value.textbookEditionIds,
        childPinHash,
      })
      .returning();
    return toChild(child);
  }

  async function getFamilySetupStage(
    actor: FamilyOwnerActor,
  ): Promise<FamilySetupStage> {
    const [[pin], [child]] = await Promise.all([
      database
        .select({ guardianId: parentPins.guardianId })
        .from(parentPins)
        .where(
          and(
            eq(parentPins.guardianId, actor.guardianId),
            eq(parentPins.familyId, actor.familyId),
          ),
        )
        .limit(1),
      database
        .select({ id: children.id })
        .from(children)
        .where(eq(children.familyId, actor.familyId))
        .limit(1),
    ]);

    if (!pin) return "pin";
    return child ? "complete" : "child";
  }

  async function listChildren(actor: FamilyOwnerActor): Promise<Child[]> {
    const rows = await database
      .select()
      .from(children)
      .where(eq(children.familyId, actor.familyId));
    return rows.map(toChild);
  }

  async function renameChild(
    actor: FamilyOwnerActor,
    childId: string,
    nickname: string,
  ): Promise<Child> {
    const value = createChildInputSchema.shape.nickname.parse(nickname);
    const [child] = await database
      .update(children)
      .set({ nickname: value })
      .where(
        and(eq(children.id, childId), eq(children.familyId, actor.familyId)),
      )
      .returning();
    if (!child) throw new Error("CHILD_NOT_FOUND");
    return toChild(child);
  }

  async function setParentPin(actor: FamilyOwnerActor, pin: string): Promise<void> {
    const value = parentPinSchema.parse(pin);
    const pinHash = await pinDependencies.hashParentPin(value);
    await database
      .insert(parentPins)
      .values({
        guardianId: actor.guardianId,
        familyId: actor.familyId,
        pinHash,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: parentPins.guardianId,
        set: {
          familyId: actor.familyId,
          pinHash,
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        },
      });
  }

  async function verifyParentPin(
    actor: FamilyOwnerActor,
    pin: string,
    now = new Date(),
  ): Promise<boolean> {
    const value = parentPinSchema.parse(pin);

    return database.transaction(async (tx) => {
      const [stored] = await tx
        .select()
        .from(parentPins)
        .where(
          and(
            eq(parentPins.guardianId, actor.guardianId),
            eq(parentPins.familyId, actor.familyId),
          ),
        )
        .limit(1)
        .for("update");
      if (!stored) throw new Error("PARENT_PIN_NOT_SET");

      if (stored.lockedUntil && stored.lockedUntil > now) return false;

      const verified = await pinDependencies.verifyPinHash(stored.pinHash, value);
      if (verified) {
        await tx
          .update(parentPins)
          .set({ failedAttempts: 0, lockedUntil: null, updatedAt: now })
          .where(eq(parentPins.guardianId, actor.guardianId));
        return true;
      }

      const failedAttempts =
        stored.lockedUntil && stored.lockedUntil <= now
          ? 1
          : stored.failedAttempts + 1;
      const lockedUntil =
        failedAttempts >= MAX_FAILED_ATTEMPTS
          ? new Date(now.getTime() + LOCK_DURATION_MS)
          : null;
      await tx
        .update(parentPins)
        .set({ failedAttempts, lockedUntil, updatedAt: now })
        .where(eq(parentPins.guardianId, actor.guardianId));
      return false;
    });
  }

  return {
    createChild,
    createFamilyOwner,
    getFamilySetupStage,
    listChildren,
    renameChild,
    setParentPin,
    verifyParentPin,
  };
}

const familyService = createFamilyService();

export const createFamilyOwner = familyService.createFamilyOwner;
export const createChild = familyService.createChild;
export const getFamilySetupStage = familyService.getFamilySetupStage;
export const listChildren = familyService.listChildren;
export const renameChild = familyService.renameChild;
export const setParentPin = familyService.setParentPin;
export const verifyParentPin = familyService.verifyParentPin;

export type { CreateChildInput } from "./validation";
