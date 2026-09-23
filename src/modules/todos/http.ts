import { env } from '@/config/runtime';
import { isTodoOriginAllowed } from './origin';
import { z } from 'zod';
import { requireParentActor } from '@/modules/auth/parent-access';
import { requireChildActor } from '@/modules/devices/child-actor';
import { createTodoService } from './service';
import { saveAttachment, removeAttachment } from './attachments';
import { todayShanghai } from './validation';
export async function todosHandler(request: Request, role: 'parent' | 'child') {
    let actor;
    try {
        actor = role === 'parent' ? await requireParentActor(request.headers) : await requireChildActor(request);
    }
    catch {
        return Response.json({ error: '请重新登录。' }, { status: 401 });
    }
    const service = createTodoService();
    try {
        if (request.method === 'GET') {
            const u = new URL(request.url);
            return Response.json(await service.list(actor, u.searchParams.get('date') ?? todayShanghai(), role === 'parent' ? u.searchParams.get('childId') ?? undefined : undefined), { headers: { 'Cache-Control': 'no-store' } });
        }
        const origin = request.headers.get('origin');
        if (!isTodoOriginAllowed(origin, env.appUrl))
            return Response.json({ error: '请求来源无效。' }, { status: 403 });
        if (role === 'parent' && actor.role === 'guardian') {
            const v = await request.json();
            if (v.action === 'review')
                await service.review(actor, v.id, v);
            else if (v.action === 'update')
                await service.updateManual(actor, v.id, v);
            else if (v.action === 'cancel')
                await service.cancelManual(actor, v.id);
            else if (v.action === undefined)
                await service.create(actor, v);
            else
                throw new Error('TODO_ACTION');
        }
        else if (actor.role === 'child') {
            if (Number(request.headers.get('content-length') ?? 0) > 9 * 1024 * 1024)
                throw new Error('ATTACHMENT_SIZE');
            const form = await request.formData();
            const id = z.string().uuid().parse(form.get('id'));
            const number = z.coerce.number().int().nonnegative().parse(form.get('number'));
            // Authorize the task before accepting or persisting any evidence file.
            const rows = await service.list(actor, z.string().parse(form.get('date')));
            if (!rows.tasks.some(t => t.id === id))
                throw new Error('TODO_NOT_FOUND');
            const file = form.get('file');
            const attachment = file instanceof File && file.size ? await saveAttachment(file) : undefined;
            try {
                await service.submit(actor, id, number, attachment);
            }
            catch (e) {
                if (attachment)
                    await removeAttachment(attachment.id);
                throw e;
            }
        }
        return Response.json({ ok: true });
    }
    catch (error) {
        const m = error instanceof Error ? error.message : '';
        const message = m === 'TODO_STALE' ? '任务状态已更新，请刷新后重试。' : m === 'TODO_KIND' ? '听写任务请在听写页面管理。' : m === 'TODO_REWARDED' ? '任务已审核并发放积分，不能撤回。' : m === 'DICTATION_INCOMPLETE' ? '请先完成听写及订正。' : m === 'DICTATION_IMAGE_ONLY' ? '听写只能上传图片，也可以不上传照片直接提交。' : m.startsWith('ATTACHMENT') ? '请选择8MB以内的图片、音频或视频，或不带附件提交。' : m === 'TODO_NOT_FOUND' ? '任务不存在或无权访问。' : '请检查填写内容后重试。';
        return Response.json({ error: message }, { status: m === 'TODO_NOT_FOUND' ? 404 : error instanceof z.ZodError ? 400 : 409 });
    }
}
