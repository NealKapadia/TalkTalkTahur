/**
 * BlinkTalk agent, powered by NVIDIA Nemotron.
 *
 * Every glance costs the patient seconds, so the agent's job is to turn an
 * incoming text (or 2-3 keywords picked with the eyes) into a few complete,
 * first-person replies the patient can send with one double blink. It is not a
 * chatbot: it never answers on the patient's behalf. It plans, calls tools
 * against the SpacetimeDB state, screens the message for scams, may escalate to
 * caregivers, and only then proposes replies. Every step is written to the
 * agent_step table so caregivers (and judges) can watch it think.
 */
import { randomUUID } from 'node:crypto';
import type { Message } from '../../bindings/index.ts';
import { settings } from './env.ts';

// ------------------------------------------------------------------ ports
/** What the agent can read and do. Implemented over SpacetimeDB in main.ts, faked in tests. */
export interface AgentPorts {
  patientName: string;
  conversation(): Array<{ who: string; text: string; at?: string }>;
  patientState(): Record<string, unknown>;
  contact(): { name: string; relation: string; isCaregiver: boolean };
  flag(risk: 'ok' | 'caution' | 'scam', reason: string): Promise<void>;
  alertCaregivers(reason: string): Promise<void>;
  propose(replies: string[], source: 'nemotron' | 'fallback'): Promise<void>;
  log(step: string, detail: string): Promise<void>;
}

export type Task =
  | { kind: 'reply'; message: Pick<Message, 'body'> }
  | { kind: 'intent'; keywords: string };

// ------------------------------------------------------------------ guardrail screen (no network)
const SCAM_RULES: Array<[RegExp, string]> = [
  [/\b(ssn|social security( number)?)\b/i, 'asks for a Social Security number'],
  [/\bgift ?cards?\b/i, 'asks for gift cards'],
  [/\b(wire|zelle|venmo|cash ?app|bitcoin|crypto)\b.*\b(send|pay|transfer)|\b(send|pay|transfer)\b.*\b(wire|zelle|venmo|cash ?app|bitcoin|crypto)\b/i, 'asks for an untraceable payment'],
  [/\b(verify|confirm|update)\b.{0,30}\b(account|identity|card|password|pin)\b/i, 'asks to verify account details'],
  [/\b(suspended|locked|deactivated|frozen)\b/i, 'claims an account was suspended'],
  [/\b(one[- ]time|verification|security) code\b/i, 'asks for a one-time code'],
  [/\b(medicare|irs|social security administration)\b.{0,60}\b(call|click|pay|verify|suspend)/i, 'impersonates a government agency'],
  [/\b(grandson|granddaughter|grandma|grandpa)\b.{0,60}\b(jail|bail|accident|lawyer)\b/i, 'family-emergency scam pattern'],
  [/https?:\/\/(?!(www\.)?(apple|google|nvidia|utdallas)\.)[^\s]*(bit\.ly|tinyurl|\.xyz|\.top|\.click|login|verify)/i, 'contains a suspicious link'],
  [/\b(act now|urgent(ly)?|immediately|within 24 hours|final notice)\b/i, 'uses pressure language'],
];

export function screen(text: string): { risk: 'ok' | 'caution' | 'scam'; reasons: string[] } {
  const reasons = SCAM_RULES.filter(([re]) => re.test(text)).map(([, why]) => why);
  const pressureOnly = reasons.length === 1 && reasons[0] === 'uses pressure language';
  if (reasons.length >= 2 || (reasons.length === 1 && !pressureOnly)) return { risk: 'scam', reasons };
  if (pressureOnly) return { risk: 'caution', reasons };
  return { risk: 'ok', reasons };
}

// ------------------------------------------------------------------ deterministic fallback
export function fallbackReplies(task: Task, risk: 'ok' | 'caution' | 'scam'): string[] {
  if (risk === 'scam') {
    return ["I don't share personal info by text.", "I'll check with my family first.", 'Please stop texting me.', 'Who is this?'];
  }
  if (task.kind === 'intent') {
    const k = task.keywords.trim();
    const cap = k.charAt(0).toUpperCase() + k.slice(1);
    return [`${cap}, please.`, `Can we talk about ${k} later?`, `I need ${k}.`, `Yes, ${k}.`];
  }
  const t = task.message.body.toLowerCase();
  if (/\?\s*$/.test(t) || /\b(are|do|can|will|would|should|is)\s+you\b/.test(t)) {
    if (/\b(ok|okay|alright|doing|feel)/.test(t)) return ["I'm okay, thanks.", "Not great today.", 'Can you come by?', 'Call me later.'];
    if (/\b(visit|come|stop by|tonight|tomorrow)\b/.test(t)) return ['Yes, please come.', 'Not today, sorry.', 'Tomorrow is better.', 'What time?'];
    return ['Yes.', 'No.', 'Maybe later.', 'Can you call me?'];
  }
  return ['Thank you.', 'Love you.', 'Can you call me?', 'Talk soon.'];
}

// ------------------------------------------------------------------ Nemotron client
type ChatMsg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type Fetch = typeof fetch;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_conversation',
      description: 'Recent messages between the patient and this contact, oldest first.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_patient_state',
      description: "The patient's live state: heart rate trend, current status, local time, phrases they use most.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screen_message',
      description: 'Record your fraud/safety verdict on the incoming message. Call exactly once for replies.',
      parameters: {
        type: 'object',
        properties: {
          risk: { type: 'string', enum: ['ok', 'caution', 'scam'] },
          reason: { type: 'string', description: 'Short plain-language reason, with honest confidence.' },
        },
        required: ['risk', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'alert_caregivers',
      description: "Text the patient's caregivers. Only for real safety concerns (scam targeting them, a medical worry, an emergency).",
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_replies',
      description: 'Finish: give exactly 4 short first-person replies the patient can send with one selection.',
      parameters: {
        type: 'object',
        properties: { replies: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 } },
        required: ['replies'],
      },
    },
  },
] as const;

function systemPrompt(name: string): string {
  return [
    `You are the communication agent inside BlinkTalk. ${name} cannot speak or type; they control a screen with eye movements, and every selection costs several seconds.`,
    'You never message anyone yourself. You prepare 4 reply options that sound like the patient (first person, warm, plain, max 12 words each, no emojis unless the conversation uses them).',
    'Make the 4 options meaningfully different (e.g. yes / no / not now / ask a question). Use facts from the tools; never invent plans, names or medical facts.',
    'Workflow: 1) get_conversation and get_patient_state; 2) for incoming messages, screen_message with an honest verdict; 3) alert_caregivers only for genuine safety issues; 4) propose_replies.',
    'If a message looks like a scam, replies must protect the patient (never share data, offer to check with family).',
  ].join('\n');
}

function taskPrompt(task: Task, contact: { name: string; relation: string }, guard: ReturnType<typeof screen>): string {
  if (task.kind === 'intent') {
    return `The patient selected these keywords with their eyes: "${task.keywords}". Expand them into 4 complete replies to ${contact.name} (${contact.relation || 'contact'}), using the conversation for context. No screening needed.`;
  }
  const hint = guard.reasons.length ? ` A rule-based pre-screen noticed: ${guard.reasons.join('; ')}.` : '';
  return `New message from ${contact.name} (${contact.relation || 'unknown relation'}): "${task.message.body}".${hint} Follow the workflow.`;
}

export function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export function parseRepliesFromText(s: string): string[] | null {
  const text = stripThinking(s);
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (Array.isArray(j.replies)) return j.replies.map(String);
    } catch { /* fall through */ }
  }
  const lines = text.split('\n').map(l => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(/^"|"$/g, '').trim()).filter(Boolean);
  return lines.length >= 2 ? lines.slice(0, 4) : null;
}

async function chat(fetchFn: Fetch, messages: ChatMsg[], useTools: boolean): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  const body: Record<string, unknown> = {
    model: settings.nemotronModel,
    messages,
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: 800,
  };
  if (useTools) { body.tools = TOOLS; body.tool_choice = 'auto'; }
  if (!settings.nemotronThinking) body.chat_template_kwargs = { enable_thinking: false };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), settings.nemotronTimeoutMs);
  try {
    const res = await fetchFn(`${settings.nemotronBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.nvidiaKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 300);
      throw Object.assign(new Error(`Nemotron HTTP ${res.status}: ${txt}`), { status: res.status });
    }
    const data = (await res.json()) as { choices?: Array<{ message: { content: string | null; tool_calls?: ToolCall[] } }> };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('Nemotron returned no choices');
    return msg;
  } finally {
    clearTimeout(timer);
  }
}

function clampReplies(replies: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of replies) {
    const t = stripThinking(String(r)).replace(/\s+/g, ' ').trim().slice(0, 140);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out.slice(0, 4);
}

// ------------------------------------------------------------------ the run
export async function runAgent(task: Task, ports: AgentPorts, fetchFn: Fetch = fetch): Promise<string[]> {
  const runId = randomUUID().slice(0, 8);
  const log = (step: string, detail: string) => ports.log(step, `[${runId}] ${detail}`);
  const contact = ports.contact();
  const guard = task.kind === 'reply' ? screen(task.message.body) : { risk: 'ok' as const, reasons: [] };
  let verdict: 'ok' | 'caution' | 'scam' = guard.risk;
  let flagged = false;
  let alerted = false;

  await log('plan', task.kind === 'reply'
    ? `Incoming text from ${contact.name}. Plan: read context -> screen for fraud -> draft 4 replies.`
    : `Patient picked "${task.keywords}". Plan: read context -> expand into 4 full replies.`);

  const finishFallback = async (why: string) => {
    await log('fallback', why);
    if (task.kind === 'reply' && !flagged) {
      await ports.flag(guard.risk, guard.reasons.join('; ') || 'No warning signs found by the rule-based screen.');
      if (guard.risk === 'scam' && !alerted) await ports.alertCaregivers(`Possible scam text to ${ports.patientName} from ${contact.name}: ${guard.reasons.join(', ')}`);
    }
    const replies = fallbackReplies(task, guard.risk);
    await ports.propose(replies, 'fallback');
    await log('reply', replies.join(' | '));
    return replies;
  };

  if (!settings.nvidiaKey) return finishFallback('NVIDIA_API_KEY not set; using on-device rules.');

  const messages: ChatMsg[] = [
    { role: 'system', content: systemPrompt(ports.patientName) },
    { role: 'user', content: taskPrompt(task, contact, guard) },
  ];
  let useTools = true;

  for (let turn = 0; turn < 6; turn++) {
    let msg;
    try {
      msg = await chat(fetchFn, messages, useTools);
    } catch (err: any) {
      if (useTools && err?.status && err.status >= 400 && err.status < 500) {
        await log('error', `Tool calling rejected (${err.status}); retrying in JSON mode.`);
        useTools = false;
        messages.push({ role: 'user', content: `Tools are unavailable. Context: conversation=${JSON.stringify(ports.conversation())} state=${JSON.stringify(ports.patientState())}. Reply ONLY with JSON: {"risk":"ok|caution|scam","reason":"...","replies":["","","",""]}` });
        continue;
      }
      return finishFallback(`Nemotron unavailable (${String(err?.message ?? err).slice(0, 160)}).`);
    }

    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      const text = msg.content ?? '';
      if (!useTools && task.kind === 'reply') {
        try {
          const j = JSON.parse(stripThinking(text).match(/\{[\s\S]*\}/)?.[0] ?? '{}');
          if (['ok', 'caution', 'scam'].includes(j.risk)) {
            verdict = guard.risk === 'scam' && j.risk === 'ok' ? 'caution' : j.risk;
            await ports.flag(verdict, String(j.reason ?? ''));
            flagged = true;
            await log('result', `screen -> ${verdict}: ${j.reason ?? ''}`);
          }
        } catch { /* ignore */ }
      }
      const parsed = parseRepliesFromText(text);
      if (parsed && clampReplies(parsed).length >= 2) {
        if (task.kind === 'reply' && !flagged) {
          await ports.flag(verdict, guard.reasons.join('; ') || 'Model gave no verdict; rule screen found nothing.');
          flagged = true;
        }
        const replies = clampReplies(parsed);
        await ports.propose(replies, 'nemotron');
        await log('reply', replies.join(' | '));
        return replies;
      }
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: 'Call propose_replies with exactly 4 replies now.' });
      continue;
    }

    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
    for (const call of calls) {
      let args: any = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* keep {} */ }
      let result: unknown;
      switch (call.function.name) {
        case 'get_conversation':
          result = ports.conversation();
          break;
        case 'get_patient_state':
          result = ports.patientState();
          break;
        case 'screen_message': {
          let risk = (['ok', 'caution', 'scam'].includes(args.risk) ? args.risk : 'caution') as typeof verdict;
          // The rule screen is a floor: the model can raise risk, not wave off a rule hit.
          if (guard.risk === 'scam' && risk === 'ok') risk = 'caution';
          verdict = risk;
          if (task.kind === 'reply') {
            await ports.flag(risk, String(args.reason ?? ''));
            flagged = true;
          }
          result = { recorded: risk };
          break;
        }
        case 'alert_caregivers':
          if (!alerted) { await ports.alertCaregivers(String(args.reason ?? 'Agent safety concern')); alerted = true; }
          result = { sent: true };
          break;
        case 'propose_replies': {
          const replies = clampReplies(Array.isArray(args.replies) ? args.replies : []);
          if (replies.length >= 2) {
            if (task.kind === 'reply' && !flagged) await ports.flag(verdict, guard.reasons.join('; ') || 'No warning signs.');
            await log('tool', `propose_replies(${replies.length})`);
            await ports.propose(replies, 'nemotron');
            await log('reply', replies.join(' | '));
            return replies;
          }
          result = { error: 'need 4 non-empty replies' };
          break;
        }
        default:
          result = { error: `unknown tool ${call.function.name}` };
      }
      await log('tool', `${call.function.name}(${JSON.stringify(args).slice(0, 120)}) -> ${JSON.stringify(result).slice(0, 200)}`);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return finishFallback('Agent did not finish in 6 steps.');
}
