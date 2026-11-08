import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NVIDIA_API_KEY = 'test-key-not-real';
import type { AgentPorts } from '../src/agent.ts';
const { runAgent, screen, parseRepliesFromText } = await import('../src/agent.ts');

function fakePorts() {
  const calls = { flags: [] as Array<[string, string]>, alerts: [] as string[], proposed: [] as Array<[string[], string]>, logs: [] as string[] };
  const ports: AgentPorts = {
    patientName: 'Neal',
    conversation: () => [{ who: 'Mom', text: 'Are you awake?' }],
    patientState: () => ({ heart_rate_now: 72 }),
    contact: () => ({ name: 'Mom', relation: 'mother', isCaregiver: true }),
    flag: async (r, why) => { calls.flags.push([r, why]); },
    alertCaregivers: async why => { calls.alerts.push(why); },
    propose: async (r, s) => { calls.proposed.push([r, s]); },
    log: async (step, d) => { calls.logs.push(`${step}:${d}`); },
  };
  return { ports, calls };
}

function scriptedFetch(responses: unknown[]) {
  const bodies: any[] = [];
  const fn = (async (_url: string, init: any) => {
    bodies.push(JSON.parse(init.body));
    const next = responses.shift();
    if (next instanceof Response) return next;
    return new Response(JSON.stringify({ choices: [{ message: next }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, bodies };
}

const tc = (name: string, args: object, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('rule screen catches classic scams and passes normal texts', () => {
  assert.equal(screen('Your Medicare benefits are suspended. Call now and verify your account').risk, 'scam');
  assert.equal(screen('Grandma I am in jail, please send bitcoin for bail').risk, 'scam');
  assert.equal(screen('Want me to bring soup tonight?').risk, 'ok');
  assert.equal(screen('Call me back urgently').risk, 'caution');
});

test('multi-step tool run: reads context, screens, proposes 4 replies', async () => {
  const { ports, calls } = fakePorts();
  const { fn, bodies } = scriptedFetch([
    { content: null, tool_calls: [tc('get_conversation', {}), tc('get_patient_state', {})] },
    { content: null, tool_calls: [tc('screen_message', { risk: 'ok', reason: 'Known family member, ordinary question.' })] },
    { content: null, tool_calls: [tc('propose_replies', { replies: ['Yes, I am awake.', 'Very tired today.', 'Can you visit?', 'Call me later.'] })] },
  ]);
  const replies = await runAgent({ kind: 'reply', message: { body: 'Are you awake?' } }, ports, fn);
  assert.deepEqual(replies, ['Yes, I am awake.', 'Very tired today.', 'Can you visit?', 'Call me later.']);
  assert.deepEqual(calls.flags, [['ok', 'Known family member, ordinary question.']]);
  assert.equal(calls.proposed[0][1], 'nemotron');
  assert.equal(bodies.length, 3);
  assert.ok(bodies[0].tools.length >= 4, 'tools offered');
  assert.equal(bodies[1].messages.filter((m: any) => m.role === 'tool').length, 2, 'tool results fed back');
});

test('model cannot wave off a rule-detected scam', async () => {
  const { ports, calls } = fakePorts();
  const { fn } = scriptedFetch([
    { content: null, tool_calls: [tc('screen_message', { risk: 'ok', reason: 'looks fine' })] },
    { content: null, tool_calls: [tc('propose_replies', { replies: ['a', 'b', 'c', 'd'] })] },
  ]);
  await runAgent({ kind: 'reply', message: { body: 'Send your SSN to verify your account now' } }, ports, fn);
  assert.equal(calls.flags[0][0], 'caution');
});

test('Nemotron outage falls back to rules: flags scam, alerts caregivers, protective replies', async () => {
  const { ports, calls } = fakePorts();
  const { fn } = scriptedFetch([new Response('upstream down', { status: 503 })]);
  const replies = await runAgent({ kind: 'reply', message: { body: 'Buy gift cards and text me the codes, urgent' } }, ports, fn);
  assert.equal(calls.flags[0][0], 'scam');
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.proposed[0][1], 'fallback');
  assert.ok(replies.some(r => /personal info/.test(r)));
});

test('4xx on tools retries in JSON mode', async () => {
  const { ports, calls } = fakePorts();
  const { fn, bodies } = scriptedFetch([
    new Response('tools unsupported', { status: 400 }),
    { content: '<think>hmm</think>{"risk":"ok","reason":"fine","replies":["Yes","No","Later","Why?"]}' },
  ]);
  const replies = await runAgent({ kind: 'reply', message: { body: 'Dinner at 6?' } }, ports, fn);
  assert.deepEqual(replies, ['Yes', 'No', 'Later', 'Why?']);
  assert.equal(bodies[1].tools, undefined);
  assert.equal(calls.flags[0][0], 'ok');
});

test('intent expansion does not screen', async () => {
  const { ports, calls } = fakePorts();
  const { fn } = scriptedFetch([
    { content: null, tool_calls: [tc('propose_replies', { replies: ['I would love some water.', 'Water later, please.', 'Is there cold water?', 'Water and a straw.'] })] },
  ]);
  await runAgent({ kind: 'intent', keywords: 'water' }, ports, fn);
  assert.equal(calls.flags.length, 0);
  assert.equal(calls.proposed[0][0].length, 4);
});

test('reply parser handles JSON, numbered lists and thinking tags', () => {
  assert.deepEqual(parseRepliesFromText('{"replies":["a","b"]}'), ['a', 'b']);
  assert.deepEqual(parseRepliesFromText('<think>x</think>1. Yes\n2. No\n3. Later'), ['Yes', 'No', 'Later']);
});
