import { z } from 'zod';
export const bonusSchema = z.number().int().min(0).max(10000);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v + 'T00:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; });
export const taskInputSchema = z.object({ childId: z.string().uuid(), title: z.string().trim().min(1).max(120), requirements: z.string().trim().max(2000).default(''), date: dateSchema, commandId: z.string().uuid() });
export function todayShanghai(at = new Date()) { return new Date(at.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
export function summarizeTodos(rows: Array<{
    status: string;
}>) { const completed = rows.filter(r => ['submitted', 'approved'].includes(r.status)).length; return { total: rows.length, completed, remaining: rows.length - completed }; }
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
