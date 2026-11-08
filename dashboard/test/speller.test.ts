import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Speller, spellCost } from '../src/speller.ts';

const make = () => {
  const out = { said: [] as string[], sent: [] as string[], to: [] as Array<string | undefined>, expanded: [] as string[] };
  const s = new Speller({ speak: t => out.said.push(t), send: (t, c) => { out.sent.push(t); out.to.push(c); }, expand: k => out.expanded.push(k) });
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
  assert.ok(s.setContext({ replies: [{ text: 'Yes, come by.' }, { text: 'Not tonight.' }], canText: true }));
  assert.equal(s.items[s.idx].value, 'Yes, come by.');
  s.select();
  assert.deepEqual(out.sent, ['Yes, come by.']);
  assert.equal(s.items.filter(i => i.kind === 'reply').length, 0);
});

test('Text it and AI expand appear once there are words', () => {
  const { s, out } = make();
  s.setContext({ canText: true, contacts: [{ id: '1', name: 'Mom' }] });
  s.text = 'water later'; s.rebuild();
  focus(s, 'expand'); s.select();
  assert.deepEqual(out.expanded, ['water later']);
  s.text = 'ok'; s.rebuild();
  focus(s, 'text'); s.select();
  assert.deepEqual(out.sent, ['ok']);
  assert.deepEqual(out.to, ['1'], 'only one contact: sent straight to them');
});

test('move wraps around', () => {
  const { s } = make();
  s.idx = 0; s.move(-1);
  assert.equal(s.idx, s.items.length - 1);
});

test('Text it with several contacts: patient chooses who gets it', () => {
  const { s, out } = make();
  s.setContext({ canText: true, contacts: [{ id: '1', name: 'Mom' }, { id: '2', name: 'Alex' }] });
  s.text = 'pho please'; s.rebuild();
  focus(s, 'text'); s.select();
  assert.equal(s.mode, 'to');
  assert.deepEqual(s.items.map(i => i.value), ['Mom', 'Alex', 'Back']);
  focus(s, 'contact', 'Alex'); s.select();
  assert.deepEqual(out.sent, ['pho please']);
  assert.deepEqual(out.to, ['2']);
  assert.equal(s.mode, 'main');
  assert.match(s.status, /Alex/);
});

test('AI suggestions addressed to someone are sent to that person', () => {
  const { s, out } = make();
  s.setContext({ replies: [{ text: 'Can you bring pho?', contactId: '2', to: 'Alex' }], canText: true });
  assert.equal(s.items[s.idx].to, 'Alex');
  s.select();
  assert.deepEqual(out.to, ['2']);
});

test('spelling cost: longer messages cost more eye movements', () => {
  const short = spellCost('hi'), long = spellCost('can you bring pho tonight');
  assert.ok(short >= 4 && short < 20, String(short));
  assert.ok(long > 60, String(long));
});
