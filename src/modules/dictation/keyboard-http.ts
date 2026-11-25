import { z } from 'zod';
import { requireChildActor } from '@/modules/devices/child-actor';
import { requireParentActor } from '@/modules/auth/parent-access';
import { createKeyboardService } from './keyboard-service';
import { keyboardParentReports } from './keyboard-view';
import { childDictationViewService } from './child-view-service';
const noStore={'cache-control':'no-store'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:noStore});
export const keyboardErrors:Record<string,string>={KEYBOARD_DRAFT_CONFLICT:'草稿已在另一页面更新，请先读取最新进度。',DICTATION_VERSION_CONFLICT:'听写进度已更新，请先读取最新进度。',DICTATION_ROUND_CONFLICT:'本轮已经结束，请读取最新进度。',KEYBOARD_ROUND_INCOMPLETE:'请先听完本轮每一道题，再提交。',KEYBOARD_REVIEW_INCOMPLETE:'请逐项确认全部待复核写法。',KEYBOARD_REVIEW_NOT_READY:'这份结果已处理，请刷新。',KEYBOARD_ALREADY_SUBMITTED:'本轮已经交卷，请读取最新进度。',KEYBOARD_RESULT_NOT_READY:'本轮尚未完成核对。',KEYBOARD_REVIEW_PENDING:'请等待家长确认待复核写法。',COMMAND_CONFLICT:'这次重试的内容已变化，请读取最新进度。'};
async function body(request:Request){const text=await request.text();if(text.length>150000)throw new Error('INVALID_REQUEST');return JSON.parse(text)}
export async function keyboardChildPost(request:Request,sessionId:string){
 let actor;try{actor=await requireChildActor(request)}catch{return json({error:'登录已失效，请重新选择孩子。'},401)}
 try{await createKeyboardService().command(actor,sessionId,await body(request));return json({session:await childDictationViewService.getSession(actor,sessionId)})}
 catch(error){const code=error instanceof Error?error.message:'';if(error instanceof z.ZodError||error instanceof SyntaxError||code==='INVALID_REQUEST')return json({error:'输入格式不正确。'},400);if(['DICTATION_SESSION_NOT_FOUND','TASK_NOT_ACTIVE','DICTATION_SESSION_NOT_ACTIVE'].includes(code))return json({error:'这项任务已撤回或不可访问。'},404);return json({...(keyboardErrors[code]?{code}:{}),error:keyboardErrors[code]??'没有保存成功，请核对进度后重试。'},409)}
}
export async function keyboardParentGet(request:Request){let actor;try{actor=await requireParentActor(request.headers)}catch(error){return authFailure(error)}return json({reports:await keyboardParentReports(actor)})}
function authFailure(error:unknown){const code=error instanceof Error?error.message:'';return json({error:'请登录并解锁家长模式。'},code==='AUTHENTICATION_REQUIRED'?401:403)}
export async function keyboardParentPost(request:Request){
 let actor;try{actor=await requireParentActor(request.headers)}catch(error){return authFailure(error)}
 try{await createKeyboardService().review(actor,await body(request));return json({ok:true})}catch(error){const code=error instanceof Error?error.message:'';if(error instanceof z.ZodError||error instanceof SyntaxError)return json({error:'请标记待确认项目并填写复核说明。'},400);return json({error:keyboardErrors[code]??'无法处理这份结果，请刷新后重试。'},code==='DICTATION_SESSION_NOT_FOUND'?404:409)}
}
