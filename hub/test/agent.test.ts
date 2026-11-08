import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentPorts } from '../src/agent.ts';

process.env.NVIDIA_API_KEY = 'test-key-not-real';
process.env.NEMOTRON_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const { runAgent, parseRepliesFromText } = await import('../src/agent.ts');

function fakePorts() {
  const calls = { alerts: [] as string[], proposed: [] as Array<[string[], string]>, logs: [] as string[] };
  const ports: AgentPorts = {
    patientName: 'Neal',
    conversation: () => [{ who: 'Mom', text: 'Are you awake?' }],
    patientState: () => ({ heart_rate_now: 72 }),
    contact: () => ({ name: 'Mom', relation: 'mother', isCaregiver: true }),
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

test('multi-step tool run: reads context, then proposes 4 replies', async () => {
  const { ports, calls } = fakePorts();
  const { fn, bodies } = scriptedFetch([
    { content: null, tool_calls: [tc('get_conversation', {}), tc('get_patient_state', {})] },
    { content: null, tool_calls: [tc('propose_replies', { replies: ['Yes, I am awake.', 'Very tired today.', 'Can you visit?', 'Call me later.'] })] },
  ]);
  const replies = await runAgent({ kind: 'reply', message: { body: 'Are you awake?' } }, ports, fn);
  assert.deepEqual(replies, ['Yes, I am awake.', 'Very tired today.', 'Can you visit?', 'Call me later.']);
  assert.equal(calls.proposed[0][1], 'nemotron');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].tools.length, 4, 'tools offered');
  assert.equal(bodies[1].messages.filter((m: any) => m.role === 'tool').length, 2, 'tool results fed back');
  assert.ok(calls.logs.some(l => l.startsWith('plan:')));
});

test('agent can alert caregivers once, then still proposes replies', async () => {
  const { ports, calls } = fakePorts();
  const { fn } = scriptedFetch([
    { content: null, tool_calls: [tc('alert_caregivers', { reason: 'Nurse says Neal fell' }), tc('alert_caregivers', { reason: 'again' }, 'b')] },
    { content: null, tool_calls: [tc('propose_replies', { replies: ['I am okay.', 'Please come now.', 'Call Mom.', 'Thank you.'] })] },
  ]);
  await runAgent({ kind: 'reply', message: { body: 'Neal fell out of bed, is someone coming?' } }, ports, fn);
  assert.deepEqual(calls.alerts, ['Nurse says Neal fell']);
  assert.equal(calls.proposed.length, 1);
});

test('Nemotron outage falls back to built-in replies', async () => {
  const { ports, calls } = fakePorts();
  const { fn } = scriptedFetch([new Response('upstream down', { status: 503 })]);
  const replies = await runAgent({ kind: 'reply', message: { body: 'Want me to bring dinner?' } }, ports, fn);
  assert.equal(calls.proposed[0][1], 'fallback');
  assert.equal(replies.length, 4);
  assert.ok(calls.logs.some(l => l.startsWith('fallback:')));
});

test('4xx on tools retries in JSON mode', async () => {
  const { ports } = fakePorts();
  const { fn, bodies } = scriptedFetch([
    new Response('tools unsupported', { status: 400 }),
    { content: '<think>hmm</think>{"replies":["Yes","No","Later","Why?"]}' },
  ]);
  const replies = await runAgent({ kind: 'reply', message: { body: 'Dinner at 6?' } }, ports, fn);
  assert.deepEqual(replies, ['Yes', 'No', 'Later', 'Why?']);
  assert.equal(bodies[1].tools, undefined);
});

test('intent expansion produces full sentences', async () => {
  const { ports, calls } = fakePorts();
  const { fn } = scriptedFetch([
    { content: null, tool_calls: [tc('propose_replies', { replies: ['I would love some water.', 'Water later, please.', 'Is there cold water?', 'Water and a straw.'] })] },
  ]);
  await runAgent({ kind: 'intent', keywords: 'water' }, ports, fn);
  assert.equal(calls.proposed[0][0].length, 4);
});

test('reply parser handles JSON, numbered lists and thinking tags', () => {
  assert.deepEqual(parseRepliesFromText('{"replies":["a","b"]}'), ['a', 'b']);
  assert.deepEqual(parseRepliesFromText('<think>x</think>1. Yes\n2. No\n3. Later'), ['Yes', 'No', 'Later']);
});
