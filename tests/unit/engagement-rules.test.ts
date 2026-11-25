import { expect, test } from 'vitest';
import { scheduled, weekOf, nextDate, feedAmount, boostedGrowth } from '@/modules/engagement/rules';
test('周一开始且年末日期与指定星期准确', () => { expect(weekOf('2027-01-03')).toBe('2026-12-28'); expect(nextDate('2026-12-31')).toBe('2027-01-01'); const rule = { schedule: 'weekdays', weekdays: [1, 3, 5], weeklyTarget: 3, startDate: '2026-11-01', stoppedOn: '2026-12-01' }; expect(scheduled(rule, '2026-11-23')).toBe(true); expect(scheduled(rule, '2026-11-24')).toBe(false); expect(scheduled(rule, '2026-12-02')).toBe(false); });
test('投喂停在下一门槛，不能跳过孵化，最终阶段可继续成长', () => { expect(feedAmount(0, 10, 100, 100)).toBe(40); expect(() => feedAmount(0, 50, 100, 100)).toThrow('EVOLUTION_READY'); expect(feedAmount(4, 1800, 35, 100)).toBe(35); });
test('加成向下取整且最高30%，不影响已有成长', () => { expect(boostedGrowth(10, 10)).toBe(11); expect(boostedGrowth(10, 200)).toBe(13); expect(boostedGrowth(1, 10)).toBe(1); });
