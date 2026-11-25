import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { CompanionFormChoices } from '@/components/engagement/companion-forms';

test('尚未化形也直接显示男性和女性入口，低年龄明确禁用', () => {
  const html = renderToStaticMarkup(<CompanionFormChoices species="fox" stage={1} value="animal" onChange={() => {}}/>);
  expect(html).toContain('动物形态'); expect(html).toContain('男性形态'); expect(html).toContain('女性形态');
  expect(html.match(/<button/g)).toHaveLength(3);
  expect(html.match(/disabled=""/g)).toHaveLength(2);
  expect(html).toContain('少年期解锁后可以选择');
});

test('男性路线直接显示男性选项且不提供无法实现的女性选项', () => {
  const html = renderToStaticMarkup(<CompanionFormChoices species="ape" stage={4} value="boy" onChange={() => {}}/>);
  expect(html).toContain('男性形态'); expect(html).not.toContain('女性形态');
  expect(html.match(/<button/g)).toHaveLength(2);
  expect(html).toMatch(/aria-pressed="true"[^>]*>男性形态/);
  expect(html).not.toContain('<select');
});

test('原有女性形态保留时男性选项仍然可见，纯动物只有动物入口', () => {
  const female = renderToStaticMarkup(<CompanionFormChoices species="phoenix" stage={3} value="girl" onChange={() => {}}/>);
  expect(female).toContain('男性形态'); expect(female).toMatch(/aria-pressed="true"[^>]*>女性形态/);
  const animal = renderToStaticMarkup(<CompanionFormChoices species="dragon" stage={4} value="animal" onChange={() => {}}/>);
  expect(animal.match(/<button/g)).toHaveLength(1); expect(animal).not.toContain('男性形态');
});
