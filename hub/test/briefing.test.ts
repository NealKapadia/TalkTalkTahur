import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Period } from '../src/briefing.ts';

process.env.AZURE_OPENAI_API_KEY = '';            // these tests cover the Gemini path
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GEMINI_MODEL = 'gemini-flash-latest';
const { writeBriefing, periodToText, rulesBriefing } = await import('../src/briefing.ts');

const at = (h: number, m: number) => new Date(2026, 10, 8, h, m);
const period: Period = {
  patientName: 'Neal', hours: 12, now: at(9, 0),
  messages: [
    { at: at(1, 5), who: 'Mom', text: 'Are you awake?', kind: 'in' },
    { at: at(1, 6), who: 'Mom', to: 'Mom', text: 'Yes, can you come by?', kind: 'out', assisted: true },
    { at: at(2, 0), who: 'someone', text: "I'd like some water, please.", kind: 'spoken' },
  ],
  alerts: [{ at: at(2, 13), kind: 'sos', ackedBy: 'Mom', ackSeconds: 40, level: 1 }],
  heart: [70, 72, 74],
  eyeMovements: 182,
};

test('the data Gemini sees: words, alerts with answer time, heart rate; no phone numbers', () => {
  const t = periodToText(period);
  assert.match(t, /SOS|sos/);
  assert.match(t, /answered by Mom after 40s/);
  assert.match(t, /average 72 bpm/);
  assert.match(t, /\[chosen from AI suggestions\]/);
  assert.doesNotMatch(t, /\+\d{8,}/);
});

test('calls Gemini generateContent with the API key header and returns its text', async () => {
  const calls: Array<{ url: string; init: any }> = [];
  const fn = (async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Neal had a calm night. Mom answered his 2:13am SOS in 40 seconds.' }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await writeBriefing(period, fn);
  assert.equal(out.model, 'gemini-flash-latest');
  assert.match(out.text, /40 seconds/);
  assert.match(calls[0].url, /models\/gemini-flash-latest:generateContent$/);
  assert.equal(calls[0].init.headers['X-goog-api-key'], 'test-gemini-key');
  assert.match(JSON.parse(calls[0].init.body).contents[0].parts[0].text, /handoff notes/);
});

test('Gemini error falls back to a plain rule-based summary', async () => {
  const fn = (async () => new Response('quota', { status: 429 })) as unknown as typeof fetch;
  const out = await writeBriefing(period, fn);
  assert.equal(out.model, 'rules');
  assert.match(out.text, /answered by Mom in 40 seconds/);
  assert.equal(out.text, rulesBriefing(period));
});
