import { z } from 'zod';
import { env } from '@/config/runtime';
import { requireParentActor } from '@/modules/auth/parent-access';
import { requireChildActor } from '@/modules/devices/child-actor';
import { isTodoOriginAllowed } from '@/modules/todos/origin';
import { createEngagementService } from './service';
const messages: Record<string, string> = { HUMAN_STYLE_UNAVAILABLE: '这位伙伴采用男性化形路线，可以选择动物形态或男性形态。', FORM_LOCKED: '这个年龄形态还没有解锁，继续投喂并见证成长吧。', TRANSFORM_UNAVAILABLE: '这位伙伴保持动物或神兽形态；可化形伙伴需解锁少年期后选择人形。', PRICE_CHANGED: '价格已更新，请刷新后重新确认兑换。', NOT_FOUND: '内容不存在或无权访问。', FORBIDDEN: '此操作需要家长确认。', HABIT_LIMIT: '每个孩子最多保留5个活跃习惯，请先停止一个习惯。', TASK_NOT_OPEN: '任务已提交或已结束，请刷新清单。', TODO_KIND: '听写任务请在听写页面管理。', PARENT_CHANGE_REQUIRED: '孵化后更换伙伴需要家长确认。', PET_REQUIRED: '请先选择一颗宠物蛋。', NO_GROWTH: '还没有可投喂的成长值，完成任务后再来吧。', EVOLUTION_READY: '伙伴已准备好变化，请先点击孵化或见证成长。', NOT_READY: '还没有达到下一阶段，继续陪伴伙伴吧。', INSUFFICIENT_BALANCE: '可用星币或成长值不足。', ALREADY_OWNED: '这件永久装饰已经在你的背包里。', ITEM_NOT_FOUND: '找不到这件物品。', ITEM_NOT_OWNED: '背包里还没有这件物品。', BOOST_LIMIT: '成长加成合计最多30%，请等已有祝福到期后再激活。', REQUEST_EXISTS: '这个奖励已有待处理的兑换申请。', REWARD_USED: '这个奖励只能兑换一次。', WEEKLY_LIMIT: '本周已达到兑换或完成次数上限。', INVALID_STATE: '状态已变化，请刷新后重试。' };
export async function engagementHandler(request: Request, role: 'parent' | 'child') {
    let actor;
    try {
        actor = role === 'parent' ? await requireParentActor(request.headers) : await requireChildActor(request);
    }
    catch {
        return Response.json({ error: '请重新登录。' }, { status: 401 });
    }
    const service = createEngagementService();
    try {
        if (request.method === 'GET') {
            const u = new URL(request.url);
            if (role === 'parent' && u.searchParams.get('children') === '1')
                return Response.json({ children: await service.childrenList(actor) }, { headers: { 'Cache-Control': 'no-store' } });
            return Response.json(await service.list(actor, role === 'parent' ? u.searchParams.get('childId') ?? undefined : undefined), { headers: { 'Cache-Control': 'no-store' } });
        }
        if (!isTodoOriginAllowed(request.headers.get('origin'), env.appUrl))
            return Response.json({ error: '请求来源无效。' }, { status: 403 });
        const v = await request.json();
        const action = z.string().parse(v.action);
        if (actor.role === 'child')
            delete v.childId;
        switch (action) {
            case 'adjust-balance':
                await service.adjustBalance(actor, v);
                break;
            case 'habit':
                await service.createHabit(actor, v);
                break;
            case 'stop-habit':
                await service.stopHabit(actor, v.id);
                break;
            case 'skip':
            case 'postpone':
                await service.adjustOccurrence(actor, v.id, action, z.iso.datetime().parse(v.expectedUpdatedAt));
                break;
            case 'choose-pet':
                await service.choosePet(actor, v);
                break;
            case 'feed':
                await service.feed(actor, v);
                break;
            case 'evolve':
                await service.evolve(actor, v.childId);
                break;
            case 'appearance':
                await service.appearance(actor, v);
                break;
            case 'buy':
                await service.buy(actor, v);
                break;
            case 'use-item':
                await service.useItem(actor, v);
                break;
            case 'save-reward':
                await service.saveReward(actor, v);
                break;
            case 'request-reward':
                await service.requestReward(actor, v);
                break;
            case 'decide-reward':
                await service.decideReward(actor, v);
                break;
            default: throw new Error('INVALID_ACTION');
        }
        return Response.json({ ok: true });
    }
    catch (error) {
        const code = error instanceof Error ? error.message : '';
        return Response.json({ error: messages[code] ?? '请检查填写内容后重试。' }, { status: code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : error instanceof z.ZodError ? 400 : 409 });
    }
}
