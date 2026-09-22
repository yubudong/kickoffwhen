import { expect, type BrowserContext, type Page, test } from "@playwright/test";

const password = "Switching-Test-Password-1";
const parentPin = "482731";

type FamilyFixture = {
  childIdsByNickname: Record<string, string>;
  parentPage: Page;
};

type SwitchingFixtureState = {
  email: string;
};

let fixtureState: SwitchingFixtureState | null = null;

function createValidTestIps() {
  const bytes = crypto.randomUUID().replaceAll("-", "").match(/.{2}/g)!
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 16));
  const secondOctet = 18 + (bytes[0]! % 2);
  const fourthOctet = (bytes[2]! % 84) * 3 + 1;
  const addressFor = (roleOffset: number) =>
    `198.${secondOctet}.${bytes[1]}.${fourthOctet + roleOffset}`;
  return {
    parent: addressFor(0),
    shared: addressFor(1),
    secondDevice: addressFor(2),
  };
}

async function seedFamily(
  context: BrowserContext,
  nicknames: [string, string],
): Promise<FamilyFixture> {
  const parentPage = await context.newPage();
  const email = `switching-${Date.now()}-${test.info().project.name}-${crypto.randomUUID()}@example.test`;
  fixtureState = { email };

  await parentPage.goto("/sign-up");
  await parentPage.getByLabel("称呼").fill("切换测试家长");
  await parentPage.getByLabel("邮箱").fill(email);
  await parentPage.getByLabel("密码", { exact: true }).fill(password);
  const [signUpResponse] = await Promise.all([
    parentPage.waitForResponse((response) =>
      response.url().endsWith("/api/auth/sign-up/email"),
    ),
    parentPage.getByRole("button", { name: "注册" }).click(),
  ]);
  expect(signUpResponse.status()).toBe(200);
  await expect(parentPage).toHaveURL(/\/parent\/onboarding$/);

  await parentPage.getByLabel("家庭名称").fill("共享设备家庭");
  await parentPage.getByLabel("家长显示名").fill("测试家长");
  await parentPage
    .getByRole("button", { name: "下一步：设置家长 PIN" })
    .click();
  await parentPage.getByLabel("6 位家长 PIN").fill(parentPin);
  await parentPage
    .getByRole("button", { name: "下一步：创建孩子" })
    .click();
  await parentPage.getByLabel("孩子昵称").fill(nicknames[0]);
  await parentPage.getByLabel("头像").selectOption("child-1");
  await parentPage
    .getByRole("button", { name: "创建孩子并完成" })
    .click();
  await expect(parentPage).toHaveURL(/\/parent\/children$/);

  const createdSecond = await parentPage.evaluate(async (nickname) => {
    const response = await fetch("/api/parent/children", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nickname,
        avatarKey: "rocket-blue",
        grade: 2,
        textbookEditionIds: [],
      }),
    });
    return response.status;
  }, nicknames[1]);
  expect(createdSecond).toBe(201);

  const children = await parentPage.evaluate(async () => {
    const response = await fetch("/api/parent/children");
    return (await response.json()) as {
      children: Array<{ id: string; nickname: string }>;
    };
  });

  return {
    childIdsByNickname: Object.fromEntries(
      children.children.map((child) => [child.nickname, child.id]),
    ),
    parentPage,
  };
}

async function cleanupFixture(state: SwitchingFixtureState) {
  const [{ db }, authSchema, familySchema, orm] = await Promise.all([
    import("@/db/client"),
    import("@/modules/auth/schema"),
    import("@/modules/families/schema"),
    import("drizzle-orm"),
  ]);
  const [authUser] = await db.select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(orm.eq(authSchema.user.email, state.email))
    .limit(1);
  if (!authUser) return;
  const [membership] = await db.select({ familyId: familySchema.guardians.familyId })
    .from(familySchema.guardians)
    .where(orm.eq(familySchema.guardians.authUserId, authUser.id))
    .limit(1);
  await db.transaction(async (tx) => {
    if (membership) {
      await tx.delete(familySchema.families)
        .where(orm.eq(familySchema.families.id, membership.familyId));
    }
    await tx.delete(authSchema.user).where(orm.eq(authSchema.user.id, authUser.id));
  });
  const remainingUsers = await db.select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(orm.eq(authSchema.user.id, authUser.id));
  expect(remainingUsers).toEqual([]);
  if (membership) {
    const remainingFamilies = await db.select({ id: familySchema.families.id })
      .from(familySchema.families)
      .where(orm.eq(familySchema.families.id, membership.familyId));
    expect(remainingFamilies).toEqual([]);
  }
}

test.afterEach(async () => {
  if (!fixtureState) return;
  const state = fixtureState;
  try {
    await cleanupFixture(state);
  } finally {
    fixtureState = null;
  }
});

async function pairDevice(
  context: BrowserContext,
  family: FamilyFixture,
  nicknames: string[],
  label: string,
) {
  const childIds = nicknames.map(
    (nickname) => family.childIdsByNickname[nickname],
  );
  const pairing = await family.parentPage.evaluate(async (ids) => {
    const response = await fetch("/api/parent/devices/pairing-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ childIds: ids }),
    });
    return (await response.json()) as { code: string };
  }, childIds);

  const page = await context.newPage();
  await page.goto("/pair");
  await page.getByLabel("配对码").fill(pairing.code);
  await page.getByLabel("设备名称").fill(label);
  await page.getByRole("button", { name: "连接设备" }).click();
  return page;
}

async function selectProfile(page: Page, nickname: string) {
  if (page.url().endsWith("/child")) {
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "切换孩子" }).click();
  } else if (!page.url().endsWith("/child/switch")) {
    await page.goto("/child/switch");
  }
  await expect(page).toHaveURL(/\/child\/switch$/);
  const profile = page.getByRole("button", { name: new RegExp(nickname) });
  await expect(profile).toBeVisible();
  await profile.click();
  await expect(page).toHaveURL(/\/child$/);
}

test("共享设备可自由切换孩子，家长模式需 PIN 且随设备撤销", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const testIps = createValidTestIps();
  const parent = await browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": testIps.parent,
    },
  });
  const shared = await browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": testIps.shared,
    },
  });
  const secondDevice = await browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": testIps.secondDevice,
    },
  });

  const family = await seedFamily(parent, ["小雨", "小川"]);
  const sharedPage = await pairDevice(
    shared,
    family,
    ["小雨", "小川"],
    "客厅共享 iPad",
  );
  const secondPage = await pairDevice(
    secondDevice,
    family,
    ["小川"],
    "小川的平板",
  );

  await shared.clearCookies({ name: "family_learning_child_session" });
  await shared.addCookies([
    {
      name: "family_learning_child_session",
      value: "stale-child-session",
      url: "http://127.0.0.1:3000",
    },
  ]);
  await sharedPage.goto("/child/switch");
  await expect(sharedPage).toHaveURL(/\/child\/switch$/);
  await expect(
    sharedPage.getByRole("button", { name: /小雨/ }),
  ).toBeVisible();

  await selectProfile(sharedPage, "小雨");
  await expect(
    sharedPage.getByRole("heading", { name: "小雨的今日任务" }),
  ).toBeVisible();
  await expect(sharedPage.getByText("今日任务尚未开放")).toBeVisible();
  await expect(sharedPage.getByText("设备管理")).toHaveCount(0);
  await expect(sharedPage.getByText("审核")).toHaveCount(0);
  await expect(sharedPage.getByText("积分调整")).toHaveCount(0);

  await selectProfile(sharedPage, "小川");
  await expect(
    sharedPage.getByRole("heading", { name: "小川的今日任务" }),
  ).toBeVisible();
  await expect(sharedPage.getByText("小雨", { exact: true })).toHaveCount(0);
  await expect(secondPage).toHaveURL(/\/child$/);
  await expect(
    secondPage.getByRole("heading", { name: "小川的今日任务" }),
  ).toBeVisible();

  await shared.clearCookies({ name: "family_learning_child_session" });
  await shared.addCookies([
    {
      name: "family_learning_child_session",
      value: "stale-after-lost-response",
      url: "http://127.0.0.1:3000",
    },
  ]);
  await sharedPage.goto("/child");
  await expect(sharedPage).toHaveURL(/\/child\/switch$/);
  await selectProfile(sharedPage, "小川");

  await shared.addCookies([
    {
      name: "better-auth.session_token",
      value: "revoked-test-session",
      url: "http://127.0.0.1:3000",
    },
  ]);
  await sharedPage.goto("/parent");
  await expect(sharedPage).toHaveURL(/\/parent-unlock$/);
  await sharedPage.getByLabel("6 位家长 PIN").fill(parentPin);
  await sharedPage.getByRole("button", { name: "进入家长模式" }).click();
  await expect(sharedPage).toHaveURL(/\/parent$/);
  await expect(
    sharedPage.getByRole("heading", { name: "家长中心" }),
  ).toBeVisible();

  const unlockedApiStatus = await sharedPage.evaluate(async () =>
    (await fetch("/api/parent/children")).status,
  );
  expect(unlockedApiStatus).toBe(200);

  await sharedPage
    .getByRole("button", { name: "退出家长模式" })
    .click();
  await expect(sharedPage).toHaveURL(/\/child\/switch$/);
  await sharedPage.goto("/parent");
  await expect(sharedPage).toHaveURL(/\/parent-unlock$/);

  await family.parentPage.goto("/parent/devices");
  await family.parentPage
    .getByRole("button", { name: "撤销 客厅共享 iPad" })
    .click();
  await expect(
    family.parentPage
      .locator("article")
      .filter({ hasText: "客厅共享 iPad" })
      .getByText("已撤销", { exact: true }),
  ).toBeVisible();

  await sharedPage.goto("/parent");
  await expect(sharedPage).toHaveURL(/\/pair$/);
});
