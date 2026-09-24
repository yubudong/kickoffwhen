export const testEmailSecret =
  "e2e-only-mailbox-secret-12345678901234567890";

// Better Auth limits sign-up attempts per IP. Keep each test file isolated
// without disabling the production rate-limit behavior in E2E.
export function uniqueTestIp(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  return `198.19.${bytes[0]}.${bytes[1]}`;
}
