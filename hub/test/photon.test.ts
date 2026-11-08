import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhoton, handleKey, readContent } from '../src/photon.ts';

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

test('reads text, single attachments and text+photo groups', () => {
  assert.deepEqual(readContent({ type: 'text', text: 'hi' }), { text: 'hi', attachmentIds: [] });
  assert.deepEqual(readContent({ type: 'attachment', attachmentId: 'att_1' }), { text: '', attachmentIds: ['att_1'] });
  assert.deepEqual(readContent({ type: 'group', parts: [{ type: 'text', text: 'look!' }, { type: 'attachment', attachmentId: 'att_2' }] }), { text: 'look!', attachmentIds: ['att_2'] });
  assert.equal(readContent({ type: 'space.typing.update' }), null);
});

test('photo messages reach the hub with attachment ids; download retries while not ready', async () => {
  const got: any[] = [];
  let downloads = 0;
  const photoMsg = { ...inbound('m9', '+14695550101', ''), content: { type: 'group', parts: [{ type: 'text', text: 'dinner!' }, { type: 'attachment', attachmentId: 'att_9' }] } };
  const fn = (async (url: string) => {
    if (url.includes('/attachments/')) {
      downloads++;
      if (downloads === 1) return new Response('{}', { status: 409, headers: { 'retry-after': '0' } });
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    return new Response(JSON.stringify({ items: [photoMsg] }), { status: 200 });
  }) as unknown as typeof fetch;
  const p = createPhoton({ apiKey: 'k', projectId: 'p', fetchFn: fn, routesFile: null, pollMs: 0, onText: async t => { got.push(t); } });
  await p.pollOnce();
  assert.deepEqual(got[0].attachmentIds, ['att_9']);
  assert.equal(got[0].body, 'dinner!');
  const img = await p.download('att_9');
  assert.equal(img.contentType, 'image/jpeg');
  assert.equal(img.data.length, 3);
  assert.equal(downloads, 2);
});
