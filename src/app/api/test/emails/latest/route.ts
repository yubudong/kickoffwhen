import { env } from "@/config/runtime";
import { FakeEmailSender } from "@/modules/auth/email-sender";
import { emailSender } from "@/modules/auth/server";
import { canAccessTestEmail } from "@/modules/auth/test-email-access";

export async function GET(request: Request) {
  if (
    !(emailSender instanceof FakeEmailSender) ||
    !canAccessTestEmail(
      env,
      emailSender,
      request.headers.get("x-auth-test-secret") ?? undefined,
    )
  ) {
    return new Response(null, { status: 404 });
  }

  const to = new URL(request.url).searchParams.get("to");
  if (!to) {
    return Response.json({ error: "EMAIL_REQUIRED" }, { status: 400 });
  }

  const message = emailSender.messages.findLast((item) => item.to === to);
  if (!message) {
    return Response.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
  }

  return Response.json({ subject: message.subject, text: message.text });
}
