import { z } from 'zod';
export const bonusSchema = z.number().int().min(0).max(10000);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v + 'T00:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; });
export const todoViewSchema = z.enum(['day', 'week', 'month']);
export type TodoView = z.infer<typeof todoViewSchema>;
function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
export function todoDateRange(anchor: string, view: TodoView = 'day') {
    const parsed = dateSchema.parse(anchor);
    const mode = todoViewSchema.parse(view);
    if (mode === 'day') return { from: parsed, to: parsed };
    const start = new Date(parsed + 'T00:00:00Z');
    if (mode === 'week') {
        const weekday = start.getUTCDay();
        const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
        const from = new Date(start);
        from.setUTCDate(start.getUTCDate() + mondayOffset);
        const to = new Date(from);
        to.setUTCDate(from.getUTCDate() + 6);
        return { from: isoDate(from), to: isoDate(to) };
    }
    const [year, month] = parsed.split('-').map(Number);
    return { from: isoDate(new Date(Date.UTC(year, month - 1, 1))), to: isoDate(new Date(Date.UTC(year, month, 0))) };
}
export function eachTodoDate(from: string, to: string) {
    const dates: string[] = [];
    const cursor = new Date(dateSchema.parse(from) + 'T00:00:00Z');
    const end = new Date(dateSchema.parse(to) + 'T00:00:00Z');
    while (cursor.getTime() <= end.getTime()) {
        dates.push(isoDate(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function formatTodoDay(date: string) {
    const value = new Date(dateSchema.parse(date) + 'T00:00:00Z');
    return `${value.getUTCMonth() + 1}月${value.getUTCDate()}日 ${weekdays[value.getUTCDay()]}`;
}
export const taskInputSchema = z.object({ childId: z.string().uuid(), title: z.string().trim().min(1).max(120), requirements: z.string().trim().max(2000).default(''), date: dateSchema, commandId: z.string().uuid() });
export const updateManualSchema = taskInputSchema.pick({ title: true, requirements: true, date: true }).extend({ expectedUpdatedAt: z.iso.datetime() });
export function todayShanghai(at = new Date()) { return new Date(at.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
export function summarizeTodos(rows: Array<{
    status: string;
}>) { const active = rows.filter(r => r.status !== 'cancelled'); const completed = active.filter(r => ['submitted', 'approved'].includes(r.status)).length; return { total: active.length, completed, remaining: active.length - completed }; }
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export function attachmentType(bytes: Uint8Array, mime: string): string {
    mime = mime.split(';')[0].trim().toLowerCase();
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES)
        throw new Error('ATTACHMENT_SIZE');
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
    if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
        return mime;
    if (mime === 'image/png' && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
        return mime;
    if (mime === 'image/webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')
        return mime;
    if (['audio/wav', 'audio/x-wav'].includes(mime) && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
        return 'audio/wav';
    if (mime === 'audio/mpeg' && (ascii(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224)))
        return mime;
    if (['video/mp4', 'video/quicktime', 'audio/mp4', 'audio/x-m4a'].includes(mime) && ascii(4, 8) === 'ftyp')
        return mime === 'audio/x-m4a' ? 'audio/mp4' : mime;
    if (['audio/webm', 'video/webm'].includes(mime) && [26, 69, 223, 163].every((v, i) => bytes[i] === v))
        return mime;
    throw new Error('ATTACHMENT_TYPE');
}
