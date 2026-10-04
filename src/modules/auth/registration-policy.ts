export function normalizeRegistrationEmail(email: string) {
  return email.trim().toLowerCase();
}

export function parseRegistrationAllowedEmails(value: string) {
  const emails = new Set(
    value
      .split(",")
      .map(normalizeRegistrationEmail)
      .filter(Boolean),
  );

  if (emails.size === 0) {
    throw new Error("REGISTRATION_ALLOWED_EMAILS_REQUIRED");
  }

  return emails;
}

export function isRegistrationAllowed(email: string, allowedEmails: ReadonlySet<string>) {
  return allowedEmails.has(normalizeRegistrationEmail(email));
}
