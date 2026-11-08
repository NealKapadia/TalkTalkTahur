import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhoton, handleKey } from '../src/photon.ts';

const LINE = { id: 'usr_line', handle: '+14155550000', platform: 'imessage' };
const inbound = (id: string, from: string, text: string, createdAt = new Date().toISOString()) => ({
  id, platform: 'imessage', status: 'received', createdAt,
  content: { type: 'text', format: 'plain', text },
  sentBy: { id: `usr_${from}`, handle: from, platform: 'imessage' },
  receivedBy: LINE,
  space: { id: `spc_${from}`, platform: 'imessage' },
});

function fakeApi(pages: any[][]) {
  const requests: Array<{ url: string; init?: any }> = [];
  const fn = (async (url: string, init?: any) => {
    requests.push({ url, init });
    if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'msg_out' }), { status: 202 });
    const items = pages.shift() ?? [];
    return new Response(JSON.stringify({ items }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, requests };
}

test('polls inbound texts, dedupes, and replies in the same chat from the same line', async () => {
  const got: any[] = [];
  const { fn, requests } = fakeApi([
    [inbound('m1', '+14695550101', 'hi Neal'), inbound('m2', '+14695550101', 'are you up?')],
    [inbound('m2', '+14695550101', 'are you up?')],           // overlap window repeat
  ]);
  const p = createPhoton({ apiKey: 'k', projectId: 'pho_prj_x', fetchFn: fn, routesFile: null, pollMs: 0, onText: async t => { got.push(t); } });
  assert.equal(await p.pollOnce(), 2);
  assert.equal(await p.pollOnce(), 0);
  assert.deepEqual(got.map(g => g.body), ['hi Neal', 'are you up?']);
  assert.equal(got[0].address, '+14695550101');

  const list = new URL(requests[0].url);
  assert.equal(list.pathname, '/v1/projects/pho_prj_x/messages');
  assert.equal(list.searchParams.get('direction'), 'received');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer k');

  assert.ok(p.canReach('+1 (469) 555-0101'));
  await p.send('+1 (469) 555-0101', 'Yes, come by at 7.');
  const post = requests.find(r => r.init?.method === 'POST')!;
  const body = JSON.parse(post.init.body);
  assert.deepEqual(body, { spaceId: 'spc_+14695550101', senderId: 'usr_line', content: { type: 'text', format: 'plain', text: 'Yes, come by at 7.' } });
  assert.ok(post.init.headers['idempotency-key']);
});

test('refuses to text someone who never texted the line (shared-line rule)', async () => {
  const { fn } = fakeApi([]);
  const p = createPhoton({ apiKey: 'k', projectId: 'p', fetchFn: fn, routesFile: null, pollMs: 0, onText: async () => {} });
  assert.equal(p.canReach('+19725550142'), false);
  await assert.rejects(() => p.send('+19725550142', 'SOS'), /has not texted the BlinkTalk line/);
});

test('ignores non-text and agent-sent items', async () => {
  const got: any[] = [];
  const own = { ...inbound('m3', '+14155550000', 'echo'), sentBy: LINE };
  const typing = { ...inbound('m4', '+14695550101', ''), content: { type: 'space.typing.update' } };
  const { fn } = fakeApi([[own, typing]]);
  const p = createPhoton({ apiKey: 'k', projectId: 'p', fetchFn: fn, routesFile: null, pollMs: 0, onText: async t => { got.push(t); } });
  assert.equal(await p.pollOnce(), 0);
  assert.equal(got.length, 0);
});

test('handle normalisation', () => {
  assert.equal(handleKey('+1 (469) 555-0101'), '+14695550101');
  assert.equal(handleKey(' Mom@iCloud.com '), 'mom@icloud.com');
});
