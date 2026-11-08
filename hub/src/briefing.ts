/**
 * Caregiver briefing, written by Google Gemini.
 *
 * Nemotron is the patient's keyboard; Gemini writes for the family. A caregiver
 * taps "Catch me up" and Gemini turns the last N hours (conversation, alerts and
 * how fast they were answered, heart rate, how much the patient communicated)
 * into a short, warm, plain-language handoff note, like a nurse's shift handoff.
 * Only first names and the patient's own words are sent: no phone numbers.
 * With no GEMINI_API_KEY the hub writes a plain rule-based summary instead.
 */
import { settings } from './env.ts';

export interface Period {
  patientName: string;
  hours: number;
  now: Date;
  messages: Array<{ at: Date; who: string; to?: string; text: string; kind: 'in' | 'out' | 'spoken'; assisted?: boolean }>;
  alerts: Array<{ at: Date; kind: string; ackedBy?: string; ackSeconds?: number; level: number }>;
  heart: number[];          // good-quality bpm samples in the period
  eyeMovements: number;
}

export type Fetch = typeof fetch;

const clock = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function periodToText(p: Period): string {
  const lines: string[] = [];
  lines.push(`Patient: ${p.patientName}. Window: last ${p.hours} hours, ending ${p.now.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}.`);
  if (p.heart.length) {
    const avg = Math.round(p.heart.reduce((a, b) => a + b, 0) / p.heart.length);
    lines.push(`Heart rate: average ${avg} bpm, range ${Math.min(...p.heart)}-${Math.max(...p.heart)} bpm over ${p.heart.length} readings.`);
  } else lines.push('Heart rate: no readings.');
  lines.push(`Eye movements made on the speller: ${p.eyeMovements}.`);
  lines.push(`Alerts (${p.alerts.length}):`);
  for (const a of p.alerts) {
    lines.push(`- ${clock(a.at)} ${a.kind}${a.ackedBy ? `, answered by ${a.ackedBy}${a.ackSeconds !== undefined ? ` after ${a.ackSeconds}s` : ''}` : ', not answered yet'}${a.level > 1 ? `, escalated to tier ${a.level}` : ''}`);
  }
  lines.push(`Messages (${p.messages.length}), oldest first:`);
  for (const m of p.messages.slice(-60)) {
    const who = m.kind === 'in' ? m.who : m.kind === 'spoken' ? `${p.patientName} (said aloud)` : `${p.patientName} to ${m.to ?? 'someone'}`;
    lines.push(`- ${clock(m.at)} ${who}: ${m.text.slice(0, 240)}${m.assisted ? ' [chosen from AI suggestions]' : ''}`);
  }
  return lines.join('\n');
}

const PROMPT = (data: string) => `You write short handoff notes for the family and caregivers of someone with ALS who communicates only with eye movements.
Write 3 to 5 sentences in plain, warm, factual English for a family member catching up. Cover: who they talked with and what they asked for or said (quote their own words briefly when it matters), any alerts and how quickly they were answered, heart rate if notable, and anything a caregiver should follow up on. Do not invent anything that is not in the data. Do not give medical advice. No headings, no bullet points.

Data:
${data}`;

/** Plain summary used when Gemini isn't configured or fails. */
export function rulesBriefing(p: Period): string {
  const out = p.messages.filter(m => m.kind !== 'in').length;
  const people = [...new Set(p.messages.filter(m => m.kind === 'in').map(m => m.who))];
  const parts = [`In the last ${p.hours} hours ${p.patientName} sent or said ${out} ${out === 1 ? 'message' : 'messages'}${people.length ? ` and heard from ${people.join(', ')}` : ''}.`];
  if (p.alerts.length) {
    parts.push(p.alerts.map(a => `${a.kind === 'sos' ? 'An SOS' : 'A heart-rate alert'} at ${clock(a.at)} was ${a.ackedBy ? `answered by ${a.ackedBy}${a.ackSeconds !== undefined ? ` in ${a.ackSeconds} seconds` : ''}` : 'not answered yet'}.`).join(' '));
  } else parts.push('There were no alerts.');
  if (p.heart.length) parts.push(`Heart rate averaged ${Math.round(p.heart.reduce((a, b) => a + b, 0) / p.heart.length)} bpm.`);
  const last = [...p.messages].reverse().find(m => m.kind !== 'in');
  if (last) parts.push(`Their latest words: “${last.text.slice(0, 120)}”.`);
  return parts.join(' ');
}

export async function writeBriefing(p: Period, fetchFn: Fetch = fetch): Promise<{ text: string; model: string }> {
  if (!settings.geminiKey) return { text: rulesBriefing(p), model: 'rules' };
  try {
    const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': settings.geminiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT(periodToText(p)) }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
      }),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (data.candidates?.[0]?.content?.parts ?? []).map(x => x.text ?? '').join('').trim();
    if (!text) throw new Error('Gemini returned no text');
    return { text: text.slice(0, 2000), model: settings.geminiModel };
  } catch (err) {
    console.error('[briefing] Gemini unavailable, using rules:', String((err as Error).message ?? err).slice(0, 200));
    return { text: rulesBriefing(p), model: 'rules' };
  }
}
