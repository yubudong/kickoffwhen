import { isRegistrationAllowed } from "./registration-policy";

type AuthHandler = (request: Request) => Promise<Response>;

export async function guardRegistrationRequest(
  request: Request,
  handler: AuthHandler,
  allowedEmails: ReadonlySet<string>,
) {
  const path = new URL(request.url).pathname;
  if (!path.endsWith("/sign-up/email")) return handler(request);

  let email = "";
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    if (typeof body.email === "string") email = body.email;
  } catch {
    return handler(request);
  }

  if (!isRegistrationAllowed(email, allowedEmails)) {
    return Response.json(
      { code: "REGISTRATION_NOT_ALLOWED", message: "Registration is restricted" },
      { status: 403 },
    );
  }

  return handler(request);
}
