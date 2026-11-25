import { z } from 'zod';
import { dateSchema, todoDateRange } from '@/modules/todos/validation';
import { speciesKeys, stages, maxStage } from './companion-catalog';
export { stages, stageNames, speciesNames } from './companion-catalog';
export const speciesSchema = z.enum(speciesKeys);
export const habitInput = z.object({ commandId: z.string().uuid(), childId: z.string().uuid(), title: z.string().trim().min(1).max(120), requirements: z.string().trim().max(2000).default(''), schedule: z.enum(['daily', 'weekdays', 'weekly']), weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]), weeklyTarget: z.number().int().min(1).max(7).default(3), startDate: dateSchema, confirmation: z.enum(['self', 'parent']).default('parent'), coins: z.number().int().min(0).max(10000).default(1), growth: z.number().int().min(0).max(10000).default(10) }).refine(v => v.schedule !== 'weekdays' || v.weekdays.length > 0, { message: '请选择至少一个星期日' });
export const rewardInput = z.object({ commandId: z.string().uuid(), title: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).default(''), price: z.number().int().min(1).max(1000000), repeatable: z.boolean().default(true), weeklyLimit: z.number().int().min(1).max(100).nullable().default(null) });
export type HabitRule = {
    schedule: string;
    weekdays: number[];
    weeklyTarget: number;
    startDate: string;
    stoppedOn: string | null;
};
export function scheduled(rule: HabitRule, date: string) { dateSchema.parse(date); if (date < rule.startDate || (rule.stoppedOn !== null && date >= rule.stoppedOn))
    return false; return rule.schedule !== 'weekdays' || rule.weekdays.includes(new Date(date + 'T00:00:00Z').getUTCDay()); }
export function nextDate(date: string) { const d = new Date(dateSchema.parse(date) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
export function weekOf(date: string) { return todoDateRange(date, 'week').from; }
export function boostedGrowth(base: number, percent: number) { return Math.floor(base * (100 + Math.min(30, Math.max(0, percent))) / 100); }
export function feedAmount(stage: number, fed: number, available: number, requested: number) {
    if (stage < maxStage && fed >= stages[stage + 1]) throw new Error('EVOLUTION_READY');
    return Math.min(requested, available, stage < maxStage ? stages[stage + 1] - fed : requested);
}
export const shopItems = [
    { key: 'apple', name: '清甜苹果', description: '一次互动，伙伴会开心地吃掉苹果，不增加成长值。', price: 2, type: 'food', slot: null, percent: 0 },
    { key: 'scarf', name: '暖阳围巾', description: '永久拥有的身边装饰。', price: 10, type: 'decoration', slot: 'charm', percent: 0 },
    { key: 'moon-lamp', name: '月光小灯', description: '永久拥有的悬浮月灯。', price: 20, type: 'decoration', slot: 'charm', percent: 0 },
    { key: 'star-room', name: '星空小屋', description: '永久拥有的星空背景。', price: 60, type: 'decoration', slot: 'background', percent: 0 },
    { key: 'focus', name: '专注祝福', description: '主动激活后7天，任务成长值＋10%，同种续时。', price: 12, type: 'boost', slot: null, percent: 10 },
    { key: 'courage', name: '勇气祝福', description: '主动激活后7天，任务成长值＋10%，同种续时。', price: 12, type: 'boost', slot: null, percent: 10 },
    { key: 'curiosity', name: '好奇祝福', description: '主动激活后7天，任务成长值＋10%，同种续时。', price: 12, type: 'boost', slot: null, percent: 10 },
] as const;
export function shopItem(key: string) { const item = shopItems.find(v => v.key === key); if (!item)
    throw new Error('ITEM_NOT_FOUND'); return item; }
