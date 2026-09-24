import { describe, expect, it } from "vitest";
import { passwordResetRequestFeedback, signInErrorMessage } from "@/modules/auth/feedback";

describe("认证失败提示", () => {
  it("正确密码但邮箱未验证时明确提示验证，不误报密码错误", () => {
    expect(signInErrorMessage({ code: "EMAIL_NOT_VERIFIED", status: 403 })).toBe(
      "邮箱尚未验证，请打开注册时收到的“验证邮箱”邮件，完成验证后再登录。",
    );
  });

  it("错误凭据仍使用不透露账号是否存在的提示", () => {
    expect(signInErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })).toBe(
      "邮箱或密码不正确。",
    );
  });

  it("限流与服务器故障不误报密码错误", () => {
    expect(signInErrorMessage({ status: 429 })).toBe("操作过于频繁，请稍后再试。");
    expect(signInErrorMessage({ status: 500 })).toBe("登录暂时不可用，请稍后再试。");
  });

  it("重置请求失败不显示邮件已发送", () => {
    const feedback = passwordResetRequestFeedback({ status: 500 });
    expect(feedback.message).toBe("");
    expect(feedback.error).toBe("重置邮件请求未成功，请稍后重试。");
  });

  it("重置请求被接受时保留防止账号枚举的提示，并提示投递延迟", () => {
    expect(passwordResetRequestFeedback(null)).toEqual({
      error: "",
      message: "如果该邮箱已注册，我们会发送重置邮件。邮件可能需要几分钟送达，请同时检查垃圾邮件。",
    });
  });
});
