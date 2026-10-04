export function isTodoOriginAllowed(origin: string | null, appUrl: string) {
  return origin === null || origin === new URL(appUrl).origin;
}
