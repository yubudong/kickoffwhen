import { z } from 'zod';
import { env } from '@/config/runtime';
import { requireParentActor } from '@/modules/auth/parent-access';
import { requireChildActor } from '@/modules/devices/child-actor';
import { isTodoOriginAllowed } from './origin';
import { createHomeworkService } from './homework-service';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const errors:Record<string,string>={TODO_NOT_FOUND:'作业不存在或无权访问。',TODO_STALE:'作业状态已更新，请读取最新进度后重试。',HOMEWORK_DRAFT_CONFLICT:'批改草稿已在另一页面更新，请先读取最新草稿。',HOMEWORK_COMMAND_CONFLICT:'本次重试的内容已变化，请读取最新进度。',HOMEWORK_REQUIREMENTS_REQUIRED:'退回订正前，请填写具体的文字要求。',HOMEWORK_PAGE_SCOPE:'图片或订正关联不属于这份作业，请重新选择。',HOMEWORK_PAGES_DUPLICATE:'同一图片或页面不能重复提交。',HOMEWORK_MARK_INVALID:'批注位置或内容不正确，请检查。',HOMEWORK_MARK_LIMIT:'批注过多，请精简后提交。',HOMEWORK_IMAGE_INVALID:'照片无法读取或像素过大，请重新拍摄。',HOMEWORK_IMAGE_ONLY:'多页作业请选择图片，音视频请使用原提交入口。',HOMEWORK_UPLOAD_LIMIT:'这份作业暂存图片较多，请使用已上传图片或稍后再试。',DICTATION_INCOMPLETE:'请先完成听写及错词订正。',ATTACHMENT_SIZE:'单张图片请控制在8MB以内。',ATTACHMENT_TYPE:'请选择可读取的JPEG、PNG或WebP照片。',WEEKLY_LIMIT:'本周次数已达标或当天任务已完成。',HABIT_DATE:'该周次数任务请在对应当天完成。'};
async function boundedBody(request:Request,limit:number){
 if(Number(request.headers.get('content-length')??0)>limit)throw new Error('HOMEWORK_BODY_LIMIT');
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();const parts:Uint8Array[]=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();throw new Error('HOMEWORK_BODY_LIMIT')}parts.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}return bytes;
}
export async function homeworkHandler(request:Request,role:'parent'|'child',todoId?:string,upload=false){
 let actor;try{actor=role==='parent'?await requireParentActor(request.headers):await requireChildActor(request)}catch{return json({error:'请重新登录或选择孩子。'},401)}
 try{
  const service=createHomeworkService();
  if(request.method==='GET'){if(todoId)return json(await service.view(actor,todoId));const childId=role==='parent'?new URL(request.url).searchParams.get('childId')??undefined:undefined;return json({tasks:await service.corrections(actor,childId)})}
  if(!todoId)throw new Error('TODO_NOT_FOUND');
  if(!isTodoOriginAllowed(request.headers.get('origin'),env.appUrl))return json({error:'请求来源无效。'},403);
  if(upload&&actor.role==='child'){
   if(Number(request.headers.get('content-length')??0)>9*1024*1024)throw new Error('ATTACHMENT_SIZE');
   const bytes=await boundedBody(request,9*1024*1024);const form=await new Response(bytes,{headers:{'content-type':request.headers.get('content-type')??''}}).formData(),file=form.get('file');if(!(file instanceof File))throw new Error('ATTACHMENT_TYPE');const item=await service.upload(actor,todoId,z.string().uuid().parse(form.get('commandId')),file);return json({upload:{id:item.id,mimeType:item.mimeType,byteSize:item.byteSize,width:item.width,height:item.height}},201);
  }
  const text=new TextDecoder().decode(await boundedBody(request,4*1024*1024));if(text.length>2200000)return json({error:'批注内容过多，请精简后保存。'},413);const value=JSON.parse(text);
  if(actor.role==='child')await service.submit(actor,todoId,value);else await service.review(actor,todoId,value);
  return json(await service.view(actor,todoId));
 }catch(error){const code=error instanceof Error?error.message:'';if(error instanceof z.ZodError||error instanceof SyntaxError)return json({error:'请核对输入内容；每次最多20张照片，退回时填写具体要求。'},400);if(code==='HOMEWORK_BODY_LIMIT')return json({error:'上传内容过大，请减少图片大小或批注。'},413);if(code==='TODO_NOT_FOUND')return json({error:errors[code]},404);return json({error:errors[code]??'操作未保存，请读取最新进度后重试。',...(errors[code]?{code}:{})},409)}
}
