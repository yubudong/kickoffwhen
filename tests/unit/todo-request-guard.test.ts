import { expect, test } from 'vitest';
import { createTodoRequestGuard } from '@/modules/todos/request-guard';
test('切换孩子后旧刷新和旧提交回调不能覆盖新孩子清单', () => {
  const guard = createTodoRequestGuard('A');
  const a = guard.begin('A');
  guard.select('B');
  const b = guard.begin('B');
  expect(guard.isCurrent(b)).toBe(true);
  expect(guard.isCurrent(a)).toBe(false);
  expect(guard.begin('A')).toBeNull();
  expect(guard.isCurrent(b)).toBe(true);
  const newer = guard.begin('B');
  expect(guard.isCurrent(b)).toBe(false);
  expect(guard.isCurrent(newer)).toBe(true);
});
