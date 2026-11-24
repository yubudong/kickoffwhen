import rawOrigins from "../../../content/official-chinese-practice-origins.json";
import type { PracticeOrigin } from "./types";

const origins = rawOrigins as Record<string, PracticeOrigin>;

export function getPracticeOrigin(builtinKey: string | null | undefined): PracticeOrigin | undefined {
  return builtinKey ? origins[builtinKey] : undefined;
}
