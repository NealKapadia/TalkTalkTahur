import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentPorts } from '../src/agent.ts';
import type { Period } from '../src/briefing.ts';

process.env.AZURE_OPENAI_API_KEY = 'test-azure-key';
process.env.AZURE_OPENAI_ENDPOINT = 'https://example.services.ai.azure.com/openai/v1/';
process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-chat-latest-2';
process.env.NVIDIA_API_KEY = 'nvapi-should-not-be-used';
process.env.GEMINI_API_KEY = 'gemini-should-not-be-used';
const { runAgent, describeImage } = await import('../src/agent.ts');
const { writeBriefing } = await import('../src/briefing.ts');
const { provider, modelLabel } = await import('../src/llm.ts');

function recorder(replies: Array<unknown | Response>) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fn = (async (url: string, init: any) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const next = replies.shift();
    if (next instanceof Response) return next;
    return new Response(JSON.stringify({ choices: [{ message: next }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ports = (): { ports: AgentPorts; proposed: Array<[string[], string]> } => {
  const proposed: Array<[string[], string]> = [];
  return {
    proposed,
    ports: {
      patientName: 'Neal',
      conversation: () => [{ who: 'Mom', text: 'Are you awake?' }],
      patientState: () => ({ heart_rate_now: 72 }),
      contact: () => ({ name: 'Mom', relation: 'mother', isCaregiver: true }),
      contacts: () => [{ id: 1n, name: 'Mom', relation: 'mother' }],
      alertCaregivers: async () => {},
      propose: async (r, s) => { proposed.push([r, s]); },
      log: async () => {},
    },
  };
};

test('Azure key set: Azure is the provider for everything', () => {
  assert.equal(provider(), 'azure');
  assert.equal(modelLabel(), 'azure:gpt-chat-latest-2');
});

test('agent: tool calls go to Azure chat/completions with the deployment, both auth headers, no Nemotron-only fields', async () => {
  const { fn, calls } = recorder([
    { content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'get_conversation', arguments: '{}' } }] },
    { content: null, tool_calls: [{ id: 'b', type: 'function', function: { name: 'propose_replies', arguments: JSON.stringify({ replies: ['Yes, I am up.', 'Not yet.', 'Come by later?', 'Love you.'] }) } }] },
  ]);
  const { ports: p, proposed } = ports();
  const out = await runAgent({ kind: 'reply', message: { body: 'Are you awake?' } }, p, fn);
  assert.deepEqual(out, ['Yes, I am up.', 'Not yet.', 'Come by later?', 'Love you.']);
  assert.equal(proposed[0][1], 'ai');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://example.services.ai.azure.com/openai/v1/chat/completions');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-azure-key');
  assert.equal(calls[0].headers['api-key'], 'test-azure-key');
  assert.equal(calls[0].body.model, 'gpt-chat-latest-2');
  assert.equal(calls[0].body.max_completion_tokens, 800);
  assert.ok(Array.isArray(calls[0].body.tools));
  for (const k of ['chat_template_kwargs', 'temperature', 'top_p', 'max_tokens']) assert.equal(k in calls[0].body, false, k);
  assert.equal(calls[1].body.messages.at(-1).role, 'tool');
});

test('a deployment that rejects max_completion_tokens is retried once with max_tokens', async () => {
  const { fn, calls } = recorder([
    new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_completion_tokens'" } }), { status: 400 }),
    { content: '{"replies":["Yes.","No.","Later.","Call me?"]}' },
  ]);
  const { ports: p } = ports();
  const out = await runAgent({ kind: 'reply', message: { body: 'Are you awake?' } }, p, fn);
  assert.deepEqual(out, ['Yes.', 'No.', 'Later.', 'Call me?']);
  assert.equal(calls[1].body.max_tokens, 800);
  assert.equal('max_completion_tokens' in calls[1].body, false);
});

test('Azure outage: built-in replies, never a crash', async () => {
  const { fn } = recorder([new Response('server error', { status: 500 })]);
  const { ports: p, proposed } = ports();
  const out = await runAgent({ kind: 'reply', message: { body: 'Are you awake?' } }, p, fn);
  assert.equal(out.length, 4);
  assert.equal(proposed[0][1], 'fallback');
});

test('photo descriptions use the Azure deployment with the image as a data URL', async () => {
  const { fn, calls } = recorder([{ content: 'Alex holding a birthday cake with candles.' }]);
  const d = await describeImage({ data: Buffer.from([1, 2, 3]), contentType: 'image/jpeg' }, 'Alex', '', fn);
  assert.equal(d, 'Alex holding a birthday cake with candles.');
  assert.equal(calls[0].body.model, 'gpt-chat-latest-2');
  assert.match(calls[0].body.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,AQID$/);
});

const period: Period = {
  patientName: 'Neal', hours: 3, now: new Date(2026, 10, 11, 21, 0),
  messages: [{ at: new Date(2026, 10, 11, 20, 0), who: 'Mom', text: 'Are you awake?', kind: 'in' }],
  alerts: [], heart: [70, 72], eyeMovements: 12,
};

test('briefings: Azure writes them instead of Gemini, labelled with the deployment', async () => {
  const { fn, calls } = recorder([{ content: 'Mom checked in at 8 PM. Neal is calm, heart rate around 71.' }]);
  const out = await writeBriefing(period, fn);
  assert.equal(out.model, 'azure:gpt-chat-latest-2');
  assert.match(out.text, /Mom checked in/);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].url, /googleapis/);
});

test('briefings: Azure failure falls back to the plain summary', async () => {
  const { fn } = recorder([new Response('nope', { status: 503 })]);
  const out = await writeBriefing(period, fn);
  assert.equal(out.model, 'rules');
  assert.match(out.text, /Neal/);
});
