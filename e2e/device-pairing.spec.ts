import { expect, test } from "@playwright/test";

import { uniqueTestIp } from "./test-config";

test.use({ extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() } });

const password = "Device-Test-Password-1";

test("家长授权共享设备，孩子可切换档案且撤销后立即退出", async ({
  browser,
  page,
}) => {
  test.setTimeout(60_000);
  const email = `device-${crypto.randomUUID()}-${test.info().project.name}@example.test`;

  await page.goto("/sign-up");
  await page.getByLabel("称呼").fill("设备测试家长");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  const [registrationResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/auth/sign-up/email")),
    page.getByRole("button", { name: "注册" }).click(),
  ]);
  expect(registrationResponse.status(), await registrationResponse.text()).toBe(200);

  await page.getByLabel("家庭名称").fill("星河设备家庭");
  await page.getByLabel("家长显示名").fill("星爸");
  await page.getByRole("button", { name: "下一步：设置家长 PIN" }).click();
  await page.getByLabel("6 位家长 PIN").fill("482731");
  await page.getByRole("button", { name: "下一步：创建孩子" }).click();
  await page.getByLabel("孩子昵称").fill("小星");
  await page.getByRole("button", { name: "创建孩子并完成" }).click();
  await expect(page).toHaveURL(/\/parent\/children/);
  const createSecondChild = await page.evaluate(async () => {
    const response = await fetch("/api/parent/children", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nickname: "小月",
        avatarKey: "rocket-blue",
        grade: 2,
        textbookEditionIds: [],
        childPin: "246810",
      }),
    });
    return response.status;
  });
  expect(createSecondChild).toBe(201);

  await page.goto("/parent/devices");
  await page.getByLabel("授权 小星").check();
  await page.getByLabel("授权 小月").check();
  await page.getByRole("button", { name: "生成配对码" }).click();
  const pairingCode = await page.locator("[data-pairing-code]").innerText();
  expect(pairingCode).toMatch(/^[A-Z0-9_-]{12}$/);

  const addressNamespace = crypto.randomUUID();
  const childContext = await browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": `e2e-${addressNamespace}-shared`,
    },
  });
  const childPage = await childContext.newPage();
  await childPage.goto("/pair");
  await childPage.getByLabel("配对码").fill(pairingCode);
  await childPage.getByLabel("设备名称").fill("客厅 iPad");
  await childPage.getByRole("button", { name: "连接设备" }).click();
  await expect(childPage).toHaveURL(/\/child\/switch/);
  await expect(childPage.getByRole("button", { name: /小星/ })).toBeVisible();
  await expect(childPage.getByRole("button", { name: /小月/ })).toBeVisible();

  const deviceCookie = (await childContext.cookies()).find(
    (cookie) => cookie.name === "family_learning_device",
  );
  expect(deviceCookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });

  await childPage.getByRole("button", { name: /小星/ }).click();
  await expect(childPage).toHaveURL(/\/child$/);
  await expect(childPage.getByRole("heading", { name: "你好，小星" })).toBeVisible();
  await childPage.waitForLoadState("networkidle");
  await childPage.getByRole("button", { name: "切换孩子" }).click();
  await expect(childPage).toHaveURL(/\/child\/switch$/);
  await expect(childPage.getByRole("button", { name: /小月/ })).toBeVisible();
  await childPage.getByRole("button", { name: /小月/ }).click();
  await expect(childPage.getByLabel("6 位儿童口令")).toBeVisible();
  await childPage.getByLabel("6 位儿童口令").fill("000000");
  await childPage.getByRole("button", { name: "进入小月" }).click();
  await expect(childPage.getByText("儿童口令不正确。", { exact: true })).toBeVisible();
  await childPage.getByLabel("6 位儿童口令").fill("246810");
  await childPage.getByRole("button", { name: "进入小月" }).click();
  await expect(childPage.getByRole("heading", { name: "你好，小月" })).toBeVisible();

  const childCookie = (await childContext.cookies()).find(
    (cookie) => cookie.name === "family_learning_child_session",
  );
  expect(childCookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });

  await page.reload();
  await expect(page.getByText("客厅 iPad", { exact: true })).toBeVisible();
  const sharedDeviceRow = page.locator("article").filter({ hasText: "客厅 iPad" });
  await expect(sharedDeviceRow.locator("[data-device-children]")).toHaveText(
    /^(小星、小月|小月、小星)$/,
  );
  await expect(page.getByText("最近活跃")).toBeVisible();

  await page.getByLabel("允许 客厅 iPad 使用 小月").uncheck();
  await page
    .getByRole("button", { name: "保存 客厅 iPad 的孩子权限" })
    .click();
  await expect(sharedDeviceRow.locator("[data-device-children]")).toHaveText(
    "小星",
  );
  await childPage.reload();
  await expect(
    childPage.getByRole("heading", { name: "你好，小星" }),
  ).toBeVisible();

  await page.getByLabel("允许 客厅 iPad 使用 小月").check();
  await page
    .getByRole("button", { name: "保存 客厅 iPad 的孩子权限" })
    .click();
  await expect(sharedDeviceRow.locator("[data-device-children]")).toHaveText(
    /^(小星、小月|小月、小星)$/,
  );
  await childPage.goto("/child/switch");
  await expect(childPage.getByRole("button", { name: /小星/ })).toBeVisible();
  await expect(childPage.getByRole("button", { name: /小月/ })).toBeVisible();

  await page.getByLabel("授权 小星").check();
  await page.getByRole("button", { name: "生成配对码" }).click();
  const singlePairingCode = await page.locator("[data-pairing-code]").innerText();
  const singleChildContext = await browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": `e2e-${addressNamespace}-single`,
    },
  });
  const singleChildPage = await singleChildContext.newPage();
  await singleChildPage.goto("/pair");
  await singleChildPage.getByLabel("配对码").fill(singlePairingCode);
  await singleChildPage.getByLabel("设备名称").fill("小星的平板");
  await singleChildPage.getByRole("button", { name: "连接设备" }).click();
  await expect(singleChildPage).toHaveURL(/\/child$/);
  await expect(
    singleChildPage.getByRole("heading", { name: "你好，小星" }),
  ).toBeVisible();
  await singleChildContext.close();

  await page.getByLabel("授权 小星").uncheck();
  await page.getByLabel("授权 小月").check();
  await page.getByRole("button", { name: "生成配对码" }).click();
  await expect(page.locator("[data-pairing-code]")).not.toHaveText(singlePairingCode);
  const singlePinPairingCode = await page.locator("[data-pairing-code]").innerText();
  const singlePinContext = await browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": `e2e-${addressNamespace}-pin`,
    },
  });
  const singlePinPage = await singlePinContext.newPage();
  await singlePinPage.goto("/pair");
  await singlePinPage.getByLabel("配对码").fill(singlePinPairingCode);
  await singlePinPage.getByLabel("设备名称").fill("小月的平板");
  await singlePinPage.getByRole("button", { name: "连接设备" }).click();
  await expect(singlePinPage).toHaveURL(/\/child\/switch$/);
  await expect(
    singlePinPage.getByRole("button", { name: "小月 需要口令" }),
  ).toBeVisible();
  await expect(singlePinPage.getByLabel("6 位儿童口令")).toBeVisible();
  await singlePinPage.getByLabel("6 位儿童口令").fill("246810");
  await singlePinPage.getByRole("button", { name: "进入小月" }).click();
  await expect(
    singlePinPage.getByRole("heading", { name: "你好，小月" }),
  ).toBeVisible();
  await singlePinContext.close();

  await page.getByRole("button", { name: "撤销 客厅 iPad" }).click();
  await expect(page.getByText("已撤销", { exact: true })).toBeVisible();

  await childPage.reload();
  await expect(childPage).toHaveURL(/\/pair/);
  await childContext.close();
});
