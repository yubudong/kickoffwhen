export type Actor =
  | { role: "guardian"; familyId: string; guardianId: string }
  | { role: "child"; familyId: string; childId: string; deviceId: string };

export type GuardianActor = Extract<Actor, { role: "guardian" }>;
export type FamilyOwnerActor = GuardianActor & { familyRole: "owner" };
export type ChildActor = Extract<Actor, { role: "child" }>;

type OwnerMembership = {
  id: string;
  familyId: string;
  isOwner: boolean;
};

type ActorDatabase =
  | typeof import("@/db/client").db
  | import("@/db/client").DbTransaction;

export function onboardingDestination(
  session: { user: { id: string } } | null,
  membership: { id: string; familyId: string } | null,
): "sign-in" | "parent" | "onboarding" {
  if (!session) return "sign-in";
  return membership ? "parent" : "onboarding";
}

export async function actorFromSession(
  session: { user: { id: string } } | null,
  membership: { id: string; familyId: string } | null,
): Promise<GuardianActor> {
  if (!session || !membership) {
    throw new Error("GUARDIAN_MEMBERSHIP_REQUIRED");
  }

  return {
    role: "guardian",
    familyId: membership.familyId,
    guardianId: membership.id,
  };
}

export async function familyOwnerActorFromSession(
  session: { user: { id: string } } | null,
  membership: OwnerMembership | null,
): Promise<FamilyOwnerActor> {
  if (!session) throw new Error("AUTHENTICATION_REQUIRED");
  if (!membership) throw new Error("GUARDIAN_MEMBERSHIP_REQUIRED");
  if (!membership.isOwner) throw new Error("FAMILY_OWNER_REQUIRED");

  return {
    role: "guardian",
    familyRole: "owner",
    familyId: membership.familyId,
    guardianId: membership.id,
  };
}

export async function familyOwnerActorForAuthUser(
  authUserId: string,
  database?: ActorDatabase,
): Promise<FamilyOwnerActor> {
  const [{ and, eq }, { guardians }] = await Promise.all([
    import("drizzle-orm"),
    import("@/modules/families/schema"),
  ]);
  const client = database ?? (await import("@/db/client")).db;
  const [ownerMembership] = await client
    .select({
      id: guardians.id,
      familyId: guardians.familyId,
      isOwner: guardians.isOwner,
    })
    .from(guardians)
    .where(
      and(
        eq(guardians.authUserId, authUserId),
        eq(guardians.isOwner, true),
      ),
    )
    .limit(1);

  if (ownerMembership) {
    return familyOwnerActorFromSession(
      { user: { id: authUserId } },
      ownerMembership,
    );
  }

  const [membership] = await client
    .select({
      id: guardians.id,
      familyId: guardians.familyId,
      isOwner: guardians.isOwner,
    })
    .from(guardians)
    .where(eq(guardians.authUserId, authUserId))
    .limit(1);

  return familyOwnerActorFromSession(
    { user: { id: authUserId } },
    membership ?? null,
  );
}

export async function requireFamilyOwnerActor(
  headers: Headers,
): Promise<FamilyOwnerActor> {
  const { auth } = await import("./server");
  const session = await auth.api.getSession({ headers });
  if (!session) throw new Error("AUTHENTICATION_REQUIRED");
  return familyOwnerActorForAuthUser(session.user.id);
}

export async function requireGuardianActor(headers: Headers): Promise<GuardianActor> {
  const [{ eq }, { db }, { guardians }, { auth }] = await Promise.all([
    import("drizzle-orm"),
    import("@/db/client"),
    import("@/modules/families/schema"),
    import("./server"),
  ]);
  const session = await auth.api.getSession({ headers });
  const [membership] = session
    ? await db
        .select({ id: guardians.id, familyId: guardians.familyId })
        .from(guardians)
        .where(eq(guardians.authUserId, session.user.id))
        .limit(1)
    : [];

  return actorFromSession(session, membership ?? null);
}
