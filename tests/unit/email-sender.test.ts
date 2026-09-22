import { describe, expect, it } from "vitest";

import {
  FakeEmailSender,
  createEmailSender,
} from "@/modules/auth/email-sender";

describe("createEmailSender", () => {
  it("生产环境缺少 SMTP 配置时立即拒绝启动", () => {
    expect(() =>
      createEmailSender({ nodeEnv: "production", smtpUrl: undefined }),
    ).toThrow("SMTP_URL_REQUIRED");
  });

  it("测试环境收集邮件供浏览器流程使用", async () => {
    const sender = createEmailSender({ nodeEnv: "test", smtpUrl: undefined });

    expect(sender).toBeInstanceOf(FakeEmailSender);
    await sender.send({
      to: "guardian@example.test",
      subject: "重置密码",
      text: "http://localhost/reset-placeholder",
    });

    expect((sender as FakeEmailSender).messages).toEqual([
      {
        to: "guardian@example.test",
        subject: "重置密码",
        text: "http://localhost/reset-placeholder",
      },
    ]);
  });
});
