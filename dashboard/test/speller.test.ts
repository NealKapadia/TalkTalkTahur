import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Speller } from '../src/speller.ts';

const make = () => {
  const out = { said: [] as string[], sent: [] as string[], expanded: [] as string[] };
  const s = new Speller({ speak: t => out.said.push(t), reply: t => out.sent.push(t), expand: k => out.expanded.push(k) });
  return { s, out };
};
const focus = (s: Speller, kind: string, value?: string) => { s.idx = s.items.findIndex(i => i.kind === kind && (value === undefined || i.value === value)); assert.ok(s.idx >= 0, `${kind} ${value} present`); };

test('spell "wa", take the phrase suggestion, it is spoken', () => {
  const { s, out } = make();
  for (const [g, l] of [['UVWXYZ', 'W'], ['ABCDE', 'A']]) { focus(s, 'group', g); s.select(); focus(s, 'letter', l); s.select(); }
  assert.equal(s.text, 'Wa');
  assert.equal(s.items[s.idx].kind, 'phrase', 'focus lands on the first suggestion');
  s.select();
  assert.deepEqual(out.said, ["I'd like some water, please."]);
  assert.equal(s.text, '');
});

test('AI replies come first, one select texts it', () => {
  const { s, out } = make();
  assert.ok(s.setContext({ replies: ['Yes, come by.', 'Not tonight.'], canText: true }));
  assert.deepEqual(s.items[s.idx], { kind: 'reply', value: 'Yes, come by.' });
  s.select();
  assert.deepEqual(out.sent, ['Yes, come by.']);
  assert.equal(s.items.filter(i => i.kind === 'reply').length, 0);
});

test('Text it and AI expand appear once there are words', () => {
  const { s, out } = make();
  s.setContext({ canText: true });
  s.text = 'water later'; s.rebuild();
  focus(s, 'expand'); s.select();
  assert.deepEqual(out.expanded, ['water later']);
  s.text = 'ok'; s.rebuild();
  focus(s, 'text'); s.select();
  assert.deepEqual(out.sent, ['ok']);
});

test('move wraps around', () => {
  const { s } = make();
  s.idx = 0; s.move(-1);
  assert.equal(s.idx, s.items.length - 1);
});
