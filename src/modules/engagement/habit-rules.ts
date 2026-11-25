import { z } from 'zod';
import { nextDate } from './rules';
export const habitConfigSchema = z.object({
  title: z.string().trim().min(1).max(120), requirements: z.string().trim().max(2000).default(''),
  schedule: z.enum(['daily', 'weekdays', 'weekly']), weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  weeklyTarget: z.number().int().min(1).max(7).default(3), confirmation: z.enum(['self', 'parent']).default('parent'),
  coins: z.number().int().min(0).max(10000).default(1), growth: z.number().int().min(0).max(10000).default(10),
}).refine(v => v.schedule !== 'weekdays' || v.weekdays.length > 0, { message: '请选择至少一个执行日' });
export type HabitConfig = z.infer<typeof habitConfigSchema>;
export type HabitVersion = { id: string; habitId: string; version: number; effectiveFrom: string; config: HabitConfig };
export function habitConfig(value: unknown): HabitConfig { return habitConfigSchema.parse(value); }
export function effectiveHabit<T extends { id: string }>(habit: T, versions: HabitVersion[], date: string): T & HabitConfig & { habitRevisionId: string | null } {
  const selected = versions.filter(v => v.habitId === habit.id && v.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0];
  return { ...habit, ...(selected?.config ?? habitConfig(habit)), habitRevisionId: selected?.id ?? null };
}
export function habitChangeDate(today: string, startDate: string) { const tomorrow = nextDate(today); return startDate > tomorrow ? startDate : tomorrow; }
