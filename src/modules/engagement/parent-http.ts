import { requireParentActor } from '@/modules/auth/parent-access';
import { createParentWorkflows } from './parent-workflows';
export async function parentWorkflowsGet(request: Request, view: 'family' | 'actions') {
  try {
    const actor=await requireParentActor(request.headers);
    const service=createParentWorkflows();
    return Response.json(await (view==='family'?service.family(actor):service.actions(actor)),{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    const code=error instanceof Error?error.message:'';
    const status=code==='AUTHENTICATION_REQUIRED'?401:['PARENT_UNLOCK_INVALID','FAMILY_OWNER_REQUIRED','GUARDIAN_MEMBERSHIP_REQUIRED','FORBIDDEN'].includes(code)?403:500;
    return Response.json({error:status===401?'请先登录。':status===403?'请先解锁家长模式。':'读取失败，请稍后重试。'},{status,headers:{'Cache-Control':'no-store'}});
  }
}
