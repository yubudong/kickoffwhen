import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { attachmentType, MAX_ATTACHMENT_BYTES } from './validation';
const location = (id: string) => path.join(process.env.MEDIA_ROOT ?? './var/media', 'todo', z.string().uuid().parse(id));
export async function saveAttachment(file: File) { if (file.size > MAX_ATTACHMENT_BYTES)
    throw new Error('ATTACHMENT_SIZE'); const bytes = new Uint8Array(await file.arrayBuffer()); const mimeType = attachmentType(bytes, file.type); const id = randomUUID(); await mkdir(path.dirname(location(id)), { recursive: true, mode: 0o700 }); await writeFile(location(id), bytes, { flag: 'wx', mode: 0o600 }); return { id, mimeType, byteSize: bytes.length }; }
export async function removeAttachment(id: string) { await unlink(location(id)).catch(() => undefined); }
export async function attachmentResponse(id: string, mimeType: string, range: string | null) {
    const bytes = await readFile(location(id));
    const headers = { 'Content-Type': mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    if (!range)
        return new Response(bytes, { headers: { ...headers, 'Content-Length': String(bytes.length) } });
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
    const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
    if (start > end || start >= bytes.length)
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
    return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } });
}
