import { isNull, notInArray, or } from "drizzle-orm";
import retiredKeys from "../../../content/official-chinese-retired-keys.json";
import { learningCards } from "./schema";

// Replacement only changes eligibility for new work. Existing tasks, audio and
// history keep reading the original card, and unchanged grade-one IDs stay active.
export const retiredOfficialBuiltinKeys: string[] = retiredKeys;
const retired = new Set(retiredOfficialBuiltinKeys);

export function isRetiredBuiltinKey(key: string | null | undefined): boolean {
  return typeof key === "string" && retired.has(key);
}

export function activeLearningCardPredicate() {
  return or(isNull(learningCards.builtinKey), notInArray(learningCards.builtinKey, retiredOfficialBuiltinKeys));
}
