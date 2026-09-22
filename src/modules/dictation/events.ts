import { createHash } from "node:crypto";

export function deriveReviewCommandId(
  gradingCommandId: string,
  taskItemId: string,
  role: "first_pass" | "same_session_relearning",
): string {
  const hex = createHash("sha256")
    .update(`dictation-review:${gradingCommandId}:${taskItemId}:${role}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
