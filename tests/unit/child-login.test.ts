import {expect,test} from 'vitest';
import {loadChildLogin} from '@/modules/devices/child-login';
test('未配对不读取孩子资料',async()=>{const r=await loadChildLogin(undefined,async()=>{throw Error('must not query');});expect(r).toEqual({state:'unpaired',children:[]});});
test('失效配对返回重新配对状态',async()=>{expect(await loadChildLogin('expired',async()=>{throw Error('DEVICE_INVALID');})).toEqual({state:'unpaired',children:[]});});
test('只返回设备服务授权的孩子，空授权明确显示为空',async()=>{const children=[{id:'a',nickname:'测试孩子',avatarKey:'star',requiresPin:true}];expect(await loadChildLogin('paired',async()=>children)).toEqual({state:'paired',children});expect(await loadChildLogin('paired',async()=>[])).toEqual({state:'paired',children:[]});});
test('数据库故障不能伪装成配对失效',async()=>{await expect(loadChildLogin('paired',async()=>{throw Error('database unavailable');})).rejects.toThrow('database unavailable');});
