import { expect, test } from "@playwright/test";

import { testEmailSecret, uniqueTestIp } from "./test-config";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() } });

const initialPassword = "Family-Test-Password-1";
const resetPassword = "Family-Test-Password-2";

test("家长可注册、退出、重新登录并完成密码重置", async ({
  page,
  request,
}) => {
  const email = `guardian-${Date.now()}-${test.info().project.name}@example.test`;

  await page.goto("/parent");
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByRole("link", { name: "注册家长账号" }).click();
  await page.getByLabel("称呼").fill("测试家长");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(initialPassword);
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/parent\/onboarding$/);

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(initialPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/parent\/onboarding$/);

  await page.goto("/forgot-password");
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "发送重置邮件" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "如果该邮箱已注册，我们会发送重置邮件。邮件可能需要几分钟送达，请同时检查垃圾邮件。",
  );

  const mailboxResponse = await request.get(
    `/api/test/emails/latest?to=${encodeURIComponent(email)}`,
    { headers: { "x-auth-test-secret": testEmailSecret } },
  );
  expect(mailboxResponse.ok()).toBe(true);
  const mailbox = (await mailboxResponse.json()) as { text: string };
  const resetLink = mailbox.text.match(/https?:\/\/\S+/)?.[0];
  expect(resetLink).toBeTruthy();

  await page.goto(resetLink!);
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await page.getByLabel("新密码").fill(resetPassword);
  await page.getByRole("button", { name: "更新密码" }).click();
  await expect(page.getByRole("status")).toHaveText("密码已更新，请重新登录。");

  await page.goto("/parent");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(resetPassword);
  const [finalSignInResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/sign-in/email"),
    ),
    page.getByRole("button", { name: "登录" }).click(),
  ]);
  expect(finalSignInResponse.status()).toBe(200);
  await expect(page).toHaveURL(/\/parent\/onboarding$/);
});

test("未登录用户不能访问 onboarding", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("忘记密码页不泄露邮箱是否注册", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("邮箱").fill(`missing-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "发送重置邮件" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "如果该邮箱已注册，我们会发送重置邮件。邮件可能需要几分钟送达，请同时检查垃圾邮件。",
  );
});

test("家长从真实会话完成家庭、PIN 和首个孩子入门", async ({
  page,
}) => {
  const email = `onboarding-${crypto.randomUUID()}-${test.info().project.name}@example.test`;

  await page.goto("/sign-up");
  await page.getByLabel("称呼").fill("测试家长");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(initialPassword);
  const [registrationResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/auth/sign-up/email")),
    page.getByRole("button", { name: "注册" }).click(),
  ]);
  expect(registrationResponse.status(), await registrationResponse.text()).toBe(200);
  await expect(page).toHaveURL(/\/parent\/onboarding/);

  await page.getByLabel("家庭名称").fill("星河家庭");
  await page.getByLabel("家长显示名").fill("星爸");
  await page.getByRole("button", { name: "下一步：设置家长 PIN" }).click();

  await expect(page.getByLabel("6 位家长 PIN")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/parent\/onboarding/);

  const duplicateFamily = await page.evaluate(async () => {
    const response = await fetch("/api/parent/family", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyName: "重复家庭", ownerName: "重复家长" }),
    });
    return { body: await response.json(), status: response.status };
  });
  expect(duplicateFamily).toEqual({
    body: { error: "FAMILY_ALREADY_EXISTS" },
    status: 409,
  });

  const prematureChild = await page.evaluate(async () => {
    const response = await fetch("/api/parent/children", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nickname: "不应提前创建",
        avatarKey: "child-1",
        grade: 2,
        textbookEditionIds: [],
      }),
    });
    return { body: await response.json(), status: response.status };
  });
  expect(prematureChild).toEqual({
    body: { error: "PARENT_PIN_REQUIRED" },
    status: 428,
  });

  await page.goto("/parent/children");
  await expect(page).toHaveURL(/\/parent\/onboarding/);
  await expect(page.getByLabel("6 位家长 PIN")).toBeVisible();
  await page.getByLabel("6 位家长 PIN").fill("482731");
  await page.getByRole("button", { name: "下一步：创建孩子" }).click();

  await expect(page.getByLabel("孩子昵称")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/parent\/onboarding/);
  await page.getByLabel("孩子昵称").fill("小星");
  await page.getByLabel("头像").selectOption("rocket-blue");
  await page.getByLabel("年级").selectOption("4");
  await page.getByLabel("人教版语文").check();
  await page.getByLabel("可选儿童口令").fill("246810");
  await page.getByRole("button", { name: "创建孩子并完成" }).click();

  await expect(page).toHaveURL(/\/parent\/children/);
  await expect(page.getByText("小星")).toBeVisible();
  await expect(page.getByText("真实姓名")).toHaveCount(0);

  const attackerFamilyId = crypto.randomUUID();
  const result = await page.evaluate(async (familyId) => {
    const response = await fetch("/api/parent/children", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familyId,
        nickname: "小月",
        avatarKey: "child-1",
        grade: 2,
        textbookEditionIds: [],
      }),
    });
    return { body: await response.json(), status: response.status };
  }, attackerFamilyId);

  expect(result.status).toBe(201);
  expect(result.body.child.familyId).not.toBe(attackerFamilyId);

  await expect(
    page.getByRole("button", { name: "退出登录" }),
  ).toBeVisible();

  await page.route("**/api/auth/sign-out", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ message: "forced test failure" }),
      contentType: "application/json",
      status: 500,
    });
  });
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/parent\/children$/);
  await expect(
    page.getByRole("alert").filter({ hasText: "暂时无法退出，请重试。" }),
  ).toHaveText("暂时无法退出，请重试。");
  await expect(
    page.getByRole("button", { name: "退出登录" }),
  ).toBeEnabled();
  await page.reload();
  await expect(page).toHaveURL(/\/parent\/children$/);

  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/parent");
  await expect(page).toHaveURL(/\/sign-in$/);
});
