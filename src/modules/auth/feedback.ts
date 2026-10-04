export type AuthError = { code?: string; status?: number };

export function signInErrorMessage(error: AuthError) {
  if (error.code === "EMAIL_NOT_VERIFIED") {
    return "邮箱尚未验证，请打开注册时收到的“验证邮箱”邮件，完成验证后再登录。";
  }
  if (error.status === 429) return "操作过于频繁，请稍后再试。";
  if (error.code === "INVALID_EMAIL_OR_PASSWORD") return "邮箱或密码不正确。";
  return "登录暂时不可用，请稍后再试。";
}

export function passwordResetRequestFeedback(error?: AuthError | null) {
  if (error) {
    return {
      error: error.status === 429 ? "操作过于频繁，请稍后再试。" : "重置邮件请求未成功，请稍后重试。",
      message: "",
    };
  }
  return {
    error: "",
    message: "如果该邮箱已注册，我们会发送重置邮件。邮件可能需要几分钟送达，请同时检查垃圾邮件。",
  };
}
