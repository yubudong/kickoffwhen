import { expect, test } from 'vitest';
import { bonusSchema, summarizeTodos, todayShanghai, taskInputSchema, updateManualSchema, attachmentType } from '@/modules/todos/validation';
test('积分仅接受非负整数',()=>{ expect(bonusSchema.parse(0)).toBe(0); for(const n of [-1,1.2,NaN]) expect(bonusSchema.safeParse(n).success).toBe(false); });
test('提交和审核通过计入完成，退回重新计入待完成',()=>{expect(summarizeTodos([{status:'open'},{status:'submitted'},{status:'approved'},{status:'rejected'}])).toEqual({total:4,completed:2,remaining:2});});
test('已撤回任务不计入孩子的待完成数',()=>{expect(summarizeTodos([{status:'open'},{status:'cancelled'},{status:'approved'}])).toEqual({total:2,completed:1,remaining:1});});
test('日期使用北京时间且拒绝不存在日期',()=>{expect(todayShanghai(new Date('2026-09-22T16:30:00Z'))).toBe('2026-09-23');expect(taskInputSchema.safeParse({childId:crypto.randomUUID(),title:'阅读',requirements:'20分钟',date:'2026-02-30',commandId:crypto.randomUUID()}).success).toBe(false);});
test('普通待办编辑校验标题、要求、日期和乐观锁时间戳',()=>{
 const valid={title:'阅读',requirements:'20分钟',date:'2026-09-24',expectedUpdatedAt:'2026-09-22T12:00:00.000Z'};
 expect(updateManualSchema.parse(valid)).toEqual(valid);
 for(const input of [{...valid,title:' '},{...valid,requirements:'a'.repeat(2001)},{...valid,date:'2026-02-30'},{...valid,expectedUpdatedAt:'yesterday'}]) expect(updateManualSchema.safeParse(input).success).toBe(false);
});
test('附件通过真实头部区分类型，拒绝文本伪装图片',()=>{expect(attachmentType(new Uint8Array([255,216,255,224]),'image/jpeg')).toBe('image/jpeg');expect(()=>attachmentType(new TextEncoder().encode('<script>bad</script>'),'image/jpeg')).toThrow();expect(attachmentType(new TextEncoder().encode('ID3hello'),'audio/mpeg')).toBe('audio/mpeg');expect(attachmentType(new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109]),'video/mp4')).toBe('video/mp4');});

test('来源校验使用配置的公开地址，支持反向代理且拒绝外站',async()=>{const {isTodoOriginAllowed}=await import('@/modules/todos/origin');expect(isTodoOriginAllowed('https://kickoffwhen.com','https://kickoffwhen.com')).toBe(true);expect(isTodoOriginAllowed('http://localhost:3033','http://localhost:3033')).toBe(true);expect(isTodoOriginAllowed('https://evil.example','https://kickoffwhen.com')).toBe(false);});
