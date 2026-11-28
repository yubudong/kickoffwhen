import { z } from 'zod';
import { env } from '@/config/runtime';
import { requireParentActor } from '@/modules/auth/parent-access';
import { isTodoOriginAllowed } from '@/modules/todos/origin';
import { createTaskTemplateService } from '@/modules/todos/template-service';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
export async function GET(request:Request){let actor;try{actor=await requireParentActor(request.headers)}catch{return json({error:'请登录并解锁家长模式。'},401)}return json({templates:await createTaskTemplateService().list(actor)})}
export async function POST(request:Request){
 let actor;try{actor=await requireParentActor(request.headers)}catch{return json({error:'请登录并解锁家长模式。'},401)}
 if(!isTodoOriginAllowed(request.headers.get('origin'),env.appUrl))return json({error:'请求来源无效。'},403);
 try{if(Number(request.headers.get('content-length')??0)>24000)return json({error:'模板内容过长。'},413);const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let length=0;if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>24000){await reader.cancel();return json({error:'模板内容过长。'},413)}chunks.push(value)}}finally{reader.releaseLock()}const bytes=new Uint8Array(length);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.length}const input=JSON.parse(new TextDecoder().decode(bytes));const service=createTaskTemplateService();const template=await service.mutate(actor,input);return json({template,templates:await service.list(actor)})}
 catch(error){const code=error instanceof Error?error.message:'';if(error instanceof z.ZodError||error instanceof SyntaxError)return json({error:'请填写任务名称，奖励为0至10000的整数，要求最多2000字。'},400);if(code==='FORBIDDEN')return json({error:'无权管理这个家庭的模板。'},403);if(code==='TEMPLATE_NOT_FOUND')return json({error:'模板不存在或无权访问。'},404);return json({error:code==='TEMPLATE_STALE'?'模板已被修改或删除，请刷新后再编辑。':code==='TEMPLATE_LIMIT'?'常用模板已达200个，请先删除不再使用的模板。':code==='TEMPLATE_COMMAND_CONFLICT'?'重试内容已变化，请刷新模板列表后重试。':'保存未完成，请重试相同操作或刷新列表。'},409)}
}
