import { expect,test } from 'vitest';
import { habitChangeDate,habitConfig,effectiveHabit } from '@/modules/engagement/habit-rules';
const base={id:'h',...habitConfig({title:'旧规则',schedule:'daily'})};
test('连续编辑同一生效日采用最新版本，但不影响之前日期',()=>{const versions=[{id:'v1',habitId:'h',version:1,effectiveFrom:'2026-11-01',config:habitConfig(base)},{id:'v2',habitId:'h',version:2,effectiveFrom:'2026-11-26',config:habitConfig({...base,title:'第二版'})},{id:'v3',habitId:'h',version:3,effectiveFrom:'2026-11-26',config:habitConfig({...base,title:'第三版'})}];expect(effectiveHabit(base,versions,'2026-11-25')).toMatchObject({title:'旧规则',habitRevisionId:'v1'});expect(effectiveHabit(base,versions,'2026-11-26')).toMatchObject({title:'第三版',habitRevisionId:'v3'});expect(base.title).toBe('旧规则')});
test('默认次日生效，未来开始的习惯不会提前生成任务',()=>{expect(habitChangeDate('2026-11-25','2026-11-01')).toBe('2026-11-26');expect(habitChangeDate('2026-11-25','2026-12-01')).toBe('2026-12-01')});
test('编辑仍验证执行日和奖励范围',()=>{expect(()=>habitConfig({...base,schedule:'weekdays',weekdays:[]})).toThrow();expect(()=>habitConfig({...base,coins:-1})).toThrow();expect(()=>habitConfig({...base,weeklyTarget:8})).toThrow()});
